import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) =>
	timestamp(name, { mode: "date", withTimezone: true });

// Batch 3 must configure Better Auth with advanced.database.generateId = "uuid"
// so runtime-generated identifiers match these UUID columns.
export const user = pgTable(
	"user",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull(),
		emailVerified: boolean("email_verified").default(false).notNull(),
		image: text("image"),
		createdAt: timestamptz("created_at").defaultNow().notNull(),
		updatedAt: timestamptz("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		role: text("role"),
		banned: boolean("banned").default(false),
		banReason: text("ban_reason"),
		banExpires: timestamptz("ban_expires"),
	},
	(table) => [uniqueIndex("user_email_unique").on(table.email)],
);

export const session = pgTable(
	"session",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		expiresAt: timestamptz("expires_at").notNull(),
		token: text("token").notNull(),
		createdAt: timestamptz("created_at").defaultNow().notNull(),
		updatedAt: timestamptz("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: uuid("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		impersonatedBy: uuid("impersonated_by"),
	},
	(table) => [
		uniqueIndex("session_token_unique").on(table.token),
		index("session_user_id_idx").on(table.userId),
	],
);

export const account = pgTable(
	"account",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: uuid("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamptz("access_token_expires_at"),
		refreshTokenExpiresAt: timestamptz("refresh_token_expires_at"),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamptz("created_at").defaultNow().notNull(),
		updatedAt: timestamptz("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		uniqueIndex("account_provider_account_unique").on(
			table.providerId,
			table.accountId,
		),
		index("account_user_id_idx").on(table.userId),
	],
);

export const verification = pgTable(
	"verification",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamptz("expires_at").notNull(),
		createdAt: timestamptz("created_at").defaultNow().notNull(),
		updatedAt: timestamptz("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const rateLimit = pgTable(
	"rate_limit",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		key: text("key").notNull(),
		count: integer("count").notNull(),
		lastRequest: bigint("last_request", { mode: "number" }).notNull(),
	},
	(table) => [
		uniqueIndex("rate_limit_key_unique").on(table.key),
		check("rate_limit_count_nonnegative", sql`${table.count} >= 0`),
	],
);

export const adminMetadata = pgTable(
	"admin_metadata",
	{
		userId: uuid("user_id")
			.primaryKey()
			.references(() => user.id, { onDelete: "cascade" }),
		mustChangePassword: boolean("must_change_password").default(true).notNull(),
		locale: varchar("locale", { length: 16 }).default("zh-CN").notNull(),
		lastLoginAt: timestamptz("last_login_at"),
		rowVersion: bigint("row_version", { mode: "bigint" })
			.default(sql`1`)
			.notNull(),
	},
	(table) => [
		check(
			"admin_metadata_locale_supported",
			sql`${table.locale} in ('zh-CN', 'en')`,
		),
		check("admin_metadata_row_version_positive", sql`${table.rowVersion} >= 1`),
	],
);
