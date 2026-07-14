export type RedactedJsonValue =
	| null
	| boolean
	| number
	| string
	| RedactedJsonValue[]
	| { [key: string]: RedactedJsonValue };

export const REDACTION_MARKER = "[REDACTED]";
export const CIRCULAR_REFERENCE_MARKER = "[Circular]";

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

function hasSignedUrlQueryMarker(url: URL) {
	for (const key of url.searchParams.keys()) {
		const normalized = normalizeKey(key);
		if (
			normalized.includes("credential") ||
			normalized.includes("signature") ||
			normalized.includes("securitytoken") ||
			normalized.endsWith("accesskeyid")
		) {
			return true;
		}
	}

	return false;
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

function isSensitiveUrl(value: string) {
	const url = parseHttpUrl(value);
	if (!url) return false;
	return Boolean(url.username || url.password) || hasSignedUrlQueryMarker(url);
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
