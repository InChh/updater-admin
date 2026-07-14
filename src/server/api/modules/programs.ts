import { Elysia, type Static, t } from "elysia";
import type {
	CreateProgramInput,
	ProgramDetailDto,
	ProgramListItemDto,
	ProgramListSearch,
	ProgramPage,
	UpdateProgramInput,
} from "../../../shared/api/programs";
import { PROGRAM_MAX_PAGE } from "../../../shared/api/programs";
import {
	createProgramsService,
	ProgramNameConflictError,
	ProgramNotFoundError,
	ProgramPreconditionRequiredError,
	ProgramStaleWriteError,
	type ProgramsService,
	ProgramsValidationError,
} from "../../domain/programs.server";
import type { ApiRequestContextStore } from "../context.server";
import { ApiProblemError } from "../problem";
import type { ExactWireShape } from "../schemas/alignment";
import { weakEntityTagSchema } from "../schemas/common";

// The domain counts Unicode code points, while the generated transport check
// uses UTF-16 String.length. A code point occupies at most two UTF-16 units, so
// these coarse caps admit every valid value and the domain remains the exact
// semantic owner.
const PROGRAM_NAME_TRANSPORT_MAX_LENGTH = 128 * 2;
const PROGRAM_DESCRIPTION_TRANSPORT_MAX_LENGTH = 512 * 2;

const programBaseProperties = {
	createdAt: t.String({ format: "date-time" }),
	description: t.Union([
		t.String({ maxLength: PROGRAM_DESCRIPTION_TRANSPORT_MAX_LENGTH }),
		t.Null(),
	]),
	id: t.String({ format: "uuid" }),
	name: t.String({
		maxLength: PROGRAM_NAME_TRANSPORT_MAX_LENGTH,
		minLength: 1,
	}),
	updatedAt: t.String({ format: "date-time" }),
} as const;

export const programListItemSchema = t.Object(
	{
		...programBaseProperties,
		etag: weakEntityTagSchema,
	},
	{ additionalProperties: false },
);

