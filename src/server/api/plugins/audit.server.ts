import { Elysia } from "elysia";

import {
	type ApiRequestContextStore,
	extractClientIp,
	extractUserAgent,
	isApiV1Path,
	requestPathname,
} from "../context.server";

export interface AuditPluginDependencies {
	readonly contextStore: ApiRequestContextStore;
}

export function createAuditPlugin({ contextStore }: AuditPluginDependencies) {
	return new Elysia({ name: "updater-admin.audit" }).onRequest(
		({ request }) => {
			if (!isApiV1Path(requestPathname(request))) return;
			const context = contextStore.require(request);
			const session = context.session;
			if (!session) throw new Error("Audit context requires a session.");

			contextStore.setAudit(request, {
				actorId: session.user.id,
				ip: extractClientIp(request.headers),
				requestId: context.requestId,
				userAgent: extractUserAgent(request.headers),
			});
		},
	);
}
