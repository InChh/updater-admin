import { isIP } from "node:net";

import type { SafeSessionView } from "../auth/session.server";

export interface ApiAuditRequestContext {
	readonly actorId: string;
	readonly ip: string | null;
	readonly requestId: string;
	readonly userAgent: string | null;
}

export interface ApiRequestContext {
	readonly audit?: ApiAuditRequestContext;
	readonly requestId: string;
	readonly session?: SafeSessionView;
}

interface MutableApiRequestContext {
	audit?: ApiAuditRequestContext;
	requestId: string;
	session?: SafeSessionView;
}

export class ApiRequestContextStore {
	readonly #contexts = new WeakMap<Request, MutableApiRequestContext>();

	initialize(request: Request, requestId: string): ApiRequestContext {
		const context = { requestId };
		this.#contexts.set(request, context);
		return context;
	}

	get(request: Request): ApiRequestContext | undefined {
		return this.#contexts.get(request);
	}

	require(request: Request): ApiRequestContext {
		const context = this.get(request);
		if (!context) throw new Error("API request context was not initialized.");
		return context;
	}

	setSession(request: Request, session: SafeSessionView): void {
		this.requireMutable(request).session = session;
	}

	setAudit(request: Request, audit: ApiAuditRequestContext): void {
		this.requireMutable(request).audit = audit;
	}

	getRequestId(request: Request): string | undefined {
		return this.get(request)?.requestId;
	}

	private requireMutable(request: Request): MutableApiRequestContext {
		const context = this.#contexts.get(request);
		if (!context) throw new Error("API request context was not initialized.");
		return context;
	}
}

export function isApiV1Path(pathname: string): boolean {
	return pathname === "/api/v1" || pathname.startsWith("/api/v1/");
}

export function requestPathname(request: Request): string {
	return new URL(request.url).pathname;
}

/** Match Elysia's trailing-slash route alias when applying path-keyed policy. */
export function canonicalApiPathname(pathname: string): string {
	const withoutTrailingSlash = pathname.replace(/\/+$/, "");
	return withoutTrailingSlash || "/";
}

function validIp(value: string | null): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	return isIP(trimmed) > 0 ? trimmed : null;
}

export function extractClientIp(headers: Headers): string | null {
	const netlifyIp = validIp(headers.get("x-nf-client-connection-ip"));
	if (netlifyIp) return netlifyIp;
	return validIp(headers.get("x-forwarded-for")?.split(",", 1)[0] ?? null);
}

export function extractUserAgent(headers: Headers): string | null {
	const value = headers.get("user-agent")?.trim();
	return value ? value.slice(0, 2048) : null;
}
