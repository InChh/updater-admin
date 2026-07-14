import { randomUUID } from "node:crypto";

import { Elysia } from "elysia";

import {
	type ApiRequestContextStore,
	isApiV1Path,
	requestPathname,
} from "../context.server";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

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

			const supplied = request.headers.get("x-request-id");
			const requestId =
				supplied && REQUEST_ID_PATTERN.test(supplied)
					? supplied
					: generateRequestId();
			contextStore.initialize(request, requestId);
			set.headers["cache-control"] = "no-store";
			set.headers.vary = "Cookie";
			set.headers["x-request-id"] = requestId;
		},
	);
}
