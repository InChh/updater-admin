import { Elysia, type Static, t } from "elysia";

import type {
	MonitoringStatusDto,
	ReleaseSeriesSearch,
	TimeSeries,
} from "../../../shared/api/monitoring";
import {
	createMonitoringService,
	type MonitoringService,
	MonitoringValidationError,
} from "../../domain/monitoring.server";
import type { ApiRequestContextStore } from "../context.server";
import { ApiProblemError } from "../problem";
import type { ExactWireShape } from "../schemas/alignment";
import { auditEventListItemSchema } from "./audit";

const statusValueSchema = t.Union([t.Literal("ready"), t.Literal("degraded")]);
const nullableString = (maximum: number) =>
	t.Union([t.String({ maxLength: maximum }), t.Null()]);
const nullableCount = t.Union([t.Integer({ minimum: 0 }), t.Null()]);

export const readinessCheckSchema = t.Object(
	{
		checkedAt: t.String({ format: "date-time" }),
		latencyMs: t.Integer({ minimum: 0 }),
		status: statusValueSchema,
	},
	{ additionalProperties: false },
);

export const monitoringStatusSchema = t.Object(
	{
		application: t.Object(
			{
				buildId: nullableString(128),
				commitRef: nullableString(128),
				environment: nullableString(64),
				name: t.Literal("updater-admin"),
				version: nullableString(64),
			},
			{ additionalProperties: false },
		),
		checkedAt: t.String({ format: "date-time" }),
		dependencies: t.Object(
			{
				neon: readinessCheckSchema,
				ossSts: readinessCheckSchema,
			},
			{ additionalProperties: false },
		),
		metrics: t.Object(
			{
				activeVersions: nullableCount,
				files: nullableCount,
				programs: nullableCount,
				status: statusValueSchema,
				totalBytes: t.Union([
					t.String({ pattern: "^(0|[1-9][0-9]*)$" }),
					t.Null(),
				]),
				versions: nullableCount,
			},
			{ additionalProperties: false },
		),
		recentOperations: t.Object(
			{
				items: t.Array(auditEventListItemSchema),
				status: statusValueSchema,
			},
			{ additionalProperties: false },
		),
		status: statusValueSchema,
	},
	{ additionalProperties: false },
);

export const timeSeriesSchema = t.Object(
	{
		from: t.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }),
		interval: t.Literal("day"),
		points: t.Array(
			t.Object(
				{
					bucket: t.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }),
					value: t.Integer({ minimum: 0 }),
				},
				{ additionalProperties: false },
			),
		),
		to: t.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }),
		total: t.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

export const releaseSeriesSearchSchema = t.Object(
	{
		days: t.Optional(
			t.Union([t.Literal("7"), t.Literal("30"), t.Literal("90")]),
		),
	},
	{ additionalProperties: false },
);

type Assert<Condition extends true> = Condition;
type _MonitoringStatusSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof monitoringStatusSchema>, MonitoringStatusDto>
>;
type _TimeSeriesSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof timeSeriesSchema>, TimeSeries>
>;

export type MonitoringSchemaAlignment =
	| _MonitoringStatusSchemaMatchesDto
	| _TimeSeriesSchemaMatchesDto;

export interface MonitoringModuleDependencies {
	readonly contextStore: ApiRequestContextStore;
	readonly getMonitoringService?: () => MonitoringService;
}

function mapMonitoringError(error: unknown): never {
	if (error instanceof MonitoringValidationError) {
		throw new ApiProblemError({
			code: "VALIDATION_FAILED",
			fieldErrors: error.fieldErrors,
			status: 422,
		});
	}
	throw error;
}

async function execute<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		return mapMonitoringError(error);
	}
}

function requireSession(
	contextStore: ApiRequestContextStore,
	request: Request,
): void {
	const context = contextStore.require(request);
	if (!context.session) throw new Error("Monitoring route requires a session.");
}

export function createMonitoringModule({
	contextStore,
	getMonitoringService,
}: MonitoringModuleDependencies) {
	let monitoringService: MonitoringService | undefined;
	const resolveMonitoringService = () => {
		monitoringService ??= getMonitoringService?.() ?? createMonitoringService();
		return monitoringService;
	};

	return new Elysia({ name: "updater-admin.monitoring" })
		.get(
			"/monitoring/status",
			async ({ request }) => {
				requireSession(contextStore, request);
				const result: MonitoringStatusDto = await execute(() =>
					resolveMonitoringService().getStatus(),
				);
				return {
					...result,
					recentOperations: {
						...result.recentOperations,
						items: [...result.recentOperations.items],
					},
				};
			},
			{ response: { 200: monitoringStatusSchema } },
		)
		.get(
			"/monitoring/release-series",
			async ({ query, request }) => {
				requireSession(contextStore, request);
				const search: ReleaseSeriesSearch = {
					days: Number(query.days ?? 30) as 7 | 30 | 90,
				};
				const result: TimeSeries = await execute(() =>
					resolveMonitoringService().getReleaseSeries(search),
				);
				return { ...result, points: [...result.points] };
			},
			{
				query: releaseSeriesSearchSchema,
				response: { 200: timeSeriesSchema },
			},
		);
}
