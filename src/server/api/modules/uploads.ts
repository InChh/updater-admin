import { Elysia, type Static, t } from "elysia";

import type {
	CompleteUploadsRequest,
	UploadCredentialsRequest,
	UploadCredentialsResponse,
	UploadFileMetadataInput,
} from "../../../shared/api/uploads";
import {
	MAX_COMPLETE_UPLOAD_FILES,
	MAX_UPLOAD_MIME_TYPE_CODE_POINTS,
	MAX_UPLOAD_OBJECT_KEY_BYTES,
	MAX_UPLOAD_PATH_CODE_POINTS,
	UPLOAD_MIME_TYPE_PATTERN,
} from "../../../shared/api/uploads";
import {
	createUploadsService,
	UploadCredentialsUnavailableError,
	type UploadsService,
} from "../../domain/uploads.server";
import type { ApiRequestContextStore } from "../context.server";
import { ApiProblemError } from "../problem";
import type { ExactWireShape } from "../schemas/alignment";

const PATH_TRANSPORT_MAX_LENGTH = MAX_UPLOAD_PATH_CODE_POINTS * 2;
const OBJECT_KEY_TRANSPORT_MAX_LENGTH = MAX_UPLOAD_OBJECT_KEY_BYTES;
const MIME_TRANSPORT_MAX_LENGTH = MAX_UPLOAD_MIME_TYPE_CODE_POINTS * 2;
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
	{},
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
		region: t.String({ maxLength: 128, minLength: 1 }),
		uploadPrefix: t.String({
			maxLength: OBJECT_KEY_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
	},
	{ additionalProperties: false },
);

export const completeUploadItemInputSchema = t.Object(
	{
		...uploadFileMetadataInputSchema.properties,
		objectKey: t.String({
			maxLength: OBJECT_KEY_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
		verifyObject: t.Optional(t.Literal(true)),
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

export type UploadsSchemaAlignment =
	| _MetadataInputSchemaMatchesDto
	| _CredentialsRequestSchemaMatchesDto
	| _CredentialsResponseSchemaMatchesDto
	| _CompleteRequestSchemaMatchesDto;

export interface UploadsModuleDependencies {
	readonly contextStore: ApiRequestContextStore;
	readonly getUploadsService?: () => UploadsService;
}

function requireMutationContext(
	contextStore: ApiRequestContextStore,
	request: Request,
) {
	const context = contextStore.require(request);
	if (!context.session || !context.audit) {
		throw new Error(
			"Upload credential mutation requires a session and audit context.",
		);
	}
	return context.audit;
}

export function createUploadsModule({
	contextStore,
	getUploadsService = () => createUploadsService(),
}: UploadsModuleDependencies) {
	return new Elysia({ name: "updater-admin.uploads" }).post(
		"/uploads/credentials",
		async ({ body, request, set }) => {
			const audit = requireMutationContext(contextStore, request);
			try {
				const result = await getUploadsService().issueCredentials(body, audit);
				set.headers["cache-control"] = "no-store";
				return result;
			} catch (error) {
				if (error instanceof UploadCredentialsUnavailableError) {
					throw new ApiProblemError({
						code: "UPLOAD_CREDENTIALS_UNAVAILABLE",
						status: 503,
					});
				}
				throw error;
			}
		},
		{
			body: uploadCredentialsRequestSchema,
			response: { 200: uploadCredentialsResponseSchema },
		},
	);
}
