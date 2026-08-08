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
	readonly failureAuditTimeoutMs?: number;
	readonly reportFailureAuditError?: (
		error: unknown,
		requestId: string,
	) => void | Promise<void>;
}

export const DEFAULT_FAILURE_AUDIT_TIMEOUT_MS = 250;

class FailureAuditTimeoutError extends Error {
	constructor() {
		super("Failure audit persistence timed out.");
		this.name = "FailureAuditTimeoutError";
	}
}

function checkedFailureAuditTimeout(value: number | undefined): number {
	const timeout = value ?? DEFAULT_FAILURE_AUDIT_TIMEOUT_MS;
	if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 5_000) {
		throw new RangeError("Failure audit timeout is invalid.");
	}
	return timeout;
}

async function persistFailureAuditWithin(
	operation: () => Promise<unknown>,
	timeoutMs: number,
): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Promise.resolve().then(operation),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new FailureAuditTimeoutError()),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}

function reportFailureAuditBestEffort(
	reporter: AuditPluginDependencies["reportFailureAuditError"],
	error: unknown,
	requestId: string,
): void {
	try {
		void Promise.resolve(reporter?.(error, requestId)).catch(() => undefined);
	} catch {
		// Reporting is observability only and never delays the original problem.
	}
}

interface FailureAuditIntent {
	readonly action: string;
	readonly actorIsResource?: boolean;
	readonly resourceId: string;
	readonly resourceType: string;
}

function failureAuditIntent(request: Request): FailureAuditIntent | null {
	if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
	const pathname = canonicalApiPathname(requestPathname(request));
	if (!isApiV1Path(pathname)) return null;
	if (request.method === "POST" && pathname === "/api/v1/administrators") {
		return {
			action: "administrator.created",
			resourceId: "unassigned",
			resourceType: "administrator",
		};
	}
	const administratorMatch = /^\/api\/v1\/administrators\/([^/]+)$/.exec(
		pathname,
	);
	if (administratorMatch?.[1] && request.method === "PATCH") {
		return {
			action: "administrator.updated",
			resourceId: administratorMatch[1].slice(0, 128),
			resourceType: "administrator",
		};
	}
	const administratorPasswordMatch =
		/^\/api\/v1\/administrators\/([^/]+)\/reset-password$/.exec(pathname);
	if (administratorPasswordMatch?.[1] && request.method === "POST") {
		return {
			action: "administrator.password.reset",
			resourceId: administratorPasswordMatch[1].slice(0, 128),
			resourceType: "administrator",
		};
	}
	const administratorSessionsMatch =
		/^\/api\/v1\/administrators\/([^/]+)\/revoke-sessions$/.exec(pathname);
	if (administratorSessionsMatch?.[1] && request.method === "POST") {
		return {
			action: "administrator.sessions.revoked",
			resourceId: administratorSessionsMatch[1].slice(0, 128),
			resourceType: "administrator",
		};
	}
	if (request.method === "PATCH" && pathname === "/api/v1/profile") {
		return {
			action: "profile.updated",
			actorIsResource: true,
			resourceId: "self",
			resourceType: "profile",
		};
	}
	if (request.method === "PATCH" && pathname === "/api/v1/settings/system") {
		return {
			action: "system-settings.updated",
			resourceId: "1",
			resourceType: "system-settings",
		};
	}
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
	const versionCollectionMatch = /^\/api\/v1\/programs\/[^/]+\/versions$/.exec(
		pathname,
	);
	if (versionCollectionMatch && request.method === "POST") {
		return {
			action: "version.created",
			resourceId: "unassigned",
			resourceType: "version",
		};
	}
	const versionMatch = /^\/api\/v1\/programs\/[^/]+\/versions\/([^/]+)$/.exec(
		pathname,
	);
	if (versionMatch?.[1] && request.method === "PATCH") {
		return {
			action: "version.updated",
			resourceId: versionMatch[1].slice(0, 128),
			resourceType: "version",
		};
	}
	if (versionMatch?.[1] && request.method === "DELETE") {
		return {
			action: "version.deleted",
			resourceId: versionMatch[1].slice(0, 128),
			resourceType: "version",
		};
	}
	const activationMatch =
		/^\/api\/v1\/programs\/[^/]+\/versions\/([^/]+)\/activation$/.exec(
			pathname,
		);
	if (activationMatch?.[1] && request.method === "PUT") {
		return {
			action: "version.activation.updated",
			resourceId: activationMatch[1].slice(0, 128),
			resourceType: "version",
		};
	}
	if (request.method === "POST" && pathname === "/api/v1/uploads/credentials") {
		return {
			action: "upload.credentials.issued",
			resourceId: "unassigned",
			resourceType: "upload",
		};
	}
	if (
		request.method === "POST" &&
		pathname === "/api/v1/profile/change-password"
	) {
		return {
			action: "profile.password.changed",
			actorIsResource: true,
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
	failureAuditTimeoutMs,
	reportFailureAuditError,
}: AuditPluginDependencies) {
	const persistenceTimeoutMs = checkedFailureAuditTimeout(
		failureAuditTimeoutMs,
	);
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
			const audit = context.audit;
			try {
				await persistFailureAuditWithin(
					() =>
						appendFailure({
							action: intent.action,
							actorId: audit.actorId,
							after: {
								code: classifyApiError({ code, error, request }).code,
								method: request.method,
							},
							ip: audit.ip,
							requestId: audit.requestId,
							resourceId: intent.actorIsResource
								? audit.actorId
								: intent.resourceId,
							resourceType: intent.resourceType,
							result: "failure",
							userAgent: audit.userAgent,
						}),
					persistenceTimeoutMs,
				);
			} catch (auditError) {
				reportFailureAuditBestEffort(
					reportFailureAuditError,
					auditError,
					audit.requestId,
				);
			}
		});
}
