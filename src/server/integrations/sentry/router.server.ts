import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { captureServerException } from "./sentry.server";

export interface RouterSentryDependencies {
	readonly captureException?: typeof captureServerException;
	readonly generateRequestId?: () => string;
	readonly readRequest?: () => Request;
}

const pendingCaptures = new WeakMap<Request, Set<Promise<void>>>();
const requestStorage = new AsyncLocalStorage<Request>();
const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

function currentRoute(request: Request): string {
	try {
		return new URL(request.url).pathname;
	} catch {
		return "/";
	}
}

function requestCorrelationId(
	request: Request,
	generateRequestId: () => string,
): string {
	const supplied = request.headers.get("x-request-id");
	return supplied && requestIdPattern.test(supplied)
		? supplied
		: generateRequestId();
}

export function runWithServerRouterSentryRequest<Result>(
	request: Request,
	callback: () => Result,
): Result {
	return requestStorage.run(request, callback);
}

/**
 * Captures SSR Router boundary errors without letting observability failures
 * replace the rendered error boundary response.
 */
export function captureServerRouterException(
	error: unknown,
	dependencies: RouterSentryDependencies = {},
): void {
	const captureException =
		dependencies.captureException ?? captureServerException;
	const request = dependencies.readRequest?.() ?? requestStorage.getStore();
	if (!request) return;
	const requestId = requestCorrelationId(
		request,
		dependencies.generateRequestId ?? (() => `req_${randomUUID()}`),
	);

	const route = currentRoute(request);
	let captures = pendingCaptures.get(request);
	if (!captures) {
		captures = new Set();
		pendingCaptures.set(request, captures);
	}

	try {
		const task = Promise.resolve(
			captureException(error, { requestId, route }),
		).catch(() => undefined);
		captures.add(task);
		void task.finally(() => captures?.delete(task));
	} catch {
		// Error reporting must never destabilize the Router error boundary.
	}
}

/** Waits for every Router capture registered during this Start request. */
export async function waitForServerRouterExceptions(
	request: Request,
): Promise<void> {
	const captures = pendingCaptures.get(request);
	if (!captures) return;

	while (captures.size > 0) {
		await Promise.all([...captures]);
	}
	pendingCaptures.delete(request);
}
