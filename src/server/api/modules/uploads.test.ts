import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";

import type { ApiProblem } from "../../../shared/api/common";
import type {
	CompleteUploadsResponse,
	UploadCredentialsResponse,
} from "../../../shared/api/uploads";
import {
	MAX_COMPLETE_UPLOAD_FILES,
	UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE,
	UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE,
} from "../../../shared/api/uploads";
import type { SafeSessionView } from "../../auth/session.server";
import type {
	RateLimitDecision,
	RateLimitInput,
} from "../../db/repositories/rate-limit.server";
import {
	UploadMetadataConflictError,
	UploadObjectNotFoundError,
	type UploadsService,
	UploadsValidationError,
	UploadVerificationUnavailableError,
} from "../../domain/uploads.server";
import { ApiRequestContextStore } from "../context.server";
import { UPLOAD_COMPLETION_FILE_POLICY } from "../plugins/rate-limit.server";
import { mapApiError } from "../problem";
import {
	createUploadCompletionInFlightLimiter,
	createUploadsModule,
	type UploadCompletionInFlightLimiter,
} from "./uploads";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const FILE_ID = "00000000-0000-4000-8000-000000000002";
const SHA256 = "a".repeat(64);
const OBJECT_KEY = `releases/${SHA256}/desktop/app.bin`;

const credentialsResponse: UploadCredentialsResponse = {
	bucket: "updater-artifacts",
	credentials: {
		accessKeyId: "STS.temporary",
		accessKeySecret: "temporary-secret",
		expiration: "2026-07-15T01:15:00.000Z",
		securityToken: "temporary-token",
	},
	objects: [{ objectKey: OBJECT_KEY, path: "desktop/app.bin" }],
	region: "oss-cn-hangzhou",
};

const completeResponse: CompleteUploadsResponse = {
	files: [
		{
			checksumAlgorithm: "sha256",
			createdAt: "2026-07-15T01:00:00.000Z",
			id: FILE_ID,
			mimeType: "application/octet-stream",
			objectEtag: "etag-1",
			path: "desktop/app.bin",
			sha256: SHA256,
			size: "42",
			updatedAt: "2026-07-15T01:00:00.000Z",
		},
	],
};

function baseFile() {
	return {
		mimeType: "application/octet-stream",
		path: "desktop/app.bin",
		sha256: SHA256,
		size: "42",
	};
}

function completedFile() {
	return {
		...baseFile(),
		objectEtag: '"etag-1"',
		objectKey: OBJECT_KEY,
	};
}

function reconciliationFile() {
	return {
		...baseFile(),
		objectKey: OBJECT_KEY,
	};
}