export const programDetailSchema = t.Object(
	{
		...programBaseProperties,
		versionCount: t.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

export const programPageSchema = t.Object(
	{
		items: t.Array(programListItemSchema),
		page: t.Integer({ minimum: 1 }),
		pageSize: t.Union([t.Literal(20), t.Literal(50), t.Literal(100)]),
		total: t.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

export const programListSearchSchema = t.Object(
	{
		name: t.Optional(
			t.String({ maxLength: PROGRAM_NAME_TRANSPORT_MAX_LENGTH }),
		),
		page: t.Optional(t.Numeric({ maximum: PROGRAM_MAX_PAGE, minimum: 1 })),
		pageSize: t.Optional(t.Numeric({ enum: [20, 50, 100] })),
		sort: t.Optional(
			t.Union([t.Literal("createdAt:desc"), t.Literal("createdAt:asc")]),
		),
	},
	{ additionalProperties: false },
);

export const createProgramSchema = t.Object(
	{
		description: t.Optional(
			t.Union([
				t.String({ maxLength: PROGRAM_DESCRIPTION_TRANSPORT_MAX_LENGTH }),
				t.Null(),
			]),
		),
		name: t.String({
			maxLength: PROGRAM_NAME_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
	},
	{ additionalProperties: false },
);

const descriptionInputSchema = t.Union([
	t.String({ maxLength: PROGRAM_DESCRIPTION_TRANSPORT_MAX_LENGTH }),
	t.Null(),
]);

export const updateProgramSchema = t.Union([
	t.Object(
		{
			description: t.Optional(descriptionInputSchema),
			name: t.String({
				maxLength: PROGRAM_NAME_TRANSPORT_MAX_LENGTH,
				minLength: 1,
			}),
		},
		{ additionalProperties: false },
	),
	t.Object(
		{
			description: descriptionInputSchema,
			name: t.Optional(
				t.String({
					maxLength: PROGRAM_NAME_TRANSPORT_MAX_LENGTH,
					minLength: 1,
				}),
			),
		},
		{ additionalProperties: false },
	),
]);

const programIdParamsSchema = t.Object(
	{ programId: t.String({ format: "uuid" }) },
	{ additionalProperties: false },
);

type Assert<Condition extends true> = Condition;
type _ListItemSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof programListItemSchema>, ProgramListItemDto>
>;
type _DetailSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof programDetailSchema>, ProgramDetailDto>
>;
type _PageSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof programPageSchema>, ProgramPage>
>;
type _CreateSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof createProgramSchema>, CreateProgramInput>
>;
type _UpdateSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof updateProgramSchema>, UpdateProgramInput>
>;

export type ProgramsSchemaAlignment =
	| _ListItemSchemaMatchesDto
	| _DetailSchemaMatchesDto
	| _PageSchemaMatchesDto
	| _CreateSchemaMatchesDto
	| _UpdateSchemaMatchesDto;

export interface ProgramsModuleDependencies {
	readonly contextStore: ApiRequestContextStore;
	readonly getProgramsService?: () => ProgramsService;
}

function mapProgramsError(error: unknown): never {
	if (error instanceof ProgramsValidationError) {
		throw new ApiProblemError({
			code: "VALIDATION_FAILED",
			fieldErrors: error.fieldErrors,
			status: 422,
		});
	}
	if (error instanceof ProgramNameConflictError) {
		throw new ApiProblemError({
			code: "PROGRAM_NAME_CONFLICT",
			fieldErrors: error.fieldErrors,
			status: 409,
		});
	}
	if (error instanceof ProgramNotFoundError) {
		throw new ApiProblemError({ code: "NOT_FOUND", status: 404 });
	}
	if (error instanceof ProgramPreconditionRequiredError) {
		throw new ApiProblemError({
			code: "PRECONDITION_REQUIRED",
			status: 428,
		});
	}
	if (error instanceof ProgramStaleWriteError) {
		throw new ApiProblemError({ code: "STALE_WRITE", status: 409 });
	}
	throw error;
}

async function execute<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		return mapProgramsError(error);
	}
}

function requireSession(
	contextStore: ApiRequestContextStore,
	request: Request,
) {
	const context = contextStore.require(request);
	if (!context.session) throw new Error("Programs route requires a session.");
	return context;
}

function requireMutationContext(
	contextStore: ApiRequestContextStore,
	request: Request,
) {
	const context = requireSession(contextStore, request);
	if (!context.audit)
		throw new Error("Program mutation requires audit context.");
	return context.audit;
}

export function createProgramsModule({
	contextStore,
	getProgramsService = () => createProgramsService(),
}: ProgramsModuleDependencies) {
	return new Elysia({ name: "updater-admin.programs" })
		.get(
			"/programs",
			async ({ query, request }) => {
				requireSession(contextStore, request);
				const search: ProgramListSearch = {
					...(query.name === undefined ? {} : { name: query.name }),
					page: query.page ?? 1,
					pageSize: (query.pageSize ?? 20) as 20 | 50 | 100,
					sort: query.sort ?? "createdAt:desc",
				};
				const result = await execute(() => getProgramsService().list(search));
				return { ...result, items: [...result.items] };
			},
			{
				query: programListSearchSchema,
				response: { 200: programPageSchema },
			},
		)
		.post(
			"/programs",
			async ({ body, request, set }): Promise<ProgramDetailDto> => {
				const audit = requireMutationContext(contextStore, request);
				const result = await execute(() =>
					getProgramsService().create(body, audit),
				);
				set.status = 201;
				set.headers.etag = result.etag;
				set.headers.location = `/api/v1/programs/${result.data.id}`;
				return result.data;
			},
			{
				body: createProgramSchema,
				response: { 201: programDetailSchema },
			},
		)
		.get(
			"/programs/:programId",
			async ({ params, request, set }): Promise<ProgramDetailDto> => {
				requireSession(contextStore, request);
				const result = await execute(() =>
					getProgramsService().getById(params.programId),
				);
				set.headers.etag = result.etag;
				return result.data;
			},
			{
				params: programIdParamsSchema,
				response: { 200: programDetailSchema },
			},
		)
		.patch(
			"/programs/:programId",
			async ({ body, params, request, set }): Promise<ProgramDetailDto> => {
				const audit = requireMutationContext(contextStore, request);
				const result = await execute(() =>
					getProgramsService().update(
						params.programId,
						request.headers.get("if-match"),
						body,
						audit,
					),
				);
				set.headers.etag = result.etag;
				return result.data;
			},
			{
				body: updateProgramSchema,
				params: programIdParamsSchema,
				response: { 200: programDetailSchema },
			},
		)
		.delete(
			"/programs/:programId",
			async ({ params, request }) => {
				const audit = requireMutationContext(contextStore, request);
				await execute(() =>
					getProgramsService().delete(
						params.programId,
						request.headers.get("if-match"),
						audit,
					),
				);
				return new Response(null, { status: 204 });
			},
			{
				params: programIdParamsSchema,
				response: { 204: t.Void() },
			},
		);
}
