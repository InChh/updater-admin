import { Elysia } from "elysia";

import { getAuth } from "../auth/auth.server";
import { getSafeSession, type SafeSessionView } from "../auth/session.server";
import {
	type BeginPasswordChangeInput,
	type CompletePasswordChangeInput,
	createProfileRepository,
} from "../db/repositories/profile.server";
import type {
	RateLimitDecision,
	RateLimitInput,
} from "../db/repositories/rate-limit.server";
import { ApiRequestContextStore } from "./context.server";
import { createProfileModule, type PasswordAuthApi } from "./modules/profile";
import { createAuditPlugin } from "./plugins/audit.server";
import { createOriginPlugin } from "./plugins/origin.server";
import {
	createRateLimitPlugin,
	type RateLimitPolicy,
} from "./plugins/rate-limit.server";
import { createRequestIdPlugin } from "./plugins/request-id";
import { createSessionPlugin } from "./plugins/session.server";
import { mapApiError } from "./problem";
import { healthSchema } from "./schemas/common";

export interface ApiAppDependencies {
	readonly beginPasswordChange?: (
		input: BeginPasswordChangeInput,
	) => Promise<void>;
	readonly completePasswordChange?: (
		input: CompletePasswordChangeInput,
	) => Promise<void>;
	readonly consumeRateLimit?: (
		input: RateLimitInput,
	) => Promise<RateLimitDecision>;
	readonly generateRequestId?: () => string;
	readonly getCanonicalOrigin?: () => string | Promise<string>;
	readonly getPasswordAuthApi?: () => PasswordAuthApi;
	readonly getSession?: (headers: Headers) => Promise<SafeSessionView | null>;
	readonly now?: () => Date;
	readonly rateLimitPolicies?: ReadonlyMap<string, RateLimitPolicy>;
	readonly reportInternalError?: (
		error: unknown,
		requestId: string,
	) => void | Promise<void>;
}

function createFallbackRequestIdGenerator(generateRequestId?: () => string) {
	const generated = new WeakMap<Request, string>();
	return (request: Request) => {
		let requestId = generated.get(request);
		if (!requestId) {
			requestId = generateRequestId?.() ?? `req_${crypto.randomUUID()}`;
			generated.set(request, requestId);
		}
		return requestId;
	};
}

export function createApiApp(dependencies: ApiAppDependencies = {}) {
	const contextStore = new ApiRequestContextStore();
	const fallbackRequestId = createFallbackRequestIdGenerator(
		dependencies.generateRequestId,
	);
	const profileRepository = {
		beginPasswordChange:
			dependencies.beginPasswordChange ??
			((input: BeginPasswordChangeInput) =>
				createProfileRepository().beginPasswordChange(input)),
		completePasswordChange:
			dependencies.completePasswordChange ??
			((input: CompletePasswordChangeInput) =>
				createProfileRepository().completePasswordChange(input)),
	};

	return new Elysia({ normalize: false })
		.onError((context) =>
			mapApiError(context, {
				getRequestId: (request) =>
					contextStore.getRequestId(request) ?? fallbackRequestId(request),
				reportInternalError: dependencies.reportInternalError,
			}),
		)
		.use(
			createRequestIdPlugin({
				contextStore,
				generateRequestId: dependencies.generateRequestId,
			}),
		)
		.use(
			createSessionPlugin({
				contextStore,
				getSession: dependencies.getSession ?? getSafeSession,
			}),
		)
		.use(
			createOriginPlugin({
				getCanonicalOrigin: dependencies.getCanonicalOrigin,
			}),
		)
		.use(
			createRateLimitPlugin({
				consume: dependencies.consumeRateLimit,
				contextStore,
				now: dependencies.now,
				policies: dependencies.rateLimitPolicies,
			}),
		)
		.use(createAuditPlugin({ contextStore }))
		.get("/health", () => ({ status: "ok" as const }), {
			response: { 200: healthSchema },
		})
		.group("/api/v1", (group) =>
			group.use(
				createProfileModule({
					contextStore,
					getPasswordAuthApi:
						dependencies.getPasswordAuthApi ?? (() => getAuth().api),
					profileRepository,
				}),
			),
		);
}

export type ApiApp = ReturnType<typeof createApiApp>;

let singleton: ApiApp | undefined;

export function getApiApp(): ApiApp {
	singleton ??= createApiApp();
	return singleton;
}

export function resetApiAppForTests(): void {
	singleton = undefined;
}

export interface FetchRequestHandler {
	handle(request: Request): Promise<Response> | Response;
}

export function forwardApiRequest(
	request: Request,
	handler: FetchRequestHandler = getApiApp(),
): Promise<Response> | Response {
	return handler.handle(request);
}
