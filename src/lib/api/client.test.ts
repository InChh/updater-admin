import { describe, expect, it } from "vitest";

import type { WeakEntityTag } from "../../shared/api/common";
import { type ApiFetch, ApiProblemError, createApiClient } from "./client";

function jsonResponse(
	value: unknown,
	init: ResponseInit & { readonly headers?: HeadersInit } = {},
): Response {
	const headers = new Headers(init.headers);
	if (!headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}
	return new Response(JSON.stringify(value), { ...init, headers });
}

describe("browser API client", () => {
	it("sends same-origin credentialed JSON and only sets Content-Type for a body", async () => {
		const calls: Array<{
			readonly init: RequestInit | undefined;
			readonly input: RequestInfo | URL;
		}> = [];
		const fetcher: ApiFetch = async (input, init) => {
			calls.push({ init, input });
			return jsonResponse({ ok: true });
		};
		const client = createApiClient(fetcher);
		const controller = new AbortController();

		await client.json("/api/v1/programs?page=1", {
			signal: controller.signal,
		});
		await client.json("/api/v1/programs/program-1", {
			body: { name: "Updater" },
			ifMatch: 'W/"4"',
			method: "PATCH",
		});

		expect(calls).toHaveLength(2);
		expect(calls[0]?.input).toBe("/api/v1/programs?page=1");
		expect(calls[0]?.init).toMatchObject({
			credentials: "include",
			method: "GET",
			signal: controller.signal,
		});
		const getHeaders = new Headers(calls[0]?.init?.headers);
		expect(getHeaders.get("accept")).toBe("application/json");
		expect(getHeaders.has("content-type")).toBe(false);

		expect(calls[1]?.init?.body).toBe(JSON.stringify({ name: "Updater" }));
		const patchHeaders = new Headers(calls[1]?.init?.headers);
		expect(patchHeaders.get("content-type")).toBe("application/json");
		expect(patchHeaders.get("if-match")).toBe('W/"4"');
	});

	it("sanitizes bounded Problem Details and throws the browser error type", async () => {
		const fetcher: ApiFetch = async () =>
			jsonResponse(
				{
					code: "PROGRAM_NAME_CONFLICT",
					debugSecret: "must not survive parsing",
					detail: "A program already uses that name.",
					fieldErrors: [
						{
							code: "PROGRAM_NAME_CONFLICT",
							debugSecret: "drop this too",
							path: "name",
						},
					],
					requestId: "req-safe-1",
					status: 409,
					title: "Program name conflict",
					type: "https://updater-admin.local/problems/program-name-conflict",
				},
				{
					headers: { "content-type": "application/problem+json" },
					status: 409,
				},
			);

		const error = await createApiClient(fetcher)
			.json("/api/v1/programs")
			.catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(ApiProblemError);
		if (!(error instanceof ApiProblemError)) throw new Error("unreachable");
		expect(error).toMatchObject({
			code: "PROGRAM_NAME_CONFLICT",
			requestId: "req-safe-1",
			status: 409,
		});
		expect(error.problem).toEqual({
			code: "PROGRAM_NAME_CONFLICT",
			detail: "A program already uses that name.",
			fieldErrors: [{ code: "PROGRAM_NAME_CONFLICT", path: "name" }],
			requestId: "req-safe-1",
			status: 409,
			title: "Program name conflict",
			type: "https://updater-admin.local/problems/program-name-conflict",
		});
		expect(JSON.stringify(error.problem)).not.toContain("debugSecret");
	});

	it("replaces malformed or oversized failures without exposing response text", async () => {
		const rawSecret = `database-password:${"x".repeat(40_000)}`;
		const fetcher: ApiFetch = async () =>
			new Response(rawSecret, {
				headers: {
					"content-type": "application/problem+json",
					"x-request-id": "req-fallback",
				},
				status: 500,
			});

		const error = await createApiClient(fetcher)
			.json("/api/v1/programs")
			.catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(ApiProblemError);
		if (!(error instanceof ApiProblemError)) throw new Error("unreachable");
		expect(error.problem).toEqual({
			code: "INVALID_RESPONSE",
			requestId: "req-fallback",
			status: 500,
			title: "Request failed",
			type: "about:blank",
		});
		expect(JSON.stringify(error)).not.toContain("database-password");
	});

	it("pairs an entity body only with an exact weak ETag", async () => {
		const responses = [
			jsonResponse(
				{ id: "program-1", name: "Updater", versionCount: 0 },
				{ headers: { etag: 'W/"7"' } },
			),
			jsonResponse(
				{ id: "program-1", name: "Updater", versionCount: 0 },
				{ headers: { etag: '"8"', "x-request-id": "req-etag" } },
			),
		];
		const fetcher: ApiFetch = async () => {
			const response = responses.shift();
			if (!response) throw new Error("missing response");
			return response;
		};
		const client = createApiClient(fetcher);

		await expect(client.entity("/api/v1/programs/program-1")).resolves.toEqual({
			data: { id: "program-1", name: "Updater", versionCount: 0 },
			etag: 'W/"7"' satisfies WeakEntityTag,
		});
		await expect(
			client.entity("/api/v1/programs/program-1"),
		).rejects.toMatchObject({
			code: "INVALID_RESPONSE",
			requestId: "req-etag",
			status: 500,
		});
	});

	it("returns cleanly only for the 204 no-content contract", async () => {
		const responses = [
			new Response(null, { status: 204 }),
			jsonResponse({ deleted: true }, { status: 200 }),
		];
		const fetcher: ApiFetch = async () => {
			const response = responses.shift();
			if (!response) throw new Error("missing response");
			return response;
		};
		const client = createApiClient(fetcher);

		await expect(
			client.noContent("/api/v1/programs/program-1", { method: "DELETE" }),
		).resolves.toBeUndefined();
		await expect(
			client.noContent("/api/v1/programs/program-1", { method: "DELETE" }),
		).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 500 });
	});

	it("rejects external, noncanonical, and forged concurrency inputs before fetch", async () => {
		let calls = 0;
		const fetcher: ApiFetch = async () => {
			calls += 1;
			return jsonResponse({ ok: true });
		};
		const client = createApiClient(fetcher);

		await expect(
			client.json("https://attacker.example/api/v1/programs" as "/api/v1"),
		).rejects.toThrow("canonical same-origin");
		await expect(client.json("/api/v1/programs/../profile")).rejects.toThrow(
			"canonical same-origin",
		);
		await expect(
			client.json("/api/v1/programs/program-1", {
				ifMatch: 'W/"0"' as WeakEntityTag,
				method: "PATCH",
			}),
		).rejects.toThrow("exact weak entity tag");
		await expect(
			client.json("/api/v1/programs/program-1", {
				ifMatch: 'W/"9223372036854775808"' as WeakEntityTag,
				method: "PATCH",
			}),
		).rejects.toThrow("exact weak entity tag");
		expect(calls).toBe(0);
	});
});
