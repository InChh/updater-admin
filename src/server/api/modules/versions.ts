import { Elysia, type Static, t } from "elysia";

import type { FilePage } from "../../../shared/api/files";
import type {
	CreateVersionInput,
	SetVersionActivationInput,
	UpdateVersionInput,
	VersionDetailDto,
	VersionListItemDto,
	VersionListSearch,
	VersionPage,
} from "../../../shared/api/versions";
import { VERSION_MAX_PAGE } from "../../../shared/api/versions";
import { ProgramNotFoundError } from "../../domain/programs.server";
import {
	createVersionsService,
	VersionNotFoundError,
	VersionNotGreaterError,
	VersionNumberConflictError,
	VersionPreconditionRequiredError,
	VersionStaleWriteError,
	type VersionsService,
	VersionsValidationError,
} from "../../domain/versions.server";
import type { ApiRequestContextStore } from "../context.server";
import { ApiProblemError } from "../problem";
import type { ExactWireShape } from "../schemas/alignment";
import { weakEntityTagSchema } from "../schemas/common";
import { filePageSchema } from "./files";

const VERSION_DESCRIPTION_TRANSPORT_MAX_LENGTH = 1024 * 2;
const VERSION_FILE_IDS_MAX_ITEMS = 10_000;

const versionBaseProperties = {
	createdAt: t.String({ format: "date-time" }),
	description: t.String({
		maxLength: VERSION_DESCRIPTION_TRANSPORT_MAX_LENGTH,
	}),
	fileCount: t.Integer({ minimum: 0 }),
	id: t.String({ format: "uuid" }),
	isActive: t.Boolean(),
	isLatest: t.Boolean(),
	programId: t.String({ format: "uuid" }),
	updatedAt: t.String({ format: "date-time" }),
	versionNumber: t.String({
		maxLength: 20,
		pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
	}),
} as const;

export const versionListItemSchema = t.Object(
	{ ...versionBaseProperties, etag: weakEntityTagSchema },
	{ additionalProperties: false },
);

export const versionDetailSchema = t.Object(
	{
		...versionBaseProperties,
		fileIds: t.Array(t.String({ format: "uuid" }), {
			maxItems: VERSION_FILE_IDS_MAX_ITEMS,
			uniqueItems: true,
		}),
	},
	{ additionalProperties: false },
);

