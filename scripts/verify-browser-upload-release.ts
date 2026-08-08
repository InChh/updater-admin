import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import process from "node:process";

import type { PublicReleaseManifestDto } from "../src/shared/api/public-releases";

const root =
	process.env.BROWSER_UPLOAD_FIXTURE_ROOT ??
	"/private/tmp/updater-browser-upload-root";
const programId = process.env.BROWSER_ACCEPTANCE_PROGRAM_ID;
const apiOrigin = process.env.BROWSER_ACCEPTANCE_API_ORIGIN ?? "http://localhost:3000";

if (!programId) {
	throw new Error("BROWSER_ACCEPTANCE_PROGRAM_ID is required.");
}

interface ExpectedFile {
	readonly path: string;
	readonly sha256: string;
	readonly size: string;
}

async function collectFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const children = await Promise.all(
		entries.map(async (entry) => {
			const path = join(directory, entry.name);
			return entry.isDirectory() ? collectFiles(path) : [path];
		}),
	);
	return children.flat();
}

async function describeFile(path: string): Promise<ExpectedFile> {
	const [contents, metadata] = await Promise.all([readFile(path), stat(path)]);
	return {
		path: relative(root, path).split(sep).join("/"),
		sha256: createHash("sha256").update(contents).digest("hex"),
		size: String(metadata.size),
	};
}

function originalPath(index: number): string {
	return [
		`group-${String(index % 20).padStart(2, "0")}`,
		`nested-${String(Math.floor(index / 20) % 10).padStart(2, "0")}`,
		`file-${String(index).padStart(4, "0")}.bin`,
	].join("/");
}

const paths = await collectFiles(root);
const expected = await Promise.all(paths.map(describeFile));
const expectedByPath = new Map(expected.map((file) => [file.path, file] as const));
if (expectedByPath.size !== 1_950) {
	throw new Error(`Expected 1,950 fixture files, got ${expectedByPath.size}.`);
}

const startedAt = Date.now();
const response = await fetch(
	`${apiOrigin}/api/public/v1/programs/${programId}/releases/latest`,
	{
		headers: { accept: "application/json" },
		signal: AbortSignal.timeout(120_000),
	},
);
if (!response.ok) {
	throw new Error(`Public API returned ${response.status}: ${await response.text()}`);
}
const manifest = (await response.json()) as PublicReleaseManifestDto;
if (manifest.programId !== programId || manifest.versionNumber !== "2.0.0") {
	throw new Error(
		`Unexpected release ${manifest.programId}/${manifest.versionNumber}.`,
	);
}
if (manifest.files.length !== expectedByPath.size) {
	throw new Error(
		`Expected ${expectedByPath.size} manifest files, got ${manifest.files.length}.`,
	);
}

const observedPaths = new Set<string>();
for (const file of manifest.files) {
	if (observedPaths.has(file.path)) {
		throw new Error(`Duplicate manifest path: ${file.path}.`);
	}
	observedPaths.add(file.path);
	const segments = file.path.split("/");
	if (
		file.path.startsWith("/") ||
		file.path.includes("\\") ||
		segments.some((segment) => !segment || segment === "." || segment === "..") ||
		segments[0] === basename(root)
	) {
		throw new Error(`Manifest path includes the selected root: ${file.path}.`);
	}
	const expectedFile = expectedByPath.get(file.path);
	if (
		!expectedFile ||
		file.sha256 !== expectedFile.sha256 ||
		file.size !== expectedFile.size ||
		file.checksumAlgorithm !== "sha256"
	) {
		throw new Error(`Manifest metadata mismatch: ${file.path}.`);
	}
	if (new URL(file.downloadUrl).protocol !== "https:") {
		throw new Error(`Manifest download URL is not HTTPS: ${file.path}.`);
	}
}

const deletedPaths = Array.from({ length: 60 }, (_, index) => originalPath(index));
if (deletedPaths.some((path) => observedPaths.has(path))) {
	throw new Error("A file deleted before the second upload remains in the manifest.");
}
const modifiedPaths = Array.from({ length: 5 }, (_, offset) =>
	originalPath(160 + offset),
);
if (modifiedPaths.some((path) => !observedPaths.has(path))) {
	throw new Error("A modified file is missing from the manifest.");
}
const addedPaths = Array.from({ length: 10 }, (_, index) =>
	[
		"added",
		`set-${String(index % 3).padStart(2, "0")}`,
		`new-${String(index).padStart(4, "0")}.bin`,
	].join("/"),
);
if (addedPaths.some((path) => !observedPaths.has(path))) {
	throw new Error("A file added before the second upload is missing from the manifest.");
}

process.stdout.write(
	`${JSON.stringify({
		addedFilesVerified: addedPaths.length,
		deletedFilesVerified: deletedPaths.length,
		fileCount: manifest.files.length,
		latestVersion: manifest.versionNumber,
		modifiedFilesVerified: modifiedPaths.length,
		requestDurationMs: Date.now() - startedAt,
		rootDirectoryExcluded: true,
		uniqueRelativePaths: observedPaths.size,
	})}\n`,
);
