import { is } from "drizzle-orm";
import { type AnyPgTable, getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
	EnvironmentValidationError,
	readAuthEnvironment,
} from "../../env.server";
import * as schema from ".";
import {
	account,
	adminMetadata,
	applications,
	applicationVersions,
	auditEvents,
	fileMetadata,
	rateLimit,
	rateLimitWindows,
	session,
	systemSettings,
	user,
	verification,
	versionFiles,
} from ".";

const schemaExports: readonly unknown[] = Object.values(schema);
const tables = schemaExports.filter((value): value is AnyPgTable =>
	is(value, PgTable),
);

function columnNames(table: AnyPgTable) {
	return getTableConfig(table).columns.map((column) => column.name);
}

function checkNames(table: AnyPgTable) {
	return getTableConfig(table)
		.checks.map((constraint) => constraint.name)
		.sort();
}

function indexNames(table: AnyPgTable) {
	return getTableConfig(table)
		.indexes.map((entry) => entry.config.name)
		.sort();
}

function indexConfig(table: AnyPgTable, name: string) {
	const entry = getTableConfig(table).indexes.find(
		(candidate) => candidate.config.name === name,
	);
	expect(entry, `missing index ${name}`).toBeDefined();
	if (!entry) throw new Error(`missing schema index ${name}`);
	return entry.config;
}

function indexColumnNames(table: AnyPgTable, name: string) {
	return indexConfig(table, name).columns.map((column) => {
		if ("name" in column && typeof column.name === "string") return column.name;
		throw new Error(`index ${name} contains a non-column expression`);
	});
}

function foreignKeySummary(table: AnyPgTable) {
	return getTableConfig(table)
		.foreignKeys.map((foreignKey) => {
			const reference = foreignKey.reference();
			return {
				columns: reference.columns.map((column) => column.name),
				foreignColumns: reference.foreignColumns.map((column) => column.name),
				foreignTable: getTableConfig(reference.foreignTable).name,
				onDelete: foreignKey.onDelete,
			};
		})
		.sort((left, right) =>
			left.columns.join().localeCompare(right.columns.join()),
		);
}

