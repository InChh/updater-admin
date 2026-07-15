import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => {
	const scopeSetTag = vi.fn();
	return {
		captureException: vi.fn(),
		init: vi.fn(),
		scopeSetTag,
		setTag: vi.fn(),
		withScope: vi.fn(
			(callback: (scope: { setTag: typeof scopeSetTag }) => void) => {
				callback({ setTag: scopeSetTag });
			},
		),
	};
});

vi.mock("@sentry/solid", () => sentry);

import {
	captureBrowserException,
	createBrowserSentryOptions,
	extractSentryRequestId,
	initializeBrowserSentry,
	normalizeSentryActorId,
	normalizeSentryRoute,
	setBrowserSentryActor,
} from "./sentry.client";

describe("browser Sentry configuration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("stays disabled when the public DSN is absent", () => {
		expect(
			createBrowserSentryOptions({ environment: "test", release: "commit" }),
		).toBeNull();
	});

	it("enables scrubbed, PII-free reporting when configured", () => {
		const options = createBrowserSentryOptions({
			dsn: "https://public@example.ingest.sentry.io/1",
			environment: "production",
			release: "commit-123",
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
				message: "password=secret",
				request: {
					headers: { authorization: "Bearer secret" },
					url: "https://admin.example.com/programs?email=private",
				},
			} as never),
		).toEqual({
			message: "[REDACTED]",
			request: { url: "https://admin.example.com/programs" },
		});
	});

	it("removes record identifiers from route tags", () => {
		expect(
			normalizeSentryRoute(
				"/programs/3a1c5d9c-db70-4b51-9034-5678a3a6bde3/versions/42",
			),
		).toBe("/programs/:id/versions/:number");
	});

	it("accepts only bounded opaque actor identifiers", () => {
		expect(normalizeSentryActorId("admin_opaque-1.2:3")).toBe(
			"admin_opaque-1.2:3",
		);
		expect(normalizeSentryActorId("admin@example.com")).toBeNull();
		expect(normalizeSentryActorId("unsafe\nactor")).toBeNull();
		expect(normalizeSentryActorId("a".repeat(129))).toBeNull();
	});

	it("extracts only validated request IDs from ApiProblem-like errors", () => {
		expect(extractSentryRequestId({ requestId: "req_safe-1" })).toBe(
			"req_safe-1",
		);
		expect(
			extractSentryRequestId({ problem: { requestId: "req_nested:2" } }),
		).toBe("req_nested:2");
		expect(
			extractSentryRequestId({ requestId: "private@example.com" }),
		).toBeNull();
		expect(extractSentryRequestId({ requestId: "unsafe\nrequest" })).toBeNull();

		const hostile = Object.defineProperty({}, "requestId", {
			get() {
				throw new Error("hostile getter");
			},
		});
		expect(extractSentryRequestId(hostile)).toBeNull();
	});

	it("uses aligned actor_id and request_id tags without user PII", () => {
		vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
		vi.stubGlobal("__SENTRY_ENVIRONMENT__", "deploy-preview");
		vi.stubGlobal("__SENTRY_RELEASE__", "commit-123");

		expect(initializeBrowserSentry()).toBe(true);
		sentry.setTag.mockClear();

		setBrowserSentryActor("admin_opaque-1");
		setBrowserSentryActor(null);
		captureBrowserException({ requestId: "req_safe-1" });

		expect(sentry.setTag).toHaveBeenNthCalledWith(
			1,
			"actor_id",
			"admin_opaque-1",
		);
		expect(sentry.setTag).toHaveBeenNthCalledWith(2, "actor_id", undefined);
		expect(sentry.scopeSetTag).toHaveBeenCalledWith("request_id", "req_safe-1");
		expect(sentry.scopeSetTag).not.toHaveBeenCalledWith(
			expect.anything(),
			"admin@example.com",
		);
	});
});
