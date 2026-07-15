import { Elysia, type Static, t } from "elysia";

import type {
	CompleteUploadsRequest,
	CompleteUploadsResponse,
	UploadCredentialsRequest,
	UploadCredentialsResponse,
	UploadFileMetadataInput,
	UploadObjectTarget,
} from "../../../shared/api/uploads";
import {
	MAX_COMPLETE_UPLOAD_FILES,
	MAX_UPLOAD_FILES,
	MAX_UPLOAD_MIME_TYPE_CODE_POINTS,
	MAX_UPLOAD_OBJECT_KEY_BYTES,
	MAX_UPLOAD_PATH_CODE_POINTS,
	UPLOAD_MIME_TYPE_PATTERN,
	UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE,
} from "../../../shared/api/uploads";
import { getDatabase } from "../../db/client.server";
import {
	createRateLimitRepository,
	type RateLimitDecision,
	type RateLimitInput,
} from "../../db/repositories/rate-limit.server";
import {
	createUploadsService,
	UploadCredentialsUnavailableError,
	UploadMetadataConflictError,
	UploadObjectNotFoundError,
	type UploadsService,
	UploadsValidationError,
	UploadVerificationUnavailableError,
} from "../../domain/uploads.server";
import type { ApiRequestContextStore } from "../context.server";
import { UPLOAD_COMPLETION_FILE_POLICY } from "../plugins/rate-limit.server";
import { ApiProblemError } from "../problem";
import type { ExactWireShape } from "../schemas/alignment";
import { fileMetadataSchema } from "./files";

// Domain limits count Unicode code points. The transport guard uses JavaScript
// string length, so a two-times cap admits every domain-valid scalar value.
const PATH_TRANSPORT_MAX_LENGTH = MAX_UPLOAD_PATH_CODE_POINTS * 2;
// Every domain-valid UTF-8 key has no more UTF-16 code units than bytes.
const OBJECT_KEY_TRANSPORT_MAX_LENGTH = MAX_UPLOAD_OBJECT_KEY_BYTES;
const MIME_TRANSPORT_MAX_LENGTH = MAX_UPLOAD_MIME_TYPE_CODE_POINTS * 2;
const ETAG_TRANSPORT_MAX_LENGTH = 255 * 2 + 2;
const TEMPORARY_CREDENTIAL_TRANSPORT_MAX_LENGTH = 4_096;

export const uploadFileMetadataInputSchema = t.Object(
	{
		mimeType: t.String({
			maxLength: MIME_TRANSPORT_MAX_LENGTH,
			minLength: 1,
			pattern: UPLOAD_MIME_TYPE_PATTERN.source,
		}),
		path: t.String({ maxLength: PATH_TRANSPORT_MAX_LENGTH, minLength: 1 }),
		sha256: t.String({ pattern: "^[0-9a-f]{64}$" }),
		size: t.String({ pattern: "^(0|[1-9][0-9]{0,12})$" }),
	},
	{ additionalProperties: false },
);

export const uploadCredentialsRequestSchema = t.Object(
	{
		files: t.Array(uploadFileMetadataInputSchema, {
			maxItems: MAX_UPLOAD_FILES,
			minItems: 1,
		}),
	},
	{ additionalProperties: false },
);

