import type { ValidationError } from "elysia";

import type {
	ApiProblem,
	FieldError,
	WeakEntityTag,
} from "../../shared/api/common";

export type ApiProblemStatus =
	| 400
	| 401
	| 403
	| 404
	| 409
	| 422
	| 428
	| 429
	| 503;

const PROBLEM_TITLES: Readonly<Record<string, string>> = {
	ADMINISTRATOR_EMAIL_CONFLICT:
		"An administrator with this email already exists",
	BAD_REQUEST: "The request could not be parsed",
	FORBIDDEN: "The requested action is not allowed",
	INTERNAL_ERROR: "An unexpected server error occurred",
	LAST_ADMIN_REQUIRED: "At least one active administrator is required",
	NOT_FOUND: "The requested resource was not found",
	PRECONDITION_REQUIRED: "A current entity tag is required",
	PROGRAM_NAME_CONFLICT: "A program with this name already exists",
	RATE_LIMITED: "Too many requests",
	SELF_DISABLE_FORBIDDEN: "You cannot disable your own administrator account",
	STALE_WRITE: "The resource changed since it was loaded",
	UNAUTHENTICATED: "Authentication is required",
	UPLOAD_CREDENTIALS_UNAVAILABLE:
		"Upload credentials are temporarily unavailable",
	UPLOAD_METADATA_CONFLICT:
		"The uploaded object does not match its metadata proof",
	UPLOAD_OBJECT_NOT_FOUND:
		"The uploaded object was not found at its canonical destination",
	UPLOAD_VERIFICATION_UNAVAILABLE:
		"Upload object verification is temporarily unavailable",
	VALIDATION_FAILED: "One or more fields are invalid",
	VERSION_NOT_GREATER:
		"The version number must be greater than every prior version",
	VERSION_NUMBER_CONFLICT: "A version with this number already exists",
};
const MAX_FIELD_ERRORS = 100;
const MAX_FIELD_PATH_LENGTH = 512;

export class ApiProblemError extends Error {
	readonly code: string;
	readonly detail?: string;
	readonly fieldErrors?: readonly FieldError[];
	readonly headers?: Readonly<Record<string, string>>;
	readonly retryAfterSeconds?: number;
	readonly status: ApiProblemStatus;
	readonly title: string;

	constructor(options: {
		readonly code: string;
		readonly detail?: string;
		readonly fieldErrors?: readonly FieldError[];
		readonly headers?: Readonly<Record<string, string>>;
		readonly retryAfterSeconds?: number;
		readonly status: ApiProblemStatus;
		readonly title?: string;
	}) {
		super(options.code);
		this.name = "ApiProblemError";
		this.code = options.code;
		this.detail = options.detail;
		this.fieldErrors = options.fieldErrors;
		this.headers = options.headers;
		this.retryAfterSeconds = options.retryAfterSeconds;
		this.status = options.status;
		this.title =
			options.title ?? PROBLEM_TITLES[options.code] ?? "Request failed";
	}
}

export interface ApiErrorContext {
	readonly code: number | string;
	readonly error: unknown;
	readonly request: Request;
}

export interface ProblemMapperDependencies {
	getRequestId(request: Request): string;
	reportInternalError?(error: unknown, requestId: string): void | Promise<void>;
}

export interface ClassifiedApiError {
	readonly code: string;
	readonly detail?: string;
	readonly fieldErrors?: readonly FieldError[];
	readonly headers?: Readonly<Record<string, string>>;
	readonly reportInternal: boolean;
	readonly retryAfterSeconds?: number;
	readonly status: number;
	readonly title?: string;
}

function problemType(code: string): string {
	return `https://updater-admin.local/problems/${code
		.toLowerCase()
		.replaceAll("_", "-")}`;
}

function normalizeValidationPath(path: string): string {
	if (!path || path === "/") return "$";
	const decoded = path
		.replace(/^\//, "")
		.split("/")
		.map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
		.join(".");
	let safe = "";
	for (let index = 0; index < decoded.length; index += 1) {
		const codeUnit = decoded.charCodeAt(index);
		let next = decoded[index] ?? "";
		if (codeUnit < 32 || codeUnit === 127) {
			next = "_";
		} else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const trailing = decoded.charCodeAt(index + 1);
			if (trailing >= 0xdc00 && trailing <= 0xdfff) {
				next = decoded.slice(index, index + 2);
				index += 1;
			} else {
				next = "\ufffd";
			}
		} else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			next = "\ufffd";
		}
		if (safe.length + next.length > MAX_FIELD_PATH_LENGTH) break;
		safe += next;
	}
	return safe || "$";
}

