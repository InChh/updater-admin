import { expect, test } from "@playwright/test";

import type {
	AuditEventDetailDto,
	AuditEventListItemDto,
} from "../../src/shared/api/audit";
import type {
	MonitoringStatusDto,
	TimeSeries,
} from "../../src/shared/api/monitoring";
import {
	AUTHENTICATED_E2E_SKIP_REASON,
	fulfillJson,
	HAS_E2E_ADMIN_CREDENTIALS,
	signIn,
} from "./support";

const AUDIT_EVENT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const CHECKED_AT = "2026-07-15T04:00:00.000Z";

const AUDIT_EVENT: AuditEventListItemDto = {
	action: "program.updated",
	actorId: ACTOR_ID,
	createdAt: CHECKED_AT,
	id: AUDIT_EVENT_ID,
	resourceId: "33333333-3333-4333-8333-333333333333",
	resourceType: "program",
	result: "success",
};

const AUDIT_DETAIL: AuditEventDetailDto = {
	...AUDIT_EVENT,
	after: { name: "Current program" },
	before: { name: "Previous program" },
	ip: "192.0.2.10",
	requestId: "e2e-audit-request",
	userAgent: "Playwright fixture",
};

const MONITORING_STATUS: MonitoringStatusDto = {
	application: {
		buildId: "e2e-build",
		commitRef: "e2e-commit",
		environment: "e2e",
		name: "updater-admin",
		version: "1.0.0",
	},
	checkedAt: CHECKED_AT,
	dependencies: {
		neon: { checkedAt: CHECKED_AT, latencyMs: 12, status: "ready" },
		ossSts: { checkedAt: CHECKED_AT, latencyMs: 18, status: "ready" },
	},
	metrics: {
		activeVersions: 3,
		files: 5,
		programs: 2,
		status: "ready",
		totalBytes: "2048",
		versions: 4,
	},
	recentOperations: { items: [AUDIT_EVENT], status: "ready" },
	status: "ready",
};

function releaseSeries(days: number): TimeSeries {
	return {
		from: "2026-07-13",
		interval: "day",
		points: [
			{ bucket: "2026-07-13", value: 1 },
			{ bucket: "2026-07-14", value: 0 },
			{ bucket: "2026-07-15", value: days === 90 ? 4 : 2 },
		],
		to: "2026-07-15",
		total: days === 90 ? 5 : 3,
	};
}

test.describe("monitoring and audit", () => {
	test.skip(!HAS_E2E_ADMIN_CREDENTIALS, AUTHENTICATED_E2E_SKIP_REASON);

	test("renders chart-ready monitoring data and read-only audit detail fixtures", async ({
		page,
	}) => {
		const requestedSeriesDays: string[] = [];
		const requestedAuditSearches: URLSearchParams[] = [];

		await page.route("**/api/v1/monitoring/**", async (route) => {
			const url = new URL(route.request().url());
			if (url.pathname === "/api/v1/monitoring/status") {
				await fulfillJson(route, MONITORING_STATUS);
				return;
			}
			if (url.pathname === "/api/v1/monitoring/release-series") {
				const days = url.searchParams.get("days") ?? "30";
				requestedSeriesDays.push(days);
				await fulfillJson(route, releaseSeries(Number(days)));
				return;
			}
			await route.continue();
		});

		await page.route("**/api/v1/audit-events**", async (route) => {
			const url = new URL(route.request().url());
			if (url.pathname === `/api/v1/audit-events/${AUDIT_EVENT_ID}`) {
				await fulfillJson(route, AUDIT_DETAIL);
				return;
			}
			if (url.pathname === "/api/v1/audit-events") {
				requestedAuditSearches.push(new URLSearchParams(url.searchParams));
				await fulfillJson(route, {
					items: [AUDIT_EVENT],
					page: Number(url.searchParams.get("page") ?? 1),
					pageSize: Number(url.searchParams.get("pageSize") ?? 20),
					total: 1,
				});
				return;
			}
			await route.continue();
		});

		await signIn(page);
		await page.goto("/monitoring/overview?days=7");
		await expect(
			page.getByRole("heading", {
				level: 1,
				name: /监控概览|Monitoring overview/,
			}),
		).toBeVisible();
		await expect(
			page.getByRole("img", { name: /发布趋势|Release trend/ }),
		).toBeVisible();
		await page.getByText(/查看发布数据表格|View release data table/).click();
		await expect(
			page.getByRole("table", { name: /每日发布数量|Daily release counts/ }),
		).toBeVisible();
		await page.getByRole("button", { name: /90 天|90 days/ }).click();
		await expect.poll(() => requestedSeriesDays.at(-1)).toBe("90");
		expect(new URL(page.url()).searchParams.get("days")).toBe("90");

		await page.goto(
			"/monitoring/audit?page=1&pageSize=20&sort=createdAt%3Adesc&result=success",
		);
		await expect(
			page.getByRole("heading", { level: 1, name: /审计记录|Audit events/ }),
		).toBeVisible();
		const auditTable = page.getByRole("table", {
			name: /审计事件|Audit events/,
		});
		await expect(auditTable).toBeVisible();
		await expect(
			auditTable.getByText(AUDIT_EVENT.action, { exact: true }),
		).toBeVisible();
		await expect
			.poll(() => requestedAuditSearches.at(-1)?.get("result"))
			.toBe("success");

		const detailButton = auditTable.getByRole("button", {
			name: new RegExp(
				`查看审计事件 ${AUDIT_EVENT_ID} 的详情|View details for audit event ${AUDIT_EVENT_ID}`,
			),
		});
		await detailButton.click();
		const dialog = page.getByRole("dialog");
		await expect(
			dialog.getByRole("heading", {
				name: /审计事件详情|Audit event details/,
			}),
		).toBeVisible();
		await expect(
			dialog.getByText(AUDIT_DETAIL.requestId, { exact: true }),
		).toBeVisible();
		await dialog
			.getByRole("button", { name: /关闭|Close/, exact: true })
			.last()
			.click();
		await expect(dialog).toHaveCount(0);
		await expect(detailButton).toBeFocused();
	});
});
