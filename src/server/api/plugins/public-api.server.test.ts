import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";

import type { ApiProblem } from "../../../shared/api/common";
import type { RateLimitDecision } from "../../db/repositories/rate-limit.server";
import { ApiRequestContextStore } from "../context.server";
import { mapApiError } from "../problem";
import { createPublicApiPlugin } from "./public-api.server";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const PATH = `/api/public/v1/programs/${PROGRAM_ID}/releases/latest`;
const V2_HEADER_PATH = `/api/public/v2/programs/${PROGRAM_ID}/releases/latest`;
const V2_FILES_PATH = `/api/public/v2/programs/${PROGRAM_ID}/releases/10.2.3/files`;
const V2_DOWNLOAD_URLS_PATH = `/api/public/v2/programs/${PROGRAM_ID}/releases/10.2.3/download-urls`;
const NOW = new Date("2026-07-20T02:00:00.000Z");

function decision(
	overrides: Partial<RateLimitDecision> = {},
): RateLimitDecision {
	return {
		allowed: true,
		count: 1,
		limit: 120,
		remaining: 119,
		resetAt: new Date("2026-07-20T02:01:00.000Z"),
		retryAfterSeconds: 60,
		...overrides,
	};
}

function testApp(
	options: {
		readonly allowedOrigins?: readonly string[];
		readonly rateLimitDecision?: RateLimitDecision;
	} = {},
) {
	const contextStore = new ApiRequestContextStore();
	const consume = vi.fn(async () => options.rateLimitDecision ?? decision());
	const handler = vi.fn(() => ({ ok: true }));
	const app = new Elysia({ normalize: false })
		.use(
			createPublicApiPlugin({
				consume,
				contextStore,
				generateRequestId: () => "req_generated",
				getAllowedOrigins: () =>
					options.allowedOrigins ?? ["https://consumer.example"],
				now: () => NOW,
			}),
		)
		.onError((context) =>
			mapApiError(context, {
				getRequestId: (request) =>
					contextStore.getRequestId(request) ?? "req_fallback",
			}),
		)
		.get("/api/public/v1/programs/:programId/releases/:versionNumber", handler)
		.get("/api/public/v2/programs/:programId/releases/:versionNumber", handler)
		.get(
			"/api/public/v2/programs/:programId/releases/:versionNumber/files",
			handler,
		)
		.post(
			"/api/public/v2/programs/:programId/releases/:versionNumber/download-urls",
			handler,
		);
	return { app, consume, handler };
}

async function readProblem(response: Response): Promise<ApiProblem> {
	expect(response.headers.get("content-type")).toBe("application/problem+json");
	return (await response.json()) as ApiProblem;
}