function validationFieldErrors(error: ValidationError): readonly FieldError[] {
	const paths = new Set<string>();
	for (const item of error.all) {
		paths.add(normalizeValidationPath(item.path));
		if (paths.size >= MAX_FIELD_ERRORS) break;
	}
	if (paths.size === 0) paths.add("$");
	return [...paths].map((path) => ({ code: "INVALID_VALUE", path }));
}

export function classifyApiError(context: ApiErrorContext): ClassifiedApiError {
	if (context.error instanceof ApiProblemError) {
		return {
			code: context.error.code,
			...(context.error.detail === undefined
				? {}
				: { detail: context.error.detail }),
			...(context.error.fieldErrors === undefined
				? {}
				: { fieldErrors: context.error.fieldErrors }),
			...(context.error.headers === undefined
				? {}
				: { headers: context.error.headers }),
			reportInternal: false,
			...(context.error.retryAfterSeconds === undefined
				? {}
				: { retryAfterSeconds: context.error.retryAfterSeconds }),
			status: context.error.status,
			title: context.error.title,
		};
	}

	if (context.code === "PARSE") {
		return { code: "BAD_REQUEST", reportInternal: false, status: 400 };
	}

	if (context.code === "VALIDATION") {
		const validationError = context.error as ValidationError;
		if (validationError.type !== "response") {
			return {
				code: "VALIDATION_FAILED",
				fieldErrors: validationFieldErrors(validationError),
				reportInternal: false,
				status: 422,
			};
		}
	}

	if (context.code === "NOT_FOUND") {
		return { code: "NOT_FOUND", reportInternal: false, status: 404 };
	}

	return { code: "INTERNAL_ERROR", reportInternal: true, status: 500 };
}

function createProblem(
	requestId: string,
	options: {
		readonly code: string;
		readonly detail?: string;
		readonly fieldErrors?: readonly FieldError[];
		readonly retryAfterSeconds?: number;
		readonly status: number;
		readonly title?: string;
	},
): ApiProblem {
	return {
		code: options.code,
		...(options.detail === undefined ? {} : { detail: options.detail }),
		...(options.fieldErrors === undefined
			? {}
			: { fieldErrors: options.fieldErrors }),
		requestId,
		...(options.retryAfterSeconds === undefined
			? {}
			: { retryAfterSeconds: options.retryAfterSeconds }),
		status: options.status,
		title: options.title ?? PROBLEM_TITLES[options.code] ?? "Request failed",
		type: problemType(options.code),
	};
}

function jsonProblem(
	problem: ApiProblem,
	extraHeaders?: Readonly<Record<string, string>>,
): Response {
	const headers = new Headers({
		"cache-control": "no-store",
		"content-type": "application/problem+json",
		"x-request-id": problem.requestId,
		...extraHeaders,
	});
	return new Response(JSON.stringify(problem), {
		headers,
		status: problem.status,
	});
}

export async function mapApiError(
	context: ApiErrorContext,
	dependencies: ProblemMapperDependencies,
): Promise<Response> {
	const requestId = dependencies.getRequestId(context.request);
	const classified = classifyApiError(context);
	if (classified.reportInternal) {
		try {
			await dependencies.reportInternalError?.(context.error, requestId);
		} catch {
			// Reporting is observability only. A reporter outage must not replace the
			// deterministic, sanitized response at the API trust boundary.
		}
	}
	return jsonProblem(createProblem(requestId, classified), classified.headers);
}

export function requireExactIfMatch(
	ifMatch: string | null,
	currentEtag: WeakEntityTag,
): void {
	if (ifMatch === null) {
		throw new ApiProblemError({
			code: "PRECONDITION_REQUIRED",
			status: 428,
		});
	}
	if (ifMatch !== currentEtag) {
		throw new ApiProblemError({ code: "STALE_WRITE", status: 409 });
	}
}
