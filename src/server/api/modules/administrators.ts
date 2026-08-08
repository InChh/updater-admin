import { Elysia, type Static, t } from "elysia";

import type {
	AdministratorDto,
	AdministratorListSearch,
	AdministratorPage,
	CreateAdministratorInput,
	ResetAdministratorPasswordInput,
	SessionsRevokedResult,
	UpdateAdministratorInput,
} from "../../../shared/api/administrators";
import { ADMINISTRATOR_MAX_PAGE } from "../../../shared/api/administrators";
import {
	AdministratorEmailConflictError,
	AdministratorNotFoundError,
	AdministratorPreconditionRequiredError,
	AdministratorSelfDisableError,
	AdministratorStaleWriteError,
	type AdministratorsService,
	AdministratorsValidationError,
	createAdministratorsService,
	LastActiveAdministratorError,
} from "../../domain/administrators.server";
import type { ApiRequestContextStore } from "../context.server";
import { readUpdaterIfMatch } from "../preconditions";
import { ApiProblemError } from "../problem";
import type { ExactWireShape } from "../schemas/alignment";
import { supportedLocaleSchema, weakEntityTagSchema } from "../schemas/common";

const ADMINISTRATOR_NAME_TRANSPORT_MAX_LENGTH = 128 * 2;
const ADMINISTRATOR_QUERY_TRANSPORT_MAX_LENGTH = 320 * 2;

