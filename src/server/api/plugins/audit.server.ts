import { Elysia } from "elysia";

import { getDatabase } from "../../db/client.server";
import {
	type AppendAuditEventInput,
	createAuditRepository,
} from "../../db/repositories/audit.server";
import {
	type ApiRequestContextStore,
	canonicalApiPathname,
	extractClientIp,
	extractUserAgent,
	isApiV1Path,
	requestPathname,
} from "../context.server";
import { classifyApiError } from "../problem";

export interface AuditPluginDependencies {
	readonly appendFailure?: (input: AppendAuditEventInput) => Promise<unknown>;
	readonly contextStore: ApiRequestContextStore;
	readonly reportFailureAuditError?: (
		error: unknown,
		requestId: string,
	) => void | Promise<void>;
}

interface FailureAuditIntent {
	readonly action: string;
	readonly resourceId: string;
	readonly resourceType: string;
}

function failureAuditIntent(request: Request): FailureAuditIntent | null {
	if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
	const pathname = canonicalApiPathname(requestPathname(request));
	if (!isApiV1Path(pathname)) return null;
	if (request.method === "POST" && pathname === "/api/v1/programs") {
		return {
			action: "program.created",
			resourceId: "unassigned",
			resourceType: "program",
		};
	}
	const programMatch = /^\/api\/v1\/programs\/([^/]+)$/.exec(pathname);
	if (programMatch?.[1] && request.method === "PATCH") {
		return {
			action: "program.updated",
			resourceId: programMatch[1].slice(0, 128),
			resourceType: "program",
		};
	}
	if (programMatch?.[1] && request.method === "DELETE") {
		return {
			action: "program.deleted",
			resourceId: programMatch[1].slice(0, 128),
			resourceType: "program",
		};
	}
	if (
		request.method === "POST" &&
		pathname === "/api/v1/profile/change-password"
	) {
		return {
			action: "profile.password.changed",
			resourceId: "self",
			resourceType: "profile",
		};
	}
	return {
		action: "api.mutation",
		resourceId: pathname.slice(0, 128),
		resourceType: "api",
	};
}

export function createAuditPlugin({
	appendFailure = (input) => createAuditRepository(getDatabase()).append(input),
	contextStore,
	reportFailureAuditError,
}: AuditPluginDependencies) {
	return new Elysia({ name: "updater-admin.audit" })
		.onRequest(({ request }) => {
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
		})
		.onError({ as: "global" }, async ({ code, error, request }) => {
			const intent = failureAuditIntent(request);
			const context = contextStore.get(request);
			if (!intent || !context?.audit) return;
			try {
				await appendFailure({
					action: intent.action,
					actorId: context.audit.actorId,
					after: {
						code: classifyApiError({ code, error, request }).code,
						method: request.method,
					},
					ip: context.audit.ip,
					requestId: context.audit.requestId,
					resourceId: intent.resourceId,
					resourceType: intent.resourceType,
					result: "failure",
					userAgent: context.audit.userAgent,
				});
			} catch (auditError) {
				try {
					await reportFailureAuditError?.(auditError, context.audit.requestId);
				} catch {
					// Failure auditing must never replace the original API problem.
				}
			}
		});
}
