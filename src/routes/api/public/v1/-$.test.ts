import { describe, expect, it, vi } from "vitest";

const { forwardApiRequest } = vi.hoisted(() => ({
	forwardApiRequest: vi.fn(),
}));

vi.mock("@tanstack/solid-router", () => ({
	createFileRoute:
		(path: string) =>
		(options: unknown): unknown => ({ options, path }),
}));
vi.mock("../../../../server/api/app.server", () => ({ forwardApiRequest }));

import { Route } from "./$";

describe("public API Start transport", () => {
	it("forwards the raw request and response for every HTTP method", async () => {
		const expected = new Response("elysia", {
			headers: { "x-request-id": "req_transport" },
			status: 429,
		});
		forwardApiRequest.mockReturnValue(expected);
		const handler = (
			Route as unknown as {
				options: {
					server: {
						handlers: {
							ANY(context: { request: Request }): Response;
						};
					};
				};
			}
		).options.server.handlers.ANY;
		const request = new Request(
			"https://admin.example/api/public/v1/programs/id/releases/latest",
			{
				headers: { origin: "https://consumer.example" },
				method: "OPTIONS",
			},
		);

		expect(await handler({ request })).toBe(expected);
		expect(forwardApiRequest).toHaveBeenCalledWith(request);
		expect((Route as unknown as { path: string }).path).toBe(
			"/api/public/v1/$",
		);
	});
});