export const administratorSchema = t.Object(
	{
		createdAt: t.String({ format: "date-time" }),
		email: t.String({ format: "email" }),
		enabled: t.Boolean(),
		etag: weakEntityTagSchema,
		id: t.String({ format: "uuid" }),
		lastLoginAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
		locale: supportedLocaleSchema,
		mustChangePassword: t.Boolean(),
		name: t.String({
			maxLength: ADMINISTRATOR_NAME_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
		updatedAt: t.String({ format: "date-time" }),
	},
	{ additionalProperties: false },
);

export const administratorPageSchema = t.Object(
	{
		items: t.Array(administratorSchema),
		page: t.Integer({ minimum: 1 }),
		pageSize: t.Union([t.Literal(20), t.Literal(50), t.Literal(100)]),
		total: t.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

export const administratorListSearchSchema = t.Object(
	{
		page: t.Optional(
			t.Numeric({ maximum: ADMINISTRATOR_MAX_PAGE, minimum: 1 }),
		),
		pageSize: t.Optional(t.Numeric({ enum: [20, 50, 100] })),
		query: t.Optional(
			t.String({ maxLength: ADMINISTRATOR_QUERY_TRANSPORT_MAX_LENGTH }),
		),
		sort: t.Optional(
			t.Union([
				t.Literal("createdAt:desc"),
				t.Literal("createdAt:asc"),
				t.Literal("name:asc"),
				t.Literal("name:desc"),
			]),
		),
		status: t.Optional(t.Union([t.Literal("active"), t.Literal("disabled")])),
	},
	{ additionalProperties: false },
);

export const createAdministratorSchema = t.Object(
	{
		email: t.String({ format: "email", maxLength: 320 }),
		name: t.String({
			maxLength: ADMINISTRATOR_NAME_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
		temporaryPassword: t.String({ maxLength: 128, minLength: 1 }),
	},
	{ additionalProperties: false },
);

const optionalAdministratorUpdateProperties = {
	enabled: t.Optional(t.Boolean()),
	locale: t.Optional(supportedLocaleSchema),
	name: t.Optional(
		t.String({
			maxLength: ADMINISTRATOR_NAME_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
	),
} as const;

export const updateAdministratorSchema = t.Union([
	t.Object(
		{ ...optionalAdministratorUpdateProperties, enabled: t.Boolean() },
		{ additionalProperties: false },
	),
	t.Object(
		{ ...optionalAdministratorUpdateProperties, locale: supportedLocaleSchema },
		{ additionalProperties: false },
	),
	t.Object(
		{
			...optionalAdministratorUpdateProperties,
			name: t.String({
				maxLength: ADMINISTRATOR_NAME_TRANSPORT_MAX_LENGTH,
				minLength: 1,
			}),
		},
		{ additionalProperties: false },
	),
]);

export const resetAdministratorPasswordSchema = t.Object(
	{ temporaryPassword: t.String({ maxLength: 128, minLength: 1 }) },
	{ additionalProperties: false },
);

export const sessionsRevokedSchema = t.Object(
	{ success: t.Literal(true) },
	{ additionalProperties: false },
);

const administratorIdParamsSchema = t.Object(
	{ administratorId: t.String({ format: "uuid" }) },
	{ additionalProperties: false },
);

type Assert<Condition extends true> = Condition;
type _AdministratorSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof administratorSchema>, AdministratorDto>
>;
type _AdministratorPageMatchesDto = Assert<
	ExactWireShape<Static<typeof administratorPageSchema>, AdministratorPage>
>;
type _CreateAdministratorMatchesDto = Assert<
	ExactWireShape<
		Static<typeof createAdministratorSchema>,
		CreateAdministratorInput
	>
>;
type _UpdateAdministratorMatchesDto = Assert<
	ExactWireShape<
		Static<typeof updateAdministratorSchema>,
		UpdateAdministratorInput
	>
>;
type _ResetPasswordMatchesDto = Assert<
	ExactWireShape<
		Static<typeof resetAdministratorPasswordSchema>,
		ResetAdministratorPasswordInput
	>
>;
type _SessionsRevokedMatchesDto = Assert<
	ExactWireShape<Static<typeof sessionsRevokedSchema>, SessionsRevokedResult>
>;

export type AdministratorsSchemaAlignment =
	| _AdministratorSchemaMatchesDto
	| _AdministratorPageMatchesDto
	| _CreateAdministratorMatchesDto
	| _UpdateAdministratorMatchesDto
	| _ResetPasswordMatchesDto
	| _SessionsRevokedMatchesDto;

export interface AdministratorsModuleDependencies {
	readonly contextStore: ApiRequestContextStore;
	readonly getAdministratorsService?: () => AdministratorsService;
}

function mapAdministratorsError(error: unknown): never {
	if (error instanceof AdministratorsValidationError) {
		throw new ApiProblemError({
			code: "VALIDATION_FAILED",
			fieldErrors: error.fieldErrors,
			status: 422,
		});
	}
	if (error instanceof AdministratorEmailConflictError) {
		throw new ApiProblemError({
			code: "ADMINISTRATOR_EMAIL_CONFLICT",
			fieldErrors: error.fieldErrors,
			status: 409,
		});
	}
	if (error instanceof AdministratorNotFoundError) {
		throw new ApiProblemError({ code: "NOT_FOUND", status: 404 });
	}
	if (error instanceof AdministratorSelfDisableError) {
		throw new ApiProblemError({ code: "SELF_DISABLE_FORBIDDEN", status: 403 });
	}
	if (error instanceof LastActiveAdministratorError) {
		throw new ApiProblemError({ code: "LAST_ADMIN_REQUIRED", status: 409 });
	}
	if (error instanceof AdministratorPreconditionRequiredError) {
		throw new ApiProblemError({ code: "PRECONDITION_REQUIRED", status: 428 });
	}
	if (error instanceof AdministratorStaleWriteError) {
		throw new ApiProblemError({ code: "STALE_WRITE", status: 409 });
	}
	throw error;
}

async function execute<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		return mapAdministratorsError(error);
	}
}

function requireContext(
	contextStore: ApiRequestContextStore,
	request: Request,
) {
	const context = contextStore.require(request);
	if (!context.session || !context.audit) {
		throw new Error("Administrator routes require security context.");
	}
	return { audit: context.audit, session: context.session };
}

export function createAdministratorsModule({
	contextStore,
	getAdministratorsService = () => createAdministratorsService(),
}: AdministratorsModuleDependencies) {
	return new Elysia({ name: "updater-admin.administrators" })
		.get(
			"/administrators",
			async ({ query, request }) => {
				requireContext(contextStore, request);
				const search: AdministratorListSearch = {
					page: query.page ?? 1,
					pageSize: (query.pageSize ?? 20) as 20 | 50 | 100,
					...(query.query === undefined ? {} : { query: query.query }),
					sort: query.sort ?? "createdAt:desc",
					...(query.status === undefined ? {} : { status: query.status }),
				};
				const result = await execute(() =>
					getAdministratorsService().list(search),
				);
				return { ...result, items: [...result.items] };
			},
			{
				query: administratorListSearchSchema,
				response: { 200: administratorPageSchema },
			},
		)
		.post(
			"/administrators",
			async ({ body, request, set }): Promise<AdministratorDto> => {
				const { audit } = requireContext(contextStore, request);
				const result = await execute(() =>
					getAdministratorsService().create(body, request.headers, audit),
				);
				set.status = 201;
				set.headers.etag = result.etag;
				set.headers.location = `/api/v1/administrators/${result.id}`;
				return result;
			},
			{
				body: createAdministratorSchema,
				response: { 201: administratorSchema },
			},
		)
		.patch(
			"/administrators/:administratorId",
			async ({ body, params, request, set }): Promise<AdministratorDto> => {
				const { audit } = requireContext(contextStore, request);
				const result = await execute(() =>
					getAdministratorsService().update(
						params.administratorId,
						readUpdaterIfMatch(request),
						body,
						request.headers,
						audit,
					),
				);
				set.headers.etag = result.etag;
				return result;
			},
			{
				body: updateAdministratorSchema,
				params: administratorIdParamsSchema,
				response: { 200: administratorSchema },
			},
		)
		.post(
			"/administrators/:administratorId/reset-password",
			async ({ body, params, request, set }): Promise<AdministratorDto> => {
				const { audit } = requireContext(contextStore, request);
				const result = await execute(() =>
					getAdministratorsService().resetPassword(
						params.administratorId,
						body,
						request.headers,
						audit,
					),
				);
				set.headers.etag = result.etag;
				return result;
			},
			{
				body: resetAdministratorPasswordSchema,
				params: administratorIdParamsSchema,
				response: { 200: administratorSchema },
			},
		)
		.post(
			"/administrators/:administratorId/revoke-sessions",
			async ({ params, request }): Promise<SessionsRevokedResult> => {
				const { audit } = requireContext(contextStore, request);
				return execute(() =>
					getAdministratorsService().revokeSessions(
						params.administratorId,
						request.headers,
						audit,
					),
				);
			},
			{
				params: administratorIdParamsSchema,
				response: { 200: sessionsRevokedSchema },
			},
		);
}
