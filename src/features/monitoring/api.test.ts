import { afterEach, describe, expect, it, vi } from "vitest";

import {
	getAuditEvent,
	getMonitoringStatus,
	getReleaseSeries,
	listAuditEvents,
} from "./api";

const EVENT_ID = "00000000-0000-4000-8000-000000000010";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";

afterEach(() => vi.unstubAllGlobals());

describe("monitoring API client", () => {
	it("uses same-origin status and release-series endpoints", async () => {
		const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
			Response.json({ interval: "day", points: [] }),
		);
		vi.stubGlobal("fetch", fetcher);

		await getMonitoringStatus();
		await getReleaseSeries(90);

		expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/monitoring/status");
		expect(fetcher.mock.calls[1]?.[0]).toBe(
			"/api/v1/monitoring/release-series?days=90",
		);
	});

	it("serializes only normalized audit filters", async () => {
		const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
			Response.json({ items: [], page: 2, pageSize: 50, total: 0 }),
		);
		vi.stubGlobal("fetch", fetcher);

		await listAuditEvents({
			action: "program.updated",
			actorId: ACTOR_ID,
			from: "2026-07-01",
			page: 2,
			pageSize: 50,
			resourceType: "program",
			result: "failure",
			sort: "createdAt:asc",
			to: "2026-07-15",
		});

		const path = String(fetcher.mock.calls[0]?.[0]);
		const url = new URL(path, "https://example.invalid");
		expect(url.pathname).toBe("/api/v1/audit-events");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			action: "program.updated",
			actorId: ACTOR_ID,
			from: "2026-07-01",
			page: "2",
			pageSize: "50",
			resourceType: "program",
			result: "failure",
			sort: "createdAt:asc",
			to: "2026-07-15",
		});
	});

	it("requires a canonical detail ID before fetching", async () => {
		const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
			Response.json({ id: EVENT_ID }),
		);
		vi.stubGlobal("fetch", fetcher);
		expect(() => getAuditEvent("not-an-id")).toThrow(TypeError);
		expect(fetcher).not.toHaveBeenCalled();

		await getAuditEvent(EVENT_ID);
		expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/audit-events/${EVENT_ID}`);
	});
});
