import { createClientOnlyFn, createIsomorphicFn } from "@tanstack/solid-start";

const loadBrowserSentry = createClientOnlyFn(() => import("./sentry.client"));

export function hasBrowserSentryDsn(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function browserSentryIsConfigured(): boolean {
	return hasBrowserSentryDsn(import.meta.env.VITE_SENTRY_DSN);
}

/**
 * Loads the browser SDK only after hydration. Keeping the `.client` module
 * behind TanStack Start's client-only boundary prevents it from entering the
 * server bundle while still letting the isomorphic router attach hooks.
 */
export async function initializeBrowserSentry(): Promise<boolean> {
	if (typeof window === "undefined" || !browserSentryIsConfigured())
		return false;

	try {
		const sentry = await loadBrowserSentry();
		return sentry.initializeBrowserSentry();
	} catch {
		return false;
	}
}

export function setBrowserSentryRoute(pathname: string): void {
	if (typeof window === "undefined" || !browserSentryIsConfigured()) return;

	void loadBrowserSentry()
		.then((sentry) => {
			sentry.setBrowserSentryRoute(pathname);
		})
		.catch(() => undefined);
}

export function setBrowserSentryActor(actorId: string | null): void {
	if (typeof window === "undefined" || !browserSentryIsConfigured()) return;

	void loadBrowserSentry()
		.then((sentry) => {
			sentry.setBrowserSentryActor(actorId);
		})
		.catch(() => undefined);
}

export function captureBrowserException(error: unknown): void {
	if (typeof window === "undefined" || !browserSentryIsConfigured()) return;

	void loadBrowserSentry()
		.then((sentry) => {
			sentry.captureBrowserException(error);
		})
		.catch(() => undefined);
}

type ServerRouteExceptionHandler = (error: unknown) => void;

let serverRouteExceptionHandler: ServerRouteExceptionHandler | undefined;

export const registerServerRouteExceptionHandler = createIsomorphicFn()
	.server((handler: ServerRouteExceptionHandler) => {
		serverRouteExceptionHandler = handler;
	})
	.client((_handler: ServerRouteExceptionHandler) => undefined);

const captureEnvironmentRouteException = createIsomorphicFn()
	.client((error: unknown) => captureBrowserException(error))
	.server((error: unknown) => serverRouteExceptionHandler?.(error));

/**
 * Reports root Router boundary failures in the environment where they occur.
 * The Start compiler removes the opposite implementation from each bundle, so
 * the Node SDK remains server-only and the browser SDK remains client-only.
 */
export function captureRouteException(error: unknown): void {
	captureEnvironmentRouteException(error);
}
