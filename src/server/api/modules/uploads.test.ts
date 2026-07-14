import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";

import type { ApiProblem } from "../../../shared/api/common";
import type {
	CompleteUploadsResponse,
	UploadCredentialsResponse,
} from "../../../shared/api/uploads";
import type { SafeSessionView } from "../../auth/session.server";
import {
	UploadMetadataConflictError,
	type UploadsService,
	UploadsValidationError,
	UploadVerificationUnavailableError,
} from "../../domain/uploads.server";
import { ApiRequestContextStore } from "../context.server";
import { mapApiError } from "../problem";
import { createUploadsModule } from "./uploads";

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

function service(overrides: Partial<UploadsService> = {}): UploadsService {
	return {
		complete: vi.fn(async () => completeResponse),
		issueCredentials: vi.fn(async () => credentialsResponse),
		...overrides,
	};
}

function testApp(
	uploadsService: UploadsService,
	options: { readonly audit?: boolean; readonly session?: boolean } = {},
) {
	const contextStore = new ApiRequestContextStore();
	const getUploadsService = vi.fn(() => uploadsService);
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
		.use(createUploadsModule({ contextStore, getUploadsService }));
	return { app, getUploadsService };
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
		const { app } = testApp(service({ complete }));

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
