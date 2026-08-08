import ignore from "ignore";

import { normalizeUploadPath } from "../../shared/uploads/path";

export const DEFAULT_UPLOAD_EXCLUSION_ENTRIES = [
	"lib/acad.dat",
	"lib/sysdir.txt",
	"lib/tm.shx",
	"UpdaterTemp/",
	"logs/",
	"workdir",
] as const;

export const DEFAULT_UPLOAD_EXCLUSIONS =
	DEFAULT_UPLOAD_EXCLUSION_ENTRIES.join("\n");

export interface UploadExclusionConfig {
	getValue(): string;
	setValue(value: string): void;
}

export type UploadExclusionMatcher = ReturnType<typeof ignore>;

export function createUploadExclusionConfig(
	initialValue = DEFAULT_UPLOAD_EXCLUSIONS,
): UploadExclusionConfig {
	let value = initialValue;
	return {
		getValue: () => value,
		setValue: (nextValue) => {
			value = nextValue;
		},
	};
}

/**
 * Compiles root-relative GitIgnore rules. The library preserves ordered
 * negation, comments, directory rules, and *, **, and ? wildcard semantics.
 */
export function parseUploadExclusions(value: string): UploadExclusionMatcher {
	return ignore({ ignorecase: true }).add(value);
}

export function uploadPathMatchesExclusion(
	path: string,
	matcher: UploadExclusionMatcher,
): boolean {
	const normalizedPath = normalizeUploadPath(path);
	return matcher.ignores(normalizedPath);
}