describe("public API plugin", () => {
	it("allows originless callers and rate-limits the primary validated Netlify IP", async () => {
		const { app, consume, handler } = testApp();
		const response = await app.handle(
			new Request(`http://localhost${PATH}`, {
				headers: {
					"x-forwarded-for": "198.51.100.8, 198.51.100.9",
					"x-nf-client-connection-ip": "203.0.113.8",
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(handler).toHaveBeenCalledOnce();
		expect(consume).toHaveBeenCalledWith({
			endpoint: "public-releases.read",
			limit: 120,
			now: NOW,
			subjectKey: "203.0.113.8",
			windowSeconds: 60,
		});
		expect(response.headers.get("x-request-id")).toBe("req_generated");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("ratelimit-limit")).toBe("120");
		expect(response.headers.get("ratelimit-remaining")).toBe("119");
		expect(response.headers.get("ratelimit-reset")).toBe("1784512860");
		expect(response.headers.get("vary")).toBe("Origin");
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
		expect(response.headers.get("access-control-allow-credentials")).toBeNull();
	});

	it("echoes only an allowlisted browser origin and exposes the request ID", async () => {
		const { app } = testApp();
		const response = await app.handle(
			new Request(`http://localhost${PATH}`, {
				headers: {
					origin: "https://consumer.example",
					"x-request-id": "req_browser.1",
				},
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBe(
			"https://consumer.example",
		);
		expect(response.headers.get("access-control-expose-headers")).toBe(
			"X-Request-Id",
		);
		expect(response.headers.get("x-request-id")).toBe("req_browser.1");
		expect(response.headers.get("access-control-allow-credentials")).toBeNull();
	});

	it("applies exact-origin no-store and IP rate limiting to every public v2 operation", async () => {
		for (const operation of [
			{ method: "GET", path: V2_HEADER_PATH },
			{ method: "GET", path: V2_FILES_PATH },
			{
				body: JSON.stringify({
					files: [{ path: "app.bin", sha256: "a".repeat(64) }],
				}),
				method: "POST",
				path: V2_DOWNLOAD_URLS_PATH,
			},
		]) {
			const { app, consume, handler } = testApp();
			const response = await app.handle(
				new Request(`http://localhost${operation.path}`, {
					...(operation.body === undefined ? {} : { body: operation.body }),
					headers: {
						"content-type": "application/json",
						origin: "https://consumer.example",
						"x-nf-client-connection-ip": "203.0.113.8",
					},
					method: operation.method,
				}),
			);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ ok: true });
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(response.headers.get("access-control-allow-origin")).toBe(
				"https://consumer.example",
			);
			expect(handler).toHaveBeenCalledOnce();
			expect(consume).toHaveBeenCalledWith({
				endpoint: "public-releases.read",
				limit: 120,
				now: NOW,
				subjectKey: "203.0.113.8",
				windowSeconds: 60,
			});
		}
	});

	it("rejects an unlisted or null origin before quota and handler work", async () => {
		for (const origin of ["https://attacker.example", "null"]) {
			const { app, consume, handler } = testApp();
			const response = await app.handle(
				new Request(`http://localhost${PATH}`, { headers: { origin } }),
			);

			expect(response.status).toBe(403);
			expect(await readProblem(response)).toMatchObject({
				code: "FORBIDDEN",
				requestId: "req_generated",
				status: 403,
			});
			expect(response.headers.get("vary")).toBe("Origin");
			expect(response.headers.get("access-control-allow-origin")).toBeNull();
			expect(consume).not.toHaveBeenCalled();
			expect(handler).not.toHaveBeenCalled();
		}
	});

	it("fails browser origins closed when the configured allowlist is empty", async () => {
		const { app, consume } = testApp({ allowedOrigins: [] });
		const response = await app.handle(
			new Request(`http://localhost${PATH}`, {
				headers: { origin: "https://consumer.example" },
			}),
		);

		expect(response.status).toBe(403);
		expect(consume).not.toHaveBeenCalled();
	});

	it("serves exact read-route preflight for v1 and v2 without consuming quota", async () => {
		for (const path of [PATH, V2_HEADER_PATH, V2_FILES_PATH]) {
			for (const method of ["GET", "HEAD", "OPTIONS"]) {
				const { app, consume, handler } = testApp();
				const response = await app.handle(
					new Request(`http://localhost${path}`, {
						headers: {
							"access-control-request-headers": "X-Request-Id",
							"access-control-request-method": method,
							origin: "https://consumer.example",
						},
						method: "OPTIONS",
					}),
				);

				expect(response.status).toBe(204);
				expect(await response.text()).toBe("");
				expect(response.headers.get("access-control-allow-methods")).toBe(
					"GET, HEAD, OPTIONS",
				);
				expect(response.headers.get("access-control-allow-headers")).toBe(
					"X-Request-Id",
				);
				expect(response.headers.get("vary")).toContain("Origin");
				expect(consume).not.toHaveBeenCalled();
				expect(handler).not.toHaveBeenCalled();
			}
		}
	});

	it("allows JSON POST preflight only on the exact public v2 signing route", async () => {
		const allowed = testApp();
		const response = await allowed.app.handle(
			new Request(`http://localhost${V2_DOWNLOAD_URLS_PATH}`, {
				headers: {
					"access-control-request-headers": "Content-Type, X-Request-Id",
					"access-control-request-method": "POST",
					origin: "https://consumer.example",
				},
				method: "OPTIONS",
			}),
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-methods")).toBe(
			"POST, OPTIONS",
		);
		expect(response.headers.get("access-control-allow-headers")).toBe(
			"Content-Type, X-Request-Id",
		);
		expect(allowed.consume).not.toHaveBeenCalled();
		expect(allowed.handler).not.toHaveBeenCalled();

		const rejected = testApp();
		const rejection = await rejected.app.handle(
			new Request(`http://localhost${V2_FILES_PATH}`, {
				headers: {
					"access-control-request-headers": "Content-Type",
					"access-control-request-method": "POST",
					origin: "https://consumer.example",
				},
				method: "OPTIONS",
			}),
		);

		expect(rejection.status).toBe(403);
		expect(rejected.consume).not.toHaveBeenCalled();
		expect(rejected.handler).not.toHaveBeenCalled();
	});

	it("rejects disallowed preflight methods and headers", async () => {
		const invalidPreflights: readonly Readonly<Record<string, string>>[] = [
			{ "access-control-request-method": "POST" },
			{
				"access-control-request-headers": "Authorization",
				"access-control-request-method": "GET",
			},
		];
		for (const headers of invalidPreflights) {
			const { app, consume } = testApp();
			const requestHeaders = new Headers(headers);
			requestHeaders.set("origin", "https://consumer.example");
			const response = await app.handle(
				new Request(`http://localhost${PATH}`, {
					headers: requestHeaders,
					method: "OPTIONS",
				}),
			);

			expect(response.status).toBe(403);
			expect(consume).not.toHaveBeenCalled();
		}
	});

	it("uses X-Forwarded-For only when the Netlify IP is invalid and a sentinel otherwise", async () => {
		const fallback = testApp();
		await fallback.app.handle(
			new Request(`http://localhost${PATH}`, {
				headers: {
					"x-forwarded-for": "198.51.100.8, 198.51.100.9",
					"x-nf-client-connection-ip": "not-an-ip",
				},
			}),
		);
		expect(fallback.consume).toHaveBeenCalledWith(
			expect.objectContaining({ subjectKey: "198.51.100.8" }),
		);

		const missing = testApp();
		await missing.app.handle(new Request(`http://localhost${PATH}`));
		expect(missing.consume).toHaveBeenCalledWith(
			expect.objectContaining({ subjectKey: "unknown-client-ip" }),
		);
	});

	it("emits the existing 429 Problem Details and rate headers without service work", async () => {
		const { app, handler } = testApp({
			rateLimitDecision: decision({
				allowed: false,
				count: 121,
				remaining: 0,
				retryAfterSeconds: 37,
			}),
		});
		const response = await app.handle(
			new Request(`http://localhost${PATH}`, {
				headers: { origin: "https://consumer.example" },
			}),
		);

		expect(response.status).toBe(429);
		expect(response.headers.get("ratelimit-limit")).toBe("120");
		expect(response.headers.get("ratelimit-remaining")).toBe("0");
		expect(response.headers.get("retry-after")).toBe("37");
		expect(response.headers.get("access-control-allow-origin")).toBe(
			"https://consumer.example",
		);
		expect(await readProblem(response)).toMatchObject({
			code: "RATE_LIMITED",
			retryAfterSeconds: 37,
			status: 429,
		});
		expect(handler).not.toHaveBeenCalled();
	});

	it("rate-limits public v2 signing before handler work", async () => {
		const { app, consume, handler } = testApp({
			rateLimitDecision: decision({
				allowed: false,
				count: 121,
				remaining: 0,
				retryAfterSeconds: 37,
			}),
		});
		const response = await app.handle(
			new Request(`http://localhost${V2_DOWNLOAD_URLS_PATH}`, {
				body: JSON.stringify({
					files: [{ path: "app.bin", sha256: "a".repeat(64) }],
				}),
				headers: {
					"content-type": "application/json",
					origin: "https://consumer.example",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(429);
		expect(await readProblem(response)).toMatchObject({
			code: "RATE_LIMITED",
			retryAfterSeconds: 37,
			status: 429,
		});
		expect(consume).toHaveBeenCalledOnce();
		expect(handler).not.toHaveBeenCalled();
	});

	it("rate-limits HEAD while returning no body for success and denial", async () => {
		const allowed = testApp();
		const success = await allowed.app.handle(
			new Request(`http://localhost${PATH}`, { method: "HEAD" }),
		);
		expect(success.status).toBe(200);
		expect(await success.text()).toBe("");
		expect(allowed.consume).toHaveBeenCalledOnce();

		const denied = testApp({
			rateLimitDecision: decision({ allowed: false, remaining: 0 }),
		});
		const rejection = await denied.app.handle(
			new Request(`http://localhost${PATH}`, { method: "HEAD" }),
		);
		expect(rejection.status).toBe(429);
		expect(await rejection.text()).toBe("");
		expect(denied.handler).not.toHaveBeenCalled();
	});

	it("does not turn unknown public OPTIONS paths into successful preflights", async () => {
		for (const path of [
			"/api/public/v1/unknown",
			"/api/public/v2/unknown",
			`${V2_DOWNLOAD_URLS_PATH}/extra`,
		]) {
			const { app, consume } = testApp();
			const response = await app.handle(
				new Request(`http://localhost${path}`, {
					headers: {
						"access-control-request-method": "GET",
						origin: "https://consumer.example",
					},
					method: "OPTIONS",
				}),
			);

			expect(response.status).toBe(404);
			expect(response.headers.get("access-control-allow-origin")).toBeNull();
			expect(consume).not.toHaveBeenCalled();
		}
	});
});
