import { Elysia, type Static, t } from "elysia";

import type {
	SystemSettingsDto,
	UpdateSystemSettingsInput,
} from "../../../shared/api/settings";
import {
	createSettingsService,
	SettingsPreconditionRequiredError,
	type SettingsService,
	SettingsStaleWriteError,
	SettingsValidationError,
} from "../../domain/settings.server";
import type { ApiRequestContextStore } from "../context.server";
import { readUpdaterIfMatch } from "../preconditions";
import { ApiProblemError } from "../problem";
import type { ExactWireShape } from "../schemas/alignment";

// The domain counts Unicode code points. These transport caps are deliberately
// coarse so every value within the domain limit reaches semantic validation.
const SYSTEM_NAME_TRANSPORT_MAX_LENGTH = 128 * 2;
const REPOSITORY_URL_TRANSPORT_MAX_LENGTH = 2048 * 2;

const localeSchema = t.Union([t.Literal("zh-CN"), t.Literal("en")]);
const pageSizeSchema = t.Union([t.Literal(20), t.Literal(50), t.Literal(100)]);
const repositoryUrlSchema = t.Union([
	t.String({ maxLength: REPOSITORY_URL_TRANSPORT_MAX_LENGTH }),
	t.Null(),
]);

export const systemSettingsSchema = t.Object(
	{
		defaultLocale: localeSchema,
		defaultPageSize: pageSizeSchema,
		repositoryUrl: repositoryUrlSchema,
		systemName: t.String({
			maxLength: SYSTEM_NAME_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
	},
	{ additionalProperties: false },
);

export const updateSystemSettingsSchema = t.Object(
	{
		defaultLocale: localeSchema,
		defaultPageSize: pageSizeSchema,
		repositoryUrl: repositoryUrlSchema,
		systemName: t.String({
			maxLength: SYSTEM_NAME_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
	},
	{ additionalProperties: false },
);

type Assert<Condition extends true> = Condition;
type _SystemSettingsSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof systemSettingsSchema>, SystemSettingsDto>
>;
type _UpdateSystemSettingsSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof updateSystemSettingsSchema>,
		UpdateSystemSettingsInput
	>
>;

export type SettingsSchemaAlignment =
	| _SystemSettingsSchemaMatchesDto
	| _UpdateSystemSettingsSchemaMatchesDto;

export interface SettingsModuleDependencies {
	readonly contextStore: ApiRequestContextStore;
	readonly getSettingsService?: () => SettingsService;
}

function mapSettingsError(error: unknown): never {
	if (error instanceof SettingsValidationError) {
		throw new ApiProblemError({
			code: "VALIDATION_FAILED",
			fieldErrors: error.fieldErrors,
			status: 422,
		});
	}
	if (error instanceof SettingsPreconditionRequiredError) {
		throw new ApiProblemError({
			code: "PRECONDITION_REQUIRED",
			status: 428,
		});
	}
	if (error instanceof SettingsStaleWriteError) {
		throw new ApiProblemError({ code: "STALE_WRITE", status: 409 });
	}
	throw error;
}

async function execute<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		return mapSettingsError(error);
	}
}

function requireSession(
	contextStore: ApiRequestContextStore,
	request: Request,
) {
	const context = contextStore.require(request);
	if (!context.session) throw new Error("Settings route requires a session.");
	return context;
}

function requireMutationContext(
	contextStore: ApiRequestContextStore,
	request: Request,
) {
	const context = requireSession(contextStore, request);
	if (!context.audit) {
		throw new Error("System settings mutation requires audit context.");
	}
	return context.audit;
}

export function createSettingsModule({
	contextStore,
	getSettingsService = () => createSettingsService(),
}: SettingsModuleDependencies) {
	return new Elysia({ name: "updater-admin.settings" })
		.get(
			"/settings/system",
			async ({ request, set }): Promise<SystemSettingsDto> => {
				requireSession(contextStore, request);
				const result = await execute(() => getSettingsService().get());
				set.headers.etag = result.etag;
				return result.data;
			},
			{ response: { 200: systemSettingsSchema } },
		)
		.patch(
			"/settings/system",
			async ({ body, request, set }): Promise<SystemSettingsDto> => {
				const audit = requireMutationContext(contextStore, request);
				const result = await execute(() =>
					getSettingsService().update(readUpdaterIfMatch(request), body, audit),
				);
				set.headers.etag = result.etag;
				return result.data;
			},
			{
				body: updateSystemSettingsSchema,
				response: { 200: systemSettingsSchema },
			},
		);
}
