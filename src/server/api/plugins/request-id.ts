import { randomUUID } from "node:crypto";

import { Elysia } from "elysia";

import {
	type ApiRequestContextStore,
	isApiV1Path,
	requestPathname,
} from "../context.server";

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function resolveRequestId(
	request: Request,
	generateRequestId: () => string,
): string {
	const supplied = request.headers.get("x-request-id");
	return supplied && REQUEST_ID_PATTERN.test(supplied)
		? supplied
		: generateRequestId();
}

export interface RequestIdPluginDependencies {
	readonly contextStore: ApiRequestContextStore;
	readonly generateRequestId?: () => string;
}

export function createRequestIdPlugin({
	contextStore,
	generateRequestId = () => `req_${randomUUID()}`,
}: RequestIdPluginDependencies) {
	return new Elysia({ name: "updater-admin.request-id" }).onRequest(
		({ request, set }) => {
			if (!isApiV1Path(requestPathname(request))) return;

			const requestId = resolveRequestId(request, generateRequestId);
			contextStore.initialize(request, requestId);
			set.headers["cache-control"] = "no-store";
			set.headers.vary = "Cookie";
			set.headers["x-request-id"] = requestId;
		},
	);
}