function allowedRateLimitDecision(
	overrides: Partial<RateLimitDecision> = {},
): RateLimitDecision {
	return {
		allowed: true,
		count: 1,
		limit: UPLOAD_COMPLETION_FILE_POLICY.limit,
		remaining: UPLOAD_COMPLETION_FILE_POLICY.limit - 1,
		resetAt: new Date("2026-07-15T01:15:00.000Z"),
		retryAfterSeconds: 900,
		...overrides,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function service(overrides: Partial<UploadsService> = {}): UploadsService {
	return {
		complete: vi.fn(async () => completeResponse),
		issueCredentials: vi.fn(async () => credentialsResponse),
		...overrides,
	};
}

function testApp(
	uploadsService: UploadsService,
	options: {
		readonly audit?: boolean;
		readonly completionInFlightLimiter?: UploadCompletionInFlightLimiter;
		readonly consumeCompletionRateLimit?: (
			input: RateLimitInput,
		) => Promise<RateLimitDecision>;
		readonly now?: () => Date;
		readonly session?: boolean;
	} = {},
) {
	const contextStore = new ApiRequestContextStore();
	const getUploadsService = vi.fn(() => uploadsService);
	const consumeCompletionRateLimit = vi.fn(
		options.consumeCompletionRateLimit ??
			(async () => allowedRateLimitDecision()),
	);
	const app = new Elysia({ normalize: false })
		.onError((context) =>
			mapApiError(context, {
				getRequestId: (request) =>
					contextStore.getRequestId(request) ?? "req_fallback",
			}),
		)
		.onRequest(({ request }) => {
			contextStore.initialize(request, "req_test");
			if (options.session !== false) {
				contextStore.setSession(request, {
					user: { id: ACTOR_ID },
				} as SafeSessionView);
			}
			if (options.audit !== false) {
				contextStore.setAudit(request, {
					actorId: ACTOR_ID,
					ip: "203.0.113.8",
					requestId: "req_test",
					userAgent: "vitest",
				});
			}
		})
		.use(
			createUploadsModule({
				...(options.completionInFlightLimiter
					? {
							completionInFlightLimiter: options.completionInFlightLimiter,
						}
					: {}),
				consumeCompletionRateLimit,
				contextStore,
				getUploadsService,
				now: options.now ?? (() => new Date("2026-07-15T01:00:00.000Z")),
			}),
		);
	return { app, consumeCompletionRateLimit, getUploadsService };
}

async function readProblem(response: Response): Promise<ApiProblem> {
	expect(response.headers.get("content-type")).toBe("application/problem+json");
	return (await response.json()) as ApiProblem;
}

function post(path: string, body: unknown) {
	return new Request(`http://localhost${path}`, {
		body: JSON.stringify(body),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
}

describe("uploads Elysia module", () => {
	it("tracks in-flight slots per actor and releases them idempotently", () => {
		const limiter = createUploadCompletionInFlightLimiter(1);
		const releaseActorA = limiter.tryAcquire("actor-a");
		expect(releaseActorA).toBeTypeOf("function");
		expect(limiter.tryAcquire("actor-a")).toBeNull();
		const releaseActorB = limiter.tryAcquire("actor-b");
		expect(releaseActorB).toBeTypeOf("function");

		releaseActorA?.();
		releaseActorA?.();
		expect(limiter.tryAcquire("actor-a")).toBeTypeOf("function");
		releaseActorB?.();
	});

	it("keeps service creation lazy and issues only short-lived credentials", async () => {
		const issueCredentials = vi.fn(async () => credentialsResponse);
		const { app, getUploadsService } = testApp(service({ issueCredentials }));
		expect(getUploadsService).not.toHaveBeenCalled();

		const response = await app.handle(
			post("/uploads/credentials", { files: [baseFile()] }),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual(credentialsResponse);
		expect(issueCredentials).toHaveBeenCalledWith(
			{ files: [baseFile()] },
			expect.objectContaining({
				actorId: ACTOR_ID,
				requestId: "req_test",
			}),
		);
	});

	it("forwards metadata-only completion with the request audit context", async () => {
		const complete = vi.fn(async () => completeResponse);
		const { app, consumeCompletionRateLimit } = testApp(service({ complete }));

		const response = await app.handle(
			post("/uploads/complete", { files: [completedFile()] }),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual(completeResponse);
		expect(complete).toHaveBeenCalledWith(
			{ files: [completedFile()] },
			expect.objectContaining({
				actorId: ACTOR_ID,
				requestId: "req_test",
			}),
		);
		expect(consumeCompletionRateLimit).toHaveBeenCalledWith({
			cost: 1,
			endpoint: "uploads.complete.files",
			limit: 2_000,
			now: new Date("2026-07-15T01:00:00.000Z"),
			subjectKey: ACTOR_ID,
			windowSeconds: 15 * 60,
		});
	});

	it("charges completion quota by validated file count", async () => {
		const second = {
			...completedFile(),
			objectKey: `${OBJECT_KEY}.second`,
			path: "desktop/app-second.bin",
		};
		const { app, consumeCompletionRateLimit } = testApp(service());

		const response = await app.handle(
			post("/uploads/complete", { files: [completedFile(), second] }),
		);

		expect(response.status).toBe(200);
		expect(consumeCompletionRateLimit).toHaveBeenCalledWith(
			expect.objectContaining({ cost: 2, subjectKey: ACTOR_ID }),
		);
	});

	it("returns a sanitized rate-limit problem before service work when the file budget is exhausted", async () => {
		const complete = vi.fn(async () => completeResponse);
		const { app, getUploadsService } = testApp(service({ complete }), {
			consumeCompletionRateLimit: async () =>
				allowedRateLimitDecision({
					allowed: false,
					count: 2_001,
					remaining: 0,
					retryAfterSeconds: 321,
				}),
		});

		const response = await app.handle(
			post("/uploads/complete", { files: [completedFile()] }),
		);
		const serialized = JSON.stringify(await readProblem(response));

		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("321");
		expect(response.headers.get("ratelimit-limit")).toBe("2000");
		expect(serialized).toContain("RATE_LIMITED");
		expect(serialized).not.toContain(ACTOR_ID);
		expect(serialized).not.toContain(OBJECT_KEY);
		expect(getUploadsService).not.toHaveBeenCalled();
		expect(complete).not.toHaveBeenCalled();
	});

	it("caps concurrent completion work per actor and releases the slot deterministically", async () => {
		const firstStarted = deferred<void>();
		const firstResult = deferred<CompleteUploadsResponse>();
		let calls = 0;
		const complete = vi.fn(async () => {
			calls += 1;
			if (calls === 1) {
				firstStarted.resolve();
				return firstResult.promise;
			}
			return completeResponse;
		});
		const { app } = testApp(service({ complete }), {
			completionInFlightLimiter: createUploadCompletionInFlightLimiter(1),
		});

		const first = app.handle(
			post("/uploads/complete", { files: [completedFile()] }),
		);
		await firstStarted.promise;
		const concurrent = await app.handle(
			post("/uploads/complete", { files: [completedFile()] }),
		);
		const concurrentProblem = await readProblem(concurrent);
		expect(concurrent.status).toBe(429);
		expect(concurrent.headers.get("retry-after")).toBe("1");
		expect(concurrentProblem).toMatchObject({
			code: "RATE_LIMITED",
			retryAfterSeconds: 1,
		});
		expect(JSON.stringify(concurrentProblem)).not.toContain(ACTOR_ID);
		expect(complete).toHaveBeenCalledTimes(1);

		firstResult.resolve(completeResponse);
		expect((await first).status).toBe(200);
		expect(
			(
				await app.handle(
					post("/uploads/complete", { files: [completedFile()] }),
				)
			).status,
		).toBe(200);
		expect(complete).toHaveBeenCalledTimes(2);
	});

	it("accepts an omitted ETag for server-side completion reconciliation", async () => {
		const complete = vi.fn(async () => completeResponse);
		const { app } = testApp(service({ complete }));

		const response = await app.handle(
			post("/uploads/complete", { files: [reconciliationFile()] }),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(completeResponse);
		expect(complete).toHaveBeenCalledWith(
			{ files: [reconciliationFile()] },
			expect.objectContaining({ actorId: ACTOR_ID }),
		);
	});

	it("rejects file bodies, unknown fields, malformed hashes, and excess metadata before service work", async () => {
		const { app, getUploadsService } = testApp(service());
		for (const request of [
			post("/uploads/credentials", {
				files: [{ ...baseFile(), body: "must-not-cross-netlify" }],
			}),
			post("/uploads/credentials", {
				files: [{ ...baseFile(), sha256: "A".repeat(64) }],
				permanentAccessKeySecret: "must-not-be-accepted",
			}),
			post("/uploads/complete", {
				file: "must-not-cross-netlify",
				files: [completedFile()],
			}),
			post("/uploads/complete", {
				files: [{ ...completedFile(), objectEtag: "" }],
			}),
			post("/uploads/complete", {
				files: Array.from(
					{ length: MAX_COMPLETE_UPLOAD_FILES + 1 },
					(_, index) => ({
						...completedFile(),
						objectKey: `${OBJECT_KEY}.${index}`,
						path: `desktop/app-${index}.bin`,
					}),
				),
			}),
		]) {
			const response = await app.handle(request);
			expect(response.status).toBe(422);
			const serialized = JSON.stringify(await readProblem(response));
			expect(serialized).not.toContain("must-not-cross-netlify");
			expect(serialized).not.toContain("must-not-be-accepted");
		}
		expect(getUploadsService).not.toHaveBeenCalled();
	});

	it("maps validation, proof conflict, and provider outage to compact problems", async () => {
		const cases = [
			{
				code: "VALIDATION_FAILED",
				error: new UploadsValidationError([
					{ code: "INVALID_FORMAT", path: "files.0.sha256" },
				]),
				status: 422,
			},
			{
				code: "UPLOAD_METADATA_CONFLICT",
				error: new UploadMetadataConflictError([
					{ code: "CONFLICT", path: "files.0.objectEtag" },
				]),
				status: 409,
			},
			{
				code: UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE,
				error: new UploadObjectNotFoundError(0),
				status: 409,
			},
			{
				code: "UPLOAD_VERIFICATION_UNAVAILABLE",
				error: new UploadVerificationUnavailableError(),
				status: 503,
			},
		] as const;

		for (const testCase of cases) {
			const { app } = testApp(
				service({
					complete: async () => {
						throw testCase.error;
					},
				}),
			);
			const response = await app.handle(
				post("/uploads/complete", { files: [completedFile()] }),
			);
			const problem = await readProblem(response);
			expect(response.status).toBe(testCase.status);
			expect(problem).toMatchObject({
				code: testCase.code,
				requestId: "req_test",
				status: testCase.status,
			});
			if (testCase.code === UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE) {
				expect(problem.fieldErrors).toEqual([
					{
						code: UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE,
						path: "files.0.objectKey",
					},
				]);
			}
			expect(JSON.stringify(problem)).not.toContain("temporary-secret");
		}
	});

	it("requires a session and completion audit context before resolving the service", async () => {
		const noSession = testApp(service(), { session: false });
		const credentials = await noSession.app.handle(
			post("/uploads/credentials", { files: [baseFile()] }),
		);
		expect(credentials.status).toBe(500);
		expect(noSession.getUploadsService).not.toHaveBeenCalled();

		const noAudit = testApp(service(), { audit: false });
		const complete = await noAudit.app.handle(
			post("/uploads/complete", { files: [completedFile()] }),
		);
		expect(complete.status).toBe(500);
		expect(noAudit.getUploadsService).not.toHaveBeenCalled();
	});
});
