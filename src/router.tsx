import { createRouter as createTanStackRouter } from "@tanstack/solid-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/solid-router-ssr-query";
import { getContext } from "./integrations/tanstack-query/provider";
import { initializeBrowserSentry, setBrowserSentryRoute } from "./lib/sentry";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const context = getContext();
	const router = createTanStackRouter({
		routeTree,
		context,
		scrollRestoration: true,
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
	});
	setupRouterSsrQueryIntegration({
		queryClient: context.queryClient,
		router,
	});
	void initializeBrowserSentry()
		.then((enabled) => {
			if (!enabled) return;
			router.subscribe("onResolved", ({ toLocation }) => {
				setBrowserSentryRoute(toLocation.pathname);
			});
		})
		.catch(() => undefined);

	return router;
}

declare module "@tanstack/solid-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
