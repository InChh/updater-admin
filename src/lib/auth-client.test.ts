import { afterEach, describe, expect, it, vi } from "vitest";

import { authClient } from "./auth-client";

afterEach(() => vi.unstubAllGlobals());

const EXPECTED_JSON_POST = {
	credentials: "same-origin",
	headers: { "content-type": "application/json" },
	method: "POST",
} as const;

describe("auth client transport", () => {
	it("posts email credentials to the Better Auth sign-in endpoint", async () => {
		const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetcher);

		const result = await authClient.signIn.email({
			email: "admin@example.com",
			password: "Temporary!Password-2026",
		});

		expect(fetcher).toHaveBeenCalledOnce();
		expect(fetcher).toHaveBeenCalledWith("/api/auth/sign-in/email", {
			...EXPECTED_JSON_POST,
			body: JSON.stringify({
				email: "admin@example.com",
				password: "Temporary!Password-2026",
			}),
		});
		expect(result).toEqual({});
	});

	it("maps only Better Auth's invalid-credentials code to the specific error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							code: "INVALID_EMAIL_OR_PASSWORD",
							message: "Invalid email or password",
						}),
						{
							headers: { "content-type": "application/json" },
							status: 401,
						},
					),
			),
		);

		const result = await authClient.signIn.email({
			email: "admin@example.com",
			password: "Temporary!Password-2026",
		});

		expect(result).toEqual({ error: { code: "INVALID_CREDENTIALS" } });
	});

	it.each([
		[401, "FAILED_TO_CREATE_SESSION", "AUTH_REQUEST_FAILED"],
		[429, "TOO_MANY_REQUESTS", "RATE_LIMITED"],
		[500, "INTERNAL_SERVER_ERROR", "AUTH_REQUEST_FAILED"],
	] as const)("does not misclassify sign-in status %s with code %s", async (status, responseCode, code) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ code: responseCode }), {
						headers: { "content-type": "application/json" },
						status,
					}),
			),
		);

		const result = await authClient.signIn.email({
			email: "admin@example.com",
			password: "Temporary!Password-2026",
		});

		expect(result).toEqual({ error: { code } });
	});

	it("fails closed when an authentication error body exceeds the read limit", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							code: "INVALID_EMAIL_OR_PASSWORD",
							padding: "x".repeat(2048),
						}),
						{
							headers: { "content-type": "application/json" },
							status: 401,
						},
					),
			),
		);

		const result = await authClient.signIn.email({
			email: "admin@example.com",
			password: "Temporary!Password-2026",
		});

		expect(result).toEqual({ error: { code: "AUTH_REQUEST_FAILED" } });
	});

	it.each([
		["sign out", "/api/auth/sign-out", () => authClient.signOut()],
		[
			"revoke other sessions",
			"/api/auth/revoke-other-sessions",
			() => authClient.revokeOtherSessions(),
		],
	] as const)("posts an empty JSON object to %s", async (_label, path, call) => {
		const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetcher);

		const result = await call();

		expect(fetcher).toHaveBeenCalledOnce();
		expect(fetcher).toHaveBeenCalledWith(path, {
			...EXPECTED_JSON_POST,
			body: "{}",
		});
		expect(result).toEqual({});
	});

	it("returns a bounded generic error without reading a non-success body", async () => {
		const response = {
			json: vi.fn(),
			ok: false,
			text: vi.fn(),
		} as unknown as Response;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => response),
		);

		const result = await authClient.signOut();

		expect(result).toEqual({ error: { code: "AUTH_REQUEST_FAILED" } });
		expect(response.json).not.toHaveBeenCalled();
		expect(response.text).not.toHaveBeenCalled();
	});

	it("does not expose network error messages", async () => {
		const privateMessage =
			"request failed for admin@example.com with password=temporary-secret";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error(privateMessage);
			}),
		);

		const result = await authClient.revokeOtherSessions();
		const serialized = JSON.stringify(result);

		expect(serialized).toBe('{"error":{"code":"AUTH_REQUEST_FAILED"}}');
		expect(serialized).not.toContain(privateMessage);
	});
});
