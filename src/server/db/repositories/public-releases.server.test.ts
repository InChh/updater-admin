import { drizzle } from "drizzle-orm/neon-serverless";
import { describe, expect, it } from "vitest";

import * as schema from "../schema";
import {
	buildPublicReleaseCursorAnchorQuery,
	buildPublicReleaseDownloadFilesQuery,
	buildPublicReleaseFilePageQuery,
	buildPublicReleaseHeaderQuery,
	buildPublicReleaseQuery,
	mapPublicReleaseFilePageRows,
	mapPublicReleaseHeaderRow,
	mapPublicReleaseRows,
	type PublicReleaseQueryRow,
} from "./public-releases.server";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const VERSION = {
	versionMajor: 10,
	versionMinor: 20,
	versionNumber: "10.20.30",
	versionPatch: 30,
} as const;

function row(
	overrides: Partial<PublicReleaseQueryRow> = {},
): PublicReleaseQueryRow {
	return {
		description: "Desktop release",
		fileChecksumAlgorithm: "sha256",
		fileId: "00000000-0000-4000-8000-000000000030",
		fileMimeType: "application/octet-stream",
		fileObjectKey: "private/app.bin",
		filePath: "app.bin",
		fileSha256: "a".repeat(64),
		fileSize: 42n,
		programId: PROGRAM_ID,
		programName: "Desktop",
		publishedAt: new Date("2026-07-20T01:00:00.000Z"),
		versionNumber: "10.2.3",
		...overrides,
	};
}

