import { afterEach, describe, expect, it, vi } from "vitest";

import {
	EnvironmentValidationError,
	readAuthEnvironment,
	readBootstrapAdminEnvironment,
	readDatabaseEnvironment,
	readOssEnvironment,
	readPublicApiEnvironment,
	readSentryRuntimeEnvironment,
	readSentrySourceMapEnvironment,
} from "./env.server";

const VALID_AUTH_SECRET = "N7x2qV9mK4pR8sT5wY3zA6cD1fG0hJ+L";

afterEach(() => {
	vi.unstubAllEnvs();
});

function getValidationError(action: () => unknown) {
	let thrown: unknown;
	try {
		action();
	} catch (error) {
		thrown = error;
	}

	expect(thrown).toBeInstanceOf(EnvironmentValidationError);
	if (!(thrown instanceof EnvironmentValidationError)) {
		throw thrown ?? new Error("Expected environment validation to fail");
	}
	return thrown;
}

describe("readAuthEnvironment", () => {
	it("accepts a strong secret and localhost HTTP outside production", () => {
		expect(
			readAuthEnvironment({
				BETTER_AUTH_SECRET: VALID_AUTH_SECRET,
				BETTER_AUTH_URL: "http://localhost:3000",
				NODE_ENV: "development",
			}),
		).toEqual({
			betterAuthSecret: VALID_AUTH_SECRET,
			betterAuthUrl: "http://localhost:3000",
		});
	});

	it.each([
		"a".repeat(32),
		"0123456789abcdef".repeat(2),
		"aaaabbbbccccddddeeeeffffgggghhhh",
		"change-me-to-a-secure-secret-value",
		"default-secret-for-local-development-123",
	])("rejects a repeated, default, or low-diversity secret", (secret) => {
		const error = getValidationError(() =>
			readAuthEnvironment({
				BETTER_AUTH_SECRET: secret,
				BETTER_AUTH_URL: "http://localhost:3000",
			}),
		);

		expect(error.variableNames).toEqual(["BETTER_AUTH_SECRET"]);
		expect(error.message).not.toContain(secret);
	});

	it.each([
		{ CONTEXT: undefined, NODE_ENV: "production" },
		{ CONTEXT: "production", NODE_ENV: "development" },
	])("requires HTTPS when either production marker is set", (production) => {
		const error = getValidationError(() =>
			readAuthEnvironment({
				...production,
				BETTER_AUTH_SECRET: VALID_AUTH_SECRET,
				BETTER_AUTH_URL: "http://localhost:3000",
			}),
		);

		expect(error.variableNames).toEqual(["BETTER_AUTH_URL"]);
	});

	it("accepts an HTTPS origin in production", () => {
		expect(
			readAuthEnvironment({
				BETTER_AUTH_SECRET: VALID_AUTH_SECRET,
				BETTER_AUTH_URL: "https://admin.example.com",
				CONTEXT: "production",
			}),
		).toEqual({
			betterAuthSecret: VALID_AUTH_SECRET,
			betterAuthUrl: "https://admin.example.com",
		});
	});

	it("rejects non-local HTTP and redacts the invalid origin", () => {
		const invalidOrigin = "http://admin.example.com";
		const error = getValidationError(() =>
			readAuthEnvironment({
				BETTER_AUTH_SECRET: VALID_AUTH_SECRET,
				BETTER_AUTH_URL: invalidOrigin,
				NODE_ENV: "development",
			}),
		);

		expect(error.variableNames).toEqual(["BETTER_AUTH_URL"]);
		expect(error.message).not.toContain(invalidOrigin);
	});
});

