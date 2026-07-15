import { describe, expect, it, vi } from "vitest";

import type { SafeSessionView } from "../../auth/session.server";
import { ProfileStaleWriteRepositoryError } from "../../db/repositories/profile.server";
import {
	AdministratorEmailConflictError,
	AdministratorPreconditionRequiredError,
	AdministratorStaleWriteError,
	type AdministratorsService,
	LastActiveAdministratorError,
} from "../../domain/administrators.server";
import { createApiApp } from "../app.server";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const TARGET_ID = "00000000-0000-4000-8000-000000000002";
const SESSION_ID = "00000000-0000-4000-8000-000000000003";
const OTHER_SESSION_ID = "00000000-0000-4000-8000-000000000004";
const TEMPORARY_PASSWORD = "Temporary!Admin-2026#Safe";

function session(): SafeSessionView {
	return {
		metadata: {
			etag: 'W/"3"',
			lastLoginAt: "2026-07-14T01:00:00.000Z",
			locale: "zh-CN",
			mustChangePassword: false,
		},
		session: {
			createdAt: "2026-07-14T00:00:00.000Z",
			expiresAt: "2026-07-21T00:00:00.000Z",
			id: SESSION_ID,
			updatedAt: "2026-07-14T00:00:00.000Z",
		},
		user: {
			banned: false,
			email: "admin@example.com",
			emailVerified: true,
			id: USER_ID,
			image: null,
			name: "Administrator",
			role: "admin",
		},
	};
}

function administrator() {
	return {
		createdAt: "2026-07-14T00:00:00.000Z",
		email: "target@example.com",
		enabled: true,
		etag: 'W/"3"' as const,
		id: TARGET_ID,
		lastLoginAt: null,
		locale: "zh-CN" as const,
		mustChangePassword: true,
		name: "Target",
		updatedAt: "2026-07-14T00:00:00.000Z",
	};
}

function service(
	overrides: Partial<AdministratorsService> = {},
): AdministratorsService {
	const unexpected = async (): Promise<never> => {
		throw new Error("Unexpected administrator service call.");
	};
	return {
		create: unexpected,
		list: unexpected,
		resetPassword: unexpected,
		revokeSessions: unexpected,
		update: unexpected,
		...overrides,
	};
}

function app(administratorsService: AdministratorsService, overrides = {}) {
	return createApiApp({
		appendFailureAudit: async () => {},
		beginPasswordChange: async () => {},
		completePasswordChange: async () => {},
		consumeRateLimit: async () => ({
			allowed: true,
			count: 1,
			limit: 5,
			remaining: 4,
			resetAt: new Date("2026-07-14T01:15:00.000Z"),
			retryAfterSeconds: 900,
		}),
		generateRequestId: () => "req_test",
		getAdministratorsService: () => administratorsService,
		getCanonicalOrigin: () => "http://localhost",
		getPasswordAuthApi: () => ({
			changePassword: async () => {},
			revokeSessions: async () => {},
		}),
		getSession: async () => session(),
		updateProfile: async () => ({
			locale: "zh-CN",
			name: "Administrator",
			rowVersion: 4n,
		}),
		...overrides,
	});
}