describe("public releases repository", () => {
	it("selects only finalized active live releases and preserves complete v1 rows", () => {
		const database = drizzle.mock({ schema });
		const latest = buildPublicReleaseQuery(database, PROGRAM_ID).toSQL();
		const sql = latest.sql.replaceAll(/\s+/g, " ").toLowerCase();

		expect(sql).toContain(
			'from "applications" inner join "application_versions"',
		);
		expect(sql).toContain('"applications"."deleted_at" is null');
		expect(sql).toContain('"application_versions"."deleted_at" is null');
		expect(sql).toContain('"application_versions"."lifecycle_status" =');
		expect(sql).toContain('"application_versions"."is_active" =');
		expect(sql).toContain('"application_versions"."finalized_at" is not null');
		expect(latest.params).toEqual(
			expect.arrayContaining([PROGRAM_ID, "finalized", true]),
		);
		expect(sql).toContain(
			'order by "application_versions"."version_major" desc, "application_versions"."version_minor" desc, "application_versions"."version_patch" desc, "application_versions"."id" desc limit',
		);
		expect(sql).toContain(
			') "selected_public_release" left join "version_files"',
		);
		expect(sql).toContain(
			'order by "file_metadata"."path" asc, "file_metadata"."id" asc',
		);
		expect(sql.match(/ limit /g)).toHaveLength(1);
	});

	it("filters specified releases by canonical text and numeric components", () => {
		const database = drizzle.mock({ schema });
		const query = buildPublicReleaseQuery(
			database,
			PROGRAM_ID,
			VERSION,
		).toSQL();

		expect(query.params).toEqual(
			expect.arrayContaining([
				PROGRAM_ID,
				"finalized",
				true,
				"10.20.30",
				10,
				20,
				30,
			]),
		);
	});

	it("builds bounded headers from finalized time and a live file count", () => {
		const database = drizzle.mock({ schema });
		const query = buildPublicReleaseHeaderQuery(
			database,
			PROGRAM_ID,
			VERSION,
		).toSQL();
		const sql = query.sql.replaceAll(/\s+/g, " ").toLowerCase();

		expect(sql).toContain('"application_versions"."finalized_at"');
		expect(sql).toContain("select count(*)::integer");
		expect(sql).toMatch(
			/inner join "file_metadata" on (?:"file_metadata"\.)?"id" = (?:"version_files"\.)?"file_metadata_id" and (?:"file_metadata"\.)?"deleted_at" is null/,
		);
		expect(sql).not.toContain('"file_metadata"."object_key"');
		expect(
			mapPublicReleaseHeaderRow({
				description: "Desktop release",
				fileCount: 10_001,
				programName: "Desktop",
				publishedAt: new Date("2026-08-06T01:00:00.000Z"),
				versionNumber: "10.20.30",
			}),
		).toMatchObject({ fileCount: 10_001, versionNumber: "10.20.30" });
	});

	it("uses an exclusive canonical-path keyset and fetches only one lookahead row", () => {
		const database = drizzle.mock({ schema });
		const query = buildPublicReleaseFilePageQuery(database, {
			afterPath: "nested/b.bin",
			pageSize: 200,
			programId: PROGRAM_ID,
			version: VERSION,
		}).toSQL();
		const sql = query.sql.replaceAll(/\s+/g, " ").toLowerCase();

		expect(sql).toContain('"file_metadata"."path" >');
		expect(sql).toContain('order by "file_metadata"."path" asc limit');
		expect(query.params).toEqual(expect.arrayContaining(["nested/b.bin", 201]));
		expect(sql).not.toContain('"file_metadata"."object_key"');
		expect(sql).not.toContain('"file_metadata"."etag"');

		const page = mapPublicReleaseFilePageRows(
			[
				{
					checksumAlgorithm: "sha256",
					mimeType: "application/octet-stream",
					path: "c.bin",
					sha256: "c".repeat(64),
					size: 3n,
				},
				{
					checksumAlgorithm: "sha256",
					mimeType: "application/octet-stream",
					path: "d.bin",
					sha256: "d".repeat(64),
					size: 4n,
				},
			],
			1,
		);
		expect(page).toEqual({
			items: [expect.objectContaining({ path: "c.bin" })],
			nextPath: "c.bin",
		});
	});

	it("verifies that a supplied cursor anchor belongs to the explicit release", () => {
		const database = drizzle.mock({ schema });
		const query = buildPublicReleaseCursorAnchorQuery(database, {
			afterPath: "nested/b.bin",
			pageSize: 200,
			programId: PROGRAM_ID,
			version: VERSION,
		}).toSQL();
		const sql = query.sql.replaceAll(/\s+/g, " ").toLowerCase();

		expect(sql).toContain('"file_metadata"."path" =');
		expect(sql).toContain("limit");
		expect(query.params).toEqual(expect.arrayContaining(["nested/b.bin", 1]));
	});

	it("selects only explicitly requested path and SHA pairs for signing", () => {
		const database = drizzle.mock({ schema });
		const query = buildPublicReleaseDownloadFilesQuery(database, {
			files: [
				{ path: "a.bin", sha256: "a".repeat(64) },
				{ path: "c.bin", sha256: "c".repeat(64) },
			],
			programId: PROGRAM_ID,
			version: VERSION,
		}).toSQL();
		const sql = query.sql.replaceAll(/\s+/g, " ").toLowerCase();

		expect(sql).toContain('"file_metadata"."path" =');
		expect(sql).toContain('"file_metadata"."sha256" =');
		expect(query.params).toEqual(
			expect.arrayContaining([
				"a.bin",
				"a".repeat(64),
				"c.bin",
				"c".repeat(64),
			]),
		);
		expect(sql).not.toContain('"file_metadata"."etag"');
	});

	it("maps v1 live files without truncation or leaking internal metadata", () => {
		const rows = Array.from({ length: 5_001 }, (_, index) =>
			row({
				fileId: `file-${index}`,
				fileObjectKey: `private/${index}.bin`,
				filePath: `${index.toString().padStart(4, "0")}.bin`,
			}),
		);
		const result = mapPublicReleaseRows(rows);

		expect(result?.files).toHaveLength(5_001);
		expect(Object.keys(result?.files[0] ?? {})).not.toContain("fileId");
		expect(Object.keys(result?.files[0] ?? {})).not.toContain("etag");
	});

	it("keeps a visible release with no live related files", () => {
		expect(
			mapPublicReleaseRows([
				row({
					fileChecksumAlgorithm: null,
					fileId: null,
					fileMimeType: null,
					fileObjectKey: null,
					filePath: null,
					fileSha256: null,
					fileSize: null,
				}),
			]),
		).toMatchObject({ files: [], programId: PROGRAM_ID });
		expect(mapPublicReleaseRows([])).toBeNull();
	});

	it("fails closed on inconsistent metadata and invalid bounded inputs", () => {
		expect(() =>
			mapPublicReleaseRows([row({ fileChecksumAlgorithm: "md5" })]),
		).toThrow("metadata invariant");
		expect(() => mapPublicReleaseRows([row({ fileId: null })])).toThrow(
			"join invariant",
		);
		expect(() => mapPublicReleaseFilePageRows([], 0)).toThrow("out of range");
		const database = drizzle.mock({ schema });
		expect(() =>
			buildPublicReleaseDownloadFilesQuery(database, {
				files: [],
				programId: PROGRAM_ID,
				version: VERSION,
			}),
		).toThrow("out of range");
	});
});
