import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";

import type { ApiProblem, EntityResult } from "../../../shared/api/common";
import type { SystemSettingsDto } from "../../../shared/api/settings";
import type { SafeSessionView } from "../../auth/session.server";
import {
	SettingsPreconditionRequiredError,
	type SettingsService,
	SettingsStaleWriteError,
	SettingsValidationError,
} from "../../domain/settings.server";
import { ApiRequestContextStore } from "../context.server";
import { mapApiError } from "../problem";
import { createSettingsModule } from "./settings";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const settings: SystemSettingsDto = {
	defaultLocale: "zh-CN",
	defaultPageSize: 20,
	repositoryUrl: "https://github.com/example/updater",
	systemName: "版本管理系统",
};
const entity: EntityResult<SystemSettingsDto> = {
	data: settings,
	etag: 'W/"3"',
};

function service(overrides: Partial<SettingsService> = {}): SettingsService {
	return {
		get: vi.fn(async () => entity),
		update: vi.fn(async () => ({ ...entity, etag: 'W/"4"' as const })),
		...overrides,
	};
}

function testApp(
	settingsService: SettingsService,
	options: { readonly audit?: boolean; readonly session?: boolean } = {},
) {
	const contextStore = new ApiRequestContextStore();
	const getSettingsService = vi.fn(() => settingsService);
	const app = new Elysia({ normalize: false })
		.onError((context) =>
			mapApiError(context, {
				getRequestId: (request) =>
					contextStore.getRequestId(request) ?? "req_fallback",
			}),
		)
		.onRequest(({ request }) => {
			contextStore.initialize(request, "req_settings");
			if (options.session !== false) {
				contextStore.setSession(request, {} as SafeSessionView);
			}
			if (options.audit !== false) {
				contextStore.setAudit(request, {
					actorId: ACTOR_ID,
					ip: "203.0.113.8",
					requestId: "req_settings",
					userAgent: "test",
				});
			}
		})
		.use(createSettingsModule({ contextStore, getSettingsService }));
	return { app, getSettingsService };
}

async function readProblem(response: Response): Promise<ApiProblem> {
	expect(response.headers.get("content-type")).toBe("application/problem+json");
	return (await response.json()) as ApiProblem;
}

describe("settings Elysia module", () => {
	it("does not resolve its service during module construction", () => {
		const { getSettingsService } = testApp(service());
		expect(getSettingsService).not.toHaveBeenCalled();
	});

	it("returns the fixed public singleton contract and its ETag", async () => {
		const get = vi.fn(async () => entity);
		const { app } = testApp(service({ get }));

		const response = await app.handle(
			new Request("http://localhost/settings/system"),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("etag")).toBe('W/"3"');
		expect(await response.json()).toEqual(settings);
		expect(get).toHaveBeenCalledOnce();
	});

	it("forwards the exact X-Updater-If-Match, body, and audit context on update", async () => {
		const update = vi.fn(async () => ({
			data: {
				...settings,
				defaultLocale: "en" as const,
				defaultPageSize: 50 as const,
			},
			etag: 'W/"4"' as const,
		}));
		const { app } = testApp(service({ update }));
		const body = {
			defaultLocale: "en",
			defaultPageSize: 50,
			repositoryUrl: null,
			systemName: "Updater Admin",
		} as const;

		const response = await app.handle(
			new Request("http://localhost/settings/system", {
				body: JSON.stringify(body),
				headers: {
					"content-type": "application/json",
					"x-updater-if-match": 'W/"3"',
				},
				method: "PATCH",
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("etag")).toBe('W/"4"');
		expect(update).toHaveBeenCalledWith(
			'W/"3"',
			body,
			expect.objectContaining({
				actorId: ACTOR_ID,
				requestId: "req_settings",
			}),
		);
	});

	it("admits a domain-valid non-BMP system name through transport schemas", async () => {
		const unicodeSettings: SystemSettingsDto = {
			...settings,
			systemName: "🚀".repeat(128),
		};
		const update = vi.fn(async () => ({
			data: unicodeSettings,
			etag: 'W/"4"' as const,
		}));
		const { app } = testApp(service({ update }));

		const response = await app.handle(
			new Request("http://localhost/settings/system", {
				body: JSON.stringify(unicodeSettings),
				headers: {
					"content-type": "application/json",
					"x-updater-if-match": 'W/"3"',
				},
				method: "PATCH",
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(unicodeSettings);
	});

	it("maps validation, missing-precondition, and stale-write problems", async () => {
		const cases = [
			{
				code: "VALIDATION_FAILED",
				error: new SettingsValidationError([
					{ code: "INVALID_URL", path: "repositoryUrl" },
				]),
				fieldErrors: [{ code: "INVALID_URL", path: "repositoryUrl" }],
				status: 422,
			},
			{
				code: "PRECONDITION_REQUIRED",
				error: new SettingsPreconditionRequiredError(),
				status: 428,
			},
			{
				code: "STALE_WRITE",
				error: new SettingsStaleWriteError(),
				status: 409,
			},
		] as const;

		for (const testCase of cases) {
			const { app } = testApp(
				service({
					update: async () => {
						throw testCase.error;
					},
				}),
			);
			const response = await app.handle(
				new Request("http://localhost/settings/system", {
					body: JSON.stringify(settings),
					headers: {
						"content-type": "application/json",
						"x-updater-if-match": 'W/"3"',
					},
					method: "PATCH",
				}),
			);
			const problem = await readProblem(response);
			expect(response.status).toBe(testCase.status);
			expect(problem).toMatchObject({
				code: testCase.code,
				...("fieldErrors" in testCase
					? { fieldErrors: testCase.fieldErrors }
					: {}),
				requestId: "req_settings",
			});
		}
	});

	it("rejects invalid enums, missing fields, and extra properties before service resolution", async () => {
		const invalidBodies = [
			{ ...settings, defaultLocale: "fr" },
			{ ...settings, defaultPageSize: 25 },
			{ defaultLocale: "en", defaultPageSize: 20, systemName: "Missing URL" },
			{ ...settings, extra: true },
		];

		for (const body of invalidBodies) {
			const { app, getSettingsService } = testApp(service());
			const response = await app.handle(
				new Request("http://localhost/settings/system", {
					body: JSON.stringify(body),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				}),
			);
			expect(response.status).toBe(422);
			expect(getSettingsService).not.toHaveBeenCalled();
		}
	});

	it("requires session and mutation audit context before service resolution", async () => {
		const missingSession = testApp(service(), { session: false });
		const read = await missingSession.app.handle(
			new Request("http://localhost/settings/system"),
		);
		expect(read.status).toBe(500);
		expect(missingSession.getSettingsService).not.toHaveBeenCalled();

		const missingAudit = testApp(service(), { audit: false });
		const write = await missingAudit.app.handle(
			new Request("http://localhost/settings/system", {
				body: JSON.stringify(settings),
				headers: { "content-type": "application/json" },
				method: "PATCH",
			}),
		);
		expect(write.status).toBe(500);
		expect(missingAudit.getSettingsService).not.toHaveBeenCalled();
	});
});
