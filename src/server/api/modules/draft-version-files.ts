import { Elysia, type Static, t } from "elysia";

import type {
	CompleteUploadsRequest,
	CompleteUploadsResponse,
	ResolveDraftFilesRequest,
	ResolveDraftFilesResponse,
} from "../../../shared/api/uploads";
import {
	MAX_COMPLETE_UPLOAD_FILES,
	MAX_RESOLVE_DRAFT_FILES,
	UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE,
} from "../../../shared/api/uploads";
import type { VersionFileCursorPage } from "../../../shared/api/versions";
import {
	VERSION_FILE_PAGE_DEFAULT_SIZE,
	VERSION_FILE_PAGE_MAX_SIZE,
} from "../../../shared/api/versions";
import {
	createDraftVersionFilesService,
	DraftVersionFilesNotFoundError,
	type DraftVersionFilesService,
	DraftVersionFilesValidationError,
	DraftVersionFinalizedError,
	DraftVersionPathConflictError,
} from "../../domain/draft-version-files.server";
import { ProgramNotFoundError } from "../../domain/programs.server";
import {
	UploadMetadataConflictError,
	UploadObjectNotFoundError,
	UploadVerificationUnavailableError,
} from "../../domain/uploads.server";
import type { ApiRequestContextStore } from "../context.server";
import { ApiProblemError } from "../problem";
import type { ExactWireShape } from "../schemas/alignment";
import { fileMetadataSchema } from "./files";
import {
	completeUploadItemInputSchema,
	uploadFileMetadataInputSchema,
} from "./uploads";

const resolveStatusSchema = t.Union([
	t.Literal("alreadyAssociated"),
	t.Literal("reused"),
	t.Literal("uploadRequired"),
]);

export const resolveDraftFilesRequestSchema = t.Object(
	{
		files: t.Array(uploadFileMetadataInputSchema, {
			maxItems: MAX_RESOLVE_DRAFT_FILES,
			minItems: 1,
		}),
	},
	{ additionalProperties: false },
);

export const resolveDraftFilesResponseSchema = t.Object(
	{
		files: t.Array(
			t.Object(
				{
					canonicalMimeType: t.Optional(t.String({ maxLength: 510 })),
					path: t.String({ maxLength: 2048, minLength: 1 }),
					status: resolveStatusSchema,
				},
				{ additionalProperties: false },
			),
			{ maxItems: MAX_RESOLVE_DRAFT_FILES, minItems: 1 },
		),
	},
	{ additionalProperties: false },
);

export const completeDraftFilesRequestSchema = t.Object(
	{
		files: t.Array(completeUploadItemInputSchema, {
			maxItems: MAX_COMPLETE_UPLOAD_FILES,
			minItems: 1,
		}),
	},
	{ additionalProperties: false },
);

export const completeDraftFilesResponseSchema = t.Object(
	{
		files: t.Array(fileMetadataSchema, {
			maxItems: MAX_COMPLETE_UPLOAD_FILES,
			minItems: 1,
		}),
	},
	{ additionalProperties: false },
);

export const versionFileCursorSearchSchema = t.Object(
	{
		cursor: t.Optional(t.String({ maxLength: 4096, minLength: 1 })),
		pageSize: t.Optional(
			t.Numeric({ maximum: VERSION_FILE_PAGE_MAX_SIZE, minimum: 1 }),
		),
	},
	{ additionalProperties: false },
);

export const versionFileCursorPageSchema = t.Object(
	{
		items: t.Array(fileMetadataSchema, {
			maxItems: VERSION_FILE_PAGE_MAX_SIZE,
		}),
		nextCursor: t.Union([t.String({ maxLength: 4096 }), t.Null()]),
		pageSize: t.Integer({
			maximum: VERSION_FILE_PAGE_MAX_SIZE,
			minimum: 1,
		}),
		versionId: t.String({ format: "uuid" }),
	},
	{ additionalProperties: false },
);

const versionIdParamsSchema = t.Object(
	{
		programId: t.String({ format: "uuid" }),
		versionId: t.String({ format: "uuid" }),
	},
	{ additionalProperties: false },
);

type Assert<Condition extends true> = Condition;
type _ResolveRequestMatchesDto = Assert<
	ExactWireShape<
		Static<typeof resolveDraftFilesRequestSchema>,
		ResolveDraftFilesRequest
	>
>;
type _ResolveResponseMatchesDto = Assert<
	ExactWireShape<
		Static<typeof resolveDraftFilesResponseSchema>,
		ResolveDraftFilesResponse
	>
