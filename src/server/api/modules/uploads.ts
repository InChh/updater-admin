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
	MAX_UPLOAD_FILES,
	MAX_UPLOAD_MIME_TYPE_CODE_POINTS,
	MAX_UPLOAD_OBJECT_KEY_BYTES,
	MAX_UPLOAD_PATH_CODE_POINTS,
	UPLOAD_MIME_TYPE_PATTERN,
} from "../../../shared/api/uploads";
import {
	createUploadsService,
	UploadCredentialsUnavailableError,
	UploadMetadataConflictError,
	type UploadsService,
	UploadsValidationError,
	UploadVerificationUnavailableError,
} from "../../domain/uploads.server";
import type { ApiRequestContextStore } from "../context.server";
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
		objectEtag: t.String({
			maxLength: ETAG_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
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
			maxItems: MAX_UPLOAD_FILES,
			minItems: 1,
		}),
	},
	{ additionalProperties: false },
);

export const completeUploadsResponseSchema = t.Object(
	{
		files: t.Array(fileMetadataSchema, {
			maxItems: MAX_UPLOAD_FILES,
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
	readonly contextStore: ApiRequestContextStore;
	readonly getUploadsService?: () => UploadsService;
}

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
	contextStore,
	getUploadsService = () => createUploadsService(),
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
				const result = await execute(() =>
					getUploadsService().complete(body, audit),
				);
				set.headers["cache-control"] = "no-store";
				return { files: [...result.files] };
			},
			{
				body: completeUploadsRequestSchema,
				response: { 200: completeUploadsResponseSchema },
			},
		);
}
