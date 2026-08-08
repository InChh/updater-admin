import process from "node:process";

import { neonConfig, Pool, type PoolClient } from "@neondatabase/serverless";
import { config } from "dotenv";
import ws from "ws";

import { readDatabaseEnvironment } from "../src/server/env.server";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

neonConfig.webSocketConstructor = ws;

const EXPECTED_DATABASE = {
	database: "neondb",
	hostname:
		"ep-falling-butterfly-aoj23551-pooler.c-2.ap-southeast-1.aws.neon.tech",
	username: "neondb_owner",
} as const;
const EXPECTED_PRODUCTION_SITE_ID = "180cc440-4b2f-4313-867d-d33146376287";
const EXECUTION_CONFIRMATION = "delete-exact-2026-07-20-production-e2e-manifest";

const target = {
	accountId: "3fc0b094-1ff5-4f71-983e-00f5f2b69f8b",
	applicationId: "857c9256-9931-4e76-8903-37f548290cfc",
	fileId: "618c138c-48c0-4064-985f-50feeeaa654a",
	userId: "a50d6ca4-4361-4ce5-b962-030039de7db6",
	versionId: "ab3dd5da-79df-41d8-b9f3-f9d9b10f27f5",
} as const;

const auditIds = [
	"d0fb41f5-3985-48f0-94fc-74aa08a005b3",
	"3606b4e8-c0ca-4839-a80e-d5e764f041da",
	"ae80d223-2353-41c4-a715-1082bee4eddf",
	"a9529b90-21a1-4283-886c-2dace54745bc",
	"79551e8e-ed69-4340-a563-8b35ebfb3426",
	"8a79facd-6e66-4f85-91c6-a38a9d0a9170",
	"a761e5a4-f71a-45a2-9e81-15d7b3a12ce4",
	"74e69b6a-47c7-4150-b5e2-76790aa64420",
	"e89fb16e-d817-4bb2-9196-2ffbff51c573",
	"979ef324-51c2-40ec-91a2-c77b4a07917f",
	"0f5c28fe-a27c-4783-b463-2852b6da9471",
	"f9d6b115-59d8-4062-93b6-da41f975fe9f",
	"b12262d3-d296-4d37-b671-e03a46f8d6c7",
	"8703d281-6657-47c4-b845-fb83505bc74a",
	"742f02dc-b80d-4b1d-99e7-d0ebfbb742f3",
	"8688f784-4def-431e-a731-71bfc760a384",
	"5e68df2d-83d0-445e-915e-76bbc03fbe9d",
	"e9304118-5369-409e-987b-a7b7141ccf44",
] as const;

const optionalRateWindow = {
	endpoint: "uploads.complete.files",
	startedAt: "2026-07-20T03:00:00.000Z",
} as const;

type Mode = "execute" | "preflight";

class GuardError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GuardError";
	}
}

interface Fingerprints {
	readonly migrationCount: number;
	readonly migrationFingerprint: string;
	readonly settingsCount: number;
	readonly settingsFingerprint: string;
}

function assertGuard(condition: unknown, message: string): asserts condition {
	if (!condition) throw new GuardError(message);
}

function readMode(): Mode {
	const argument = process.argv.find((value) => value.startsWith("--mode="));
	const mode = argument?.slice("--mode=".length);
	if (mode === "preflight" || mode === "execute") return mode;
	throw new GuardError("Pass --mode=preflight or --mode=execute.");
}

function validateExecutionEnvironment(mode: Mode): string {
	const { databaseUrl } = readDatabaseEnvironment();
	const parsed = new URL(databaseUrl);
	assertGuard(
		parsed.hostname === EXPECTED_DATABASE.hostname &&
			parsed.username === EXPECTED_DATABASE.username &&
			parsed.pathname === `/${EXPECTED_DATABASE.database}`,
		"DATABASE_URL does not match the approved production database identity.",
	);
	assertGuard(
		process.env.NETLIFY_PRODUCTION_SITE_ID === EXPECTED_PRODUCTION_SITE_ID,
		"NETLIFY_PRODUCTION_SITE_ID does not match the approved production site.",
	);
	if (mode === "execute") {
		assertGuard(
			process.env.CONFIRM_PRODUCTION_E2E_CLEANUP === EXECUTION_CONFIRMATION,
			"Production cleanup confirmation is absent or incorrect.",
		);
	}
	return databaseUrl;
}

