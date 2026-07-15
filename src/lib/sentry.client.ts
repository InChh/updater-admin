import * as Sentry from "@sentry/solid";

import {
	normalizeObservabilityRoute,
	scrubObservabilityEvent,
} from "../shared/security/redact";

export interface BrowserSentrySource {
	readonly dsn?: string;
	readonly environment: string;
	readonly release?: string;
}

const SENTRY_SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SENTRY_ACTOR_TAG = "actor_id";
const SENTRY_REQUEST_TAG = "request_id";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function safeRecordValue(
	record: Record<string, unknown>,
	key: string,
): unknown {
	try {
		return record[key];
	} catch {
		return undefined;
	}
}

function normalizeSentryIdentifier(value: unknown): string | null {
	return typeof value === "string" && SENTRY_SAFE_IDENTIFIER_PATTERN.test(value)
		? value
		: null;
}

export function normalizeSentryActorId(actorId: unknown): string | null {
	return normalizeSentryIdentifier(actorId);
}

export function extractSentryRequestId(error: unknown): string | null {
	if (!isRecord(error)) return null;

	const direct = normalizeSentryIdentifier(safeRecordValue(error, "requestId"));
	if (direct) return direct;

	const problem = safeRecordValue(error, "problem");
	return isRecord(problem)
		? normalizeSentryIdentifier(safeRecordValue(problem, "requestId"))
		: null;
}

export function normalizeSentryRoute(pathname: string): string {
	return normalizeObservabilityRoute(pathname);
}

export function createBrowserSentryOptions(source: BrowserSentrySource) {
	const dsn = source.dsn?.trim();
	if (!dsn) return null;

	return {
		beforeSend(event) {
			return scrubObservabilityEvent(event) as unknown as typeof event;
		},
		dsn,
		enabled: true,
		environment: source.environment,
		release: source.release?.trim() || undefined,
		sendDefaultPii: false,
		tracesSampleRate: 0,
	} satisfies Parameters<typeof Sentry.init>[0];
}

let initialized = false;

export function initializeBrowserSentry(): boolean {
	if (typeof window === "undefined") return false;
	if (initialized) return true;

	const options = createBrowserSentryOptions({
		dsn: import.meta.env.VITE_SENTRY_DSN,
		environment: __SENTRY_ENVIRONMENT__,
		release:
			typeof __SENTRY_RELEASE__ === "string" ? __SENTRY_RELEASE__ : undefined,
	});
	if (!options) return false;

	Sentry.init(options);
	initialized = true;
	setBrowserSentryRoute(window.location.pathname);
	return true;
}

export function setBrowserSentryRoute(pathname: string): void {
	if (!initialized) return;
	Sentry.setTag("route", normalizeSentryRoute(pathname));
}

export function setBrowserSentryActor(actorId: string | null): void {
	if (!initializeBrowserSentry()) return;
	Sentry.setTag(SENTRY_ACTOR_TAG, normalizeSentryActorId(actorId) ?? undefined);
}

export function captureBrowserException(error: unknown): void {
	if (!initializeBrowserSentry()) return;
	Sentry.withScope((scope) => {
		scope.setTag("route", normalizeSentryRoute(window.location.pathname));
		const requestId = extractSentryRequestId(error);
		if (requestId) scope.setTag(SENTRY_REQUEST_TAG, requestId);
		Sentry.captureException(error);
	});
}
