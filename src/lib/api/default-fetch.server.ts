import { getRequest } from "@tanstack/solid-start/server";

import { forwardApiRequest } from "../../server/api/app.server";
import type { ApiFetch } from "./client";

const INHERITED_AUTHENTICATION_HEADERS = ["authorization", "cookie"] as const;

function inputUrl(input: RequestInfo | URL, baseUrl: URL): URL {
	const value =
		input instanceof Request
			? input.url
			: input instanceof URL
				? input.href
				: input;
	const url = new URL(value, baseUrl);
	if (url.origin !== baseUrl.origin) {
		throw new TypeError("SSR API requests must remain on the current origin.");
	}
	return url;
}

function copyHeaders(target: Headers, source: HeadersInit | undefined): void {
	if (!source) return;
	new Headers(source).forEach((value, name) => {
		target.set(name, value);
	});
}

/**
 * Rebuilds the browser-style relative API request inside the active Start SSR
 * request. Only authentication and origin context are inherited; callers keep
 * ownership of all API-specific headers through `Request`/`RequestInit`.
 */
export function createServerApiRequest(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	currentRequest: Request,
): Request {
	const currentUrl = new URL(currentRequest.url);
	const url = inputUrl(input, currentUrl);
	const headers = new Headers();

	for (const name of INHERITED_AUTHENTICATION_HEADERS) {
		const value = currentRequest.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	headers.set(
		"origin",
		currentRequest.headers.get("origin") ?? currentUrl.origin,
	);

	if (input instanceof Request) copyHeaders(headers, input.headers);
	copyHeaders(headers, init?.headers);

	const requestInit = { ...init, headers };
	return input instanceof Request
		? new Request(input, requestInit)
		: new Request(url, requestInit);
}

/**
 * Dispatches SSR data requests straight into the canonical Elysia application.
 * This deliberately avoids an HTTP self-request to the Netlify function.
 */
export const fetchApiOnServer: ApiFetch = async (input, init) =>
	forwardApiRequest(createServerApiRequest(input, init, getRequest()));
