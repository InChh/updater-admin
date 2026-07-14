import { APIError } from "better-auth/api";
import { t } from "elysia";
import { describe, expect, it, vi } from "vitest";

import {
	ApiProblemError as ClientApiProblemError,
	createApiClient,
} from "../../lib/api/client";
import type { ApiProblem } from "../../shared/api/common";
import {
	formatWeakEntityTag,
	isWellFormedUnicode,
} from "../../shared/api/common";
import type { SafeSessionView } from "../auth/session.server";
import type { AppendAuditEventInput } from "../db/repositories/audit.server";
import type { ProgramsService } from "../domain/programs.server";
import type { UploadsService } from "../domain/uploads.server";
import type { FilesService, VersionsService } from "../domain/versions.server";
import {
	type ApiAppDependencies,
	createApiApp,
	forwardApiRequest,
} from "./app.server";
import { requireExactIfMatch } from "./problem";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000002";
const PROGRAM_ID = "00000000-0000-4000-8000-000000000003";
const VERSION_ID = "00000000-0000-4000-8000-000000000004";
const FILE_ID = "00000000-0000-4000-8000-000000000005";

function safeSession(
	overrides: {
		readonly banned?: boolean;
		readonly mustChangePassword?: boolean;
	} = {},
): SafeSessionView {
	return {
		metadata: {
			lastLoginAt: "2026-07-14T01:00:00.000Z",
			locale: "zh-CN",
			mustChangePassword: overrides.mustChangePassword ?? false,
		},
		session: {
			createdAt: "2026-07-14T00:00:00.000Z",
			expiresAt: "2026-07-21T00:00:00.000Z",
			id: SESSION_ID,
			updatedAt: "2026-07-14T00:00:00.000Z",
		},
		user: {
			banned: overrides.banned ?? false,
			email: "admin@example.com",
			emailVerified: true,
			id: USER_ID,
			image: null,
			name: "Admin",
			role: "admin",
		},
	};
}

function allowedRateLimitDecision() {
	return {
		allowed: true,
		count: 1,
		limit: 5,
		remaining: 4,
		resetAt: new Date("2026-07-14T01:15:00.000Z"),
		retryAfterSeconds: 900,
	};
}

function programsService(
	overrides: Partial<ProgramsService> = {},
): ProgramsService {
	const notImplemented = async (): Promise<never> => {
		throw new Error("Unexpected programs service call.");
	};
	return {
		create: notImplemented,
		delete: notImplemented,
		getById: notImplemented,
		list: notImplemented,
		update: notImplemented,
		...overrides,
	};
}

function versionsService(
	overrides: Partial<VersionsService> = {},
): VersionsService {
	const notImplemented = async (): Promise<never> => {
		throw new Error("Unexpected versions service call.");
	};
	return {
		create: notImplemented,
		delete: notImplemented,
		getById: notImplemented,
		list: notImplemented,
		listFiles: notImplemented,
		setActivation: notImplemented,
		update: notImplemented,
		...overrides,
	};
}

function filesService(overrides: Partial<FilesService> = {}): FilesService {
	const notImplemented = async (): Promise<never> => {
		throw new Error("Unexpected files service call.");
	};
	return {
		getById: notImplemented,
		list: notImplemented,
		...overrides,
	};
}

function uploadsService(
	overrides: Partial<UploadsService> = {},
): UploadsService {
	const notImplemented = async (): Promise<never> => {
		throw new Error("Unexpected uploads service call.");
	};
	return {
		complete: notImplemented,
		issueCredentials: notImplemented,
		...overrides,
	};
}

function testDependencies(
	overrides: ApiAppDependencies = {},
): ApiAppDependencies {
	return {
		appendFailureAudit: async () => {},
		beginPasswordChange: async () => {},
		completePasswordChange: async () => {},
		consumeRateLimit: async () => allowedRateLimitDecision(),
		generateRequestId: () => "req_test",
		getCanonicalOrigin: () => "http://localhost",
		getPasswordAuthApi: () => ({
			changePassword: async () => {},
			revokeSessions: async () => {},
		}),
		getSession: async () => safeSession(),
		now: () => new Date("2026-07-14T01:00:00.000Z"),
		...overrides,
	};
}

async function readProblem(response: Response): Promise<ApiProblem> {
	expect(response.headers.get("content-type")).toBe("application/problem+json");
	return (await response.json()) as ApiProblem;
}

function passwordRequest(
	body: unknown,
	headers: Readonly<Record<string, string>> = {},
): Request {
	return new Request("http://localhost/api/v1/profile/change-password", {
		body: typeof body === "string" ? body : JSON.stringify(body),
		headers: {
			"content-type": "application/json",
			origin: "http://localhost",
			...headers,
		},
		method: "POST",
	});
}

