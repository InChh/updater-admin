import { Elysia, type Static, t } from "elysia";

import {
	AUDIT_ACTIONS,
	AUDIT_MAX_PAGE,
	AUDIT_RESOURCE_TYPES,
	type AuditEventDetailDto,
	type AuditEventListItemDto,
	type AuditEventPage,
	type AuditListSearch,
} from "../../../shared/api/audit";
import {
	AuditEventNotFoundError,
	type AuditService,
	AuditValidationError,
	createAuditService,
} from "../../domain/audit.server";
import type { ApiRequestContextStore } from "../context.server";
import { ApiProblemError } from "../problem";
import type { ExactWireShape } from "../schemas/alignment";

const actionFilterSchema = t.Union(
	AUDIT_ACTIONS.map((value) => t.Literal(value)),
);
const resourceTypeFilterSchema = t.Union(
	AUDIT_RESOURCE_TYPES.map((value) => t.Literal(value)),
);
const nullableString = (maximum: number) =>
	t.Union([t.String({ maxLength: maximum }), t.Null()]);

export const auditEventListItemSchema = t.Object(
	{
		action: t.String({ maxLength: 128, minLength: 1 }),
		actorId: t.Union([t.String({ format: "uuid" }), t.Null()]),
		createdAt: t.String({ format: "date-time" }),
		id: t.String({ format: "uuid" }),
		resourceId: t.String({ maxLength: 128 }),
		resourceType: t.String({ maxLength: 64, minLength: 1 }),
		result: t.Union([t.Literal("success"), t.Literal("failure")]),
	},
	{ additionalProperties: false },
);

export const auditEventDetailSchema = t.Object(
	{
		...auditEventListItemSchema.properties,
		after: t.Any(),
		before: t.Any(),
		ip: nullableString(64),
		requestId: t.String({ maxLength: 128, minLength: 1 }),
		userAgent: nullableString(2048),
	},
	{ additionalProperties: false },
);

export const auditEventPageSchema = t.Object(
	{
		items: t.Array(auditEventListItemSchema),
		page: t.Integer({ minimum: 1 }),
		pageSize: t.Union([t.Literal(20), t.Literal(50), t.Literal(100)]),
		total: t.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

export const auditListSearchSchema = t.Object(
	{
		action: t.Optional(actionFilterSchema),
		actorId: t.Optional(t.String({ format: "uuid" })),
		from: t.Optional(
			t.String({ maxLength: 10, pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }),
		),
		page: t.Optional(t.Numeric({ maximum: AUDIT_MAX_PAGE, minimum: 1 })),
		pageSize: t.Optional(
			t.Union([t.Literal("20"), t.Literal("50"), t.Literal("100")]),
		),
		resourceType: t.Optional(resourceTypeFilterSchema),
		result: t.Optional(t.Union([t.Literal("success"), t.Literal("failure")])),
		sort: t.Optional(
			t.Union([t.Literal("createdAt:desc"), t.Literal("createdAt:asc")]),
		),
		to: t.Optional(
			t.String({ maxLength: 10, pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }),
		),
	},
	{ additionalProperties: false },
);

const auditEventParamsSchema = t.Object(
	{ auditEventId: t.String({ format: "uuid" }) },
	{ additionalProperties: false },
);

type Assert<Condition extends true> = Condition;
type _AuditListItemSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof auditEventListItemSchema>, AuditEventListItemDto>
>;
type _AuditPageSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof auditEventPageSchema>, AuditEventPage>
>;

export type AuditSchemaAlignment =
	| _AuditListItemSchemaMatchesDto
	| _AuditPageSchemaMatchesDto;

export interface AuditModuleDependencies {
	readonly contextStore: ApiRequestContextStore;
	readonly getAuditService?: () => AuditService;
}

function mapAuditError(error: unknown): never {
	if (error instanceof AuditValidationError) {
		throw new ApiProblemError({
			code: "VALIDATION_FAILED",
			fieldErrors: error.fieldErrors,
			status: 422,
		});
	}
	if (error instanceof AuditEventNotFoundError) {
		throw new ApiProblemError({ code: "NOT_FOUND", status: 404 });
	}
	throw error;
}

async function execute<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		return mapAuditError(error);
	}
}

function requireSession(
	contextStore: ApiRequestContextStore,
	request: Request,
): void {
	const context = contextStore.require(request);
	if (!context.session) throw new Error("Audit route requires a session.");
}

export function createAuditModule({
	contextStore,
	getAuditService = () => createAuditService(),
}: AuditModuleDependencies) {
	return new Elysia({ name: "updater-admin.audit-routes" })
		.get(
			"/audit-events",
			async ({ query, request }) => {
				requireSession(contextStore, request);
				const search: AuditListSearch = {
					...(query.action === undefined ? {} : { action: query.action }),
					...(query.actorId === undefined ? {} : { actorId: query.actorId }),
					...(query.from === undefined ? {} : { from: query.from }),
					page: query.page ?? 1,
					pageSize: Number(query.pageSize ?? 20) as 20 | 50 | 100,
					...(query.resourceType === undefined
						? {}
						: { resourceType: query.resourceType }),
					...(query.result === undefined ? {} : { result: query.result }),
					sort: query.sort ?? "createdAt:desc",
					...(query.to === undefined ? {} : { to: query.to }),
				};
				const result = await execute(() => getAuditService().list(search));
				return { ...result, items: [...result.items] };
			},
			{
				query: auditListSearchSchema,
				response: { 200: auditEventPageSchema },
			},
		)
		.get(
			"/audit-events/:auditEventId",
			async ({ params, request }): Promise<AuditEventDetailDto> => {
				requireSession(contextStore, request);
				return execute(() => getAuditService().getById(params.auditEventId));
			},
			{
				params: auditEventParamsSchema,
				response: { 200: auditEventDetailSchema },
			},
		);
}