describe("administrators and profile API contracts", () => {
	it("forwards the whitelisted administrator page query", async () => {
		const list = vi.fn(async () => ({
			items: [administrator()],
			page: 2,
			pageSize: 50 as const,
			total: 1,
		}));
		const response = await app(service({ list })).handle(
			new Request(
				"http://localhost/api/v1/administrators?page=2&pageSize=50&query=Target&sort=name%3Aasc&status=active",
			),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			items: [administrator()],
			page: 2,
			pageSize: 50,
			total: 1,
		});
		expect(list).toHaveBeenCalledWith({
			page: 2,
			pageSize: 50,
			query: "Target",
			sort: "name:asc",
			status: "active",
		});
	});

	it("creates an administrator without returning the temporary password or auth secrets", async () => {
		const create = vi.fn(async () => administrator());
		const consumeRateLimit = vi.fn(async () => ({
			allowed: true,
			count: 1,
			limit: 5,
			remaining: 4,
			resetAt: new Date("2026-07-14T01:15:00.000Z"),
			retryAfterSeconds: 900,
		}));
		const response = await app(service({ create }), {
			consumeRateLimit,
		}).handle(
			new Request("http://localhost/api/v1/administrators", {
				body: JSON.stringify({
					email: "target@example.com",
					name: "Target",
					temporaryPassword: TEMPORARY_PASSWORD,
				}),
				headers: {
					"content-type": "application/json",
					cookie: "better-auth.session_token=server-only",
					origin: "http://localhost",
				},
				method: "POST",
			}),
		);
		const serialized = JSON.stringify(await response.json());

		expect(response.status).toBe(201);
		expect(response.headers.get("etag")).toBe('W/"3"');
		expect(response.headers.get("location")).toBe(
			`/api/v1/administrators/${TARGET_ID}`,
		);
		expect(serialized).not.toContain(TEMPORARY_PASSWORD);
		expect(serialized).not.toMatch(/token|cookie|passwordHash/i);
		expect(create).toHaveBeenCalledWith(
			{
				email: "target@example.com",
				name: "Target",
				temporaryPassword: TEMPORARY_PASSWORD,
			},
			expect.any(Headers),
			expect.objectContaining({ actorId: USER_ID, requestId: "req_test" }),
		);
		expect(consumeRateLimit).toHaveBeenCalledWith({
			endpoint: "administrators.create",
			limit: 5,
			now: expect.any(Date),
			subjectKey: USER_ID,
			windowSeconds: 15 * 60,
		});
	});

	it("forwards If-Match and returns the updated administrator ETag", async () => {
		const updated = {
			...administrator(),
			etag: 'W/"4"' as const,
			name: "Updated Target",
		};
		const update = vi.fn(async () => updated);
		const response = await app(service({ update })).handle(
			new Request(`http://localhost/api/v1/administrators/${TARGET_ID}`, {
				body: JSON.stringify({ name: "Updated Target" }),
				headers: {
					"content-type": "application/json",
					"if-match": 'W/"3"',
					origin: "http://localhost",
				},
				method: "PATCH",
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("etag")).toBe('W/"4"');
		expect(await response.json()).toEqual(updated);
		expect(update).toHaveBeenCalledWith(
			TARGET_ID,
			'W/"3"',
			{ name: "Updated Target" },
			expect.any(Headers),
			expect.objectContaining({ actorId: USER_ID }),
		);
	});

	it("returns the new ETag after a successful temporary-password reset", async () => {
		const resetPassword = vi.fn(async () => ({
			...administrator(),
			etag: 'W/"4"' as const,
		}));
		const response = await app(service({ resetPassword })).handle(
			new Request(
				`http://localhost/api/v1/administrators/${TARGET_ID}/reset-password`,
				{
					body: JSON.stringify({ temporaryPassword: TEMPORARY_PASSWORD }),
					headers: {
						"content-type": "application/json",
						origin: "http://localhost",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("etag")).toBe('W/"4"');
		expect(resetPassword).toHaveBeenCalledOnce();
	});

	it("rate limits dynamic administrator password resets before service work", async () => {
		const resetPassword = vi.fn(async () => administrator());
		const consumeRateLimit = vi.fn(async () => ({
			allowed: false,
			count: 6,
			limit: 5,
			remaining: 0,
			resetAt: new Date("2026-07-14T01:15:00.000Z"),
			retryAfterSeconds: 321,
		}));
		const response = await app(service({ resetPassword }), {
			consumeRateLimit,
		}).handle(
			new Request(
				`http://localhost/api/v1/administrators/${TARGET_ID}/reset-password/`,
				{
					body: JSON.stringify({ temporaryPassword: TEMPORARY_PASSWORD }),
					headers: {
						"content-type": "application/json",
						"if-match": 'W/"3"',
						origin: "http://localhost",
					},
					method: "POST",
				},
			),
		);

		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("321");
		expect(resetPassword).not.toHaveBeenCalled();
		expect(consumeRateLimit).toHaveBeenCalledWith({
			endpoint: "administrators.reset-password",
			limit: 5,
			now: expect.any(Date),
			subjectKey: USER_ID,
			windowSeconds: 15 * 60,
		});
	});

	it("maps duplicate email and locked last-admin errors to stable safe problems", async () => {
		for (const [error, expectedStatus, expectedCode] of [
			[
				new AdministratorEmailConflictError(),
				409,
				"ADMINISTRATOR_EMAIL_CONFLICT",
			],
			[new LastActiveAdministratorError(), 409, "LAST_ADMIN_REQUIRED"],
		] as const) {
			const response = await app(
				service({
					update: async () => {
						throw error;
					},
				}),
			).handle(
				new Request(`http://localhost/api/v1/administrators/${TARGET_ID}`, {
					body: JSON.stringify({ enabled: false }),
					headers: {
						"content-type": "application/json",
						origin: "http://localhost",
					},
					method: "PATCH",
				}),
			);
			expect(response.status).toBe(expectedStatus);
			expect(await response.json()).toMatchObject({ code: expectedCode });
		}
	});

	it("projects safe current/other session summaries and strips every token", async () => {
		const response = await app(service(), {
			getPasswordAuthApi: () => ({
				changePassword: async () => {},
				listSessions: async () => [
					{
						createdAt: new Date("2026-07-14T00:00:00.000Z"),
						expiresAt: new Date("2026-07-21T00:00:00.000Z"),
						id: SESSION_ID,
						token: "current-secret-token",
						updatedAt: new Date("2026-07-14T00:00:00.000Z"),
					},
					{
						createdAt: new Date("2026-07-13T00:00:00.000Z"),
						expiresAt: new Date("2026-07-20T00:00:00.000Z"),
						id: OTHER_SESSION_ID,
						ipAddress: "203.0.113.8",
						token: "other-secret-token",
						updatedAt: new Date("2026-07-13T00:00:00.000Z"),
						userAgent: "Browser",
					},
				],
				revokeSessions: async () => {},
			}),
		}).handle(new Request("http://localhost/api/v1/profile"));
		const body = await response.json();
		const serialized = JSON.stringify(body);

		expect(response.status).toBe(200);
		expect(response.headers.get("etag")).toBe('W/"3"');
		expect(body).toMatchObject({
			currentSession: { id: SESSION_ID },
			otherSessions: [
				{
					id: OTHER_SESSION_ID,
					ipAddress: "203.0.113.8",
					userAgent: "Browser",
				},
			],
		});
		expect(serialized).not.toContain("secret-token");
		expect(serialized).not.toContain("token");
	});

	it("persists normalized profile name/locale through the repository owner", async () => {
		const updateProfile = vi.fn(async () => ({
			locale: "en" as const,
			name: "Updated Name",
			rowVersion: 4n,
		}));
		const response = await app(service(), { updateProfile }).handle(
			new Request("http://localhost/api/v1/profile", {
				body: JSON.stringify({ locale: "en", name: " Updated Name " }),
				headers: {
					"content-type": "application/json",
					"if-match": 'W/"3"',
					origin: "http://localhost",
				},
				method: "PATCH",
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("etag")).toBe('W/"4"');
		expect(await response.json()).toMatchObject({
			locale: "en",
			name: "Updated Name",
			otherSessions: [],
		});
		expect(updateProfile).toHaveBeenCalledWith(
			expect.objectContaining({
				actorId: USER_ID,
				expectedRowVersion: 3n,
				locale: "en",
				name: "Updated Name",
			}),
		);
	});

	it("enforces administrator and profile update preconditions", async () => {
		const administratorResponse = await app(
			service({
				update: async (_id, ifMatch) => {
					expect(ifMatch).toBeNull();
					throw new AdministratorPreconditionRequiredError();
				},
			}),
		).handle(
			new Request(`http://localhost/api/v1/administrators/${TARGET_ID}`, {
				body: JSON.stringify({ name: "Changed" }),
				headers: {
					"content-type": "application/json",
					origin: "http://localhost",
				},
				method: "PATCH",
			}),
		);
		expect(administratorResponse.status).toBe(428);
		expect(await administratorResponse.json()).toMatchObject({
			code: "PRECONDITION_REQUIRED",
		});

		const profileResponse = await app(service()).handle(
			new Request("http://localhost/api/v1/profile", {
				body: JSON.stringify({ locale: "en" }),
				headers: {
					"content-type": "application/json",
					origin: "http://localhost",
				},
				method: "PATCH",
			}),
		);
		expect(profileResponse.status).toBe(428);
		expect(await profileResponse.json()).toMatchObject({
			code: "PRECONDITION_REQUIRED",
		});
	});

	it("maps stale administrator and profile tokens to conflict responses", async () => {
		const administratorResponse = await app(
			service({
				update: async () => {
					throw new AdministratorStaleWriteError();
				},
			}),
		).handle(
			new Request(`http://localhost/api/v1/administrators/${TARGET_ID}`, {
				body: JSON.stringify({ name: "Changed" }),
				headers: {
					"content-type": "application/json",
					"if-match": 'W/"3"',
					origin: "http://localhost",
				},
				method: "PATCH",
			}),
		);
		expect(administratorResponse.status).toBe(409);
		expect(await administratorResponse.json()).toMatchObject({
			code: "STALE_WRITE",
		});

		const profileResponse = await app(service(), {
			updateProfile: async () => {
				throw new ProfileStaleWriteRepositoryError();
			},
		}).handle(
			new Request("http://localhost/api/v1/profile", {
				body: JSON.stringify({ locale: "en" }),
				headers: {
					"content-type": "application/json",
					"if-match": 'W/"3"',
					origin: "http://localhost",
				},
				method: "PATCH",
			}),
		);
		expect(profileResponse.status).toBe(409);
		expect(await profileResponse.json()).toMatchObject({ code: "STALE_WRITE" });
	});
});