async function count(
	client: PoolClient,
	text: string,
	values: readonly unknown[] = [],
): Promise<number> {
	const result = await client.query<{ count: string }>(text, [...values]);
	const value = Number.parseInt(result.rows[0]?.count ?? "", 10);
	assertGuard(Number.isSafeInteger(value), "A database count was not an integer.");
	return value;
}

async function readFingerprints(client: PoolClient): Promise<Fingerprints> {
	const settings = await client.query<{
		fingerprint: string;
		row_count: string;
	}>(`
		select
			count(*)::text as row_count,
			md5(coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)::text) as fingerprint
		from system_settings s
	`);
	const migrations = await client.query<{
		fingerprint: string;
		row_count: string;
	}>(`
		select
			count(*)::text as row_count,
			md5(coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)::text) as fingerprint
		from drizzle.__drizzle_migrations m
	`);
	const value = {
		migrationCount: Number.parseInt(migrations.rows[0]?.row_count ?? "", 10),
		migrationFingerprint: migrations.rows[0]?.fingerprint ?? "",
		settingsCount: Number.parseInt(settings.rows[0]?.row_count ?? "", 10),
		settingsFingerprint: settings.rows[0]?.fingerprint ?? "",
	};
	assertGuard(
		value.settingsCount === 1 && value.settingsFingerprint.length === 32,
		"The system-settings preservation fingerprint is unexpected.",
	);
	assertGuard(
		value.migrationCount === 2 && value.migrationFingerprint.length === 32,
		"The migration-ledger preservation fingerprint is unexpected.",
	);
	return value;
}

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
	const left = [...actual].sort();
	const right = [...expected].sort();
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function assertExactTargetState(client: PoolClient): Promise<Fingerprints> {
	assertGuard(
		(await count(client, "select count(*) from applications where id = $1", [
			target.applicationId,
		])) === 1,
		"The target application cardinality changed.",
	);
	assertGuard(
		(await count(
			client,
			"select count(*) from application_versions where application_id = $1",
			[target.applicationId],
		)) === 1,
		"The target application now has an unlisted version.",
	);
	assertGuard(
		(await count(
			client,
			"select count(*) from application_versions where id = $1 and application_id = $2",
			[target.versionId, target.applicationId],
		)) === 1,
		"The target version identity changed.",
	);
	assertGuard(
		(await count(client, "select count(*) from file_metadata where id = $1", [
			target.fileId,
		])) === 1,
		"The target file cardinality changed.",
	);
	assertGuard(
		(await count(client, "select count(*) from version_files where version_id = $1", [
			target.versionId,
		])) === 1 &&
			(await count(
				client,
				"select count(*) from version_files where file_metadata_id = $1",
				[target.fileId],
			)) === 1 &&
			(await count(
				client,
				"select count(*) from version_files where version_id = $1 and file_metadata_id = $2",
				[target.versionId, target.fileId],
			)) === 1,
		"The target version-file relationship changed.",
	);

	const users = await client.query<{ email: string }>(
		'select email from "user" where id = $1',
		[target.userId],
	);
	assertGuard(users.rowCount === 1, "The target user cardinality changed.");
	const targetEmail = users.rows[0]?.email;
	assertGuard(Boolean(targetEmail), "The target user email is absent.");
	assertGuard(
		(await count(client, "select count(*) from account where user_id = $1", [
			target.userId,
		])) === 1 &&
			(await count(client, "select count(*) from account where id = $1 and user_id = $2", [
				target.accountId,
				target.userId,
			])) === 1,
		"The target account relationship changed.",
	);
	assertGuard(
		(await count(client, "select count(*) from admin_metadata where user_id = $1", [
			target.userId,
		])) === 1,
		"The target administrator metadata cardinality changed.",
	);

	const zeroReferenceChecks = [
		count(client, 'select count(*) from "session" where user_id = $1 or impersonated_by = $1', [target.userId]),
		count(client, "select count(*) from system_settings where updated_by = $1", [target.userId]),
		count(client, "select count(*) from verification where identifier = any($1::text[])", [[target.userId, targetEmail]]),
		count(client, "select count(*) from rate_limit where position($1 in key) > 0 or position($2 in key) > 0", [target.userId, targetEmail]),
		count(client, "select count(*) from account where id <> $1 and account_id = any($2::text[])", [target.accountId, [target.userId, targetEmail]]),
		count(client, "select count(*) from applications where id <> $1 and (created_by = $2 or updated_by = $2 or deleted_by = $2)", [target.applicationId, target.userId]),
		count(client, "select count(*) from application_versions where id <> $1 and (created_by = $2 or updated_by = $2 or deleted_by = $2)", [target.versionId, target.userId]),
		count(client, "select count(*) from file_metadata where id <> $1 and (created_by = $2 or updated_by = $2 or deleted_by = $2)", [target.fileId, target.userId]),
	];
	const referenceCounts = await Promise.all(zeroReferenceChecks);
	assertGuard(
		referenceCounts.every((value) => value === 0),
		"An unlisted logical reference to the target user exists.",
	);

	const rateRows = await client.query<{
		endpoint: string;
		window_started_at: Date;
	}>(
		"select endpoint, window_started_at from rate_limit_windows where subject_key = $1",
		[target.userId],
	);
	assertGuard(rateRows.rows.length <= 1, "The target user has an unlisted rate-limit window.");
	if (rateRows.rows[0]) {
		assertGuard(
			rateRows.rows[0].endpoint === optionalRateWindow.endpoint &&
				rateRows.rows[0].window_started_at.toISOString() === optionalRateWindow.startedAt,
			"The target user has a different rate-limit window.",
		);
	}

	const fixedAudits = await client.query<{ id: string }>(
		"select id::text as id from audit_events where id = any($1::uuid[])",
		[[...auditIds]],
	);
	assertGuard(
		sameSet(
			fixedAudits.rows.map((row) => row.id),
			auditIds,
		),
		"The fixed audit-event set is incomplete.",
	);
	const embeddedTargets = Object.values(target);
	const discoveredAudits = await client.query<{ id: string }>(
		`
			select id::text as id
			from audit_events audit
			where actor_id = $1
				or resource_id = any($2::text[])
				or exists (
					select 1
					from unnest($2::text[]) as target_id
					where position(target_id in coalesce(audit.before_json::text, '')) > 0
						or position(target_id in coalesce(audit.after_json::text, '')) > 0
				)
		`,
		[target.userId, embeddedTargets],
	);
	assertGuard(
		sameSet(
			discoveredAudits.rows.map((row) => row.id),
			auditIds,
		),
		"Audit discovery found rows outside the fixed manifest.",
	);

	return readFingerprints(client);
}