export const versionPageSchema = t.Object(
	{
		items: t.Array(versionListItemSchema),
		page: t.Integer({ minimum: 1 }),
		pageSize: t.Union([t.Literal(20), t.Literal(50), t.Literal(100)]),
		total: t.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

export const versionListSearchSchema = t.Object(
	{
		page: t.Optional(t.Numeric({ maximum: VERSION_MAX_PAGE, minimum: 1 })),
		pageSize: t.Optional(
			t.Union([t.Literal("20"), t.Literal("50"), t.Literal("100")]),
		),
		sort: t.Optional(
			t.Union([t.Literal("createdAt:desc"), t.Literal("createdAt:asc")]),
		),
	},
	{ additionalProperties: false },
);

const versionNumberInputSchema = t.String({
	maxLength: 20,
	minLength: 1,
});
const versionDescriptionInputSchema = t.String({
	maxLength: VERSION_DESCRIPTION_TRANSPORT_MAX_LENGTH,
});
const versionFileIdsInputSchema = t.Array(t.String({ format: "uuid" }), {
	maxItems: VERSION_FILE_IDS_MAX_ITEMS,
	uniqueItems: true,
});

export const createVersionSchema = t.Object(
	{
		description: t.Optional(versionDescriptionInputSchema),
		fileIds: t.Array(t.String({ format: "uuid" }), {
			maxItems: VERSION_FILE_IDS_MAX_ITEMS,
			minItems: 1,
			uniqueItems: true,
		}),
		versionNumber: versionNumberInputSchema,
	},
	{ additionalProperties: false },
);

export const updateVersionSchema = t.Union([
	t.Object(
		{
			description: t.Optional(versionDescriptionInputSchema),
			fileIds: t.Optional(versionFileIdsInputSchema),
			versionNumber: versionNumberInputSchema,
		},
		{ additionalProperties: false },
	),
	t.Object(
		{
			description: versionDescriptionInputSchema,
			fileIds: t.Optional(versionFileIdsInputSchema),
			versionNumber: t.Optional(versionNumberInputSchema),
		},
		{ additionalProperties: false },
	),
	t.Object(
		{
			description: t.Optional(versionDescriptionInputSchema),
			fileIds: versionFileIdsInputSchema,
			versionNumber: t.Optional(versionNumberInputSchema),
		},
		{ additionalProperties: false },
	),
]);

export const setVersionActivationSchema = t.Object(
	{ isActive: t.Boolean() },
	{ additionalProperties: false },
);

export const versionFileListSearchSchema = t.Object(
	{
		page: t.Optional(t.Numeric({ maximum: VERSION_MAX_PAGE, minimum: 1 })),
		pageSize: t.Optional(
			t.Union([t.Literal("20"), t.Literal("50"), t.Literal("100")]),
		),
		sort: t.Optional(t.Union([t.Literal("path:asc"), t.Literal("path:desc")])),
	},
	{ additionalProperties: false },
);

const programIdParamsSchema = t.Object(
	{ programId: t.String({ format: "uuid" }) },
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
type _ListItemSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof versionListItemSchema>, VersionListItemDto>
>;
type _DetailSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof versionDetailSchema>, VersionDetailDto>
>;
type _PageSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof versionPageSchema>, VersionPage>
>;
type _CreateSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof createVersionSchema>, CreateVersionInput>
>;
type _UpdateSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof updateVersionSchema>, UpdateVersionInput>
>;
type _ActivationSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof setVersionActivationSchema>,
		SetVersionActivationInput
	>
>;
type _NestedFilesSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof filePageSchema>, FilePage>
>;

export type VersionsSchemaAlignment =
	| _ListItemSchemaMatchesDto
	| _DetailSchemaMatchesDto
	| _PageSchemaMatchesDto
	| _CreateSchemaMatchesDto
	| _UpdateSchemaMatchesDto
	| _ActivationSchemaMatchesDto
	| _NestedFilesSchemaMatchesDto;

export interface VersionsModuleDependencies {
	readonly contextStore: ApiRequestContextStore;
	readonly getVersionsService?: () => VersionsService;
}

function mapVersionsError(error: unknown): never {
	if (error instanceof VersionsValidationError) {
		throw new ApiProblemError({
			code: "VALIDATION_FAILED",
			fieldErrors: error.fieldErrors,
			status: 422,
		});
	}
	if (
		error instanceof ProgramNotFoundError ||
		error instanceof VersionNotFoundError
	) {
		throw new ApiProblemError({ code: "NOT_FOUND", status: 404 });
	}
	if (error instanceof VersionNumberConflictError) {
		throw new ApiProblemError({
			code: "VERSION_NUMBER_CONFLICT",
			fieldErrors: error.fieldErrors,
			status: 409,
			title: "A version with this number already exists",
		});
	}
	if (error instanceof VersionNotGreaterError) {
		throw new ApiProblemError({
			code: "VERSION_NOT_GREATER",
			...(error.currentMax === undefined
				? {}
				: { detail: `The current maximum version is ${error.currentMax}.` }),
			fieldErrors: error.fieldErrors,
			status: 409,
			title: "The version number must be greater than the current maximum",
		});
	}
	if (error instanceof VersionPreconditionRequiredError) {
		throw new ApiProblemError({
			code: "PRECONDITION_REQUIRED",
			status: 428,
		});
	}
	if (error instanceof VersionStaleWriteError) {
		throw new ApiProblemError({ code: "STALE_WRITE", status: 409 });
	}
	throw error;
}

async function execute<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		return mapVersionsError(error);
	}
}

function requireSession(
	contextStore: ApiRequestContextStore,
	request: Request,
) {
	const context = contextStore.require(request);
	if (!context.session) throw new Error("Versions route requires a session.");
	return context;
}

function requireMutationContext(
	contextStore: ApiRequestContextStore,
	request: Request,
) {
	const context = requireSession(contextStore, request);
	if (!context.audit)
		throw new Error("Version mutation requires audit context.");
	return context.audit;
}

export function createVersionsModule({
	contextStore,
	getVersionsService = () => createVersionsService(),
}: VersionsModuleDependencies) {
	return new Elysia({ name: "updater-admin.versions" })
		.get(
			"/programs/:programId/versions",
			async ({ params, query, request }) => {
				requireSession(contextStore, request);
				const search: VersionListSearch = {
					page: query.page ?? 1,
					pageSize: Number(query.pageSize ?? 20) as 20 | 50 | 100,
					sort: query.sort ?? "createdAt:desc",
				};
				const result = await execute(() =>
					getVersionsService().list(params.programId, search),
				);
				return { ...result, items: [...result.items] };
			},
			{
				params: programIdParamsSchema,
				query: versionListSearchSchema,
				response: { 200: versionPageSchema },
			},
		)
		.post(
			"/programs/:programId/versions",
			async ({ body, params, request, set }) => {
				const audit = requireMutationContext(contextStore, request);
				const result = await execute(() =>
					getVersionsService().create(params.programId, body, audit),
				);
				set.status = 201;
				set.headers.etag = result.etag;
				set.headers.location = `/api/v1/programs/${params.programId}/versions/${result.data.id}`;
				return { ...result.data, fileIds: [...result.data.fileIds] };
			},
			{
				body: createVersionSchema,
				params: programIdParamsSchema,
				response: { 201: versionDetailSchema },
			},
		)
		.get(
			"/programs/:programId/versions/:versionId",
			async ({ params, request, set }) => {
				requireSession(contextStore, request);
				const result = await execute(() =>
					getVersionsService().getById(params.programId, params.versionId),
				);
				set.headers.etag = result.etag;
				return { ...result.data, fileIds: [...result.data.fileIds] };
			},
			{
				params: versionIdParamsSchema,
				response: { 200: versionDetailSchema },
			},
		)
		.patch(
			"/programs/:programId/versions/:versionId",
			async ({ body, params, request, set }) => {
				const audit = requireMutationContext(contextStore, request);
				const result = await execute(() =>
					getVersionsService().update(
						params.programId,
						params.versionId,
						request.headers.get("if-match"),
						body,
						audit,
					),
				);
				set.headers.etag = result.etag;
				return { ...result.data, fileIds: [...result.data.fileIds] };
			},
			{
				body: updateVersionSchema,
				params: versionIdParamsSchema,
				response: { 200: versionDetailSchema },
			},
		)
		.delete(
			"/programs/:programId/versions/:versionId",
			async ({ params, request }) => {
				const audit = requireMutationContext(contextStore, request);
				await execute(() =>
					getVersionsService().delete(
						params.programId,
						params.versionId,
						request.headers.get("if-match"),
						audit,
					),
				);
				return new Response(null, { status: 204 });
			},
			{
				params: versionIdParamsSchema,
				response: { 204: t.Void() },
			},
		)
		.put(
			"/programs/:programId/versions/:versionId/activation",
			async ({ body, params, request, set }) => {
				const audit = requireMutationContext(contextStore, request);
				const result = await execute(() =>
					getVersionsService().setActivation(
						params.programId,
						params.versionId,
						request.headers.get("if-match"),
						body,
						audit,
					),
				);
				set.headers.etag = result.etag;
				return { ...result.data, fileIds: [...result.data.fileIds] };
			},
			{
				body: setVersionActivationSchema,
				params: versionIdParamsSchema,
				response: { 200: versionDetailSchema },
			},
		)
		.get(
			"/programs/:programId/versions/:versionId/files",
			async ({ params, query, request }) => {
				requireSession(contextStore, request);
				const result = await execute(() =>
					getVersionsService().listFiles(params.programId, params.versionId, {
						page: query.page ?? 1,
						pageSize: Number(query.pageSize ?? 20) as 20 | 50 | 100,
						sort: query.sort ?? "path:asc",
					}),
				);
				return { ...result, items: [...result.items] };
			},
			{
				params: versionIdParamsSchema,
				query: versionFileListSearchSchema,
				response: { 200: filePageSchema },
			},
		);
}