describe("readPublicApiEnvironment", () => {
	it("accepts an empty native/server allowlist", () => {
		expect(readPublicApiEnvironment({})).toEqual({ allowedOrigins: [] });
		expect(
			readPublicApiEnvironment({ PUBLIC_API_ALLOWED_ORIGINS: "   " }),
		).toEqual({ allowedOrigins: [] });
	});

	it("canonicalizes, trims, and deduplicates HTTPS origins", () => {
		expect(
			readPublicApiEnvironment({
				CONTEXT: "production",
				PUBLIC_API_ALLOWED_ORIGINS:
					" https://downloads.example.com/, https://EXAMPLE.com:443,https://downloads.example.com ",
			}),
		).toEqual({
			allowedOrigins: ["https://downloads.example.com", "https://example.com"],
		});
	});

	it("allows localhost HTTP only outside production", () => {
		expect(
			readPublicApiEnvironment({
				NODE_ENV: "development",
				PUBLIC_API_ALLOWED_ORIGINS:
					"http://localhost:3000,http://127.0.0.1:4173,http://[::1]:8080",
			}),
		).toEqual({
			allowedOrigins: [
				"http://localhost:3000",
				"http://127.0.0.1:4173",
				"http://[::1]:8080",
			],
		});

		for (const production of [
			{ NODE_ENV: "production" },
			{ CONTEXT: "production" },
		]) {
			const error = getValidationError(() =>
				readPublicApiEnvironment({
					...production,
					PUBLIC_API_ALLOWED_ORIGINS: "http://localhost:3000",
				}),
			);
			expect(error.variableNames).toEqual(["PUBLIC_API_ALLOWED_ORIGINS"]);
		}
	});

	it.each([
		"http://downloads.example.com",
		"https://user:secret@downloads.example.com",
		"https://downloads.example.com/files",
		"https://downloads.example.com?tenant=one",
		"https://downloads.example.com#fragment",
		"ftp://downloads.example.com",
		"null",
		"*",
		"https://one.example,,https://two.example",
		"https://one.example,",
	])("rejects and redacts an invalid origin list: %s", (value) => {
		const error = getValidationError(() =>
			readPublicApiEnvironment({ PUBLIC_API_ALLOWED_ORIGINS: value }),
		);
		expect(error.variableNames).toEqual(["PUBLIC_API_ALLOWED_ORIGINS"]);
		expect(error.message).not.toContain(value);
	});
});

describe("other server environment readers", () => {
	it("rereads process environment values on every call", () => {
		vi.stubEnv("DATABASE_URL", "postgresql://first.example.com/updater");
		expect(readDatabaseEnvironment()).toEqual({
			databaseUrl: "postgresql://first.example.com/updater",
		});

		vi.stubEnv("DATABASE_URL", "postgres://second.example.com/updater");
		expect(readDatabaseEnvironment()).toEqual({
			databaseUrl: "postgres://second.example.com/updater",
		});
	});

	it("validates and maps bootstrap administrator values", () => {
		expect(
			readBootstrapAdminEnvironment({
				BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
				BOOTSTRAP_ADMIN_NAME: "Updater Administrator",
				BOOTSTRAP_ADMIN_PASSWORD: "temporary-password-123",
			}),
		).toEqual({
			email: "admin@example.com",
			name: "Updater Administrator",
			password: "temporary-password-123",
		});
	});

	it.each([
		"a".repeat(12),
		"Ab3$xY7!qP9#".repeat(2),
		`A1!b2@c3#d4$${"x".repeat(117)}`,
	])("rejects and redacts a weak bootstrap password", (password) => {
		const error = getValidationError(() =>
			readBootstrapAdminEnvironment({
				BOOTSTRAP_ADMIN_EMAIL: "admin@example.com",
				BOOTSTRAP_ADMIN_NAME: "Updater Administrator",
				BOOTSTRAP_ADMIN_PASSWORD: password,
			}),
		);

		expect(error.variableNames).toEqual(["BOOTSTRAP_ADMIN_PASSWORD"]);
		expect(error.message).not.toContain(password);
	});

	it("validates and maps the complete OSS environment group", () => {
		expect(
			readOssEnvironment({
				OSS_ACCESS_KEY_ID: "access-key-id",
				OSS_ACCESS_KEY_SECRET: "access-key-secret",
				OSS_BUCKET: "updater-artifacts",
				OSS_REGION: "cn-hangzhou",
				OSS_STS_ENDPOINT: "sts.cn-hangzhou.aliyuncs.com",
				OSS_UPLOAD_PREFIX: "releases/",
				OSS_UPLOAD_RAM_ROLE_ARN: "acs:ram::123456789:role/updater-upload",
			}),
		).toEqual({
			accessKeyId: "access-key-id",
			accessKeySecret: "access-key-secret",
			bucket: "updater-artifacts",
			region: "cn-hangzhou",
			stsEndpoint: "sts.cn-hangzhou.aliyuncs.com",
			uploadPrefix: "releases/",
			uploadRoleArn: "acs:ram::123456789:role/updater-upload",
		});
	});

	it("validates and maps both Sentry environment groups", () => {
		expect(
			readSentryRuntimeEnvironment({
				SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
				SENTRY_ENVIRONMENT: "production",
			}),
		).toEqual({
			dsn: "https://public@example.ingest.sentry.io/1",
			environment: "production",
		});
		expect(
			readSentrySourceMapEnvironment({
				SENTRY_AUTH_TOKEN: "source-map-token",
				SENTRY_ORG: "example-org",
				SENTRY_PROJECT: "updater-admin",
			}),
		).toEqual({
			authToken: "source-map-token",
			organization: "example-org",
			project: "updater-admin",
		});
	});
});