async function deleteExactTargets(client: PoolClient) {
	const deletedAudits = await client.query(
		"delete from audit_events where id = any($1::uuid[])",
		[[...auditIds]],
	);
	const deletedRateWindow = await client.query(
		"delete from rate_limit_windows where endpoint = $1 and subject_key = $2 and window_started_at = $3::timestamptz",
		[optionalRateWindow.endpoint, target.userId, optionalRateWindow.startedAt],
	);
	const deletedRelation = await client.query(
		"delete from version_files where version_id = $1 and file_metadata_id = $2",
		[target.versionId, target.fileId],
	);
	const deletedVersion = await client.query(
		"delete from application_versions where id = $1",
		[target.versionId],
	);
	const deletedFile = await client.query("delete from file_metadata where id = $1", [
		target.fileId,
	]);
	const deletedApplication = await client.query("delete from applications where id = $1", [
		target.applicationId,
	]);
	const deletedAccount = await client.query("delete from account where id = $1", [
		target.accountId,
	]);
	const deletedMetadata = await client.query(
		"delete from admin_metadata where user_id = $1",
		[target.userId],
	);
	const deletedUser = await client.query('delete from "user" where id = $1', [target.userId]);

	const counts = {
		account: deletedAccount.rowCount,
		adminMetadata: deletedMetadata.rowCount,
		application: deletedApplication.rowCount,
		audits: deletedAudits.rowCount,
		file: deletedFile.rowCount,
		rateWindow: deletedRateWindow.rowCount,
		user: deletedUser.rowCount,
		version: deletedVersion.rowCount,
		versionFile: deletedRelation.rowCount,
	};
	assertGuard(
		counts.account === 1 &&
			counts.adminMetadata === 1 &&
			counts.application === 1 &&
			counts.audits === auditIds.length &&
			counts.file === 1 &&
			(counts.rateWindow === 0 || counts.rateWindow === 1) &&
			counts.user === 1 &&
			counts.version === 1 &&
			counts.versionFile === 1,
		"A delete count did not match the fixed manifest.",
	);
	return counts;
}

