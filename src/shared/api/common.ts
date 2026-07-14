export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type SortDirection = "asc" | "desc";
export type WeakEntityTag = `W/"${bigint}"`;

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

export function formatWeakEntityTag(rowVersion: bigint): WeakEntityTag {
	if (rowVersion < 1n) {
		throw new RangeError("Row version must be a positive integer.");
	}
	return `W/"${rowVersion}"`;
}
