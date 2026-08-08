import { randomUUID } from "node:crypto";

import { Elysia } from "elysia";
import { getDatabase } from "../../db/client.server";
import {
	createRateLimitRepository,
	type RateLimitDecision,
	type RateLimitInput,
} from "../../db/repositories/rate-limit.server";
import { readPublicApiEnvironment } from "../../env.server";
import {
	type ApiRequestContextStore,
	canonicalApiPathname,
	extractClientIp,
	requestPathname,
} from "../context.server";
import { ApiProblemError } from "../problem";
import { resolveRequestId } from "./request-id";

export const PUBLIC_RELEASE_RATE_LIMIT_POLICY = {
	endpoint: "public-releases.read",
	limit: 120,
	windowSeconds: 60,
} as const;

const PUBLIC_RELEASE_V1_PATH =
	/^\/api\/public\/v1\/programs\/[^/]+\/releases\/[^/]+$/;
const PUBLIC_RELEASE_V2_HEADER_PATH =
	/^\/api\/public\/v2\/programs\/[^/]+\/releases\/[^/]+$/;
const PUBLIC_RELEASE_V2_FILES_PATH =
	/^\/api\/public\/v2\/programs\/[^/]+\/releases\/[^/]+\/files$/;
const PUBLIC_RELEASE_V2_DOWNLOAD_URLS_PATH =
	/^\/api\/public\/v2\/programs\/[^/]+\/releases\/[^/]+\/download-urls$/;
const PUBLIC_READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PUBLIC_READ_HEADERS = new Set(["x-request-id"]);
const PUBLIC_DOWNLOAD_METHODS = new Set(["POST", "OPTIONS"]);
const PUBLIC_DOWNLOAD_HEADERS = new Set(["content-type", "x-request-id"]);
const UNKNOWN_CLIENT_IP_SUBJECT = "unknown-client-ip";

interface CorsState {
	readonly allowed: boolean;
}

interface PublicRoutePolicy {
	readonly allowedHeaders: ReadonlySet<string>;
	readonly allowedMethods: ReadonlySet<string>;
	readonly allowMethodsHeader: string;
}

const PUBLIC_READ_POLICY: PublicRoutePolicy = {
	allowedHeaders: PUBLIC_READ_HEADERS,
	allowedMethods: PUBLIC_READ_METHODS,
	allowMethodsHeader: "GET, HEAD, OPTIONS",
};

const PUBLIC_DOWNLOAD_POLICY: PublicRoutePolicy = {
	allowedHeaders: PUBLIC_DOWNLOAD_HEADERS,
	allowedMethods: PUBLIC_DOWNLOAD_METHODS,
	allowMethodsHeader: "POST, OPTIONS",
};

export interface PublicApiPluginDependencies {
	readonly consume?: (input: RateLimitInput) => Promise<RateLimitDecision>;
	readonly contextStore: ApiRequestContextStore;
	readonly generateRequestId?: () => string;
	readonly getAllowedOrigins?: () =>
		| Promise<readonly string[]>
		| readonly string[];
	readonly now?: () => Date;
}

function publicRoutePolicy(request: Request): PublicRoutePolicy | undefined {
	const pathname = canonicalApiPathname(requestPathname(request));
	if (
		PUBLIC_RELEASE_V1_PATH.test(pathname) ||
		PUBLIC_RELEASE_V2_HEADER_PATH.test(pathname) ||
		PUBLIC_RELEASE_V2_FILES_PATH.test(pathname)
	) {
		return PUBLIC_READ_POLICY;
	}
	if (PUBLIC_RELEASE_V2_DOWNLOAD_URLS_PATH.test(pathname)) {
		return PUBLIC_DOWNLOAD_POLICY;
	}
	return undefined;
}

function normalizeOrigin(value: string): string | null {
	try {
		const parsed = new URL(value);
		if (
			!parsed.hostname ||
			parsed.username ||
			parsed.password ||
			(parsed.pathname !== "/" && parsed.pathname !== "") ||
			parsed.search ||
			parsed.hash
		) {
			return null;
		}
		return parsed.origin;
	} catch {
		return null;
	}
}

function requestedHeaders(request: Request): readonly string[] | null {
	const raw = request.headers.get("access-control-request-headers");
	if (!raw) return [];
	const values = raw.split(",").map((value) => value.trim().toLowerCase());
	if (values.some((value) => !value)) return null;
	return values;
}

