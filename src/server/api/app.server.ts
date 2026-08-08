import { Elysia } from "elysia";

import { getAuth } from "../auth/auth.server";
import { getSafeSession, type SafeSessionView } from "../auth/session.server";
import type { AppendAuditEventInput } from "../db/repositories/audit.server";
import {
	type BeginPasswordChangeInput,
	type CompletePasswordChangeInput,
	createProfileRepository,
	type ProfileUpdateRecord,
	type UpdateProfileRepositoryInput,
} from "../db/repositories/profile.server";
import type {
	RateLimitDecision,
	RateLimitInput,
} from "../db/repositories/rate-limit.server";
import type { AdministratorsService } from "../domain/administrators.server";
import type { AuditService } from "../domain/audit.server";
import type { DraftVersionFilesService } from "../domain/draft-version-files.server";
import type { MonitoringService } from "../domain/monitoring.server";
import type { ProgramsService } from "../domain/programs.server";
import type {
	PublicReleasesService,
	PublicReleasesV2Service,
} from "../domain/public-releases.server";
import type { SettingsService } from "../domain/settings.server";
import type { UploadsService } from "../domain/uploads.server";
import type { FilesService, VersionsService } from "../domain/versions.server";
import { captureServerException } from "../integrations/sentry/sentry.server";
import { ApiRequestContextStore } from "./context.server";
import { createAdministratorsModule } from "./modules/administrators";
import { createAuditModule } from "./modules/audit";
import { createDraftVersionFilesModule } from "./modules/draft-version-files";
import { createFilesModule } from "./modules/files";
import { createMonitoringModule } from "./modules/monitoring";
import { createProfileModule, type PasswordAuthApi } from "./modules/profile";
import { createProgramsModule } from "./modules/programs";
import {
	createPublicReleasesModule,
	createPublicReleasesV2Module,
} from "./modules/public-releases";
import { createSettingsModule } from "./modules/settings";
import { createUploadsModule } from "./modules/uploads";
import { createVersionsModule } from "./modules/versions";
import { createAuditPlugin } from "./plugins/audit.server";
import { createOriginPlugin } from "./plugins/origin.server";
import { createPublicApiPlugin } from "./plugins/public-api.server";
import {
	createRateLimitPlugin,
	type RateLimitPolicy,
} from "./plugins/rate-limit.server";
import { createRequestIdPlugin } from "./plugins/request-id";
import { createSessionPlugin } from "./plugins/session.server";
import { mapApiError } from "./problem";
import { healthSchema } from "./schemas/common";

