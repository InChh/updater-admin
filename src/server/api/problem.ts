import type { ValidationError } from "elysia";

import type {
	ApiProblem,
	FieldError,
	WeakEntityTag,
} from "../../shared/api/common";

export type ApiProblemStatus = 400 | 401 | 403 | 404 | 409 | 422 | 428 | 429;

const PROBLEM_TITLES: Readonly<Record<string, string>> = {
	BAD_REQUEST: "The request could not be parsed",
	FORBIDDEN: "The requested action is not allowed",
	INTERNAL_ERROR: "An unexpected server error occurred",
	NOT_FOUND: "The requested resource was not found",
	PRECONDITION_REQUIRED: "A current entity tag is required",
	RATE_LIMITED: "Too many requests",
	STALE_WRITE: "The resource changed since it was loaded",
	UNAUTHENTICATED: "Authentication is required",
	VALIDATION_FAILED: "One or more fields are invalid",
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

function problemType(code: string): string {
	return `https://updater-admin.local/problems/${code
		.toLowerCase()
		.replaceAll("_", "-")}`;
}

function normalizeValidationPath(path: string): string {
	if (!path || path === "/") return "$";
	return path
		.replace(/^\//, "")
		.split("/")
		.map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
		.join(".");
}

function validationFieldErrors(error: ValidationError): readonly FieldError[] {
	const paths = new Set<string>();
	for (const item of error.all) {
		paths.add(
			normalizeValidationPath(item.path).slice(0, MAX_FIELD_PATH_LENGTH),
		);
		if (paths.size >= MAX_FIELD_ERRORS) break;
	}
	if (paths.size === 0) paths.add("$");
	return [...paths].map((path) => ({ code: "INVALID_VALUE", path }));
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
	if (context.error instanceof ApiProblemError) {
		const problem = createProblem(requestId, context.error);
		return jsonProblem(problem, context.error.headers);
	}

	if (context.code === "PARSE") {
		return jsonProblem(
			createProblem(requestId, { code: "BAD_REQUEST", status: 400 }),
		);
	}

	if (context.code === "VALIDATION") {
		const validationError = context.error as ValidationError;
		if (validationError.type !== "response") {
			return jsonProblem(
				createProblem(requestId, {
					code: "VALIDATION_FAILED",
					fieldErrors: validationFieldErrors(validationError),
					status: 422,
				}),
			);
		}
	}

	if (context.code === "NOT_FOUND") {
		return jsonProblem(
			createProblem(requestId, { code: "NOT_FOUND", status: 404 }),
		);
	}

	try {
		await dependencies.reportInternalError?.(context.error, requestId);
	} catch {
		// Reporting is observability only. A reporter outage must not replace the
		// deterministic, sanitized response at the API trust boundary.
	}
	return jsonProblem(
		createProblem(requestId, { code: "INTERNAL_ERROR", status: 500 }),
	);
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