describe("Elysia API foundation", () => {
	it("keeps health public, minimal, and independent of auth, env, and database work", async () => {
		const forbiddenDependency = vi.fn(() => {
			throw new Error("health touched a protected dependency");
		});
		const app = createApiApp({
			beginPasswordChange: forbiddenDependency,
			completePasswordChange: forbiddenDependency,
			consumeRateLimit: forbiddenDependency,
			generateRequestId: () => "req_test",
			getCanonicalOrigin: forbiddenDependency,
			getPasswordAuthApi: forbiddenDependency,
			getProgramsService: forbiddenDependency,
			getSession: forbiddenDependency,
			getUploadsService: forbiddenDependency,
		});

		const response = await app.handle(new Request("http://localhost/health"));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "ok" });
		expect(forbiddenDependency).not.toHaveBeenCalled();
		expect(response.headers.get("x-request-id")).toBeNull();
	});

	it("mounts the authenticated programs module while keeping service creation lazy", async () => {
		const list = vi.fn(async () => ({
			items: [
				{
					createdAt: "2026-07-14T00:00:00.000Z",
					description: null,
					etag: 'W/"1"' as const,
					id: "00000000-0000-4000-8000-000000000010",
					name: "Desktop",
					updatedAt: "2026-07-14T00:00:00.000Z",
				},
			],
			page: 1,
			pageSize: 20 as const,
			total: 1,
		}));
		const getProgramsService = vi.fn(() => programsService({ list }));
		const app = createApiApp(testDependencies({ getProgramsService }));

		const health = await app.handle(new Request("http://localhost/health"));
		expect(health.status).toBe(200);
		expect(getProgramsService).not.toHaveBeenCalled();

		const response = await app.handle(
			new Request(
				"http://localhost/api/v1/programs?name=Desk&page=1&pageSize=20&sort=createdAt%3Aasc",
			),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			items: [{ id: "00000000-0000-4000-8000-000000000010" }],
			page: 1,
			pageSize: 20,
			total: 1,
		});
		expect(getProgramsService).toHaveBeenCalledOnce();
		expect(list).toHaveBeenCalledWith({
			name: "Desk",
			page: 1,
			pageSize: 20,
			sort: "createdAt:asc",
		});
	});

	it("mounts version and file lists while keeping both services lazy for health", async () => {
		const listVersions = vi.fn(async () => ({
			items: [
				{
					createdAt: "2026-07-14T00:00:00.000Z",
					description: "Initial release",
					etag: 'W/"1"' as const,
					fileCount: 1,
					id: VERSION_ID,
					isActive: true,
					isLatest: true,
					programId: PROGRAM_ID,
					updatedAt: "2026-07-14T00:00:00.000Z",
					versionNumber: "1.0.0",
				},
			],
			page: 2,
			pageSize: 50 as const,
			total: 1,
		}));
		const listFiles = vi.fn(async () => ({
			items: [
				{
					checksumAlgorithm: "sha256" as const,
					createdAt: "2026-07-14T00:00:00.000Z",
					id: FILE_ID,
					mimeType: "application/octet-stream",
					objectEtag: '"object-etag"',
					path: "desktop/installer.zip",
					sha256: "a".repeat(64),
					size: "1024",
					updatedAt: "2026-07-14T00:00:00.000Z",
				},
			],
			page: 3,
			pageSize: 100 as const,
			total: 1,
		}));
		const getVersionsService = vi.fn(() =>
			versionsService({ list: listVersions }),
		);
		const getFilesService = vi.fn(() => filesService({ list: listFiles }));
		const app = createApiApp(
			testDependencies({ getFilesService, getVersionsService }),
		);

		const health = await app.handle(new Request("http://localhost/health"));
		expect(health.status).toBe(200);
		expect(getVersionsService).not.toHaveBeenCalled();
		expect(getFilesService).not.toHaveBeenCalled();

		const versions = await app.handle(
			new Request(
				`http://localhost/api/v1/programs/${PROGRAM_ID}/versions?page=2&pageSize=50&sort=createdAt%3Aasc`,
			),
		);
		expect(versions.status).toBe(200);
		expect(await versions.json()).toMatchObject({
			items: [{ id: VERSION_ID, versionNumber: "1.0.0" }],
			page: 2,
			pageSize: 50,
			total: 1,
		});
		expect(getVersionsService).toHaveBeenCalledOnce();
		expect(listVersions).toHaveBeenCalledWith(PROGRAM_ID, {
			page: 2,
			pageSize: 50,
			sort: "createdAt:asc",
		});
		expect(getFilesService).not.toHaveBeenCalled();

		const files = await app.handle(
			new Request(
				"http://localhost/api/v1/files?path=installer&page=3&pageSize=100&sort=path%3Adesc",
			),
		);
		expect(files.status).toBe(200);
		expect(await files.json()).toMatchObject({
			items: [{ id: FILE_ID, path: "desktop/installer.zip" }],
			page: 3,
			pageSize: 100,
			total: 1,
		});
		expect(getFilesService).toHaveBeenCalledOnce();
		expect(listFiles).toHaveBeenCalledWith({
			page: 3,
			pageSize: 100,
			path: "installer",
			sort: "path:desc",
		});
	});

	it("mounts rate-limited upload credentials while keeping OSS and database work lazy for health", async () => {
		const sha256 = "a".repeat(64);
		const issueCredentials = vi.fn(async () => ({
			bucket: "updater-artifacts",
			credentials: {
				accessKeyId: "STS.temporary",
				accessKeySecret: "temporary-secret",
				expiration: "2026-07-14T01:15:00.000Z",
				securityToken: "temporary-token",
			},
			objects: [
				{
					objectKey: `releases/${sha256}/desktop/app.bin`,
					path: "desktop/app.bin",
				},
			],
			region: "oss-cn-hangzhou",
		}));
		const getUploadsService = vi.fn(() => uploadsService({ issueCredentials }));
		const consumeRateLimit = vi.fn(async () => allowedRateLimitDecision());
		const app = createApiApp(
			testDependencies({ consumeRateLimit, getUploadsService }),
		);

		const health = await app.handle(new Request("http://localhost/health"));
		expect(health.status).toBe(200);
		expect(getUploadsService).not.toHaveBeenCalled();
		expect(consumeRateLimit).not.toHaveBeenCalled();

		const response = await app.handle(
			new Request("http://localhost/api/v1/uploads/credentials", {
				body: JSON.stringify({
					files: [
						{
							mimeType: "application/octet-stream",
							path: "desktop/app.bin",
							sha256,
							size: "42",
						},
					],
				}),
				headers: {
					"content-type": "application/json",
					origin: "http://localhost",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toMatchObject({
			bucket: "updater-artifacts",
			objects: [{ path: "desktop/app.bin" }],
		});
		expect(getUploadsService).toHaveBeenCalledOnce();
		expect(issueCredentials).toHaveBeenCalledWith(
			expect.objectContaining({ files: [expect.objectContaining({ sha256 })] }),
			expect.objectContaining({
				actorId: USER_ID,
				requestId: "req_test",
			}),
		);
		expect(consumeRateLimit).toHaveBeenCalledWith({
			endpoint: "uploads.credentials",
			limit: 10,
			now: new Date("2026-07-14T01:00:00.000Z"),
			subjectKey: USER_ID,
			windowSeconds: 5 * 60,
		});
	});

	it("returns a sanitized 401 before origin, rate-limit, and routing work", async () => {
		const getCanonicalOrigin = vi.fn(() => "http://localhost");
		const consumeRateLimit = vi.fn(async () => allowedRateLimitDecision());
		const app = createApiApp(
			testDependencies({
				consumeRateLimit,
				getCanonicalOrigin,
				getSession: async () => null,
			}),
		);

		const response = await app.handle(
			new Request("http://localhost/api/v1/programs", {
				headers: { "x-request-id": "req_inbound" },
			}),
		);
		const problem = await readProblem(response);

		expect(response.status).toBe(401);
		expect(problem).toMatchObject({
			code: "UNAUTHENTICATED",
			requestId: "req_inbound",
			status: 401,
		});
		expect(response.headers.get("x-request-id")).toBe("req_inbound");
		expect(getCanonicalOrigin).not.toHaveBeenCalled();
		expect(consumeRateLimit).not.toHaveBeenCalled();
	});

	it("rejects banned and forced-password sessions before business routes", async () => {
		const bannedApp = createApiApp(
			testDependencies({
				getSession: async () => safeSession({ banned: true }),
			}),
		);
		const banned = await bannedApp.handle(
			new Request("http://localhost/api/v1/profile"),
		);
		expect(banned.status).toBe(403);
		expect(await readProblem(banned)).toMatchObject({ code: "FORBIDDEN" });

		const forcedApp = createApiApp(
			testDependencies({
				getSession: async () => safeSession({ mustChangePassword: true }),
			}),
		);
		const profile = await forcedApp.handle(
			new Request("http://localhost/api/v1/profile"),
		);
		const programs = await forcedApp.handle(
			new Request("http://localhost/api/v1/programs"),
		);

		expect(profile.status).toBe(200);
		expect(await profile.json()).toMatchObject({
			id: USER_ID,
			mustChangePassword: true,
		});
		expect(programs.status).toBe(403);
	});

	it("requires the exact canonical Origin before consuming mutation quota", async () => {
		const consumeRateLimit = vi.fn(async () => allowedRateLimitDecision());
		const app = createApiApp(testDependencies({ consumeRateLimit }));
		const body = JSON.stringify({
			currentPassword: "current-password",
			newPassword: "new-password-123",
		});

		for (const origin of [undefined, "null", "https://attacker.example"]) {
			const headers: Record<string, string> = {
				"content-type": "application/json",
			};
			if (origin) headers.origin = origin;
			const response = await app.handle(
				new Request("http://localhost/api/v1/profile/change-password", {
					body,
					headers,
					method: "POST",
				}),
			);
			expect(response.status).toBe(403);
		}
		expect(consumeRateLimit).not.toHaveBeenCalled();
	});

	it("maps malformed JSON and strict body validation without echoing values", async () => {
		const app = createApiApp(testDependencies());
		const malformed = await app.handle(passwordRequest('{"currentPassword":'));
		expect(malformed.status).toBe(400);
		expect(await readProblem(malformed)).toMatchObject({ code: "BAD_REQUEST" });

		const invalid = await app.handle(
			passwordRequest({
				currentPassword: "super-secret-current",
				extraPassword: "must-not-appear",
				newPassword: "new-password-123",
			}),
		);
		const problem = await readProblem(invalid);
		expect(invalid.status).toBe(422);
		expect(problem.code).toBe("VALIDATION_FAILED");
		expect(problem.fieldErrors).toContainEqual({
			code: "INVALID_VALUE",
			path: "extraPassword",
		});
		expect(JSON.stringify(problem)).not.toContain("must-not-appear");
		expect(JSON.stringify(problem)).not.toContain("super-secret-current");
	});

	it("records authorized program mutation failures without attempted values", async () => {
		const appendFailureAudit = vi.fn(
			async (_input: AppendAuditEventInput) => {},
		);
		const app = createApiApp(testDependencies({ appendFailureAudit }));
		const response = await app.handle(
			new Request("http://localhost/api/v1/programs", {
				body: JSON.stringify({
					extra: "must-not-be-audited",
					name: "also-not-audited",
				}),
				headers: {
					"content-type": "application/json",
					origin: "http://localhost",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(422);
		expect(appendFailureAudit).toHaveBeenCalledWith({
			action: "program.created",
			actorId: USER_ID,
			after: {
				code: "VALIDATION_FAILED",
				method: "POST",
			},
			ip: null,
			requestId: "req_test",
			resourceId: "unassigned",
			resourceType: "program",
			result: "failure",
			userAgent: null,
		});
		expect(JSON.stringify(appendFailureAudit.mock.calls)).not.toContain(
			"must-not-be-audited",
		);
		expect(JSON.stringify(appendFailureAudit.mock.calls)).not.toContain(
			"also-not-audited",
		);
	});

	it("audits invalid version activation with its canonical action and no submitted values", async () => {
		const appendFailureAudit = vi.fn(
			async (_input: AppendAuditEventInput) => {},
		);
		const app = createApiApp(testDependencies({ appendFailureAudit }));
		const response = await app.handle(
			new Request(
				`http://localhost/api/v1/programs/${PROGRAM_ID}/versions/${VERSION_ID}/activation`,
				{
					body: JSON.stringify({
						isActive: "must-not-be-audited",
						note: "also-not-audited",
					}),
					headers: {
						"content-type": "application/json",
						origin: "http://localhost",
					},
					method: "PUT",
				},
			),
		);

		expect(response.status).toBe(422);
		expect(appendFailureAudit).toHaveBeenCalledWith({
			action: "version.activation.updated",
			actorId: USER_ID,
			after: {
				code: "VALIDATION_FAILED",
				method: "PUT",
			},
			ip: null,
			requestId: "req_test",
			resourceId: VERSION_ID,
			resourceType: "version",
			result: "failure",
			userAgent: null,
		});
		expect(JSON.stringify(appendFailureAudit.mock.calls)).not.toContain(
			"must-not-be-audited",
		);
		expect(JSON.stringify(appendFailureAudit.mock.calls)).not.toContain(
			"also-not-audited",
		);
	});

	it("audits upload credential and completion failures with canonical actions and no metadata values", async () => {
		const appendFailureAudit = vi.fn(
			async (_input: AppendAuditEventInput) => {},
		);
		const app = createApiApp(testDependencies({ appendFailureAudit }));
		const sha256 = "a".repeat(64);
		const base = {
			mimeType: "application/octet-stream",
			path: "private/must-not-be-audited.bin",
			sha256,
			size: "42",
		};

		for (const [path, body] of [
			[
				"credentials",
				{
					files: [{ ...base, body: "must-not-cross-netlify" }],
				},
			],
			[
				"complete",
				{
					files: [
						{
							...base,
							objectEtag: "secret-etag",
							objectKey: "secret-object-key",
							secret: "must-not-be-audited",
						},
					],
				},
			],
		] as const) {
			const response = await app.handle(
				new Request(`http://localhost/api/v1/uploads/${path}`, {
					body: JSON.stringify(body),
					headers: {
						"content-type": "application/json",
						origin: "http://localhost",
					},
					method: "POST",
				}),
			);
			expect(response.status).toBe(422);
		}

		expect(appendFailureAudit.mock.calls.map(([input]) => input)).toEqual([
			{
				action: "upload.credentials.issued",
				actorId: USER_ID,
				after: { code: "VALIDATION_FAILED", method: "POST" },
				ip: null,
				requestId: "req_test",
				resourceId: "unassigned",
				resourceType: "upload",
				result: "failure",
				userAgent: null,
			},
			{
				action: "upload.completed",
				actorId: USER_ID,
				after: { code: "VALIDATION_FAILED", method: "POST" },
				ip: null,
				requestId: "req_test",
				resourceId: "unassigned",
				resourceType: "upload",
				result: "failure",
				userAgent: null,
			},
		]);
		const serializedAudit = JSON.stringify(appendFailureAudit.mock.calls);
		for (const forbidden of [
			"private/must-not-be-audited.bin",
			"must-not-cross-netlify",
			"secret-etag",
			"secret-object-key",
		]) {
			expect(serializedAudit).not.toContain(forbidden);
		}
	});

	it("preserves the original problem when failure auditing also fails", async () => {
		const reportInternalError = vi.fn(async () => {});
		const app = createApiApp(
			testDependencies({
				appendFailureAudit: async () => {
					throw new Error("audit database unavailable");
				},
				reportInternalError,
			}),
		);
		const response = await app.handle(
			new Request("http://localhost/api/v1/programs", {
				body: JSON.stringify({ extra: true, name: "Invalid" }),
				headers: {
					"content-type": "application/json",
					origin: "http://localhost",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(422);
		expect(await readProblem(response)).toMatchObject({
			code: "VALIDATION_FAILED",
		});
		expect(reportInternalError).toHaveBeenCalledWith(
			expect.any(Error),
			"req_test",
		);
	});

	it("audits parse and response-validation failures with the mapped problem code", async () => {
		const appendFailureAudit = vi.fn(
			async (_input: AppendAuditEventInput) => {},
		);
		const app = createApiApp(testDependencies({ appendFailureAudit })).post(
			"/api/v1/invalid-mutation-response",
			() => JSON.parse('{"ok":"not-a-boolean"}'),
			{ response: { 200: t.Object({ ok: t.Boolean() }) } },
		);

		const malformed = await app.handle(
			new Request("http://localhost/api/v1/programs", {
				body: '{"name":',
				headers: {
					"content-type": "application/json",
					origin: "http://localhost",
				},
				method: "POST",
			}),
		);
		expect(malformed.status).toBe(400);
		expect(await readProblem(malformed)).toMatchObject({ code: "BAD_REQUEST" });

		const responseValidation = await app.handle(
			new Request("http://localhost/api/v1/invalid-mutation-response", {
				headers: { origin: "http://localhost" },
				method: "POST",
			}),
		);
		expect(responseValidation.status).toBe(500);
		expect(await readProblem(responseValidation)).toMatchObject({
			code: "INTERNAL_ERROR",
		});
		expect(appendFailureAudit.mock.calls.map(([input]) => input.after)).toEqual(
			[
				{ code: "BAD_REQUEST", method: "POST" },
				{ code: "INTERNAL_ERROR", method: "POST" },
			],
		);
	});

	it("bounds and deduplicates attacker-controlled validation paths", async () => {
		const attackerFields = Object.fromEntries(
			Array.from({ length: 150 }, (_, index) => [
				`field-${index}-${"x".repeat(600)}`,
				"attacker-controlled-value",
			]),
		);
		const app = createApiApp(testDependencies());

		const response = await app.handle(
			passwordRequest({
				...attackerFields,
				currentPassword: "current-password",
				newPassword: "new-password-123",
			}),
		);
		const problem = await readProblem(response);

		expect(response.status).toBe(422);
		expect(problem.fieldErrors).toHaveLength(100);
		expect(problem.fieldErrors?.every(({ path }) => path.length <= 512)).toBe(
			true,
		);
		expect(new Set(problem.fieldErrors?.map(({ path }) => path)).size).toBe(
			100,
		);
		expect(JSON.stringify(problem)).not.toContain("attacker-controlled-value");
	});

	it("sanitizes validation paths that cross the server-client trust boundary", async () => {
		const app = createApiApp(testDependencies());
		const client = createApiClient((input, init) => {
			const headers = new Headers(init?.headers);
			headers.set("origin", "http://localhost");
			return app.handle(
				new Request(new URL(String(input), "http://localhost"), {
					...init,
					headers,
				}),
			);
		});

		const error = await client
			.json("/api/v1/programs", {
				body: {
					"bad\nkey": "must-not-cross-boundary",
					"bad\ud800key": "must-not-cross-boundary",
					name: "Valid",
				},
				method: "POST",
			})
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(ClientApiProblemError);
		const clientError = error as ClientApiProblemError;
		expect(clientError.code).toBe("VALIDATION_FAILED");
		expect(clientError.problem.fieldErrors).not.toHaveLength(0);
		for (const { path } of clientError.problem.fieldErrors ?? []) {
			expect(
				[...path].every((character) => {
					const codePoint = character.codePointAt(0) ?? 0;
					return codePoint >= 32 && codePoint !== 127;
				}),
			).toBe(true);
			expect(isWellFormedUnicode(path)).toBe(true);
		}
		expect(JSON.stringify(clientError.problem)).not.toContain(
			"must-not-cross-boundary",
		);
	});

	it("returns a centralized 404 for authenticated unknown routes", async () => {
		const app = createApiApp(testDependencies());
		const response = await app.handle(
			new Request("http://localhost/api/v1/not-present"),
		);
		expect(response.status).toBe(404);
		expect(await readProblem(response)).toMatchObject({
			code: "NOT_FOUND",
			requestId: "req_test",
		});
	});

	it("preserves raw body, query, and headers inside the Elysia handler", async () => {
		const app = createApiApp(testDependencies()).post(
			"/api/v1/echo",
			({ body, query, request }) => ({
				body,
				queryValue: query.value,
				rawHeader: request.headers.get("x-raw"),
			}),
		);
		const response = await app.handle(
			new Request("http://localhost/api/v1/echo?value=a%2Fb%20c", {
				body: JSON.stringify({ nested: [1, 2, 3] }),
				headers: {
					"content-type": "application/json",
					origin: "http://localhost",
					"x-raw": "unchanged",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			body: { nested: [1, 2, 3] },
			queryValue: "a/b c",
			rawHeader: "unchanged",
		});
	});

	it("enforces missing and exact weak If-Match values", async () => {
		const app = createApiApp(testDependencies()).patch(
			"/api/v1/entity",
			({ request }) => {
				requireExactIfMatch(
					request.headers.get("if-match"),
					formatWeakEntityTag(3n),
				);
				return { updated: true };
			},
		);
		const makeRequest = (ifMatch?: string) =>
			new Request("http://localhost/api/v1/entity", {
				headers: {
					origin: "http://localhost",
					...(ifMatch ? { "if-match": ifMatch } : {}),
				},
				method: "PATCH",
			});

		expect((await app.handle(makeRequest())).status).toBe(428);
		for (const stale of ['W/"2"', '"3"', "*", 'W/"3", W/"2"']) {
			const response = await app.handle(makeRequest(stale));
			expect(response.status).toBe(409);
			expect(await readProblem(response)).toMatchObject({
				code: "STALE_WRITE",
			});
		}
		expect((await app.handle(makeRequest('W/"3"'))).status).toBe(200);
	});

	it("returns retry metadata and never enters the password handler after quota", async () => {
		const changePassword = vi.fn(async () => {});
		const app = createApiApp(
			testDependencies({
				consumeRateLimit: async () => ({
					allowed: false,
					count: 6,
					limit: 5,
					remaining: 0,
					resetAt: new Date("2026-07-14T01:15:00.000Z"),
					retryAfterSeconds: 321,
				}),
				getPasswordAuthApi: () => ({
					changePassword,
					revokeSessions: async () => {},
				}),
			}),
		);
		const response = await app.handle(
			passwordRequest({
				currentPassword: "current-password",
				newPassword: "new-password-123",
			}),
		);
		const problem = await readProblem(response);

		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("321");
		expect(problem).toMatchObject({
			code: "RATE_LIMITED",
			retryAfterSeconds: 321,
		});
		expect(changePassword).not.toHaveBeenCalled();
	});

	it("applies forced-password and rate-limit policy to trailing-slash route aliases", async () => {
		const consumeRateLimit = vi.fn(async () => allowedRateLimitDecision());
		const changePassword = vi.fn(async () => {});
		const app = createApiApp(
			testDependencies({
				consumeRateLimit,
				getPasswordAuthApi: () => ({
					changePassword,
					revokeSessions: async () => {},
				}),
				getSession: async () => safeSession({ mustChangePassword: true }),
			}),
		);

		const response = await app.handle(
			new Request("http://localhost/api/v1/profile/change-password/", {
				body: JSON.stringify({
					currentPassword: "current-password",
					newPassword: "new-password-123",
				}),
				headers: {
					"content-type": "application/json",
					origin: "http://localhost",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(consumeRateLimit).toHaveBeenCalledOnce();
		expect(changePassword).toHaveBeenCalledOnce();
	});

	it("sanitizes internal and response-schema failures", async () => {
		const reportInternalError = vi.fn();
		const app = createApiApp(testDependencies({ reportInternalError }))
			.get("/api/v1/failure", () => {
				throw new Error(
					"password=hunter2 select * from account /Users/private cookie token",
				);
			})
			.get(
				"/api/v1/invalid-response",
				() => JSON.parse('{"ok":"not-a-boolean"}'),
				{ response: { 200: t.Object({ ok: t.Boolean() }) } },
			);

		for (const path of ["failure", "invalid-response"]) {
			const response = await app.handle(
				new Request(`http://localhost/api/v1/${path}`),
			);
			const serialized = JSON.stringify(await readProblem(response));
			expect(response.status).toBe(500);
			expect(serialized).toContain("INTERNAL_ERROR");
			for (const marker of [
				"hunter2",
				"select *",
				"/Users/private",
				"cookie",
				"token",
			]) {
				expect(serialized.toLowerCase()).not.toContain(marker.toLowerCase());
			}
		}
		expect(reportInternalError).toHaveBeenCalledTimes(2);
	});

	it("still returns the sanitized 500 when internal-error reporting fails", async () => {
		const reportInternalError = vi.fn(async () => {
			throw new Error("reporter secret must never cross the API boundary");
		});
		const app = createApiApp(testDependencies({ reportInternalError })).get(
			"/api/v1/failure-with-broken-reporter",
			() => {
				throw new Error("application secret must never cross the API boundary");
			},
		);

		const response = await app.handle(
			new Request("http://localhost/api/v1/failure-with-broken-reporter"),
		);
		const problem = await readProblem(response);

		expect(response.status).toBe(500);
		expect(problem).toMatchObject({
			code: "INTERNAL_ERROR",
			requestId: "req_test",
			status: 500,
		});
		expect(JSON.stringify(problem)).not.toContain("reporter secret");
		expect(JSON.stringify(problem)).not.toContain("application secret");
		expect(reportInternalError).toHaveBeenCalledOnce();
	});

	it("changes the password, marks the account forced, revokes sessions, then commits metadata and audit", async () => {
		const order: string[] = [];
		const changePassword = vi.fn(async () => {
			order.push("change");
			return { token: "must-not-be-returned" };
		});
		const revokeSessions = vi.fn(async () => {
			order.push("revoke");
		});
		const beginPasswordChange = vi.fn(async () => {
			order.push("begin");
		});
		const completePasswordChange = vi.fn(async () => {
			order.push("complete");
		});
		const app = createApiApp(
			testDependencies({
				beginPasswordChange,
				completePasswordChange,
				getPasswordAuthApi: () => ({ changePassword, revokeSessions }),
			}),
		);

		const response = await app.handle(
			passwordRequest(
				{
					currentPassword: "current-password",
					newPassword: "new-password-123",
				},
				{
					"user-agent": "Contract Test",
					"x-nf-client-connection-ip": "203.0.113.8",
				},
			),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			reauthenticationRequired: true,
		});
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(order).toEqual(["change", "begin", "revoke", "complete"]);
		expect(changePassword).toHaveBeenCalledWith({
			body: {
				currentPassword: "current-password",
				newPassword: "new-password-123",
				revokeOtherSessions: false,
			},
			headers: expect.any(Headers),
		});
		expect(beginPasswordChange).toHaveBeenCalledWith({ actorId: USER_ID });
		expect(completePasswordChange).toHaveBeenCalledWith({
			actorId: USER_ID,
			ip: "203.0.113.8",
			previousMustChangePassword: false,
			requestId: "req_test",
			userAgent: "Contract Test",
		});
	});

	it("maps invalid current passwords without entering partial-success handling", async () => {
		const beginPasswordChange = vi.fn(async () => {});
		const revokeSessions = vi.fn(async () => {});
		const completePasswordChange = vi.fn(async () => {});
		const invalidApp = createApiApp(
			testDependencies({
				beginPasswordChange,
				completePasswordChange,
				getPasswordAuthApi: () => ({
					changePassword: async () => {
						throw new APIError("BAD_REQUEST", {
							code: "INVALID_PASSWORD",
							message: "credential value must stay private",
						});
					},
					revokeSessions,
				}),
			}),
		);
		const invalid = await invalidApp.handle(
			passwordRequest({
				currentPassword: "wrong-password",
				newPassword: "new-password-123",
			}),
		);
		const invalidProblem = await readProblem(invalid);
		expect(invalid.status).toBe(422);
		expect(invalidProblem.fieldErrors).toEqual([
			{ code: "INVALID_PASSWORD", path: "currentPassword" },
		]);
		expect(JSON.stringify(invalidProblem)).not.toContain("credential value");
		expect(beginPasswordChange).not.toHaveBeenCalled();
		expect(revokeSessions).not.toHaveBeenCalled();
		expect(completePasswordChange).not.toHaveBeenCalled();
	});

	it("keeps a previously unforced account fail-closed when revocation fails", async () => {
		let mustChangePassword = false;
		const beginPasswordChange = vi.fn(async () => {
			mustChangePassword = true;
		});
		const completionAfterRevocation = vi.fn(async () => {});
		const revokeSessions = vi.fn(async () => {
			throw new Error("session store unavailable");
		});
		const revocationApp = createApiApp(
			testDependencies({
				beginPasswordChange,
				completePasswordChange: completionAfterRevocation,
				getPasswordAuthApi: () => ({
					changePassword: async () => {},
					revokeSessions,
				}),
				getSession: async () => safeSession({ mustChangePassword }),
			}),
		);
		const revocationFailure = await revocationApp.handle(
			passwordRequest({
				currentPassword: "current-password",
				newPassword: "new-password-123",
			}),
		);
		expect(revocationFailure.status).toBe(500);
		expect(beginPasswordChange).toHaveBeenCalledWith({ actorId: USER_ID });
		expect(mustChangePassword).toBe(true);
		expect(revokeSessions).toHaveBeenCalledOnce();
		expect(completionAfterRevocation).not.toHaveBeenCalled();

		const subsequentBusinessRequest = await revocationApp.handle(
			new Request("http://localhost/api/v1/programs"),
		);
		expect(subsequentBusinessRequest.status).toBe(403);
	});

	it("attempts session revocation when the fail-closed marker cannot persist", async () => {
		const revokeSessions = vi.fn(async () => {});
		const completePasswordChange = vi.fn(async () => {});
		const app = createApiApp(
			testDependencies({
				beginPasswordChange: async () => {
					throw new Error("metadata store unavailable");
				},
				completePasswordChange,
				getPasswordAuthApi: () => ({
					changePassword: async () => {},
					revokeSessions,
				}),
			}),
		);

		const response = await app.handle(
			passwordRequest({
				currentPassword: "current-password",
				newPassword: "new-password-123",
			}),
		);

		expect(response.status).toBe(500);
		expect(revokeSessions).toHaveBeenCalledOnce();
		expect(completePasswordChange).not.toHaveBeenCalled();
	});

	it("leaves the forced marker set when final persistence fails", async () => {
		let mustChangePassword = false;
		const beginPasswordChange = vi.fn(async () => {
			mustChangePassword = true;
		});
		const revokeSessions = vi.fn(async () => {});
		const failedCompletion = vi.fn(async () => {
			throw new Error("database unavailable");
		});
		const completionApp = createApiApp(
			testDependencies({
				beginPasswordChange,
				completePasswordChange: failedCompletion,
				getPasswordAuthApi: () => ({
					changePassword: async () => {},
					revokeSessions,
				}),
			}),
		);
		const failed = await completionApp.handle(
			passwordRequest({
				currentPassword: "current-password",
				newPassword: "new-password-123",
			}),
		);
		expect(failed.status).toBe(500);
		expect(mustChangePassword).toBe(true);
		expect(revokeSessions).toHaveBeenCalledOnce();
		expect(failedCompletion).toHaveBeenCalledOnce();
	});

	it("forwards the identical Request and returns the handler Response unchanged", async () => {
		const request = new Request(
			"http://localhost/api/v1/echo?value=raw%20query",
			{
				body: new Uint8Array([0, 1, 2, 255]),
				headers: { "content-type": "application/octet-stream", "x-raw": "yes" },
				method: "PUT",
			},
		);
		const expectedResponse = new Response("unchanged", {
			headers: { "x-upstream": "yes" },
			status: 207,
		});
		const handle = vi.fn((_request: Request) => expectedResponse);

		const response = await forwardApiRequest(request, { handle });

		expect(handle).toHaveBeenCalledWith(request);
		expect(handle.mock.calls[0]?.[0]).toBe(request);
		expect(response).toBe(expectedResponse);
		expect(request.bodyUsed).toBe(false);
	});
});