export interface ApiAppDependencies {
	readonly appendFailureAudit?: (
		input: AppendAuditEventInput,
	) => Promise<unknown>;
	readonly beginPasswordChange?: (
		input: BeginPasswordChangeInput,
	) => Promise<void>;
	readonly completePasswordChange?: (
		input: CompletePasswordChangeInput,
	) => Promise<void>;
	readonly updateProfile?: (
		input: UpdateProfileRepositoryInput,
	) => Promise<ProfileUpdateRecord>;
	readonly consumeRateLimit?: (
		input: RateLimitInput,
	) => Promise<RateLimitDecision>;
	readonly failureAuditTimeoutMs?: number;
	readonly generateRequestId?: () => string;
	readonly getCanonicalOrigin?: () => string | Promise<string>;
	readonly getAdministratorsService?: () => AdministratorsService;
	readonly getAuditService?: () => AuditService;
	readonly getDraftVersionFilesService?: () => DraftVersionFilesService;
	readonly getFilesService?: () => FilesService;
	readonly getMonitoringService?: () => MonitoringService;
	readonly getPasswordAuthApi?: () => PasswordAuthApi;
	readonly getProgramsService?: () => ProgramsService;
	readonly getPublicApiAllowedOrigins?: () =>
		| Promise<readonly string[]>
		| readonly string[];
	readonly getPublicReleasesService?: () => PublicReleasesService;
	readonly getPublicReleasesV2Service?: () => PublicReleasesV2Service;
	readonly getSettingsService?: () => SettingsService;
	readonly getSession?: (headers: Headers) => Promise<SafeSessionView | null>;
	readonly getUploadsService?: () => UploadsService;
	readonly getVersionsService?: () => VersionsService;
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
	const reportBackgroundError =
		dependencies.reportInternalError ??
		((error: unknown, requestId: string) =>
			captureServerException(error, {
				requestId,
				route: "/api/v1",
			}));
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
		updateProfile:
			dependencies.updateProfile ??
			((input: UpdateProfileRepositoryInput) =>
				createProfileRepository().updateProfile(input)),
	};

	return new Elysia({ normalize: false })
		.use(
			createRequestIdPlugin({
				contextStore,
				generateRequestId: dependencies.generateRequestId,
			}),
		)
		.use(
			createPublicApiPlugin({
				consume: dependencies.consumeRateLimit,
				contextStore,
				generateRequestId: dependencies.generateRequestId,
				getAllowedOrigins: dependencies.getPublicApiAllowedOrigins,
				now: dependencies.now,
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
		.use(
			createAuditPlugin({
				...(dependencies.appendFailureAudit
					? { appendFailure: dependencies.appendFailureAudit }
					: {}),
				contextStore,
				...(dependencies.failureAuditTimeoutMs === undefined
					? {}
					: { failureAuditTimeoutMs: dependencies.failureAuditTimeoutMs }),
				reportFailureAuditError: reportBackgroundError,
			}),
		)
		.onError((context) => {
			const requestContext = contextStore.get(context.request);
			return mapApiError(context, {
				getRequestId: (request) =>
					contextStore.getRequestId(request) ?? fallbackRequestId(request),
				reportInternalError:
					dependencies.reportInternalError ??
					((error, requestId) =>
						captureServerException(error, {
							...(requestContext?.session?.user.id
								? { actorId: requestContext.session.user.id }
								: {}),
							requestId,
							route: new URL(context.request.url).pathname,
						})),
			});
		})
		.get("/health", () => ({ status: "ok" as const }), {
			response: { 200: healthSchema },
		})
		.group("/api/public/v1", (group) =>
			group.use(
				createPublicReleasesModule({
					...(dependencies.getPublicReleasesService
						? {
								getPublicReleasesService: dependencies.getPublicReleasesService,
							}
						: {}),
				}),
			),
		)
		.group("/api/public/v2", (group) =>
			group.use(
				createPublicReleasesV2Module({
					...(dependencies.getPublicReleasesV2Service
						? {
								getPublicReleasesV2Service:
									dependencies.getPublicReleasesV2Service,
							}
						: {}),
				}),
			),
		)
		.group("/api/v1", (group) =>
			group
				.use(
					createProfileModule({
						contextStore,
						getPasswordAuthApi:
							dependencies.getPasswordAuthApi ?? (() => getAuth().api),
						profileRepository,
					}),
				)
				.use(
					createAdministratorsModule({
						contextStore,
						...(dependencies.getAdministratorsService
							? {
									getAdministratorsService:
										dependencies.getAdministratorsService,
								}
							: {}),
					}),
				)
				.use(
					createProgramsModule({
						contextStore,
						...(dependencies.getProgramsService
							? { getProgramsService: dependencies.getProgramsService }
							: {}),
					}),
				)
				.use(
					createSettingsModule({
						contextStore,
						...(dependencies.getSettingsService
							? { getSettingsService: dependencies.getSettingsService }
							: {}),
					}),
				)
				.use(
					createMonitoringModule({
						contextStore,
						...(dependencies.getMonitoringService
							? {
									getMonitoringService: dependencies.getMonitoringService,
								}
							: {}),
					}),
				)
				.use(
					createAuditModule({
						contextStore,
						...(dependencies.getAuditService
							? { getAuditService: dependencies.getAuditService }
							: {}),
					}),
				)
				.use(
					createVersionsModule({
						contextStore,
						...(dependencies.getVersionsService
							? { getVersionsService: dependencies.getVersionsService }
							: {}),
					}),
				)
				.use(
					createDraftVersionFilesModule({
						contextStore,
						...(dependencies.getDraftVersionFilesService
							? {
									getDraftVersionFilesService:
										dependencies.getDraftVersionFilesService,
								}
							: {}),
					}),
				)
				.use(
					createFilesModule({
						contextStore,
						...(dependencies.getFilesService
							? { getFilesService: dependencies.getFilesService }
							: {}),
					}),
				)
				.use(
					createUploadsModule({
						contextStore,
						...(dependencies.getUploadsService
							? { getUploadsService: dependencies.getUploadsService }
							: {}),
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
