import { createIsomorphicFn } from "@tanstack/solid-start";

import type {
	ApiProblem,
	EntityResult,
	FieldError,
	WeakEntityTag,
} from "../../shared/api/common";
import {
	isWellFormedUnicode,
	parseWeakEntityTag,
	UPDATER_IF_MATCH_HEADER,
} from "../../shared/api/common";

export type ApiMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
export type ApiPath = `/api/v1${string}`;
export type ApiFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export interface ApiRequestOptions {
	readonly body?: unknown;
	readonly ifMatch?: WeakEntityTag;
	readonly method?: ApiMethod;
	readonly signal?: AbortSignal;
}

export interface ApiClient {
	entity<T>(
		path: ApiPath,
		options?: ApiRequestOptions,
	): Promise<EntityResult<T>>;
	json<T>(path: ApiPath, options?: ApiRequestOptions): Promise<T>;
	noContent(path: ApiPath, options?: ApiRequestOptions): Promise<void>;
}

const INTERNAL_URL_BASE = "https://updater-admin.invalid";
const MAX_API_PATH_LENGTH = 8_192;
const MAX_PROBLEM_BYTES = 32 * 1_024;
const MAX_JSON_BYTES = 8 * 1_024 * 1_024;
const MAX_FIELD_ERRORS = 100;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const PROBLEM_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const ENCODED_CONTROL_CHARACTER_PATTERN = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;

interface ParsedJson {
	readonly ok: boolean;
	readonly value?: unknown;
}

export class ApiProblemError extends Error {
	readonly code: string;
	readonly problem: ApiProblem;
	readonly requestId: string;
	readonly status: number;

	constructor(problem: ApiProblem) {
		super(problem.code);
		this.name = "ApiProblemError";
		this.code = problem.code;
		this.problem = problem;
		this.requestId = problem.requestId;
		this.status = problem.status;
	}
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 32 || codePoint === 127;
	});
}

function requireSafeApiPath(path: string): void {
	if (
		path.length === 0 ||
		path.length > MAX_API_PATH_LENGTH ||
		path !== path.trim() ||
		path.startsWith("//") ||
		path.includes("\\") ||
		path.includes("#") ||
		hasControlCharacter(path) ||
		ENCODED_CONTROL_CHARACTER_PATTERN.test(path)
	) {
		throw new TypeError(
			"API path must be a canonical same-origin /api/v1 path.",
		);
	}

	let parsed: URL;
	try {
		parsed = new URL(path, INTERNAL_URL_BASE);
	} catch {
		throw new TypeError(
			"API path must be a canonical same-origin /api/v1 path.",
		);
	}

	const inApiNamespace =
		parsed.pathname === "/api/v1" || parsed.pathname.startsWith("/api/v1/");
	const canonical = `${parsed.pathname}${parsed.search}`;
	if (
		parsed.origin !== INTERNAL_URL_BASE ||
		!inApiNamespace ||
		parsed.pathname.includes("%") ||
		canonical !== path
	) {
		throw new TypeError(
			"API path must be a canonical same-origin /api/v1 path.",
		);
	}
}

function isWeakEntityTag(value: unknown): value is WeakEntityTag {
	return parseWeakEntityTag(value) !== null;
}

function createRequestInit(options: ApiRequestOptions): RequestInit {
	const method = options.method ?? "GET";
	const hasBody = options.body !== undefined;
	if (method === "GET" && hasBody) {
		throw new TypeError("GET requests cannot carry a JSON body.");
	}
	if (options.ifMatch !== undefined && !isWeakEntityTag(options.ifMatch)) {
		throw new TypeError(
			"The precondition token must be an exact weak entity tag.",
		);
	}

	const headers = new Headers({ Accept: "application/json" });
	if (hasBody) headers.set("Content-Type", "application/json");
	if (options.ifMatch !== undefined) {
		// Netlify's proxy consumes the standard If-Match request header before
		// invoking Functions. Use an application-owned header while retaining
		// standard ETag response headers for entity version discovery.
		headers.set(UPDATER_IF_MATCH_HEADER, options.ifMatch);
	}

	return {
		...(hasBody ? { body: JSON.stringify(options.body) } : {}),
		...(method === "GET" ? { cache: "no-store" as const } : {}),
		credentials: "include",
		headers,
		method,
		...(options.signal ? { signal: options.signal } : {}),
	};
}

