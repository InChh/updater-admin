import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/solid-start", () => {
	const createIsomorphicFn = () => {
		let serverImplementation: ((...args: never[]) => unknown) | undefined;
		const implementation = (...args: never[]) =>
			serverImplementation?.(...args);
		return Object.assign(implementation, {
			client: () => implementation,
			server: (nextServerImplementation: (...args: never[]) => unknown) => {
				serverImplementation = nextServerImplementation;
				return implementation;
			},
		});
	};

	return {
		createClientOnlyFn: (implementation: unknown) => implementation,
		createCsrfMiddleware: (options: {
			filter?: (context: { handlerType: string }) => boolean | Promise<boolean>;
		}) => ({
			options: {
				server: async (context: {
					handlerType: string;
					next: () => Promise<unknown>;
					request: Request;
				}) => {
					if (options.filter && !(await options.filter(context))) {
						return context.next();
					}
					const origin = context.request.headers.get("origin");
					if (origin === new URL(context.request.url).origin) {
						return context.next();
					}
					return new Response("Forbidden", { status: 403 });
				},
			},
		}),
		createIsomorphicFn,
		createMiddleware: () => ({
			server: (server: unknown) => ({ options: { server } }),
		}),
		createStart: (getOptions: () => unknown) => ({
			getOptions: async () => getOptions(),
		}),
	};
});

import {
	captureServerRouterException,
	waitForServerRouterExceptions,
} from "./server/integrations/sentry/router.server";
import { SECURITY_RESPONSE_HEADERS } from "./server/security/headers";
import {
	csrfMiddleware,
	routerSentryLifecycleMiddleware,
	securityHeadersMiddleware,
	startInstance,
} from "./start";

describe("TanStack Start global middleware", () => {
	it("keeps security headers outside Sentry lifecycle and CSRF", async () => {
		const options = await startInstance.getOptions();
		expect(options.requestMiddleware).toEqual([
			securityHeadersMiddleware,
			routerSentryLifecycleMiddleware,
			csrfMiddleware,
		]);
	});

	it("adds security headers when the inner CSRF middleware rejects", async () => {
		const request = new Request("https://admin.example.com/_server", {
			headers: { Origin: "https://attacker.example" },
			method: "POST",
		});
		const csrfServer = csrfMiddleware.options.server as never as (context: {
			handlerType: "serverFn";
			next: () => Promise<never>;
			request: Request;
		}) => Promise<Response>;
		const securityServer = securityHeadersMiddleware.options
			.server as never as (context: {
			next: () => Promise<{ response: Response }>;
		}) => Promise<{ response: Response }>;

		const result = await securityServer({
			next: async () => ({
				response: await csrfServer({
					handlerType: "serverFn",
					next: async () => {
						throw new Error("CSRF rejection must not call next");
					},
					request,
				}),
			}),
		});

		expect(result.response.status).toBe(403);
		for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
			expect(result.response.headers.get(name)).toBe(value);
		}
	});

	it("awaits queued Router reporting before ending the request lifecycle", async () => {
		const request = new Request("https://admin.example.com/programs");
		let finishCapture: (() => void) | undefined;
		const lifecycleServer = routerSentryLifecycleMiddleware.options
			.server as never as (context: {
			next: () => Promise<{ response: Response }>;
			request: Request;
		}) => Promise<{ response: Response }>;

		const lifecycle = lifecycleServer({
			next: async () => {
				captureServerRouterException(new Error("SSR failed"), {
					captureException: vi.fn(
						() =>
							new Promise<void>((resolve) => {
								finishCapture = resolve;
							}),
					),
					generateRequestId: () => "req_start-test",
					readRequest: () => request,
				});
				return { response: new Response("ok") };
			},
			request,
		});

		let lifecycleFinished = false;
		void lifecycle.then(() => {
			lifecycleFinished = true;
		});
		await vi.waitFor(() => expect(finishCapture).toBeTypeOf("function"));
		expect(lifecycleFinished).toBe(false);
		finishCapture?.();
		await lifecycle;
		expect(lifecycleFinished).toBe(true);
		await expect(
			waitForServerRouterExceptions(request),
		).resolves.toBeUndefined();
	});
});
