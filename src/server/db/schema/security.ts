import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) =>
	timestamp(name, { mode: "date", withTimezone: true });

export const auditEvents = pgTable(
	"audit_events",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		actorId: uuid("actor_id"),
		action: varchar("action", { length: 128 }).notNull(),
		resourceType: varchar("resource_type", { length: 64 }).notNull(),
		resourceId: varchar("resource_id", { length: 128 }).notNull(),
		result: varchar("result", { length: 32 }).notNull(),
		beforeJson: jsonb("before_json"),
		afterJson: jsonb("after_json"),
		requestId: varchar("request_id", { length: 128 }).notNull(),
		ip: varchar("ip", { length: 64 }),
		userAgent: text("user_agent"),
		createdAt: timestamptz("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("audit_events_created_at_idx").on(table.createdAt.desc()),
		index("audit_events_actor_created_at_idx").on(
			table.actorId,
			table.createdAt.desc(),
		),
		index("audit_events_action_created_at_idx").on(
			table.action,
			table.createdAt.desc(),
		),
		index("audit_events_resource_created_at_idx").on(
			table.resourceType,
			table.resourceId,
			table.createdAt.desc(),
		),
		index("audit_events_result_created_at_idx").on(
			table.result,
			table.createdAt.desc(),
		),
	],
);

export const systemSettings = pgTable(
	"system_settings",
	{
		id: integer("id").default(1).primaryKey(),
		systemName: varchar("system_name", { length: 128 })
			.default("版本管理系统")
			.notNull(),
		defaultLocale: varchar("default_locale", { length: 16 })
			.default("zh-CN")
			.notNull(),
		defaultPageSize: integer("default_page_size").default(20).notNull(),
		repositoryUrl: varchar("repository_url", { length: 2048 }),
		updatedAt: timestamptz("updated_at").defaultNow().notNull(),
		updatedBy: uuid("updated_by"),
		rowVersion: bigint("row_version", { mode: "bigint" })
			.default(sql`1`)
			.notNull(),
	},
	(table) => [
		check("system_settings_singleton", sql`${table.id} = 1`),
		check(
			"system_settings_locale_supported",
			sql`${table.defaultLocale} in ('zh-CN', 'en')`,
		),
		check(
			"system_settings_page_size_supported",
			sql`${table.defaultPageSize} in (20, 50, 100)`,
		),
		check(
			"system_settings_row_version_positive",
			sql`${table.rowVersion} >= 1`,
		),
	],
);

export const rateLimitWindows = pgTable(
	"rate_limit_windows",
	{
		endpoint: varchar("endpoint", { length: 255 }).notNull(),
		subjectKey: varchar("subject_key", { length: 255 }).notNull(),
		windowStartedAt: timestamptz("window_started_at").notNull(),
		count: integer("count").default(1).notNull(),
		expiresAt: timestamptz("expires_at").notNull(),
		createdAt: timestamptz("created_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({
			columns: [table.endpoint, table.subjectKey, table.windowStartedAt],
			name: "rate_limit_windows_pk",
		}),
		check("rate_limit_windows_count_nonnegative", sql`${table.count} >= 0`),
		check(
			"rate_limit_windows_expiry_after_start",
			sql`${table.expiresAt} > ${table.windowStartedAt}`,
		),
		index("rate_limit_windows_expires_at_idx").on(table.expiresAt),
	],
);
