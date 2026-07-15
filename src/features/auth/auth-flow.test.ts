import { describe, expect, it, vi } from "vitest";

import {
	AuthenticationFlowError,
	rotatePasswordAndReplaceSession,
	signInAndLoadSession,
} from "./auth-flow";

describe("authentication browser flow", () => {
	it("loads the server-owned safe session after Better Auth sign-in", async () => {
		const session = { userId: "admin-1" };
		await expect(
			signInAndLoadSession(
				{ email: "admin@example.com", password: "temporary-password" },
				{
					loadSession: async () => session,
					signIn: async () => ({ error: null }),
				},
			),
		).resolves.toBe(session);
	});

	it("does not treat an auth response without a safe session as authenticated", async () => {
		await expect(
			signInAndLoadSession(
				{ email: "admin@example.com", password: "temporary-password" },
				{
					loadSession: async () => null,
					signIn: async () => ({ error: null }),
				},
			),
		).rejects.toEqual(new AuthenticationFlowError("SESSION_NOT_ESTABLISHED"));
	});

	it.each([
		["INVALID_CREDENTIALS", "INVALID_CREDENTIALS"],
		["RATE_LIMITED", "RATE_LIMITED"],
		["AUTH_REQUEST_FAILED", "SIGN_IN_FAILED"],
	] as const)("maps the bounded %s transport error to %s", async (transportCode, flowCode) => {
		await expect(
			signInAndLoadSession(
				{ email: "admin@example.com", password: "temporary-password" },
				{
					loadSession: async () => ({ userId: "unexpected" }),
					signIn: async () => ({ error: { code: transportCode } }),
				},
			),
		).rejects.toEqual(new AuthenticationFlowError(flowCode));
	});

	it("rotates the password, clears stale Query state, and signs in with the new password in order", async () => {
		const order: string[] = [];
		const clearSessionCache = vi.fn(() => order.push("clear"));
		const changePassword = vi.fn(async () => {
			order.push("change");
		});
		const signIn = vi.fn(async () => {
			order.push("sign-in");
			return { error: null };
		});
		const loadSession = vi.fn(async () => {
			order.push("load");
			return { mustChangePassword: false };
		});

		await expect(
			rotatePasswordAndReplaceSession(
				{
					currentPassword: "temporary-password",
					email: "admin@example.com",
					newPassword: "replacement-password",
				},
				{ changePassword, clearSessionCache, loadSession, signIn },
			),
		).resolves.toEqual({ mustChangePassword: false });
		expect(order).toEqual(["change", "clear", "sign-in", "load"]);
		expect(signIn).toHaveBeenCalledWith({
			email: "admin@example.com",
			password: "replacement-password",
		});
	});

	it("never signs in again when password rotation fails", async () => {
		const signIn = vi.fn(async () => ({ error: null }));
		await expect(
			rotatePasswordAndReplaceSession(
				{
					currentPassword: "temporary-password",
					email: "admin@example.com",
					newPassword: "replacement-password",
				},
				{
					changePassword: async () => {
						throw new Error("rejected");
					},
					clearSessionCache: () => {},
					loadSession: async () => null,
					signIn,
				},
			),
		).rejects.toThrow("rejected");
		expect(signIn).not.toHaveBeenCalled();
	});

	it("distinguishes replacement-session failure after the password was changed", async () => {
		const order: string[] = [];
		await expect(
			rotatePasswordAndReplaceSession(
				{
					currentPassword: "temporary-password",
					email: "admin@example.com",
					newPassword: "replacement-password",
				},
				{
					changePassword: async () => {
						order.push("change");
					},
					clearSessionCache: () => order.push("clear"),
					loadSession: async () => null,
					signIn: async () => {
						order.push("sign-in");
						return { error: { code: "AUTH_REQUEST_FAILED" } };
					},
				},
			),
		).rejects.toEqual(new AuthenticationFlowError("SIGN_IN_FAILED"));
		expect(order).toEqual(["change", "clear", "sign-in"]);
	});
});
