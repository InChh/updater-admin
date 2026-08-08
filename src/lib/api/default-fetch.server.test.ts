import { beforeEach, describe, expect, it, vi } from "vitest";

const { forwardApiRequest, getRequest } = vi.hoisted(() => ({
	forwardApiRequest: vi.fn(),
	getRequest: vi.fn(),
}));

vi.mock("@tanstack/solid-start/server", () => ({ getRequest }));
vi.mock("../../server/api/app.server", () => ({ forwardApiRequest }));

import { fetchApiOnServer } from "./default-fetch.server";

describe("SSR API default fetch", () => {
	beforeEach(() => {
		forwardApiRequest.mockReset();
		getRequest.mockReset();
		getRequest.mockReturnValue(
			new Request("https://admin.example/programs?from=ssr", {
				headers: {
					authorization: "Bearer current-session",
					cookie: "better-auth.session_token=server-only",
					origin: "https://admin.example",
					"proxy-authorization": "Basic should-not-cross",
					referer: "https://sensitive.example/private",
					"user-agent": "private-runtime-agent",
					"x-api-key": "server-secret",
					"x-forwarded-for": "192.0.2.10",
				},
			}),
		);
		forwardApiRequest.mockReturnValue(
			new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
			}),
		);
	});

	it("builds an absolute same-origin request and forwards only auth/origin context", async () => {
		const controller = new AbortController();

		await fetchApiOnServer("/api/v1/programs/program-1?view=detail", {
			body: JSON.stringify({ name: "Updater" }),
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				"x-updater-if-match": 'W/"7"',
			},
			method: "PATCH",
			signal: controller.signal,
		});

		expect(forwardApiRequest).toHaveBeenCalledOnce();
		const request = forwardApiRequest.mock.calls[0]?.[0];
		expect(request).toBeInstanceOf(Request);
		if (!(request instanceof Request)) throw new Error("unreachable");
		expect(request.url).toBe(
			"https://admin.example/api/v1/programs/program-1?view=detail",
		);
		expect(request.method).toBe("PATCH");
		expect(request.headers.get("authorization")).toBe("Bearer current-session");
		expect(request.headers.get("cookie")).toBe(
			"better-auth.session_token=server-only",
		);
		expect(request.headers.get("origin")).toBe("https://admin.example");
		expect(request.headers.get("accept")).toBe("application/json");
		expect(request.headers.get("content-type")).toBe("application/json");
		expect(request.headers.get("x-updater-if-match")).toBe('W/"7"');
		expect(request.headers.has("proxy-authorization")).toBe(false);
		expect(request.headers.has("referer")).toBe(false);
		expect(request.headers.has("user-agent")).toBe(false);
		expect(request.headers.has("x-api-key")).toBe(false);
		expect(request.headers.has("x-forwarded-for")).toBe(false);
		expect(await request.json()).toEqual({ name: "Updater" });
		expect(request.signal.aborted).toBe(false);
		controller.abort();
		expect(request.signal.aborted).toBe(true);
	});

	it("lets explicit request headers override inherited context", async () => {
		await fetchApiOnServer("/api/v1/programs", {
			headers: {
				authorization: "Bearer explicit",
				cookie: "explicit-cookie=value",
				origin: "https://override.example",
				"x-request-id": "req-explicit",
			},
		});

		const request = forwardApiRequest.mock.calls[0]?.[0];
		if (!(request instanceof Request)) throw new Error("unreachable");
		expect(request.headers.get("authorization")).toBe("Bearer explicit");
		expect(request.headers.get("cookie")).toBe("explicit-cookie=value");
		expect(request.headers.get("origin")).toBe("https://override.example");
		expect(request.headers.get("x-request-id")).toBe("req-explicit");
	});

	it("uses the active request origin when browsers omit Origin on navigation", async () => {
		getRequest.mockReturnValue(
			new Request("https://admin.example/programs", {
				headers: { cookie: "session=one" },
			}),
		);

		await fetchApiOnServer(
			new URL("/api/v1/programs", "https://admin.example"),
		);

		const request = forwardApiRequest.mock.calls[0]?.[0];
		if (!(request instanceof Request)) throw new Error("unreachable");
		expect(request.headers.get("origin")).toBe("https://admin.example");
	});

	it("rejects a cross-origin URL before it reaches Elysia", async () => {
		await expect(
			fetchApiOnServer(new URL("https://attacker.example/api/v1/programs")),
		).rejects.toThrow("current origin");
		expect(forwardApiRequest).not.toHaveBeenCalled();
	});
});
