import { Elysia, type Static, t } from "elysia";

import type {
	CreateDraftVersionInput,
	FinalizeDraftVersionRequest,
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
	DraftFileCountConflictError,
	DraftIncompleteError,
	DraftPathConflictError,
	VersionDraftRequiredError,
	VersionFinalizedRequiredError,
	VersionNotFoundError,
	VersionNotGreaterError,
	VersionNumberConflictError,
	VersionPreconditionRequiredError,
	VersionStaleWriteError,
	type VersionsService,
	VersionsValidationError,
} from "../../domain/versions.server";
import type { ApiRequestContextStore } from "../context.server";
import { readUpdaterIfMatch } from "../preconditions";
import { ApiProblemError } from "../problem";
import type { ExactWireShape } from "../schemas/alignment";
import { weakEntityTagSchema } from "../schemas/common";

const VERSION_DESCRIPTION_TRANSPORT_MAX_LENGTH = 1024 * 2;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

const versionBaseProperties = {
	associatedFileCount: t.Integer({ minimum: 0 }),
	createdAt: t.String({ format: "date-time" }),
	description: t.String({
		maxLength: VERSION_DESCRIPTION_TRANSPORT_MAX_LENGTH,
	}),
	expectedFileCount: t.Union([t.Integer({ minimum: 0 }), t.Null()]),
	fileCount: t.Integer({ minimum: 0 }),
	finalizedAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
	id: t.String({ format: "uuid" }),
	isActive: t.Boolean(),
	isLatest: t.Boolean(),
	lifecycleStatus: t.Union([t.Literal("draft"), t.Literal("finalized")]),
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

export const versionDetailSchema = t.Object(versionBaseProperties, {
	additionalProperties: false,
});

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

const versionNumberInputSchema = t.String({ maxLength: 20, minLength: 1 });
const versionDescriptionInputSchema = t.String({
	maxLength: VERSION_DESCRIPTION_TRANSPORT_MAX_LENGTH,
});

export const createDraftVersionSchema = t.Object(
	{
		description: t.Optional(versionDescriptionInputSchema),
		expectedFileCount: t.Integer({
			maximum: POSTGRES_INTEGER_MAX,
			minimum: 1,
		}),
		versionNumber: versionNumberInputSchema,
	},
	{ additionalProperties: false },
);

export const updateVersionSchema = t.Union([
	t.Object(
		{
			description: t.Optional(versionDescriptionInputSchema),
			versionNumber: versionNumberInputSchema,
		},
		{ additionalProperties: false },
	),
	t.Object(
		{
			description: versionDescriptionInputSchema,
			versionNumber: t.Optional(versionNumberInputSchema),
		},
		{ additionalProperties: false },
	),
]);

export const finalizeDraftVersionSchema = t.Object(
	{},
	{ additionalProperties: false },
);

export const setVersionActivationSchema = t.Object(
	{ isActive: t.Boolean() },
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
	ExactWireShape<
		Static<typeof createDraftVersionSchema>,
		CreateDraftVersionInput
	>
>;
type _UpdateSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof updateVersionSchema>, UpdateVersionInput>
>;
type _FinalizeSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof finalizeDraftVersionSchema>,
		FinalizeDraftVersionRequest
	>
>;
type _ActivationSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof setVersionActivationSchema>,
		SetVersionActivationInput
	>
>;

export type VersionsSchemaAlignment =
	| _ListItemSchemaMatchesDto
	| _DetailSchemaMatchesDto
	| _PageSchemaMatchesDto
	| _CreateSchemaMatchesDto
	| _UpdateSchemaMatchesDto
	| _FinalizeSchemaMatchesDto
	| _ActivationSchemaMatchesDto;

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
	if (error instanceof VersionDraftRequiredError) {
		throw new ApiProblemError({ code: "VERSION_FINALIZED", status: 409 });
	}
	if (error instanceof VersionFinalizedRequiredError) {
		throw new ApiProblemError({ code: "VERSION_NOT_FINALIZED", status: 409 });
	}
	if (error instanceof DraftIncompleteError) {
		throw new ApiProblemError({
			code: "DRAFT_INCOMPLETE",
			detail: `Expected ${error.expected} files but found ${error.actual}.`,
			status: 409,
		});
	}
	if (error instanceof DraftFileCountConflictError) {
		throw new ApiProblemError({
			code: "DRAFT_FILE_COUNT_CONFLICT",
			detail: `Expected ${error.expected} files but found ${error.actual}.`,
			status: 409,
		});
	}
	if (error instanceof DraftPathConflictError) {
		throw new ApiProblemError({ code: "DRAFT_PATH_CONFLICT", status: 409 });
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
			"/programs/:programId/versions/drafts",
			async ({ body, params, request, set }) => {
				const audit = requireMutationContext(contextStore, request);
				const result = await execute(() =>
					getVersionsService().createDraft(params.programId, body, audit),
				);
				set.status = 201;
				set.headers.etag = result.etag;
				set.headers.location = `/api/v1/programs/${params.programId}/versions/${result.data.id}`;
				set.headers["cache-control"] = "no-store";
				return result.data;
			},
			{
				body: createDraftVersionSchema,
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
				set.headers["cache-control"] = "no-store";
				return result.data;
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
						readUpdaterIfMatch(request),
						body,
						audit,
					),
				);
				set.headers.etag = result.etag;
				return result.data;
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
						readUpdaterIfMatch(request),
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
		.post(
			"/programs/:programId/versions/:versionId/finalize",
			async ({ params, request, set }) => {
				const audit = requireMutationContext(contextStore, request);
				const result = await execute(() =>
					getVersionsService().finalize(
						params.programId,
						params.versionId,
						readUpdaterIfMatch(request),
						audit,
					),
				);
				set.headers.etag = result.etag;
				set.headers["cache-control"] = "no-store";
				return result.data;
			},
			{
				body: finalizeDraftVersionSchema,
				params: versionIdParamsSchema,
				response: { 200: versionDetailSchema },
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
						readUpdaterIfMatch(request),
						body,
						audit,
					),
				);
				set.headers.etag = result.etag;
				return result.data;
			},
			{
				body: setVersionActivationSchema,
				params: versionIdParamsSchema,
				response: { 200: versionDetailSchema },
			},
		);
}
