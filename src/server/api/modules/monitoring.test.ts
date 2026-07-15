import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";

import type { ApiProblem } from "../../../shared/api/common";
import type {
	MonitoringStatusDto,
	TimeSeries,
} from "../../../shared/api/monitoring";
import type { SafeSessionView } from "../../auth/session.server";
import {
	type MonitoringService,
	MonitoringValidationError,
} from "../../domain/monitoring.server";
import { ApiRequestContextStore } from "../context.server";
import { mapApiError } from "../problem";
import { createMonitoringModule } from "./monitoring";

const status: MonitoringStatusDto = {
	application: {
		buildId: "deploy-42",
		commitRef: "abcdef",
		environment: "deploy-preview",
		name: "updater-admin",
		version: "1.2.3",
	},
	checkedAt: "2026-07-15T02:00:00.000Z",
	dependencies: {
		neon: {
			checkedAt: "2026-07-15T02:00:00.000Z",
			latencyMs: 4,
			status: "ready",
		},
		ossSts: {
			checkedAt: "2026-07-15T02:00:00.000Z",
			latencyMs: 20,
			status: "ready",
		},
	},
	metrics: {
		activeVersions: 3,
		files: 5,
		programs: 2,
		status: "ready",
		totalBytes: "9007199254740993",
		versions: 4,
	},
	recentOperations: {
		items: [
			{
				action: "version.created",
				actorId: "00000000-0000-4000-8000-000000000001",
				createdAt: "2026-07-15T01:00:00.000Z",
				id: "00000000-0000-4000-8000-000000000010",
				resourceId: "00000000-0000-4000-8000-000000000020",
				resourceType: "version",
				result: "success",
			},
		],
		status: "ready",
	},
	status: "ready",
};

const series: TimeSeries = {
	from: "2026-07-09",
	interval: "day",
	points: [
		{ bucket: "2026-07-09", value: 1 },
		{ bucket: "2026-07-10", value: 0 },
	],
	to: "2026-07-10",
	total: 1,
};

function service(
	overrides: Partial<MonitoringService> = {},
): MonitoringService {
	return {
		getReleaseSeries: vi.fn(async () => series),
		getStatus: vi.fn(async () => status),
		...overrides,
	};
}

function testApp(
	monitoringService: MonitoringService,
	options: { readonly session?: boolean } = {},
) {
	const contextStore = new ApiRequestContextStore();
	const getMonitoringService = vi.fn(() => monitoringService);
	const app = new Elysia({ normalize: false })
		.onError((context) =>
			mapApiError(context, {
				getRequestId: (request) =>
					contextStore.getRequestId(request) ?? "req_fallback",
			}),
		)
		.onRequest(({ request }) => {
			contextStore.initialize(request, "req_monitoring");
			if (options.session !== false) {
				contextStore.setSession(request, {} as SafeSessionView);
			}
		})
		.use(createMonitoringModule({ contextStore, getMonitoringService }));
	return { app, getMonitoringService };
}

async function readProblem(response: Response): Promise<ApiProblem> {
	expect(response.headers.get("content-type")).toBe("application/problem+json");
	return (await response.json()) as ApiProblem;
}

describe("monitoring Elysia module", () => {
	it("keeps dependencies lazy, memoizes the service, and returns authenticated status", async () => {
		const getStatus = vi.fn(async () => status);
		const { app, getMonitoringService } = testApp(service({ getStatus }));
		expect(getMonitoringService).not.toHaveBeenCalled();

		for (const requestNumber of [1, 2]) {
			const response = await app.handle(
				new Request("http://localhost/monitoring/status"),
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toEqual(status);
			expect(JSON.stringify(body)).not.toContain("accessKey");
			expect(getStatus).toHaveBeenCalledTimes(requestNumber);
		}
		expect(getMonitoringService).toHaveBeenCalledOnce();
	});

	it("forwards only 7, 30, and 90 day release windows with a 30 day default", async () => {
		const getReleaseSeries = vi.fn(async () => series);
		const { app } = testApp(service({ getReleaseSeries }));

		for (const [suffix, days] of [
			["", 30],
			["?days=7", 7],
			["?days=90", 90],
		] as const) {
			const response = await app.handle(
				new Request(`http://localhost/monitoring/release-series${suffix}`),
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual(series);
			expect(getReleaseSeries).toHaveBeenLastCalledWith({ days });
		}
	});

	it("returns a degraded status as a successful bounded contract", async () => {
		const degraded: MonitoringStatusDto = {
			...status,
			dependencies: {
				neon: { ...status.dependencies.neon, status: "degraded" },
				ossSts: { ...status.dependencies.ossSts, status: "degraded" },
			},
			metrics: {
				activeVersions: null,
				files: null,
				programs: null,
				status: "degraded",
				totalBytes: null,
				versions: null,
			},
			recentOperations: { items: [], status: "degraded" },
			status: "degraded",
		};
		const { app } = testApp(service({ getStatus: async () => degraded }));
		const response = await app.handle(
			new Request("http://localhost/monitoring/status"),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(degraded);
	});

	it("rejects invalid windows and extra query properties before service work", async () => {
		for (const url of [
			"http://localhost/monitoring/release-series?days=14",
			"http://localhost/monitoring/release-series?days=7&project=sentry",
		]) {
			const { app, getMonitoringService } = testApp(service());
			const response = await app.handle(new Request(url));
			expect(response.status).toBe(422);
			expect(getMonitoringService).not.toHaveBeenCalled();
		}
	});

	it("maps domain validation and requires a session", async () => {
		const validationApp = testApp(
			service({
				getReleaseSeries: async () => {
					throw new MonitoringValidationError([
						{ code: "INVALID_VALUE", path: "days" },
					]);
				},
			}),
		);
		const invalid = await validationApp.app.handle(
			new Request("http://localhost/monitoring/release-series"),
		);
		const problem = await readProblem(invalid);
		expect(invalid.status).toBe(422);
		expect(problem).toMatchObject({
			code: "VALIDATION_FAILED",
			fieldErrors: [{ code: "INVALID_VALUE", path: "days" }],
			requestId: "req_monitoring",
		});

		const missingSession = testApp(service(), { session: false });
		const response = await missingSession.app.handle(
			new Request("http://localhost/monitoring/status"),
		);
		expect(response.status).toBe(500);
		expect(missingSession.getMonitoringService).not.toHaveBeenCalled();
	});
});
