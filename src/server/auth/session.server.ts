import { eq } from "drizzle-orm";

import { type Database, getDatabase } from "../db/client.server";
import { adminMetadata } from "../db/schema";
import { type AppAuth, getAuth } from "./auth.server";

export type SupportedLocale = "en" | "zh-CN";

export interface SafeSessionView {
	readonly metadata: {
		readonly lastLoginAt: string | null;
		readonly locale: SupportedLocale;
		readonly mustChangePassword: boolean;
	};
	readonly session: {
		readonly createdAt: string;
		readonly expiresAt: string;
		readonly id: string;
		readonly updatedAt: string;
	};
	readonly user: {
		readonly banned: boolean;
		readonly email: string;
		readonly emailVerified: boolean;
		readonly id: string;
		readonly image: string | null;
		readonly name: string;
		readonly role: string;
	};
}

export interface AdminSessionMetadata {
	readonly lastLoginAt: Date | null;
	readonly locale: SupportedLocale;
	readonly mustChangePassword: boolean;
}

type GetSessionApi = AppAuth["api"]["getSession"];

export interface SafeSessionDependencies {
	readonly auth?: { readonly api: { readonly getSession: GetSessionApi } };
	readonly loadMetadata?: (
		userId: string,
	) => Promise<AdminSessionMetadata | null>;
}

export async function loadAdminSessionMetadata(
	userId: string,
	database: Database = getDatabase(),
): Promise<AdminSessionMetadata | null> {
	const [metadata] = await database
		.select({
			lastLoginAt: adminMetadata.lastLoginAt,
			locale: adminMetadata.locale,
			mustChangePassword: adminMetadata.mustChangePassword,
		})
		.from(adminMetadata)
		.where(eq(adminMetadata.userId, userId))
		.limit(1);

	if (!metadata) return null;
	return {
		...metadata,
		locale: metadata.locale === "en" ? "en" : "zh-CN",
	};
}

function serializeDate(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}

export async function getSafeSession(
	headers: Headers,
	dependencies: SafeSessionDependencies = {},
): Promise<SafeSessionView | null> {
	const auth = dependencies.auth ?? getAuth();
	const session = await auth.api.getSession({
		headers,
		query: { disableCookieCache: true, disableRefresh: true },
	});
	if (!session) return null;

	const loadMetadata = dependencies.loadMetadata ?? loadAdminSessionMetadata;
	const metadata = await loadMetadata(session.user.id);

	return {
		metadata: {
			lastLoginAt: metadata?.lastLoginAt?.toISOString() ?? null,
			locale: metadata?.locale ?? "zh-CN",
			// Missing metadata is fail-closed until the account is repaired.
			mustChangePassword: metadata?.mustChangePassword ?? true,
		},
		session: {
			createdAt: serializeDate(session.session.createdAt),
			expiresAt: serializeDate(session.session.expiresAt),
			id: session.session.id,
			updatedAt: serializeDate(session.session.updatedAt),
		},
		user: {
			banned: session.user.banned ?? false,
			email: session.user.email,
			emailVerified: session.user.emailVerified,
			id: session.user.id,
			image: session.user.image ?? null,
			name: session.user.name,
			role: session.user.role ?? "",
		},
	};
}