async function assertPostCommitState(
	client: PoolClient,
	before: Fingerprints,
): Promise<void> {
	const remaining = await Promise.all([
		count(client, "select count(*) from applications where id = $1", [target.applicationId]),
		count(client, "select count(*) from application_versions where id = $1", [target.versionId]),
		count(client, "select count(*) from file_metadata where id = $1", [target.fileId]),
		count(client, "select count(*) from version_files where version_id = $1 or file_metadata_id = $2", [target.versionId, target.fileId]),
		count(client, 'select count(*) from "user" where id = $1', [target.userId]),
		count(client, "select count(*) from account where id = $1", [target.accountId]),
		count(client, "select count(*) from admin_metadata where user_id = $1", [target.userId]),
		count(client, "select count(*) from audit_events where id = any($1::uuid[])", [[...auditIds]]),
		count(client, "select count(*) from rate_limit_windows where endpoint = $1 and subject_key = $2 and window_started_at = $3::timestamptz", [optionalRateWindow.endpoint, target.userId, optionalRateWindow.startedAt]),
	]);
	assertGuard(remaining.every((value) => value === 0), "A fixed target remains after commit.");
	const after = await readFingerprints(client);
	assertGuard(
		after.settingsFingerprint === before.settingsFingerprint &&
			after.migrationFingerprint === before.migrationFingerprint,
		"A preservation fingerprint changed during cleanup.",
	);
}

async function run() {
	const mode = readMode();
	const databaseUrl = validateExecutionEnvironment(mode);
	const pool = new Pool({
		connectionString: databaseUrl,
		connectionTimeoutMillis: 10_000,
		idleTimeoutMillis: 30_000,
		max: 1,
	});
	const client = await pool.connect();
	let transactionOpen = false;
	try {
		await client.query("begin isolation level serializable");
		transactionOpen = true;
		await client.query("set local lock_timeout = '10s'");
		await client.query("set local statement_timeout = '60s'");
		await client.query(`
			lock table
				applications,
				application_versions,
				file_metadata,
				version_files,
				"user",
				account,
				admin_metadata,
				"session",
				verification,
				rate_limit,
				rate_limit_windows,
				audit_events,
				system_settings,
				drizzle.__drizzle_migrations
			in share row exclusive mode
		`);
		const fingerprints = await assertExactTargetState(client);
		if (mode === "preflight") {
			await client.query("rollback");
			transactionOpen = false;
			console.log(
				JSON.stringify({
					auditCount: auditIds.length,
					migrationCount: fingerprints.migrationCount,
					mode,
					optionalRateWindow: "absent-or-exact",
					settingsCount: fingerprints.settingsCount,
					status: "matched",
				}),
			);
			return;
		}

		const counts = await deleteExactTargets(client);
		await client.query("commit");
		transactionOpen = false;
		await assertPostCommitState(client, fingerprints);
		console.log(JSON.stringify({ counts, mode, status: "committed-and-verified" }));
	} catch (error) {
		if (transactionOpen) await client.query("rollback").catch(() => undefined);
		if (error instanceof GuardError) {
			console.error(`Production E2E cleanup aborted: ${error.message}`);
		} else {
			const code =
				typeof error === "object" && error && "code" in error
					? String(error.code)
					: "unexpected-error";
			console.error(`Production E2E cleanup aborted with database code: ${code}`);
		}
		process.exitCode = 1;
	} finally {
		client.release();
		await pool.end();
	}
}

await run();
