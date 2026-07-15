import process from "node:process";

import * as Sentry from "@sentry/node";

import {
	normalizeObservabilityRoute,
	scrubObservabilityEvent,
} from "../../../shared/security/redact";
import {
	type EnvironmentSource,
	readSentryRuntimeEnvironment,
} from "../../env.server";

export interface ServerErrorContext {
	readonly actorId?: string;
	readonly requestId: string;
	readonly route: string;
}

export function createServerSentryOptions(source: EnvironmentSource) {
	if (!source.SENTRY_DSN?.trim()) return null;
	const environment = readSentryRuntimeEnvironment(source);

	return {
		beforeSend(event) {
			return scrubObservabilityEvent(event) as unknown as typeof event;
		},
		dsn: environment.dsn,
		enabled: true,
		environment: environment.environment,
		release:
			source.COMMIT_REF?.trim() || source.SENTRY_RELEASE?.trim() || undefined,
		sendDefaultPii: false,
		tracesSampleRate: 0,
	} satisfies Parameters<typeof Sentry.init>[0];
}

type ServerSentryClient = Pick<
	typeof Sentry,
	"captureException" | "flush" | "init" | "withScope"
>;

const initializedClients = new WeakSet<object>();

export function initializeServerSentry(
	source: EnvironmentSource = process.env,
	client: ServerSentryClient = Sentry,
): boolean {
	if (initializedClients.has(client)) return true;
	const options = createServerSentryOptions(source);
	if (!options) return false;

	client.init(options);
	initializedClients.add(client);
	return true;
}

export async function captureServerException(
	error: unknown,
	context: ServerErrorContext,
	source: EnvironmentSource = process.env,
	client: ServerSentryClient = Sentry,
): Promise<void> {
	if (!initializeServerSentry(source, client)) return;

	client.withScope((scope) => {
		scope.setTag("request_id", context.requestId);
		scope.setTag("route", normalizeObservabilityRoute(context.route));
		if (context.actorId) scope.setTag("actor_id", context.actorId);
		client.captureException(error);
	});
	// Netlify may freeze a function immediately after the response. Keep the
	// flush bounded so telemetry is delivered without making reporting a new
	// availability dependency for the sanitized API error response.
	await client.flush(2_000);
}