describe("Updater Admin database schema", () => {
	it("contains only the thirteen approved tables", () => {
		const tableNames = tables.map((table) => getTableConfig(table).name).sort();
		expect(tableNames).toEqual([
			"account",
			"admin_metadata",
			"application_versions",
			"applications",
			"audit_events",
			"file_metadata",
			"rate_limit",
			"rate_limit_windows",
			"session",
			"system_settings",
			"user",
			"verification",
			"version_files",
		]);
		expect(tableNames.join(" ")).not.toMatch(
			/(billing|invoice|legacy|openid|organization|permission|role|subscription|tenant)/,
		);
	});

	it("uses snake_case physical names and timestamptz for every timestamp", () => {
		for (const table of tables) {
			const config = getTableConfig(table);
			expect(config.name).toMatch(/^[a-z][a-z0-9_]*$/);
			for (const column of config.columns) {
				expect(column.name).toMatch(/^[a-z][a-z0-9_]*$/);
				if (column.getSQLType().startsWith("timestamp")) {
					expect(column.getSQLType()).toBe("timestamp with time zone");
				}
			}
		}
	});

	it("matches the Better Auth 1.6.23 tables and admin plugin fields", () => {
		expect(columnNames(user)).toEqual([
			"id",
			"name",
			"email",
			"email_verified",
			"image",
			"created_at",
			"updated_at",
			"role",
			"banned",
			"ban_reason",
			"ban_expires",
		]);
		expect(columnNames(session)).toEqual([
			"id",
			"expires_at",
			"token",
			"created_at",
			"updated_at",
			"ip_address",
			"user_agent",
			"user_id",
			"impersonated_by",
		]);
		expect(columnNames(account)).toEqual([
			"id",
			"account_id",
			"provider_id",
			"user_id",
			"access_token",
			"refresh_token",
			"id_token",
			"access_token_expires_at",
			"refresh_token_expires_at",
			"scope",
			"password",
			"created_at",
			"updated_at",
		]);
		expect(columnNames(verification)).toEqual([
			"id",
			"identifier",
			"value",
			"expires_at",
			"created_at",
			"updated_at",
		]);
		expect(columnNames(rateLimit)).toEqual([
			"id",
			"key",
			"count",
			"last_request",
		]);
		expect(columnNames(adminMetadata)).toEqual([
			"user_id",
			"must_change_password",
			"locale",
			"last_login_at",
		]);

		for (const table of [user, session, account, verification, rateLimit]) {
			const id = getTableConfig(table).columns.find(
				(column) => column.name === "id",
			);
			expect(id?.getSQLType()).toBe("uuid");
			expect(id?.hasDefault).toBe(true);
		}
		expect(indexNames(account)).toEqual([
			"account_provider_account_unique",
			"account_user_id_idx",
		]);
		expect(indexConfig(account, "account_provider_account_unique").unique).toBe(
			true,
		);
		expect(
			indexColumnNames(account, "account_provider_account_unique"),
		).toEqual(["provider_id", "account_id"]);
		expect(checkNames(adminMetadata)).toEqual([
			"admin_metadata_locale_supported",
		]);
		expect(foreignKeySummary(adminMetadata)).toEqual([
			{
				columns: ["user_id"],
				foreignColumns: ["id"],
				foreignTable: "user",
				onDelete: "cascade",
			},
		]);
		for (const authDependency of [session, account]) {
			expect(foreignKeySummary(authDependency)).toEqual([
				{
					columns: ["user_id"],
					foreignColumns: ["id"],
					foreignTable: "user",
					onDelete: "cascade",
				},
			]);
		}
	});

	it("defines exact business columns, required version descriptions, and audit fields", () => {
		expect(columnNames(applications)).toEqual([
			"id",
			"name",
			"description",
			"created_at",
			"created_by",
			"updated_at",
			"updated_by",
			"deleted_at",
			"deleted_by",
			"row_version",
		]);
		expect(columnNames(applicationVersions)).toEqual([
			"id",
			"application_id",
			"version_number",
			"version_major",
			"version_minor",
			"version_patch",
			"description",
			"is_active",
			"created_at",
			"created_by",
			"updated_at",
			"updated_by",
			"deleted_at",
			"deleted_by",
			"row_version",
		]);
		expect(columnNames(fileMetadata)).toEqual([
			"id",
			"path",
			"sha256",
			"size",
			"object_key",
			"mime_type",
			"etag",
			"checksum_algorithm",
			"created_at",
			"created_by",
			"updated_at",
			"updated_by",
			"deleted_at",
			"deleted_by",
			"row_version",
		]);
		expect(columnNames(versionFiles)).toEqual([
			"version_id",
			"file_metadata_id",
		]);

		const versionDescription = getTableConfig(applicationVersions).columns.find(
			(column) => column.name === "description",
		);
		// The approved design explicitly says version description is required.
		expect(versionDescription?.notNull).toBe(true);
		expect(versionDescription?.hasDefault).toBe(false);
		for (const table of [applications, applicationVersions, fileMetadata]) {
			const rowVersion = getTableConfig(table).columns.find(
				(column) => column.name === "row_version",
			);
			expect(rowVersion?.getSQLType()).toBe("bigint");
			expect(rowVersion?.notNull).toBe(true);
			expect(rowVersion?.hasDefault).toBe(true);
		}
	});

	it("defines approved checks, partial uniqueness, latest ordering, and real foreign keys", () => {
		expect(checkNames(applications)).toEqual([
			"applications_row_version_positive",
		]);
		expect(checkNames(applicationVersions)).toEqual([
			"application_versions_major_nonnegative",
			"application_versions_minor_nonnegative",
			"application_versions_number_canonical",
			"application_versions_patch_nonnegative",
			"application_versions_row_version_positive",
		]);
		expect(checkNames(fileMetadata)).toEqual([
			"file_metadata_checksum_algorithm",
			"file_metadata_row_version_positive",
			"file_metadata_sha256_format",
			"file_metadata_size_nonnegative",
		]);
		expect(indexNames(fileMetadata)).toEqual([
			"file_metadata_live_identity_unique",
			"file_metadata_object_key_idx",
			"file_metadata_sha256_idx",
		]);
		expect(
			indexColumnNames(fileMetadata, "file_metadata_object_key_idx"),
		).toEqual(["object_key"]);

		for (const [table, name] of [
			[applications, "applications_live_name_unique"],
			[applicationVersions, "application_versions_live_number_unique"],
			[fileMetadata, "file_metadata_live_identity_unique"],
		] as const) {
			const index = indexConfig(table, name);
			expect(index.unique).toBe(true);
			expect(index.where).toBeDefined();
		}
		const latest = indexConfig(
			applicationVersions,
			"application_versions_latest_idx",
		);
		expect(latest.where).toBeDefined();
		expect(
			indexColumnNames(applicationVersions, "application_versions_latest_idx"),
		).toEqual([
			"application_id",
			"is_active",
			"version_major",
			"version_minor",
			"version_patch",
		]);

		expect(foreignKeySummary(applicationVersions)).toEqual([
			{
				columns: ["application_id"],
				foreignColumns: ["id"],
				foreignTable: "applications",
				onDelete: "restrict",
			},
		]);
		expect(foreignKeySummary(versionFiles)).toEqual([
			{
				columns: ["file_metadata_id"],
				foreignColumns: ["id"],
				foreignTable: "file_metadata",
				onDelete: "cascade",
			},
			{
				columns: ["version_id"],
				foreignColumns: ["id"],
				foreignTable: "application_versions",
				onDelete: "cascade",
			},
		]);
		const versionFilesConfig = getTableConfig(versionFiles);
		expect(versionFilesConfig.foreignKeys).toHaveLength(2);
		expect(versionFilesConfig.primaryKeys).toHaveLength(1);
		expect(
			versionFilesConfig.primaryKeys[0]?.columns.map((column) => column.name),
		).toEqual(["version_id", "file_metadata_id"]);
	});

	it("keeps audit, settings, and product rate limiting under distinct owners", () => {
		expect(columnNames(auditEvents)).toEqual([
			"id",
			"actor_id",
			"action",
			"resource_type",
			"resource_id",
			"result",
			"before_json",
			"after_json",
			"request_id",
			"ip",
			"user_agent",
			"created_at",
		]);
		expect(indexNames(auditEvents)).toEqual([
			"audit_events_action_created_at_idx",
			"audit_events_actor_created_at_idx",
			"audit_events_created_at_idx",
			"audit_events_resource_created_at_idx",
			"audit_events_result_created_at_idx",
		]);
		expect(columnNames(systemSettings)).toEqual([
			"id",
			"system_name",
			"default_locale",
			"default_page_size",
			"repository_url",
			"updated_at",
			"updated_by",
			"row_version",
		]);
		expect(checkNames(systemSettings)).toEqual([
			"system_settings_locale_supported",
			"system_settings_page_size_supported",
			"system_settings_row_version_positive",
			"system_settings_singleton",
		]);
		expect(columnNames(rateLimitWindows)).toEqual([
			"endpoint",
			"subject_key",
			"window_started_at",
			"count",
			"expires_at",
			"created_at",
		]);
		expect(getTableConfig(rateLimitWindows).primaryKeys).toHaveLength(1);
		expect(indexNames(rateLimitWindows)).toEqual([
			"rate_limit_windows_expires_at_idx",
		]);
		expect(getTableConfig(rateLimit).name).not.toBe(
			getTableConfig(rateLimitWindows).name,
		);
	});
});

describe("environment validation", () => {
	it("reports variable names without including invalid secret values", () => {
		const secretValue = "must-not-appear";
		expect(() =>
			readAuthEnvironment({
				BETTER_AUTH_SECRET: secretValue,
				BETTER_AUTH_URL: "sensitive://invalid-origin",
			}),
		).toThrow(EnvironmentValidationError);

		try {
			readAuthEnvironment({
				BETTER_AUTH_SECRET: secretValue,
				BETTER_AUTH_URL: "sensitive://invalid-origin",
			});
		} catch (error) {
			expect(error).toBeInstanceOf(EnvironmentValidationError);
			expect((error as EnvironmentValidationError).variableNames).toEqual([
				"BETTER_AUTH_SECRET",
				"BETTER_AUTH_URL",
			]);
			expect((error as Error).message).not.toContain(secretValue);
			expect((error as Error).message).not.toContain(
				"sensitive://invalid-origin",
			);
		}
	});
});
