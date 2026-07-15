import { describe, expect, it, vi } from "vitest";

import { EnvironmentValidationError } from "../../env.server";
import {
	captureServerException,
	createServerSentryOptions,
} from "./sentry.server";

describe("server Sentry configuration", () => {
	it("stays disabled when the server DSN is absent", () => {
		expect(
			createServerSentryOptions({ SENTRY_ENVIRONMENT: "production" }),
		).toBeNull();
	});

	it("requires a named environment whenever the DSN enables reporting", () => {
		expect(() =>
			createServerSentryOptions({
				SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
			}),
		).toThrowError(EnvironmentValidationError);
	});

	it("builds a scrubbed, PII-free error reporter with the Netlify release", () => {
		const options = createServerSentryOptions({
			COMMIT_REF: "commit-123",
			SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
			SENTRY_ENVIRONMENT: "production",
		});

		expect(options).toMatchObject({
			dsn: "https://public@example.ingest.sentry.io/1",
			environment: "production",
			release: "commit-123",
			sendDefaultPii: false,
			tracesSampleRate: 0,
		});
		expect(
			options?.beforeSend?.({
				extra: { password: "secret" },
				message: "DATABASE_URL=postgresql://user:pass@host/db",
				request: {
					data: { email: "private@example.com" },
					url: "https://admin.example.com/api/v1/programs?name=private",
				},
			} as never),
		).toEqual({
			message: "[REDACTED]",
			request: { url: "https://admin.example.com/api/v1/programs" },
		});
	});

	it("uses the local release override while preferring Netlify COMMIT_REF", () => {
		expect(
			createServerSentryOptions({
				SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
				SENTRY_ENVIRONMENT: "preview",
				SENTRY_RELEASE: "local-release",
			})?.release,
		).toBe("local-release");
		expect(
			createServerSentryOptions({
				COMMIT_REF: "netlify-commit",
				SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
				SENTRY_ENVIRONMENT: "production",
				SENTRY_RELEASE: "local-release",
			})?.release,
		).toBe("netlify-commit");
	});

	it("captures tagged server errors and performs a bounded serverless flush", async () => {
		const setTag = vi.fn();
		const client = {
			captureException: vi.fn(() => "event-id"),
			flush: vi.fn(async () => true),
			init: vi.fn(),
			withScope: vi.fn((callback: (scope: { setTag: typeof setTag }) => void) =>
				callback({ setTag }),
			),
		};
		const error = new Error("failure");

		await captureServerException(
			error,
			{
				actorId: "actor-1",
				requestId: "request-1",
				route: "/api/v1/programs/123",
			},
			{
				SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
				SENTRY_ENVIRONMENT: "production",
			},
			client as never,
		);

		expect(client.init).toHaveBeenCalledOnce();
		expect(setTag).toHaveBeenCalledWith("request_id", "request-1");
		expect(setTag).toHaveBeenCalledWith("route", "/api/v1/programs/:number");
		expect(setTag).toHaveBeenCalledWith("actor_id", "actor-1");
		expect(client.captureException).toHaveBeenCalledWith(error);
		expect(client.flush).toHaveBeenCalledWith(2_000);
	});
});
