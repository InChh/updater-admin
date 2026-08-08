export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type SortDirection = "asc" | "desc";
export type WeakEntityTag = `W/"${bigint}"`;

export const UPDATER_IF_MATCH_HEADER = "X-Updater-If-Match";
export const ROW_VERSION_MAX = 9_223_372_036_854_775_807n;
const WEAK_ENTITY_TAG_PATTERN = /^W\/"([1-9][0-9]{0,18})"$/;

export interface Page<T> {
	readonly items: readonly T[];
	readonly page: number;
	readonly pageSize: number;
	readonly total: number;
}

export interface FieldError {
	readonly code: string;
	readonly path: string;
}

export interface ApiProblem {
	readonly code: string;
	readonly detail?: string;
	readonly fieldErrors?: readonly FieldError[];
	readonly requestId: string;
	readonly retryAfterSeconds?: number;
	readonly status: number;
	readonly title: string;
	readonly type: string;
}

/** Client-side result after the fetch adapter has paired a DTO with its ETag. */
export interface EntityResult<T> {
	readonly data: T;
	readonly etag: WeakEntityTag;
}

/** Returns false for strings containing unpaired UTF-16 surrogate code units. */
export function isWellFormedUnicode(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
			continue;
		}
		if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
	}
	return true;
}

export function parseWeakEntityTag(value: unknown): bigint | null {
	if (typeof value !== "string") return null;
	const match = WEAK_ENTITY_TAG_PATTERN.exec(value);
	if (!match?.[1]) return null;
	const rowVersion = BigInt(match[1]);
	return rowVersion <= ROW_VERSION_MAX ? rowVersion : null;
}

export function formatWeakEntityTag(rowVersion: bigint): WeakEntityTag {
	if (rowVersion < 1n || rowVersion > ROW_VERSION_MAX) {
		throw new RangeError("Row version must fit a positive PostgreSQL int8.");
	}
	return `W/"${rowVersion}"`;
}