export const uploadObjectTargetSchema = t.Object(
	{
		objectKey: t.String({
			maxLength: OBJECT_KEY_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
		path: t.String({ maxLength: PATH_TRANSPORT_MAX_LENGTH, minLength: 1 }),
	},
	{ additionalProperties: false },
);

export const uploadCredentialsResponseSchema = t.Object(
	{
		bucket: t.String({ maxLength: 63, minLength: 3 }),
		credentials: t.Object(
			{
				accessKeyId: t.String({
					maxLength: TEMPORARY_CREDENTIAL_TRANSPORT_MAX_LENGTH,
					minLength: 1,
				}),
				accessKeySecret: t.String({
					maxLength: TEMPORARY_CREDENTIAL_TRANSPORT_MAX_LENGTH,
					minLength: 1,
				}),
				expiration: t.String({ format: "date-time" }),
				securityToken: t.String({
					maxLength: TEMPORARY_CREDENTIAL_TRANSPORT_MAX_LENGTH,
					minLength: 1,
				}),
			},
			{ additionalProperties: false },
		),
		objects: t.Array(uploadObjectTargetSchema, {
			maxItems: MAX_UPLOAD_FILES,
			minItems: 1,
		}),
		region: t.String({ maxLength: 128, minLength: 1 }),
	},
	{ additionalProperties: false },
);

export const completeUploadItemInputSchema = t.Object(
	{
		...uploadFileMetadataInputSchema.properties,
		objectEtag: t.Optional(
			t.String({
				maxLength: ETAG_TRANSPORT_MAX_LENGTH,
				minLength: 1,
			}),
		),
		objectKey: t.String({
			maxLength: OBJECT_KEY_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
	},
	{ additionalProperties: false },
);

export const completeUploadsRequestSchema = t.Object(
	{
		files: t.Array(completeUploadItemInputSchema, {
			maxItems: MAX_COMPLETE_UPLOAD_FILES,
			minItems: 1,
		}),
	},
	{ additionalProperties: false },
);

export const completeUploadsResponseSchema = t.Object(
	{
		files: t.Array(fileMetadataSchema, {
			maxItems: MAX_COMPLETE_UPLOAD_FILES,
			minItems: 1,
		}),
	},
	{ additionalProperties: false },
);

type Assert<Condition extends true> = Condition;
type _MetadataInputSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof uploadFileMetadataInputSchema>,
		UploadFileMetadataInput
	>
>;
type _CredentialsRequestSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof uploadCredentialsRequestSchema>,
		UploadCredentialsRequest
	>
>;
type _TargetSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof uploadObjectTargetSchema>, UploadObjectTarget>
>;
type _CredentialsResponseSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof uploadCredentialsResponseSchema>,
		UploadCredentialsResponse
	>
>;
type _CompleteRequestSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof completeUploadsRequestSchema>,
		CompleteUploadsRequest
	>
>;
type _CompleteResponseSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof completeUploadsResponseSchema>,
		CompleteUploadsResponse
	>
>;

export type UploadsSchemaAlignment =
	| _MetadataInputSchemaMatchesDto
	| _CredentialsRequestSchemaMatchesDto
	| _TargetSchemaMatchesDto
	| _CredentialsResponseSchemaMatchesDto
	| _CompleteRequestSchemaMatchesDto
	| _CompleteResponseSchemaMatchesDto;

export interface UploadsModuleDependencies {
	readonly completionInFlightLimiter?: UploadCompletionInFlightLimiter;
	readonly consumeCompletionRateLimit?: (
		input: RateLimitInput,
	) => Promise<RateLimitDecision>;
	readonly contextStore: ApiRequestContextStore;
	readonly getUploadsService?: () => UploadsService;
	readonly now?: () => Date;
}

export const UPLOAD_COMPLETION_IN_FLIGHT_LIMIT = 2;
export const UPLOAD_COMPLETION_IN_FLIGHT_RETRY_SECONDS = 1;

export interface UploadCompletionInFlightLimiter {
	tryAcquire(actorId: string): (() => void) | null;
}

/**
 * Per-instance backpressure complements the Neon-backed file-token budget. It
 * prevents one actor from filling every local HEAD worker while the shared
 * budget bounds the same actor across independently scaled Netlify instances.
 */
export function createUploadCompletionInFlightLimiter(
	limit = UPLOAD_COMPLETION_IN_FLIGHT_LIMIT,
): UploadCompletionInFlightLimiter {
	if (!Number.isInteger(limit) || limit < 1) {
		throw new RangeError("Invalid upload completion in-flight limit.");
	}
	const activeByActor = new Map<string, number>();
	return {
		tryAcquire(actorId) {
			if (!actorId) throw new RangeError("Upload actor ID is required.");
			const active = activeByActor.get(actorId) ?? 0;
			if (active >= limit) return null;
			activeByActor.set(actorId, active + 1);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const current = activeByActor.get(actorId) ?? 0;
				if (current <= 1) activeByActor.delete(actorId);
				else activeByActor.set(actorId, current - 1);
			};
		},
	};
}

const defaultCompletionInFlightLimiter =
	createUploadCompletionInFlightLimiter();

function mapUploadsError(error: unknown): never {
	if (error instanceof UploadsValidationError) {
		throw new ApiProblemError({
			code: "VALIDATION_FAILED",
			fieldErrors: error.fieldErrors,
			status: 422,
		});
	}
	if (error instanceof UploadMetadataConflictError) {
		throw new ApiProblemError({
			code: "UPLOAD_METADATA_CONFLICT",
			fieldErrors: error.fieldErrors,
			status: 409,
		});
	}
	if (error instanceof UploadObjectNotFoundError) {
		throw new ApiProblemError({
			code: UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE,
			fieldErrors: error.fieldErrors,
			status: 409,
		});
	}
	if (error instanceof UploadVerificationUnavailableError) {
		throw new ApiProblemError({
			code: "UPLOAD_VERIFICATION_UNAVAILABLE",
			status: 503,
		});
	}
	if (error instanceof UploadCredentialsUnavailableError) {
		throw new ApiProblemError({
			code: "UPLOAD_CREDENTIALS_UNAVAILABLE",
			status: 503,
		});
	}
	throw error;
}

async function execute<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		return mapUploadsError(error);
	}
}

function requireSession(
	contextStore: ApiRequestContextStore,
	request: Request,
) {
	const context = contextStore.require(request);
	if (!context.session) throw new Error("Uploads route requires a session.");
	return context;
}

function requireMutationContext(
	contextStore: ApiRequestContextStore,
	request: Request,
) {
	const context = requireSession(contextStore, request);
	if (!context.audit)
		throw new Error("Upload completion requires audit context.");
	return context.audit;
}

export function createUploadsModule({
	completionInFlightLimiter = defaultCompletionInFlightLimiter,
	consumeCompletionRateLimit = (input) =>
		createRateLimitRepository(getDatabase()).consume(input),
	contextStore,
	getUploadsService = () => createUploadsService(),
	now = () => new Date(),
}: UploadsModuleDependencies) {
	return new Elysia({ name: "updater-admin.uploads" })
		.post(
			"/uploads/credentials",
			async ({ body, request, set }) => {
				const audit = requireMutationContext(contextStore, request);
				const result = await execute(() =>
					getUploadsService().issueCredentials(body, audit),
				);
				set.headers["cache-control"] = "no-store";
				return { ...result, objects: [...result.objects] };
			},
			{
				body: uploadCredentialsRequestSchema,
				response: { 200: uploadCredentialsResponseSchema },
			},
		)
		.post(
			"/uploads/complete",
			async ({ body, request, set }) => {
				const audit = requireMutationContext(contextStore, request);
				const release = completionInFlightLimiter.tryAcquire(audit.actorId);
				if (!release) {
					throw new ApiProblemError({
						code: "RATE_LIMITED",
						headers: {
							"retry-after": String(UPLOAD_COMPLETION_IN_FLIGHT_RETRY_SECONDS),
						},
						retryAfterSeconds: UPLOAD_COMPLETION_IN_FLIGHT_RETRY_SECONDS,
						status: 429,
					});
				}
				try {
					const decision = await consumeCompletionRateLimit({
						cost: body.files.length,
						endpoint: UPLOAD_COMPLETION_FILE_POLICY.endpoint,
						limit: UPLOAD_COMPLETION_FILE_POLICY.limit,
						now: now(),
						subjectKey: audit.actorId,
						windowSeconds: UPLOAD_COMPLETION_FILE_POLICY.windowSeconds,
					});
					set.headers["ratelimit-limit"] = decision.limit;
					set.headers["ratelimit-remaining"] = decision.remaining;
					set.headers["ratelimit-reset"] = Math.ceil(
						decision.resetAt.getTime() / 1000,
					);
					if (!decision.allowed) {
						throw new ApiProblemError({
							code: "RATE_LIMITED",
							headers: {
								"retry-after": String(decision.retryAfterSeconds),
							},
							retryAfterSeconds: decision.retryAfterSeconds,
							status: 429,
						});
					}
					const result = await execute(() =>
						getUploadsService().complete(body, audit),
					);
					set.headers["cache-control"] = "no-store";
					return { files: [...result.files] };
				} finally {
					release();
				}
			},
			{
				body: completeUploadsRequestSchema,
				response: { 200: completeUploadsResponseSchema },
			},
		);
}
