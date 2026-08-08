import { readdir, rm } from "node:fs/promises";

async function removeSourceMaps(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	await Promise.all(
		entries.map((entry) => {
			const target = new URL(entry.name, directory);
			if (entry.isDirectory()) {
				return removeSourceMaps(new URL(`${entry.name}/`, directory));
			}
			if (entry.isFile() && entry.name.endsWith(".map")) return rm(target);
			return undefined;
		}),
	);
}

await removeSourceMaps(new URL("../dist/", import.meta.url));
