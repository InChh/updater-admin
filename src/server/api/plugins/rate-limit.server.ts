import { Elysia } from "elysia";

import { getDatabase } from "../../db/client.server";
import {
	createRateLimitRepository,
	type RateLimitDecision,
	type RateLimitInput,
} from "../../db/repositories/rate-limit.server";
import {
	type ApiRequestContextStore,
	canonicalApiPathname,
	isApiV1Path,
	requestPathname,
} from "../context.server";
import { ApiProblemError } from "../problem";

export interface RateLimitPolicy {
	readonly endpoint: string;
	readonly limit: number;
	readonly windowSeconds: number;
}

const PROFILE_CHANGE_PASSWORD_POLICY: RateLimitPolicy = {
	endpoint: "profile.change-password",
	limit: 5,
	windowSeconds: 15 * 60,
};

export const ADMINISTRATOR_CREATE_POLICY: RateLimitPolicy = {
	endpoint: "administrators.create",
	limit: 5,
	windowSeconds: 15 * 60,
};

export const ADMINISTRATOR_RESET_PASSWORD_POLICY: RateLimitPolicy = {
	endpoint: "administrators.reset-password",
	limit: 5,
	windowSeconds: 15 * 60,
};

/**
 * One credential response authorizes the configured upload prefix for its
 * validity window. This request-count budget permits recovery while preventing
 * STS issuance from becoming an oracle.
 */
export const UPLOAD_CREDENTIALS_POLICY: RateLimitPolicy = {
	endpoint: "uploads.credentials",
	limit: 10,
	windowSeconds: 5 * 60,
};

const RATE_LIMIT_POLICIES = new Map<string, RateLimitPolicy>([
	["POST /api/v1/administrators", ADMINISTRATOR_CREATE_POLICY],
	["POST /api/v1/profile/change-password", PROFILE_CHANGE_PASSWORD_POLICY],
	["POST /api/v1/uploads/credentials", UPLOAD_CREDENTIALS_POLICY],
]);

const ADMINISTRATOR_RESET_PASSWORD_PATH =
	/^\/api\/v1\/administrators\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/reset-password$/i;

function resolveRateLimitPolicy(
	method: string,
	pathname: string,
	policies: ReadonlyMap<string, RateLimitPolicy>,
): RateLimitPolicy | undefined {
	const exact = policies.get(`${method} ${pathname}`);
	if (exact) return exact;
	if (method === "POST" && ADMINISTRATOR_RESET_PASSWORD_PATH.test(pathname)) {
		return ADMINISTRATOR_RESET_PASSWORD_POLICY;
	}
	return undefined;
}

export interface RateLimitPluginDependencies {
	readonly consume?: (input: RateLimitInput) => Promise<RateLimitDecision>;
	readonly contextStore: ApiRequestContextStore;
	readonly now?: () => Date;
	readonly policies?: ReadonlyMap<string, RateLimitPolicy>;
}

export function createRateLimitPlugin({
	consume = (input) => createRateLimitRepository(getDatabase()).consume(input),
	contextStore,
	now = () => new Date(),
	policies = RATE_LIMIT_POLICIES,
}: RateLimitPluginDependencies) {
	return new Elysia({ name: "updater-admin.rate-limit" }).onRequest(
		async ({ request, set }) => {
			const pathname = canonicalApiPathname(requestPathname(request));
			if (!isApiV1Path(pathname)) return;
			const policy = resolveRateLimitPolicy(request.method, pathname, policies);
			if (!policy) return;

			const session = contextStore.require(request).session;
			if (!session) throw new Error("Rate limiting requires a session.");
			const decision = await consume({
				endpoint: policy.endpoint,
				limit: policy.limit,
				now: now(),
				subjectKey: session.user.id,
				windowSeconds: policy.windowSeconds,
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
		},
	);
}
