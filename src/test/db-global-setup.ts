import { resolve } from "node:path";
import process from "node:process";

import { getTableName } from "drizzle-orm";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

import { createDatabaseClient } from "../server/db/client.server";
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
} from "../server/db/schema";
import { assertDisposableDatabaseGuard } from "../server/db/schema/database-test-safety";

const APPROVED_TABLES = [
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
] as const;

/** Prepare one explicitly disposable database for every serial *.db.test.ts file. */
export default async function setupDatabaseTests() {
	const testDatabaseUrl = process.env.TEST_DATABASE_URL;
	if (!testDatabaseUrl) return;

	assertDisposableDatabaseGuard({
		confirmation: process.env.TEST_DATABASE_CONFIRM_DISPOSABLE,
		databaseUrl: process.env.DATABASE_URL,
		testDatabaseUrl,
	});

	const client = createDatabaseClient({ databaseUrl: testDatabaseUrl });
	try {
		await migrate(client.db, { migrationsFolder: resolve("drizzle") });
		const result = await client.pool.query<{ table_name: string }>(
			`select table_name
			from information_schema.tables
			where table_schema = 'public' and table_type = 'BASE TABLE'
			order by table_name`,
		);
		const actual = result.rows.map((row) => row.table_name);
		const expected = APPROVED_TABLES.map(getTableName).sort();
		if (actual.join("\n") !== expected.join("\n")) {
			throw new Error(
				`Disposable database table set differs from the approved migrations. Expected ${expected.join(", ")}; received ${actual.join(", ") || "none"}.`,
			);
		}

		const quotedTables = expected
			.map((tableName) => `"${tableName.replaceAll('"', '""')}"`)
			.join(", ");
		await client.pool.query(
			`truncate table ${quotedTables} restart identity cascade`,
		);
	} finally {
		await client.close();
	}
}
