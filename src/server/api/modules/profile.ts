import { APIError } from "better-auth/api";
import { Elysia, type Static, t } from "elysia";
import {
	formatWeakEntityTag,
	isWellFormedUnicode,
	parseWeakEntityTag,
} from "../../../shared/api/common";
import type {
	ChangePasswordInput,
	PasswordChangedResult,
	ProfileDto,
	ProfileSessionSummaryDto,
	UpdateProfileInput,
} from "../../../shared/api/profile";
import type { SafeSessionView } from "../../auth/session.server";
import {
	type ProfileRepository,
	ProfileStaleWriteRepositoryError,
	type ProfileUpdateRecord,
} from "../../db/repositories/profile.server";
import type { ApiRequestContextStore } from "../context.server";
import { readUpdaterIfMatch } from "../preconditions";
import { ApiProblemError } from "../problem";
import type { ExactWireShape } from "../schemas/alignment";
import { supportedLocaleSchema } from "../schemas/common";

export const profileSchema = t.Object(
	{
		currentSession: t.Object(
			{
				createdAt: t.String({ format: "date-time" }),
				expiresAt: t.String({ format: "date-time" }),
				id: t.String({ format: "uuid" }),
				updatedAt: t.String({ format: "date-time" }),
			},
			{ additionalProperties: false },
		),
		email: t.String({ format: "email" }),
		emailVerified: t.Boolean(),
		id: t.String({ format: "uuid" }),
		image: t.Union([t.String(), t.Null()]),
		lastLoginAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
		locale: supportedLocaleSchema,
		mustChangePassword: t.Boolean(),
		name: t.String(),
		otherSessions: t.Array(
			t.Object(
				{
					createdAt: t.String({ format: "date-time" }),
					expiresAt: t.String({ format: "date-time" }),
					id: t.String({ format: "uuid" }),
					ipAddress: t.Union([t.String(), t.Null()]),
					updatedAt: t.String({ format: "date-time" }),
					userAgent: t.Union([t.String(), t.Null()]),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

const PROFILE_NAME_TRANSPORT_MAX_LENGTH = 128 * 2;

export const updateProfileSchema = t.Union([
	t.Object(
		{
			locale: supportedLocaleSchema,
			name: t.Optional(
				t.String({
					maxLength: PROFILE_NAME_TRANSPORT_MAX_LENGTH,
					minLength: 1,
				}),
			),
		},
		{ additionalProperties: false },
	),
	t.Object(
		{
			locale: t.Optional(supportedLocaleSchema),
			name: t.String({
				maxLength: PROFILE_NAME_TRANSPORT_MAX_LENGTH,
				minLength: 1,
			}),
		},
		{ additionalProperties: false },
	),
]);

export const changePasswordSchema = t.Object(
	{
		currentPassword: t.String({ maxLength: 128, minLength: 1 }),
		newPassword: t.String({ maxLength: 128, minLength: 12 }),
	},
	{ additionalProperties: false },
);

export const passwordChangedSchema = t.Object(
	{ reauthenticationRequired: t.Literal(true) },
	{ additionalProperties: false },
);

type Assert<Condition extends true> = Condition;
type _ProfileSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof profileSchema>, ProfileDto>
>;
type _PasswordInputSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof changePasswordSchema>, ChangePasswordInput>
>;
type _PasswordResultSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof passwordChangedSchema>, PasswordChangedResult>
>;
type _UpdateProfileSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof updateProfileSchema>, UpdateProfileInput>
>;

export type ProfileSchemaAlignment =
	| _ProfileSchemaMatchesDto
	| _PasswordInputSchemaMatchesDto
	| _PasswordResultSchemaMatchesDto
	| _UpdateProfileSchemaMatchesDto;

export interface ProfileAuthSession {
	readonly createdAt: Date | string;
	readonly expiresAt: Date | string;
	readonly id: string;
	readonly ipAddress?: string | null;
	readonly token: string;
	readonly updatedAt: Date | string;
	readonly userAgent?: string | null;
}

export interface PasswordAuthApi {
	changePassword(input: {
		readonly body: ChangePasswordInput & {
			readonly revokeOtherSessions: false;
		};
		readonly headers: Headers;
	}): Promise<unknown>;
	revokeSessions(input: { readonly headers: Headers }): Promise<unknown>;
	listSessions?(input: {
		readonly headers: Headers;
	}): Promise<readonly ProfileAuthSession[]>;
}

export interface ProfileModuleDependencies {
	readonly contextStore: ApiRequestContextStore;
	readonly getPasswordAuthApi: () => PasswordAuthApi;
	readonly profileRepository: ProfileRepository;
}

function isInvalidCurrentPassword(error: unknown): boolean {
	return (
		error instanceof APIError &&
		error.body !== null &&
		typeof error.body === "object" &&
		"code" in error.body &&
		error.body.code === "INVALID_PASSWORD"
	);
}

function serializeDate(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}

async function loadOtherSessions(
	authApi: PasswordAuthApi,
	headers: Headers,
	currentSessionId: string,
): Promise<readonly ProfileSessionSummaryDto[]> {
	const sessions = (await authApi.listSessions?.({ headers })) ?? [];
	return sessions
		.filter((session) => session.id !== currentSessionId)
		.sort(
			(left, right) =>
				new Date(right.updatedAt).getTime() -
				new Date(left.updatedAt).getTime(),
		)
		.map((session) => ({
			createdAt: serializeDate(session.createdAt),
			expiresAt: serializeDate(session.expiresAt),
			id: session.id,
			ipAddress: session.ipAddress ?? null,
			updatedAt: serializeDate(session.updatedAt),
			userAgent: session.userAgent?.slice(0, 2048) ?? null,
		}));
}

function profileDto(
	session: SafeSessionView,
	otherSessions: readonly ProfileSessionSummaryDto[],
	overrides: { readonly locale?: "en" | "zh-CN"; readonly name?: string } = {},
): ProfileDto {
	return {
		currentSession: session.session,
		email: session.user.email,
		emailVerified: session.user.emailVerified,
		id: session.user.id,
		image: session.user.image,
		lastLoginAt: session.metadata.lastLoginAt,
		locale: overrides.locale ?? session.metadata.locale,
		mustChangePassword: session.metadata.mustChangePassword,
		name: overrides.name ?? session.user.name,
		otherSessions,
	};
}

function normalizeProfileName(value: string): string {
	if (value.includes("\0") || !isWellFormedUnicode(value)) {
		throw new ApiProblemError({
			code: "VALIDATION_FAILED",
			fieldErrors: [{ code: "INVALID_VALUE", path: "name" }],
			status: 422,
		});
	}
	const name = value.trim();
	if (name.length === 0) {
		throw new ApiProblemError({
			code: "VALIDATION_FAILED",
			fieldErrors: [{ code: "REQUIRED", path: "name" }],
			status: 422,
		});
	}
	if ([...name].length > 128) {
		throw new ApiProblemError({
			code: "VALIDATION_FAILED",
			fieldErrors: [{ code: "TOO_LONG", path: "name" }],
			status: 422,
		});
	}
	return name;
}

function parseExpectedProfileRowVersion(ifMatch: string | null): bigint {
	if (ifMatch === null) {
		throw new ApiProblemError({ code: "PRECONDITION_REQUIRED", status: 428 });
	}
	const rowVersion = parseWeakEntityTag(ifMatch);
	if (rowVersion === null) {
		throw new ApiProblemError({ code: "STALE_WRITE", status: 409 });
	}
	return rowVersion;
}

async function revokeSessionsBestEffort(
	authApi: PasswordAuthApi,
	headers: Headers,
): Promise<void> {
	try {
		await authApi.revokeSessions({ headers });
	} catch {
		// The original persistence failure remains the actionable error.
	}
}

export function createProfileModule({
	contextStore,
	getPasswordAuthApi,
	profileRepository,
}: ProfileModuleDependencies) {
	return new Elysia({ name: "updater-admin.profile" })
		.get(
			"/profile",
			async ({ request, set }) => {
				const session = contextStore.require(request).session;
				if (!session) throw new Error("Profile route requires a session.");
				const authApi = getPasswordAuthApi();
				const profile = profileDto(
					session,
					await loadOtherSessions(authApi, request.headers, session.session.id),
				);
				set.headers.etag = session.metadata.etag;
				return { ...profile, otherSessions: [...profile.otherSessions] };
			},
			{ response: { 200: profileSchema } },
		)
		.patch(
			"/profile",
			async ({ body, request, set }) => {
				const context = contextStore.require(request);
				const session = context.session;
				const audit = context.audit;
				if (!session || !audit) {
					throw new Error("Profile update requires security context.");
				}
				const name =
					body.name === undefined
						? session.user.name
						: normalizeProfileName(body.name);
				const locale = body.locale ?? session.metadata.locale;
				const expectedRowVersion = parseExpectedProfileRowVersion(
					readUpdaterIfMatch(request),
				);
				let updatedProfile: ProfileUpdateRecord;
				try {
					updatedProfile = await profileRepository.updateProfile({
						actorId: audit.actorId,
						expectedRowVersion,
						headers: request.headers,
						ip: audit.ip,
						locale,
						name,
						requestId: audit.requestId,
						userAgent: audit.userAgent,
					});
				} catch (error) {
					if (error instanceof ProfileStaleWriteRepositoryError) {
						throw new ApiProblemError({ code: "STALE_WRITE", status: 409 });
					}
					throw error;
				}
				const authApi = getPasswordAuthApi();
				const profile = profileDto(
					session,
					await loadOtherSessions(authApi, request.headers, session.session.id),
					{ locale: updatedProfile.locale, name: updatedProfile.name },
				);
				set.headers.etag = formatWeakEntityTag(updatedProfile.rowVersion);
				return { ...profile, otherSessions: [...profile.otherSessions] };
			},
			{
				body: updateProfileSchema,
				response: { 200: profileSchema },
			},
		)
		.post(
			"/profile/change-password",
			async ({ body, request }): Promise<PasswordChangedResult> => {
				const context = contextStore.require(request);
				const session = context.session;
				const audit = context.audit;
				if (!session || !audit) {
					throw new Error("Password change requires security context.");
				}

				const passwordAuthApi = getPasswordAuthApi();
				try {
					await passwordAuthApi.changePassword({
						body: {
							currentPassword: body.currentPassword,
							newPassword: body.newPassword,
							revokeOtherSessions: false,
						},
						headers: request.headers,
					});
				} catch (error) {
					if (isInvalidCurrentPassword(error)) {
						throw new ApiProblemError({
							code: "VALIDATION_FAILED",
							fieldErrors: [
								{ code: "INVALID_PASSWORD", path: "currentPassword" },
							],
							status: 422,
						});
					}
					throw error;
				}

				// Better Auth owns credential/session writes while this repository owns
				// administrator policy metadata, so no cross-library transaction exists.
				// Persisting the forced-password marker before revocation makes surviving
				// sessions fail closed on their next metadata refresh.
				try {
					await profileRepository.beginPasswordChange({
						actorId: audit.actorId,
					});
				} catch (error) {
					// The password has already changed. Revocation is the only compensating
					// action available when the policy marker could not be persisted.
					await revokeSessionsBestEffort(passwordAuthApi, request.headers);
					throw error;
				}

				await passwordAuthApi.revokeSessions({
					headers: request.headers,
				});
				await profileRepository.completePasswordChange({
					actorId: audit.actorId,
					ip: audit.ip,
					previousMustChangePassword: session.metadata.mustChangePassword,
					requestId: audit.requestId,
					userAgent: audit.userAgent,
				});

				return { reauthenticationRequired: true };
			},
			{
				body: changePasswordSchema,
				response: { 200: passwordChangedSchema },
			},
		);
}
