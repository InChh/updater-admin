import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const root =
	process.env.BROWSER_UPLOAD_FIXTURE_ROOT ??
	"/private/tmp/updater-browser-upload-root";
const mode = process.argv[2];

function originalPath(index: number): string {
	return join(
		root,
		`group-${String(index % 20).padStart(2, "0")}`,
		`nested-${String(Math.floor(index / 20) % 10).padStart(2, "0")}`,
		`file-${String(index).padStart(4, "0")}.bin`,
	);
}

async function write(path: string, contents: string): Promise<void> {
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, contents);
}

async function countFiles(path: string): Promise<number> {
	let count = 0;
	for (const entry of await readdir(path, { withFileTypes: true })) {
		count += entry.isDirectory()
			? await countFiles(join(path, entry.name))
			: 1;
	}
	return count;
}

if (mode === "initial") {
	await rm(root, { force: true, recursive: true });
	for (let index = 0; index < 2_000; index += 1) {
		await write(
			originalPath(index),
			`updater-browser-acceptance:${index}:v1\n`,
		);
	}
} else if (mode === "mixed") {
	for (let index = 0; index < 60; index += 1) {
		await rm(originalPath(index));
	}
	for (let index = 160; index < 165; index += 1) {
		await write(
			originalPath(index),
			`updater-browser-acceptance:${index}:v2-modified\n`,
		);
	}
	for (let index = 0; index < 10; index += 1) {
		await write(
			join(
				root,
				"added",
				`set-${String(index % 3).padStart(2, "0")}`,
				`new-${String(index).padStart(4, "0")}.bin`,
			),
			`updater-browser-acceptance:added:${index}\n`,
		);
	}
} else {
	throw new Error('Usage: tsx prepare-browser-upload-fixture.ts "initial|mixed"');
}

process.stdout.write(
	`${JSON.stringify({ fileCount: await countFiles(root), mode, root })}\n`,
);
