import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { UploadFileMetadataInput } from "../../src/shared/api/uploads";

export const INCREMENTAL_RELEASE_VERSIONS = ["v1", "v2"] as const;
export type IncrementalReleaseVersion =
	(typeof INCREMENTAL_RELEASE_VERSIONS)[number];

const RELEASE_FILES: Readonly<
	Record<IncrementalReleaseVersion, readonly string[]>
> = {
	v1: ["A.txt", "B.txt", "D.txt"],
	v2: ["A.txt", "B.txt", "C.txt"],
};

const fixtureRoot = resolve(
	process.cwd(),
	"tests/fixtures/version-incremental-upload",
);

export interface IncrementalReleaseFixtureFile extends UploadFileMetadataInput {
	readonly fixturePath: string;
}

export function incrementalReleaseFixtureDirectory(
	version: IncrementalReleaseVersion,
): string {
	return resolve(fixtureRoot, version, "release");
}

export function loadIncrementalReleaseFixture(
	version: IncrementalReleaseVersion,
): readonly IncrementalReleaseFixtureFile[] {
	return RELEASE_FILES[version].map((path) => {
		const fixturePath = resolve(
			incrementalReleaseFixtureDirectory(version),
			path,
		);
		const contents = readFileSync(fixturePath);
		return {
			fixturePath,
			mimeType: "text/plain",
			path: `release/${path}`,
			sha256: createHash("sha256").update(contents).digest("hex"),
			size: String(contents.byteLength),
		};
	});
}

export const SCALE_RELEASE_FILE_COUNT = 10_001;

export function createScaleReleaseMetadata(
	count = SCALE_RELEASE_FILE_COUNT,
): readonly UploadFileMetadataInput[] {
	return Array.from({ length: count }, (_, index) => ({
		mimeType: "application/octet-stream",
		path: `release/file-${String(index).padStart(5, "0")}.bin`,
		sha256: index.toString(16).padStart(64, "0"),
		size: String(index + 1),
	}));
}