function isJsonResponse(response: Response): boolean {
	const contentType = response.headers.get("content-type");
	if (!contentType) return false;
	const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
	return (
		mediaType === "application/json" ||
		mediaType === "application/problem+json" ||
		Boolean(mediaType?.endsWith("+json"))
	);
}

async function cancelBody(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// Releasing a malformed response is best effort only.
	}
}

async function readBoundedText(
	response: Response,
	maximumBytes: number,
): Promise<null | string> {
	const contentLength = response.headers.get("content-length");
	if (contentLength && /^\d+$/.test(contentLength)) {
		const declaredBytes = Number(contentLength);
		if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maximumBytes) {
			await cancelBody(response);
			return null;
		}
	}
	if (!response.body) return null;

	const reader = response.body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let byteCount = 0;
	let text = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			byteCount += value.byteLength;
			if (byteCount > maximumBytes) {
				await reader.cancel();
				return null;
			}
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
		return text;
	} catch {
		try {
			await reader.cancel();
		} catch {
			// The parse result remains invalid even if cancellation also fails.
		}
		return null;
	} finally {
		reader.releaseLock();
	}
}

async function parseBoundedJson(
	response: Response,
	maximumBytes: number,
): Promise<ParsedJson> {
	if (!isJsonResponse(response)) {
		await cancelBody(response);
		return { ok: false };
	}
	const text = await readBoundedText(response, maximumBytes);
	if (text === null || text.length === 0) return { ok: false };
	try {
		return { ok: true, value: JSON.parse(text) as unknown };
	} catch {
		return { ok: false };
	}
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(
	value: unknown,
	minimumLength: number,
	maximumLength: number,
): value is string {
	return (
		typeof value === "string" &&
		value.length >= minimumLength &&
		value.length <= maximumLength &&
		isWellFormedUnicode(value)
	);
}

function isSafeProblemType(value: unknown): value is string {
	if (!isBoundedString(value, 1, 512) || hasControlCharacter(value)) {
		return false;
	}
	try {
		const parsed = new URL(value);
		return parsed.protocol === "https:" || value === "about:blank";
	} catch {
		return false;
	}
}

function parseFieldErrors(value: unknown): null | readonly FieldError[] {
	if (!Array.isArray(value) || value.length > MAX_FIELD_ERRORS) return null;
	const fieldErrors: FieldError[] = [];
	for (const candidate of value) {
		if (!isRecord(candidate)) return null;
		const { code, path } = candidate;
		if (
			!isBoundedString(code, 1, 128) ||
			!PROBLEM_CODE_PATTERN.test(code) ||
			!isBoundedString(path, 1, 512) ||
			hasControlCharacter(path)
		) {
			return null;
		}
		fieldErrors.push({ code, path });
	}
	return fieldErrors;
}

function sanitizeProblem(
	value: unknown,
	responseStatus: number,
): ApiProblem | null {
	if (!isRecord(value)) return null;
	const {
		code,
		detail,
		fieldErrors,
		requestId,
		retryAfterSeconds,
		status,
		title,
	} = value;
	if (
		!isBoundedString(code, 1, 128) ||
		!PROBLEM_CODE_PATTERN.test(code) ||
		!isBoundedString(requestId, 1, 128) ||
		!REQUEST_ID_PATTERN.test(requestId) ||
		!Number.isInteger(status) ||
		status !== responseStatus ||
		status < 400 ||
		status > 599 ||
		!isBoundedString(title, 1, 256) ||
		hasControlCharacter(title) ||
		!isSafeProblemType(value.type) ||
		(detail !== undefined && !isBoundedString(detail, 0, 2_048)) ||
		(retryAfterSeconds !== undefined &&
			(typeof retryAfterSeconds !== "number" ||
				!Number.isSafeInteger(retryAfterSeconds) ||
				retryAfterSeconds < 1))
	) {
		return null;
	}

	let sanitizedFieldErrors: readonly FieldError[] | undefined;
	if (fieldErrors !== undefined) {
		const parsedFieldErrors = parseFieldErrors(fieldErrors);
		if (parsedFieldErrors === null) return null;
		sanitizedFieldErrors = parsedFieldErrors;
	}

	return {
		code,
		...(detail === undefined ? {} : { detail }),
		...(sanitizedFieldErrors === undefined
			? {}
			: { fieldErrors: sanitizedFieldErrors }),
		requestId,
		...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
		status,
		title,
		type: value.type,
	};
}

function safeRequestId(response: Response): string {
	const requestId = response.headers.get("x-request-id");
	return requestId && REQUEST_ID_PATTERN.test(requestId)
		? requestId
		: "unavailable";
}

function invalidResponseProblem(response: Response): ApiProblem {
	return {
		code: "INVALID_RESPONSE",
		requestId: safeRequestId(response),
		status:
			response.status >= 400 && response.status <= 599 ? response.status : 500,
		title: "Request failed",
		type: "about:blank",
	};
}

async function problemFromResponse(response: Response): Promise<ApiProblem> {
	const parsed = await parseBoundedJson(response, MAX_PROBLEM_BYTES);
	if (parsed.ok) {
		const problem = sanitizeProblem(parsed.value, response.status);
		if (problem) return problem;
	}
	return invalidResponseProblem(response);
}

async function jsonFromResponse<T>(response: Response): Promise<T> {
	const parsed = await parseBoundedJson(response, MAX_JSON_BYTES);
	if (!parsed.ok) throw new ApiProblemError(invalidResponseProblem(response));
	return parsed.value as T;
}

const defaultFetch: ApiFetch = createIsomorphicFn()
	.client((input: RequestInfo | URL, init?: RequestInit) =>
		globalThis.fetch(input, init),
	)
	.server(async (input: RequestInfo | URL, init?: RequestInit) => {
		// Vitest transforms this module through the SSR pipeline even for jsdom
		// suites. Keep their explicitly stubbed browser transport available;
		// deployed SSR continues through the request-scoped Elysia bridge below.
		if (import.meta.env.MODE === "test") return globalThis.fetch(input, init);
		const { fetchApiOnServer } = await import("./default-fetch.server");
		return fetchApiOnServer(input, init);
	});

export function createApiClient(fetcher: ApiFetch = defaultFetch): ApiClient {
	const request = async (path: ApiPath, options: ApiRequestOptions = {}) => {
		requireSafeApiPath(path);
		const response = await fetcher(path, createRequestInit(options));
		if (!response.ok) {
			throw new ApiProblemError(await problemFromResponse(response));
		}
		return response;
	};

	return {
		async entity<T>(path: ApiPath, options?: ApiRequestOptions) {
			const response = await request(path, options);
			const etag = response.headers.get("etag");
			if (!isWeakEntityTag(etag)) {
				await cancelBody(response);
				throw new ApiProblemError(invalidResponseProblem(response));
			}
			return { data: await jsonFromResponse<T>(response), etag };
		},
		async json<T>(path: ApiPath, options?: ApiRequestOptions) {
			return jsonFromResponse<T>(await request(path, options));
		},
		async noContent(path: ApiPath, options?: ApiRequestOptions) {
			const response = await request(path, options);
			if (response.status !== 204) {
				await cancelBody(response);
				throw new ApiProblemError(invalidResponseProblem(response));
			}
		},
	};
}

export const apiClient = createApiClient();
