import { APIError } from "better-auth/api";
import { Elysia, type Static, t } from "elysia";

import type {
	ChangePasswordInput,
	PasswordChangedResult,
	ProfileDto,
} from "../../../shared/api/profile";
import type { ProfileRepository } from "../../db/repositories/profile.server";
import type { ApiRequestContextStore } from "../context.server";
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
	},
	{ additionalProperties: false },
);

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

export type ProfileSchemaAlignment =
	| _ProfileSchemaMatchesDto
	| _PasswordInputSchemaMatchesDto
	| _PasswordResultSchemaMatchesDto;

export interface PasswordAuthApi {
	changePassword(input: {
		readonly body: ChangePasswordInput & {
			readonly revokeOtherSessions: false;
		};
		readonly headers: Headers;
	}): Promise<unknown>;
	revokeSessions(input: { readonly headers: Headers }): Promise<unknown>;
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
			({ request }): ProfileDto => {
				const session = contextStore.require(request).session;
				if (!session) throw new Error("Profile route requires a session.");
				return {
					currentSession: session.session,
					email: session.user.email,
					emailVerified: session.user.emailVerified,
					id: session.user.id,
					image: session.user.image,
					lastLoginAt: session.metadata.lastLoginAt,
					locale: session.metadata.locale,
					mustChangePassword: session.metadata.mustChangePassword,
					name: session.user.name,
				};
			},
			{ response: { 200: profileSchema } },
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