>;
type _CompleteRequestMatchesDto = Assert<
	ExactWireShape<
		Static<typeof completeDraftFilesRequestSchema>,
		CompleteUploadsRequest
	>
>;
type _CompleteResponseMatchesDto = Assert<
	ExactWireShape<
		Static<typeof completeDraftFilesResponseSchema>,
		CompleteUploadsResponse
	>
>;
type _FilePageMatchesDto = Assert<
	ExactWireShape<
		Static<typeof versionFileCursorPageSchema>,
		VersionFileCursorPage
	>
>;

export type DraftVersionFilesSchemaAlignment =
	| _ResolveRequestMatchesDto
	| _ResolveResponseMatchesDto
	| _CompleteRequestMatchesDto
	| _CompleteResponseMatchesDto
	| _FilePageMatchesDto;

export interface DraftVersionFilesModuleDependencies {
	readonly contextStore: ApiRequestContextStore;
	readonly getDraftVersionFilesService?: () => DraftVersionFilesService;
}

function mapDraftVersionFilesError(error: unknown): never {
	if (error instanceof DraftVersionFilesValidationError) {
		throw new ApiProblemError({
			code: "VALIDATION_FAILED",
			fieldErrors: error.fieldErrors,
			status: 422,
		});
	}
	if (
		error instanceof ProgramNotFoundError ||
		error instanceof DraftVersionFilesNotFoundError
	) {
		throw new ApiProblemError({ code: "NOT_FOUND", status: 404 });
	}
	if (error instanceof DraftVersionFinalizedError) {
		throw new ApiProblemError({ code: "VERSION_FINALIZED", status: 409 });
	}
	if (error instanceof DraftVersionPathConflictError) {
		throw new ApiProblemError({
			code: "DRAFT_PATH_CONFLICT",
			fieldErrors: error.fieldErrors,
			status: 409,
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
	throw error;
}

async function execute<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		return mapDraftVersionFilesError(error);
	}
}

function requireSession(
	contextStore: ApiRequestContextStore,
	request: Request,
) {
	const context = contextStore.require(request);
	if (!context.session) {
		throw new Error("Draft version file route requires a session.");
	}
	return context;
}

function requireMutationContext(
	contextStore: ApiRequestContextStore,
	request: Request,
) {
	const context = requireSession(contextStore, request);
	if (!context.audit) {
		throw new Error("Draft version file mutation requires audit context.");
	}
	return context.audit;
}

export function createDraftVersionFilesModule({
	contextStore,
	getDraftVersionFilesService = () => createDraftVersionFilesService(),
}: DraftVersionFilesModuleDependencies) {
	return new Elysia({ name: "updater-admin.draft-version-files" })
		.post(
			"/programs/:programId/versions/:versionId/files/resolve",
			async ({ body, params, request, set }) => {
				const audit = requireMutationContext(contextStore, request);
				const result = await execute(() =>
					getDraftVersionFilesService().resolve(
						params.programId,
						params.versionId,
						body,
						audit,
					),
				);
				set.headers["cache-control"] = "no-store";
				return { files: [...result.files] };
			},
			{
				body: resolveDraftFilesRequestSchema,
				params: versionIdParamsSchema,
				response: { 200: resolveDraftFilesResponseSchema },
			},
		)
		.post(
			"/programs/:programId/versions/:versionId/files/complete",
			async ({ body, params, request, set }) => {
				const audit = requireMutationContext(contextStore, request);
				const result = await execute(() =>
					getDraftVersionFilesService().complete(
						params.programId,
						params.versionId,
						body,
						audit,
					),
				);
				set.headers["cache-control"] = "no-store";
				return { files: [...result.files] };
			},
			{
				body: completeDraftFilesRequestSchema,
				params: versionIdParamsSchema,
				response: { 200: completeDraftFilesResponseSchema },
			},
		)
		.get(
			"/programs/:programId/versions/:versionId/files",
			async ({ params, query, request, set }) => {
				requireSession(contextStore, request);
				const result = await execute(() =>
					getDraftVersionFilesService().listFiles(
						params.programId,
						params.versionId,
						{
							...(query.cursor === undefined ? {} : { cursor: query.cursor }),
							pageSize: Number(
								query.pageSize ?? VERSION_FILE_PAGE_DEFAULT_SIZE,
							),
						},
					),
				);
				set.headers["cache-control"] = "no-store";
				return { ...result, items: [...result.items] };
			},
			{
				params: versionIdParamsSchema,
				query: versionFileCursorSearchSchema,
				response: { 200: versionFileCursorPageSchema },
			},
		);
}
