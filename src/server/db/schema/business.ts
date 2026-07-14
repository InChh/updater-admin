import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	char,
	check,
	index,
	integer,
	pgTable,
	primaryKey,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) =>
	timestamp(name, { mode: "date", withTimezone: true });

export const applications = pgTable(
	"applications",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		name: varchar("name", { length: 128 }).notNull(),
		description: varchar("description", { length: 512 }),
		createdAt: timestamptz("created_at").defaultNow().notNull(),
		createdBy: uuid("created_by").notNull(),
		updatedAt: timestamptz("updated_at").defaultNow().notNull(),
		updatedBy: uuid("updated_by").notNull(),
		deletedAt: timestamptz("deleted_at"),
		deletedBy: uuid("deleted_by"),
		rowVersion: bigint("row_version", { mode: "bigint" })
			.default(sql`1`)
			.notNull(),
	},
	(table) => [
		uniqueIndex("applications_live_name_unique")
			.on(table.name)
			.where(sql`${table.deletedAt} is null`),
		check("applications_row_version_positive", sql`${table.rowVersion} >= 1`),
	],
);

export const applicationVersions = pgTable(
	"application_versions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		applicationId: uuid("application_id")
			.notNull()
			.references(() => applications.id, { onDelete: "restrict" }),
		versionNumber: varchar("version_number", { length: 20 }).notNull(),
		versionMajor: integer("version_major").notNull(),
		versionMinor: integer("version_minor").notNull(),
		versionPatch: integer("version_patch").notNull(),
		description: varchar("description", { length: 1024 }).notNull(),
		isActive: boolean("is_active").default(false).notNull(),
		createdAt: timestamptz("created_at").defaultNow().notNull(),
		createdBy: uuid("created_by").notNull(),
		updatedAt: timestamptz("updated_at").defaultNow().notNull(),
		updatedBy: uuid("updated_by").notNull(),
		deletedAt: timestamptz("deleted_at"),
		deletedBy: uuid("deleted_by"),
		rowVersion: bigint("row_version", { mode: "bigint" })
			.default(sql`1`)
			.notNull(),
	},
	(table) => [
		check(
			"application_versions_major_nonnegative",
			sql`${table.versionMajor} >= 0`,
		),
		check(
			"application_versions_minor_nonnegative",
			sql`${table.versionMinor} >= 0`,
		),
		check(
			"application_versions_patch_nonnegative",
			sql`${table.versionPatch} >= 0`,
		),
		check(
			"application_versions_number_canonical",
			sql`${table.versionNumber} = (${table.versionMajor}::text || '.' || ${table.versionMinor}::text || '.' || ${table.versionPatch}::text)`,
		),
		check(
			"application_versions_row_version_positive",
			sql`${table.rowVersion} >= 1`,
		),
		uniqueIndex("application_versions_live_number_unique")
			.on(
				table.applicationId,
				table.versionMajor,
				table.versionMinor,
				table.versionPatch,
			)
			.where(sql`${table.deletedAt} is null`),
		index("application_versions_latest_idx")
			.on(
				table.applicationId,
				table.isActive,
				table.versionMajor.desc(),
				table.versionMinor.desc(),
				table.versionPatch.desc(),
			)
			.where(sql`${table.deletedAt} is null`),
	],
);

export const fileMetadata = pgTable(
	"file_metadata",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		path: varchar("path", { length: 1024 }).notNull(),
		sha256: char("sha256", { length: 64 }).notNull(),
		size: bigint("size", { mode: "bigint" }).notNull(),
		objectKey: varchar("object_key", { length: 1024 }).notNull(),
		mimeType: varchar("mime_type", { length: 255 }).notNull(),
		etag: varchar("etag", { length: 255 }),
		checksumAlgorithm: varchar("checksum_algorithm", { length: 16 })
			.default("sha256")
			.notNull(),
		createdAt: timestamptz("created_at").defaultNow().notNull(),
		createdBy: uuid("created_by").notNull(),
		updatedAt: timestamptz("updated_at").defaultNow().notNull(),
		updatedBy: uuid("updated_by").notNull(),
		deletedAt: timestamptz("deleted_at"),
		deletedBy: uuid("deleted_by"),
		rowVersion: bigint("row_version", { mode: "bigint" })
			.default(sql`1`)
			.notNull(),
	},
	(table) => [
		check("file_metadata_size_nonnegative", sql`${table.size} >= 0`),
		check(
			"file_metadata_sha256_format",
			sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
		),
		check(
			"file_metadata_checksum_algorithm",
			sql`${table.checksumAlgorithm} = 'sha256'`,
		),
		check("file_metadata_row_version_positive", sql`${table.rowVersion} >= 1`),
		uniqueIndex("file_metadata_live_identity_unique")
			.on(table.path, table.sha256, table.size)
			.where(sql`${table.deletedAt} is null`),
		index("file_metadata_object_key_idx").on(table.objectKey),
		index("file_metadata_sha256_idx").on(table.sha256),
	],
);

export const versionFiles = pgTable(
	"version_files",
	{
		versionId: uuid("version_id")
			.notNull()
			.references(() => applicationVersions.id, { onDelete: "cascade" }),
		fileMetadataId: uuid("file_metadata_id")
			.notNull()
			.references(() => fileMetadata.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({
			columns: [table.versionId, table.fileMetadataId],
			name: "version_files_pk",
		}),
	],
);
