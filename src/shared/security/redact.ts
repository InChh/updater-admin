export type RedactedJsonValue =
	| null
	| boolean
	| number
	| string
	| RedactedJsonValue[]
	| { [key: string]: RedactedJsonValue };

export const REDACTION_MARKER = "[REDACTED]";
export const CIRCULAR_REFERENCE_MARKER = "[Circular]";

const uuidPathSegment =
	/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;

export function normalizeObservabilityRoute(pathname: string): string {
	const normalized = pathname
		.replaceAll(uuidPathSegment, "/:id")
		.replaceAll(/\/\d+(?=\/|$)/g, "/:number");
	return normalized || "/";
}

const sensitiveKeyFragments = [
	"password",
	"passwd",
	"authorization",
	"cookie",
	"session",
	"token",
	"secret",
	"credential",
	"accesskey",
	"apikey",
	"privatekey",
	"signature",
] as const;

const highConfidenceSecretPatterns = [
	/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/iu,
	/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|LTAI[A-Za-z0-9]{12,})\b/u,
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
	/\b(?:security[\s_.-]*token|access[\s_.-]*key(?:[\s_.-]*(?:id|secret))?|client[\s_.-]*secret|api[\s_.-]*key|refresh[\s_.-]*token|session[\s_.-]*token)\b\s+(?:is\s+|was\s+)?(?=[A-Za-z0-9._~+/=-]{8,}\b)(?=[^\s]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]+\b/iu,
] as const;

/** Detects credential text even when a provider omits a `key=value` delimiter. */
export function containsHighConfidenceSecretText(value: string): boolean {
	return highConfidenceSecretPatterns.some((pattern) => pattern.test(value));
}

function normalizeKey(key: string) {
	return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function keyTokens(key: string) {
	return key
		.replaceAll(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

function isSensitiveKey(key: string) {
	const normalized = normalizeKey(key);
	if (normalized === "mustchangepassword") return false;

	return (
		sensitiveKeyFragments.some((fragment) => normalized.includes(fragment)) ||
		keyTokens(key).includes("sts")
	);
}

function hasSensitiveUrlParameter(parameters: URLSearchParams) {
	for (const [key, value] of parameters) {
		if (isSensitiveKey(key) || containsHighConfidenceSecretText(value))
			return true;
	}
	return false;
}

function fragmentParameters(url: URL): URLSearchParams | undefined {
	const fragment = url.hash.slice(1);
	if (!fragment) return undefined;
	const queryIndex = fragment.indexOf("?");
	return new URLSearchParams(
		queryIndex === -1 ? fragment : fragment.slice(queryIndex + 1),
	);
}

function parseHttpUrl(value: string) {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:"
			? url
			: undefined;
	} catch {
		if (!/^(?:\/{1,2}|\.\.?\/|\?)/.test(value)) return undefined;

		try {
			return new URL(value, "https://redaction.invalid");
		} catch {
			return undefined;
		}
	}
}

export function isSensitiveUrl(value: string): boolean {
	const url = parseHttpUrl(value);
	if (!url) return false;
	const hashParameters = fragmentParameters(url);
	return (
		Boolean(url.username || url.password) ||
		hasSensitiveUrlParameter(url.searchParams) ||
		(hashParameters !== undefined && hasSensitiveUrlParameter(hashParameters))
	);
}

function defineJsonProperty(
	target: Record<string, RedactedJsonValue>,
	key: string,
	value: RedactedJsonValue,
) {
	Object.defineProperty(target, key, {
		configurable: true,
		enumerable: true,
		value,
		writable: true,
	});
}

function redactValue(
	value: unknown,
	ancestors: WeakSet<object>,
): RedactedJsonValue {
	if (value === null) return null;

	switch (typeof value) {
		case "string":
			return isSensitiveUrl(value) ? REDACTION_MARKER : value;
		case "boolean":
			return value;
		case "number":
			return Number.isFinite(value) ? value : null;
		case "bigint":
			return value.toString();
		case "undefined":
		case "symbol":
		case "function":
			return null;
	}

	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.toISOString();
	}

	if (ancestors.has(value)) return CIRCULAR_REFERENCE_MARKER;
	ancestors.add(value);

	try {
		if (Array.isArray(value)) {
			return Array.from({ length: value.length }, (_, index) =>
				redactValue(value[index], ancestors),
			);
		}

		const source = value as Record<string, unknown>;
		const clone: Record<string, RedactedJsonValue> = {};
		for (const key of Object.keys(source)) {
			defineJsonProperty(
				clone,
				key,
				isSensitiveKey(key)
					? REDACTION_MARKER
					: redactValue(source[key], ancestors),
			);
		}
		return clone;
	} finally {
		ancestors.delete(value);
	}
}

export function redactSensitiveData(value: unknown): RedactedJsonValue {
	return redactValue(value, new WeakSet());
}

function isRecord(value: RedactedJsonValue): value is {
	[key: string]: RedactedJsonValue;
} {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripUrlQuery(value: string): string {
	if (value === REDACTION_MARKER) return value;
	const queryIndex = value.indexOf("?");
	const hashIndex = value.indexOf("#");
	const end = [queryIndex, hashIndex]
		.filter((index) => index >= 0)
		.reduce((lowest, index) => Math.min(lowest, index), value.length);
	return value.slice(0, end);
}

function scrubObservabilityUrl(value: string): string {
	const stripped = stripUrlQuery(value);
	if (stripped === REDACTION_MARKER) return stripped;

	try {
		const url = new URL(stripped);
		url.pathname = normalizeObservabilityRoute(url.pathname);
		return url.toString();
	} catch {
		return normalizeObservabilityRoute(stripped);
	}
}

/**
 * Applies the common recursive redactor and then removes request payloads and
 * other free-form Sentry fields that cannot be proven PII-free. Stack frames,
 * stable tags, route names and request IDs remain available for diagnostics.
 */
export function scrubObservabilityEvent(value: unknown): RedactedJsonValue {
	const redacted = redactSensitiveData(value);
	if (!isRecord(redacted)) return redacted;

	delete redacted.breadcrumbs;
	delete redacted.extra;
	if (typeof redacted.message === "string") {
		redacted.message = REDACTION_MARKER;
	}
	if (typeof redacted.transaction === "string") {
		redacted.transaction = normalizeObservabilityRoute(
			stripUrlQuery(redacted.transaction),
		);
	}

	const request = redacted.request;
	if (isRecord(request)) {
		delete request.cookies;
		delete request.data;
		delete request.env;
		delete request.headers;
		delete request.query_string;
		if (typeof request.url === "string") {
			request.url = scrubObservabilityUrl(request.url);
		}
	}

	const user = redacted.user;
	if (isRecord(user) && typeof user.id === "string") {
		redacted.user = { id: user.id };
	} else {
		delete redacted.user;
	}

	const exception = redacted.exception;
	if (isRecord(exception) && Array.isArray(exception.values)) {
		for (const exceptionValue of exception.values) {
			if (!isRecord(exceptionValue)) continue;
			if (typeof exceptionValue.value === "string") {
				exceptionValue.value = REDACTION_MARKER;
			}
			const stacktrace = exceptionValue.stacktrace;
			if (!isRecord(stacktrace) || !Array.isArray(stacktrace.frames)) continue;
			for (const frame of stacktrace.frames) {
				if (isRecord(frame)) delete frame.vars;
			}
		}
	}

	return redacted;
}
