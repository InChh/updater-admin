export const VERSION_COMPONENT_MAX = 2_147_483_647;
export const VERSION_NUMBER_MAX_LENGTH = 20;

const CANONICAL_VERSION_NUMBER_PATTERN =
	/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export interface VersionTriplet {
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
}

export interface ParsedVersionNumber extends VersionTriplet {
	readonly normalized: string;
}

/**
 * Parses the database's canonical numeric version representation.
 *
 * Both the PostgreSQL int4 component bound and varchar(20) display bound are
 * enforced here so a value accepted by the domain always fits the schema.
 */
export function parseVersionNumber(value: unknown): ParsedVersionNumber | null {
	if (typeof value !== "string" || value.length > VERSION_NUMBER_MAX_LENGTH) {
		return null;
	}

	const match = CANONICAL_VERSION_NUMBER_PATTERN.exec(value);
	if (!match?.[1] || !match[2] || !match[3]) return null;

	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	if (
		![major, minor, patch].every(
			(component) =>
				Number.isSafeInteger(component) &&
				component >= 0 &&
				component <= VERSION_COMPONENT_MAX,
		)
	) {
		return null;
	}

	return {
		major,
		minor,
		normalized: `${major}.${minor}.${patch}`,
		patch,
	};
}

/** Numeric lexicographic comparison, independent of display-string ordering. */
export function compareVersionNumbers(
	left: VersionTriplet,
	right: VersionTriplet,
): -1 | 0 | 1 {
	for (const component of ["major", "minor", "patch"] as const) {
		if (left[component] > right[component]) return 1;
		if (left[component] < right[component]) return -1;
	}
	return 0;
}
