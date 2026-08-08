import { describe, expect, it, vi } from "vitest";

import type { PublicReleaseManifestDto } from "../../shared/api/public-releases";
import type { PublicReleasesService } from "../domain/public-releases.server";
import { createApiApp } from "./app.server";

const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";
const PATH = `/api/public/v1/programs/${PROGRAM_ID}/releases/latest`;
const manifest: PublicReleaseManifestDto = {
	description: "Desktop release",
	downloadExpiresAt: "2026-07-20T02:05:00.000Z",
	files: [
		{
			checksumAlgorithm: "sha256",
			downloadUrl: "https://bucket.example/app.bin?x-oss-signature=short-lived",
			mimeType: "application/octet-stream",
			path: "app.bin",
			sha256: "a".repeat(64),
			size: "42",
		},
	],
	programId: PROGRAM_ID,
	programName: "Desktop",
	publishedAt: "2026-07-20T01:00:00.000Z",
	versionNumber: "10.2.3",
};

function publicService(
	overrides: Partial<PublicReleasesService> = {},
): PublicReleasesService {
	return {
		getByVersionNumber: vi.fn(async () => manifest),
		getLatest: vi.fn(async () => manifest),
		...overrides,
	};
}

function publicDependencies(service: PublicReleasesService = publicService()) {
	const consumeRateLimit = vi.fn(async () => ({
		allowed: true,
		count: 1,
		limit: 120,
		remaining: 119,
		resetAt: new Date("2026-07-20T02:01:00.000Z"),
		retryAfterSeconds: 60,
	}));
	const getPublicReleasesService = vi.fn(() => service);
	const getSession = vi.fn(async () => null);
	const getCanonicalOrigin = vi.fn(() => {
		throw new Error("Admin origin dependency must remain isolated.");
	});
	const appendFailureAudit = vi.fn(async () => {
		throw new Error("Admin audit dependency must remain isolated.");
	});
	return {
		appendFailureAudit,
		consumeRateLimit,
		generateRequestId: () => "req_public-app",
		getCanonicalOrigin,
		getPublicApiAllowedOrigins: () => ["https://consumer.example"],
		getPublicReleasesService,
		getSession,
		now: () => new Date("2026-07-20T02:00:00.000Z"),
	};
}

describe("public release API app integration", () => {
	it("mounts the anonymous manifest outside every administrator guard", async () => {
		const dependencies = publicDependencies();
		const app = createApiApp(dependencies);
		const response = await app.handle(new Request(`http://localhost${PATH}`));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(manifest);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("x-request-id")).toBe("req_public-app");
		expect(dependencies.getPublicReleasesService).toHaveBeenCalledOnce();
		expect(dependencies.getSession).not.toHaveBeenCalled();
		expect(dependencies.getCanonicalOrigin).not.toHaveBeenCalled();
		expect(dependencies.appendFailureAudit).not.toHaveBeenCalled();
	});

	it("keeps health independent of all public environment, DB, and service work", async () => {
		const forbidden = vi.fn(() => {
			throw new Error("Health touched a public dependency.");
		});
		const app = createApiApp({
			consumeRateLimit: forbidden,
			generateRequestId: () => "req_test",
			getPublicApiAllowedOrigins: forbidden,
			getPublicReleasesService: forbidden,
		});

		const response = await app.handle(new Request("http://localhost/health"));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "ok" });
		expect(forbidden).not.toHaveBeenCalled();
	});

	it("does not weaken the existing administrator session boundary", async () => {
		const dependencies = publicDependencies();
		const app = createApiApp(dependencies);
		const response = await app.handle(
			new Request("http://localhost/api/v1/programs"),
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({
			code: "UNAUTHENTICATED",
			status: 401,
		});
		expect(dependencies.getSession).toHaveBeenCalledOnce();
		expect(dependencies.getPublicReleasesService).not.toHaveBeenCalled();
		expect(dependencies.consumeRateLimit).not.toHaveBeenCalled();
	});

	it("rejects a disallowed browser origin before rate limit or manifest work", async () => {
		const dependencies = publicDependencies();
		const app = createApiApp(dependencies);
		const response = await app.handle(
			new Request(`http://localhost${PATH}`, {
				headers: { origin: "https://attacker.example" },
			}),
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			code: "FORBIDDEN",
			status: 403,
		});
		expect(dependencies.consumeRateLimit).not.toHaveBeenCalled();
		expect(dependencies.getPublicReleasesService).not.toHaveBeenCalled();
		expect(dependencies.getSession).not.toHaveBeenCalled();
	});

	it("sanitizes public service failures while preserving allowlisted CORS", async () => {
		const secret = "x-oss-signature=must-not-escape";
		const dependencies = publicDependencies(
			publicService({
				getLatest: async () => {
					throw new Error(secret);
				},
			}),
		);
		const reportInternalError = vi.fn();
		const app = createApiApp({ ...dependencies, reportInternalError });
		const response = await app.handle(
			new Request(`http://localhost${PATH}`, {
				headers: { origin: "https://consumer.example" },
			}),
		);
		const text = await response.text();

		expect(response.status).toBe(500);
		expect(text).toContain("INTERNAL_ERROR");
		expect(text).not.toContain(secret);
		expect(response.headers.get("access-control-allow-origin")).toBe(
			"https://consumer.example",
		);
		expect(reportInternalError).toHaveBeenCalledWith(
			expect.any(Error),
			"req_public-app",
		);
	});
});
