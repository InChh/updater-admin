import {
	createCsrfMiddleware,
	createMiddleware,
	createStart,
} from "@tanstack/solid-start";

import { registerServerRouteExceptionHandler } from "./lib/sentry";
import { withSecurityResponseHeaders } from "./server/security/headers";

export const securityHeadersMiddleware = createMiddleware().server(
	async ({ next }) => {
		const result = await next();
		return {
			...result,
			response: withSecurityResponseHeaders(result.response),
		};
	},
);

export const routerSentryLifecycleMiddleware = createMiddleware().server(
	async ({ next, request }) => {
		const sentry = await import("./server/integrations/sentry/router.server");
		registerServerRouteExceptionHandler(sentry.captureServerRouterException);

		return sentry.runWithServerRouterSentryRequest(request, async () => {
			try {
				const result = await next();
				await sentry.waitForServerRouterExceptions(request);
				return result;
			} catch (error) {
				sentry.captureServerRouterException(error);
				await sentry.waitForServerRouterExceptions(request);
				throw error;
			}
		});
	},
);

export const csrfMiddleware = createCsrfMiddleware({
	filter: (context) => context.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
	// Security headers stay outermost so they also decorate a CSRF middleware
	// rejection that returns before invoking the rest of the request chain.
	requestMiddleware: [
		securityHeadersMiddleware,
		routerSentryLifecycleMiddleware,
		csrfMiddleware,
	],
}));
