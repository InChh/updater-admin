import { describe, expect, it } from "vitest";

import {
	PROGRAMS_PATH,
	PROTECTED_ROUTE_IDS,
	PROTECTED_ROUTE_REGISTRY,
	programVersionsHref,
	programVersionsTabKey,
	resolveProtectedRoute,
	validateReturnTo,
} from "./route-registry";

const PROGRAM_ID = "abcdef12-3456-4abc-8def-1234567890ab";

describe("protected route registry", () => {
	it("contains only the eight approved protected routes and exact paths", () => {
		expect(PROTECTED_ROUTE_IDS).toEqual([
			"programs",
			"programVersions",
			"administrators",
			"monitoringOverview",
			"monitoringAudit",
			"profileSettings",
			"accountSettings",
			"systemSettings",
		]);
		expect(
			Object.fromEntries(
				PROTECTED_ROUTE_IDS.map((routeId) => [
					routeId,
					PROTECTED_ROUTE_REGISTRY[routeId].path,
				]),
			),
		).toEqual({
			accountSettings: "/settings/account",
			administrators: "/administrators",
			monitoringAudit: "/monitoring/audit",
			monitoringOverview: "/monitoring/overview",
			profileSettings: "/settings/profile",
			programVersions: "/programs/$programId/versions",
			programs: "/programs",
			systemSettings: "/settings/system",
		});
		expect(JSON.stringify(PROTECTED_ROUTE_REGISTRY)).not.toContain("dashboard");
	});

	it("resolves static and canonical UUID version routes with current query state", () => {
		expect(resolveProtectedRoute("/administrators?page=2")).toEqual({
			closable: true,
			fallbackTitle: "Administrators",
			href: "/administrators?page=2",
			key: "administrators",
			navGroup: "administrators",
			pageTitleKey: "routes.administrators.pageTitle",
			routeId: "administrators",
			tabTitleKey: "routes.administrators.tabTitle",
		});
		expect(
			resolveProtectedRoute(`${programVersionsHref(PROGRAM_ID)}?page=3`),
		).toMatchObject({
			href: `/programs/${PROGRAM_ID}/versions?page=3`,
			key: programVersionsTabKey(PROGRAM_ID),
			programId: PROGRAM_ID,
			routeId: "programVersions",
		});
	});

	it("accepts only registered canonical internal return targets", () => {
		expect(validateReturnTo("/monitoring/audit?page=4")).toBe(
			"/monitoring/audit?page=4",
		);
		expect(validateReturnTo(programVersionsHref(PROGRAM_ID))).toBe(
			programVersionsHref(PROGRAM_ID),
		);

		for (const maliciousOrInvalid of [
			undefined,
			null,
			"",
			"https://attacker.example/programs",
			"//attacker.example/programs",
			"/\\attacker.example/programs",
			" /administrators",
			"/administrators\n",
			"/login",
			"/",
			"/api/v1/programs",
			"/demo/store",
			"/dashboard",
			"/administrators#secret",
			"/programs/../administrators",
			"/programs/%2e%2e/administrators",
			"/programs%2f..%2fadministrators",
			"/programs/%00/versions",
			"/administrators?filter=%0a",
			`/programs?query=${"x".repeat(2048)}`,
			`/programs/${PROGRAM_ID.toUpperCase()}/versions`,
			`/programs/${PROGRAM_ID}/versions/`,
		]) {
			expect(validateReturnTo(maliciousOrInvalid)).toBe(PROGRAMS_PATH);
		}
	});

	it("rejects noncanonical program IDs before constructing hrefs or keys", () => {
		expect(() => programVersionsHref(PROGRAM_ID.toUpperCase())).toThrow(
			"canonical lowercase UUID",
		);
		expect(() => programVersionsTabKey("not-a-uuid")).toThrow(
			"canonical lowercase UUID",
		);
	});
});
