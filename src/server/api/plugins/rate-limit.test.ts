import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";

import type { ApiProblem } from "../../../shared/api/common";
import type { SafeSessionView } from "../../auth/session.server";
import type { RateLimitDecision } from "../../db/repositories/rate-limit.server";
import { ApiRequestContextStore } from "../context.server";
import { mapApiError } from "../problem";
import {
	createRateLimitPlugin,
	UPLOAD_CREDENTIALS_POLICY,
} from "./rate-limit.server";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-15T01:00:00.000Z");

function decision(
	overrides: Partial<RateLimitDecision> = {},
): RateLimitDecision {
	return {
		allowed: true,
		count: 1,
		limit: UPLOAD_CREDENTIALS_POLICY.limit,
		remaining: UPLOAD_CREDENTIALS_POLICY.limit - 1,
		resetAt: new Date("2026-07-15T01:05:00.000Z"),
		retryAfterSeconds: 300,
		...overrides,
	};
}

function testApp(rateLimitDecision = decision()) {
	const contextStore = new ApiRequestContextStore();
	const consume = vi.fn(async () => rateLimitDecision);
	const handler = vi.fn(() => ({ ok: true }));
	const app = new Elysia({ normalize: false })
		.onError((context) =>
			mapApiError(context, {
				getRequestId: (request) =>
					contextStore.getRequestId(request) ?? "req_fallback",
			}),
		)
		.onRequest(({ request }) => {
			contextStore.initialize(request, "req_test");
			contextStore.setSession(request, {
				user: { id: ACTOR_ID },
			} as SafeSessionView);
		})
		.use(
			createRateLimitPlugin({
				consume,
				contextStore,
				now: () => NOW,
			}),
		)
		.post("/api/v1/uploads/credentials", handler);
	return { app, consume, handler };
}

function credentialsRequest(): Request {
	return new Request("http://localhost/api/v1/uploads/credentials", {
		method: "POST",
	});
}

describe("upload rate-limit policies", () => {
	it("uses a bounded request-count budget for STS issuance", () => {
		expect(UPLOAD_CREDENTIALS_POLICY).toEqual({
			endpoint: "uploads.credentials",
			limit: 10,
			windowSeconds: 5 * 60,
		});
	});

	it("charges one credential request without a per-file cost", async () => {
		const { app, consume, handler } = testApp();

		const response = await app.handle(credentialsRequest());

		expect(response.status).toBe(200);
		expect(handler).toHaveBeenCalledOnce();
		expect(consume).toHaveBeenCalledWith({
			endpoint: "uploads.credentials",
			limit: 10,
			now: NOW,
			subjectKey: ACTOR_ID,
			windowSeconds: 5 * 60,
		});
		expect(response.headers.get("ratelimit-limit")).toBe("10");
		expect(response.headers.get("ratelimit-remaining")).toBe("9");
	});

	it("returns bounded secret-free retry metadata when issuance quota is exhausted", async () => {
		const { app, handler } = testApp(
			decision({
				allowed: false,
				count: 11,
				remaining: 0,
				retryAfterSeconds: 123,
			}),
		);

		const response = await app.handle(credentialsRequest());
		const problem = (await response.json()) as ApiProblem;
		const serialized = JSON.stringify(problem);

		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("123");
		expect(problem).toMatchObject({
			code: "RATE_LIMITED",
			retryAfterSeconds: 123,
			status: 429,
		});
		expect(serialized).not.toContain(ACTOR_ID);
		expect(serialized).not.toContain("credential");
		expect(handler).not.toHaveBeenCalled();
	});
});
