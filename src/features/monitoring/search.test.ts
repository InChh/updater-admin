import { describe, expect, it } from "vitest";

import {
	auditListLoaderDeps,
	auditListSearch,
	closeAuditDetail,
	openAuditDetail,
	validateAuditRouteSearch,
	validateMonitoringRouteSearch,
} from "./search";

const EVENT_ID = "00000000-0000-4000-8000-000000000010";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";

describe("monitoring route search", () => {
	it("whitelists release windows", () => {
		expect(validateMonitoringRouteSearch({ days: "7" })).toEqual({ days: 7 });
		expect(validateMonitoringRouteSearch({ days: 14 })).toEqual({ days: 30 });
	});

	it("preserves omitted audit pageSize while normalizing explicit invalid input", () => {
		const omitted = validateAuditRouteSearch({
			page: 1,
			sort: "createdAt:desc",
		});
		expect(omitted).not.toHaveProperty("pageSize");
		expect(auditListLoaderDeps(omitted)).not.toHaveProperty("pageSize");
		expect(
			validateAuditRouteSearch({
				page: 1,
				pageSize: undefined,
				sort: "createdAt:desc",
			}),
		).toMatchObject({ pageSize: 20 });
	});

	it("keeps only bounded audit list values and a canonical detail ID", () => {
		const result = validateAuditRouteSearch({
			action: "program.updated",
			actorId: ACTOR_ID,
			auditEventId: EVENT_ID,
			from: "2026-07-01",
			page: "2",
			pageSize: "50",
			resourceType: "program",
			result: "success",
			sort: "createdAt:asc",
			to: "2026-07-15",
		});
		expect(result).toEqual({
			action: "program.updated",
			actorId: ACTOR_ID,
			auditEventId: EVENT_ID,
			from: "2026-07-01",
			page: 2,
			pageSize: 50,
			resourceType: "program",
			result: "success",
			sort: "createdAt:asc",
			to: "2026-07-15",
		});
	});

	it("falls back for malformed and reversed audit filters", () => {
		expect(
			validateAuditRouteSearch({
				action: "database.dump",
				actorId: "not-an-id",
				from: "2026-07-20",
				page: 0,
				pageSize: 25,
				resourceType: "credential",
				result: "pending",
				sort: "action:asc",
				to: "2026-07-01",
			}),
		).toEqual({ page: 1, pageSize: 20, sort: "createdAt:desc" });
	});

	it("opens and closes details without changing the list cache identity", () => {
		const list = {
			page: 3,
			pageSize: 20,
			result: "failure",
			sort: "createdAt:desc",
		} as const;
		const opened = openAuditDetail(list, EVENT_ID);
		expect(opened.auditEventId).toBe(EVENT_ID);
		expect(auditListSearch(opened)).toEqual(list);
		expect(closeAuditDetail(opened)).toEqual(list);
	});
});
