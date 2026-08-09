import { and, asc, count, eq, gte, isNull, lt, sql, sum } from "drizzle-orm";

import { type Database, getDatabase } from "../client.server";
import { applications, applicationVersions, fileMetadata } from "../schema";

export interface MonitoringMetricsRecord {
	readonly activeVersions: number;
	readonly files: number;
	readonly programs: number;
	readonly totalBytes: bigint;
	readonly versions: number;
}

export interface ReleaseCountRecord {
	readonly bucket: string;
	readonly value: number;
}

export interface ReleaseCountsRepositoryInput {
	readonly from: Date;
	readonly toExclusive: Date;
}

export interface MonitoringRepository {
	checkNeon(): Promise<void>;
	getMetrics(): Promise<MonitoringMetricsRecord>;
	getReleaseCounts(
		input: ReleaseCountsRepositoryInput,
	): Promise<readonly ReleaseCountRecord[]>;
}

export type MonitoringDatabase = Pick<Database, "execute" | "select">;

function nonNegativeCount(value: unknown, name: string): number {
	const countValue = Number(value ?? 0);
	if (!Number.isSafeInteger(countValue) || countValue < 0) {
		throw new Error(`${name} count invariant was violated.`);
	}
	return countValue;
}

function nonNegativeBytes(value: unknown): bigint {
	const bytes = BigInt(String(value ?? "0"));
	if (bytes < 0n) throw new Error("Storage byte total invariant was violated.");
	return bytes;
}

export function createMonitoringRepository(
	database?: MonitoringDatabase,
): MonitoringRepository {
	const resolveDatabase = () => database ?? getDatabase();

	return {
		async checkNeon() {
			await resolveDatabase().execute(sql`select 1`);
		},
		async getMetrics() {
			const databaseClient = resolveDatabase();
			const [programRows, versionRows, activeRows, fileRows] =
				await Promise.all([
					databaseClient
						.select({ value: count() })
						.from(applications)
						.where(isNull(applications.deletedAt)),
					databaseClient
						.select({ value: count() })
						.from(applicationVersions)
						.where(isNull(applicationVersions.deletedAt)),
					databaseClient
						.select({ value: count() })
						.from(applicationVersions)
						.where(
							and(
								isNull(applicationVersions.deletedAt),
								eq(applicationVersions.isActive, true),
							),
						),
					databaseClient
						.select({ bytes: sum(fileMetadata.size), value: count() })
						.from(fileMetadata)
						.where(isNull(fileMetadata.deletedAt)),
				]);

			return {
				activeVersions: nonNegativeCount(
					activeRows[0]?.value,
					"Active version",
				),
				files: nonNegativeCount(fileRows[0]?.value, "File"),
				programs: nonNegativeCount(programRows[0]?.value, "Program"),
				totalBytes: nonNegativeBytes(fileRows[0]?.bytes),
				versions: nonNegativeCount(versionRows[0]?.value, "Version"),
			};
		},
		async getReleaseCounts(input) {
			const bucketExpression = sql<string>`to_char(${applicationVersions.finalizedAt} at time zone 'UTC', 'YYYY-MM-DD')`;
			const rows = await resolveDatabase()
				.select({ bucket: bucketExpression, value: count() })
				.from(applicationVersions)
				.where(
					and(
						eq(applicationVersions.lifecycleStatus, "finalized"),
						isNull(applicationVersions.deletedAt),
						gte(applicationVersions.finalizedAt, input.from),
						lt(applicationVersions.finalizedAt, input.toExclusive),
					),
				)
				.groupBy(bucketExpression)
				.orderBy(asc(bucketExpression));
			return rows.map((row) => ({
				bucket: row.bucket,
				value: nonNegativeCount(row.value, "Release bucket"),
			}));
		},
	};
}
