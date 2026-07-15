import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { tanstackStartCookies } from "better-auth/tanstack-start/solid";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { type Database, getDatabase } from "../db/client.server";
import {
	account,
	adminMetadata,
	rateLimit,
	session,
	user,
	verification,
} from "../db/schema";
import type { EnvironmentSource } from "../env.server";
import { readAuthEnvironment } from "../env.server";

export const AUTH_HTTP_DISABLED_PATHS = [
	"/admin/set-role",
	"/admin/get-user",
	"/admin/create-user",
	"/admin/update-user",
	"/admin/list-users",
	"/admin/list-user-sessions",
	"/admin/unban-user",
	"/admin/ban-user",
	"/admin/impersonate-user",
	"/admin/stop-impersonating",
	"/admin/revoke-user-session",
	"/admin/revoke-user-sessions",
	"/admin/remove-user",
	"/admin/set-user-password",
	"/admin/has-permission",
	"/change-password",
	"/update-user",
	"/delete-user",
	"/delete-user/callback",
	"/change-email",
	"/revoke-sessions",
] as const;

const authSchema = {
	account,
	rateLimit,
	session,
	user,
	verification,
};

export interface SessionLoginRecord {
	readonly createdAt: Date;
	readonly userId: string;
}

export type LastLoginUpdater = (record: SessionLoginRecord) => Promise<void>;

export type AuthDatabase = Parameters<typeof drizzleAdapter>[0] &
	Pick<Database, "update">;

export async function updateLastLoginAt(
	database: Pick<Database, "update">,
	{ createdAt, userId }: SessionLoginRecord,
): Promise<void> {
	await database
		.update(adminMetadata)
		.set({
			lastLoginAt: createdAt,
			rowVersion: sql`${adminMetadata.rowVersion} + 1`,
		})
		.where(
			and(
				eq(adminMetadata.userId, userId),
				or(
					isNull(adminMetadata.lastLoginAt),
					lt(adminMetadata.lastLoginAt, createdAt),
				),
			),
		);
}

export function createSessionLoginHook(updateLastLogin: LastLoginUpdater) {
	return async (createdSession: SessionLoginRecord): Promise<void> => {
		await updateLastLogin({
			createdAt: createdSession.createdAt,
			userId: createdSession.userId,
		});
	};
}

export interface CreateAuthDependencies {
	readonly database?: AuthDatabase;
	readonly databaseTransaction?: boolean;
	readonly environment?: EnvironmentSource;
	readonly rateLimitEnabled?: boolean;
	readonly updateLastLogin?: LastLoginUpdater;
}

export function createAuth(dependencies: CreateAuthDependencies = {}) {
	const environment = readAuthEnvironment(dependencies.environment);
	const database = dependencies.database ?? getDatabase();
	const secureCookies =
		new URL(environment.betterAuthUrl).protocol === "https:";
	const updateLastLogin =
		dependencies.updateLastLogin ??
		((record: SessionLoginRecord) => updateLastLoginAt(database, record));
	const onSessionCreated = createSessionLoginHook(updateLastLogin);

	return betterAuth({
		appName: "Updater Admin",
		baseURL: environment.betterAuthUrl,
		basePath: "/api/auth",
		secret: environment.betterAuthSecret,
		database: drizzleAdapter(database, {
			provider: "pg",
			schema: authSchema,
			transaction: dependencies.databaseTransaction ?? true,
		}),
		emailAndPassword: {
			autoSignIn: false,
			disableSignUp: true,
			enabled: true,
			maxPasswordLength: 128,
			minPasswordLength: 12,
		},
		trustedOrigins: [environment.betterAuthUrl],
		rateLimit: {
			customRules: {
				"/sign-in/email": { max: 10, window: 60 },
			},
			enabled: dependencies.rateLimitEnabled ?? true,
			max: 100,
			storage: "database",
			window: 60,
		},
		advanced: {
			database: { generateId: "uuid" },
			defaultCookieAttributes: {
				httpOnly: true,
				sameSite: "lax",
				secure: secureCookies,
			},
			ipAddress: {
				ipAddressHeaders: ["x-nf-client-connection-ip", "x-forwarded-for"],
			},
			useSecureCookies: secureCookies,
		},
		databaseHooks: {
			session: {
				create: {
					after: onSessionCreated,
				},
			},
		},
		disabledPaths: [...AUTH_HTTP_DISABLED_PATHS],
		plugins: [
			admin({ defaultRole: "admin", adminRoles: ["admin"] }),
			tanstackStartCookies(),
		],
		telemetry: { enabled: false },
	});
}

export type AppAuth = ReturnType<typeof createAuth>;

let singleton: AppAuth | undefined;

export function getAuth(): AppAuth {
	singleton ??= createAuth();
	return singleton;
}

export function resetAuthForTests(): void {
	singleton = undefined;
}
