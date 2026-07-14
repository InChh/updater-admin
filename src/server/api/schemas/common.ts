import { type Static, t } from "elysia";

import type {
	ApiProblem,
	FieldError,
	SupportedLocale,
	WeakEntityTag,
} from "../../../shared/api/common";
import type { ExactWireShape } from "./alignment";

export const supportedLocaleSchema = t.Union([
	t.Literal("zh-CN"),
	t.Literal("en"),
]);

export const requestIdSchema = t.String({
	maxLength: 128,
	minLength: 1,
	pattern: "^[A-Za-z0-9._:-]+$",
});

export const weakEntityTagSchema = t.String({
	maxLength: 23,
	pattern: '^W/"[1-9][0-9]*"$',
});

export const fieldErrorSchema = t.Object(
	{
		code: t.String({ maxLength: 128, minLength: 1 }),
		path: t.String({ maxLength: 512, minLength: 1 }),
	},
	{ additionalProperties: false },
);

export const apiProblemSchema = t.Object(
	{
		code: t.String({ maxLength: 128, minLength: 1 }),
		detail: t.Optional(t.String({ maxLength: 2048 })),
		fieldErrors: t.Optional(t.Array(fieldErrorSchema, { maxItems: 100 })),
		requestId: requestIdSchema,
		retryAfterSeconds: t.Optional(t.Integer({ minimum: 1 })),
		status: t.Integer({ maximum: 599, minimum: 400 }),
		title: t.String({ maxLength: 256, minLength: 1 }),
		type: t.String({ format: "uri", maxLength: 512 }),
	},
	{ additionalProperties: false },
);

export const healthSchema = t.Object(
	{ status: t.Literal("ok") },
	{ additionalProperties: false },
);

type Assert<Condition extends true> = Condition;

type _LocaleSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof supportedLocaleSchema>, SupportedLocale>
>;
type _FieldErrorSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof fieldErrorSchema>, FieldError>
>;
type _ProblemSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof apiProblemSchema>, ApiProblem>
>;
type _EtagSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof weakEntityTagSchema>, WeakEntityTag>
>;

export type CommonSchemaAlignment =
	| _LocaleSchemaMatchesDto
	| _FieldErrorSchemaMatchesDto
	| _ProblemSchemaMatchesDto
	| _EtagSchemaMatchesDto;