export function createPublicApiPlugin({
	consume = (input) => createRateLimitRepository(getDatabase()).consume(input),
	contextStore,
	generateRequestId = () => `req_${randomUUID()}`,
	getAllowedOrigins = () => readPublicApiEnvironment().allowedOrigins,
	now = () => new Date(),
}: PublicApiPluginDependencies) {
	const corsStates = new WeakMap<Request, CorsState>();
	let allowedOriginsPromise: Promise<ReadonlySet<string>> | undefined;
	const resolveAllowedOrigins = () => {
		allowedOriginsPromise ??= Promise.resolve(getAllowedOrigins()).then(
			(origins) => new Set(origins),
		);
		return allowedOriginsPromise;
	};

	return new Elysia({ name: "updater-admin.public-api" })
		.onRequest(async ({ request, set }) => {
			if (!publicRoutePolicy(request)) return;

			const requestId = resolveRequestId(request, generateRequestId);
			contextStore.initialize(request, requestId);
			set.headers["cache-control"] = "no-store";
			set.headers["x-request-id"] = requestId;
			set.headers.vary = "Origin";
			set.headers["access-control-expose-headers"] = "X-Request-Id";

			const suppliedOrigin = request.headers.get("origin");
			if (!suppliedOrigin) {
				corsStates.set(request, { allowed: true });
				return;
			}
			const canonicalOrigin = normalizeOrigin(suppliedOrigin);
			const allowed =
				canonicalOrigin !== null &&
				(await resolveAllowedOrigins()).has(canonicalOrigin);
			corsStates.set(request, { allowed });
			if (allowed) {
				set.headers["access-control-allow-origin"] = suppliedOrigin;
			}
		})
		.onBeforeHandle({ as: "global" }, async ({ request, set }) => {
			const routePolicy = publicRoutePolicy(request);
			if (!routePolicy) return;
			const cors = corsStates.get(request);
			if (!cors?.allowed) {
				throw new ApiProblemError({ code: "FORBIDDEN", status: 403 });
			}

			if (request.method === "OPTIONS") {
				set.headers.vary =
					"Origin, Access-Control-Request-Method, Access-Control-Request-Headers";
				const requestedMethod = request.headers.get(
					"access-control-request-method",
				);
				const headers = requestedHeaders(request);
				if (
					(requestedMethod !== null &&
						!routePolicy.allowedMethods.has(requestedMethod)) ||
					headers === null ||
					headers.some((header) => !routePolicy.allowedHeaders.has(header))
				) {
					throw new ApiProblemError({ code: "FORBIDDEN", status: 403 });
				}
				set.headers["access-control-allow-methods"] =
					routePolicy.allowMethodsHeader;
				if (headers.length > 0) {
					set.headers["access-control-allow-headers"] = headers
						.map((header) =>
							header === "content-type" ? "Content-Type" : "X-Request-Id",
						)
						.join(", ");
				}
				return;
			}

			if (!routePolicy.allowedMethods.has(request.method)) return;
			const decision = await consume({
				endpoint: PUBLIC_RELEASE_RATE_LIMIT_POLICY.endpoint,
				limit: PUBLIC_RELEASE_RATE_LIMIT_POLICY.limit,
				now: now(),
				subjectKey:
					extractClientIp(request.headers) ?? UNKNOWN_CLIENT_IP_SUBJECT,
				windowSeconds: PUBLIC_RELEASE_RATE_LIMIT_POLICY.windowSeconds,
			});
			set.headers["ratelimit-limit"] = decision.limit;
			set.headers["ratelimit-remaining"] = decision.remaining;
			set.headers["ratelimit-reset"] = Math.ceil(
				decision.resetAt.getTime() / 1000,
			);
			if (!decision.allowed) {
				throw new ApiProblemError({
					code: "RATE_LIMITED",
					headers: { "retry-after": String(decision.retryAfterSeconds) },
					retryAfterSeconds: decision.retryAfterSeconds,
					status: 429,
				});
			}
		})
		.options(
			"/api/public/v1/programs/:programId/releases/:versionNumber",
			() => new Response(null, { status: 204 }),
		)
		.options(
			"/api/public/v2/programs/:programId/releases/:versionNumber",
			() => new Response(null, { status: 204 }),
		)
		.options(
			"/api/public/v2/programs/:programId/releases/:versionNumber/files",
			() => new Response(null, { status: 204 }),
		)
		.options(
			"/api/public/v2/programs/:programId/releases/:versionNumber/download-urls",
			() => new Response(null, { status: 204 }),
		);
}
