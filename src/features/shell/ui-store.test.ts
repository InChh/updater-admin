import { describe, expect, it, vi } from "vitest";

import { programVersionsHref, programVersionsTabKey } from "./route-registry";
import {
	createOpenedTab,
	createShellUiController,
	type OpenTabInput,
	type SessionStorageLike,
	shellUiStorageKey,
} from "./ui-store";

const ACCOUNT_A = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_B = "00000000-0000-4000-8000-000000000002";
const PROGRAM_A = "10000000-0000-4000-8000-000000000001";
const PROGRAM_B = "10000000-0000-4000-8000-000000000002";

class MemorySessionStorage implements SessionStorageLike {
	readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

function tab(
	routeId: OpenTabInput["routeId"],
	href: string,
	title: string,
): OpenTabInput {
	return { href, routeId, title };
}

describe("shell UI store", () => {
	it("starts SSR-safe with only the pinned programs tab", () => {
		const controller = createShellUiController({
			initialLocale: "en",
			storage: null,
		});

		expect(controller.getState()).toEqual({
			accountId: null,
			activeTabKey: "programs",
			hydrated: false,
			locale: "en",
			mobileNavigationOpen: false,
			openedTabs: [
				{
					closable: false,
					href: "/programs",
					key: "programs",
					routeId: "programs",
					title: "Programs",
				},
			],
			sidebarCollapsed: false,
		});
		controller.hydrateForAccount({
			accountId: ACCOUNT_A,
			currentTab: tab("administrators", "/administrators", "Administrators"),
		});
		expect(controller.getState().activeTabKey).toBe("administrators");
		controller.dispose();
	});

	it("opens, activates, deduplicates, and updates each tab's latest href", () => {
		const controller = createShellUiController({ storage: null });
		controller.hydrateForAccount({ accountId: ACCOUNT_A });

		controller.openOrActivateTab(
			tab("administrators", "/administrators?page=1", "Administrators"),
		);
		controller.openOrActivateTab(
			tab("administrators", "/administrators?page=2", "Admin accounts"),
		);
		controller.openOrActivateTab(
			tab("programVersions", programVersionsHref(PROGRAM_A), "Versions · A"),
		);
		controller.openOrActivateTab(
			tab(
				"programVersions",
				`${programVersionsHref(PROGRAM_B)}?page=3`,
				"Versions · B",
			),
		);

		const state = controller.getState();
		expect(state.openedTabs).toHaveLength(4);
		expect(state.openedTabs[1]).toMatchObject({
			href: "/administrators?page=2",
			key: "administrators",
			title: "Admin accounts",
		});
		expect(state.openedTabs.slice(2).map(({ key }) => key)).toEqual([
			`programVersions:${PROGRAM_A}`,
			`programVersions:${PROGRAM_B}`,
		]);
		expect(state.activeTabKey).toBe(`programVersions:${PROGRAM_B}`);
		controller.dispose();
	});

	it("retitles an existing tab without changing activation or its query href", () => {
		const controller = createShellUiController({ storage: null });
		controller.hydrateForAccount({ accountId: ACCOUNT_A });
		controller.openOrActivateTab(
			tab(
				"programVersions",
				`${programVersionsHref(PROGRAM_A)}?page=9&sort=version&direction=desc`,
				"Program versions",
			),
		);
		controller.openOrActivateTab(
			tab("administrators", "/administrators?page=2", "Administrators"),
		);
		const before = controller
			.getState()
			.openedTabs.find(({ key }) => key === programVersionsTabKey(PROGRAM_A));

		expect(
			controller.retitleTab(
				programVersionsTabKey(PROGRAM_A),
				"Updater Desktop",
			),
		).toBe(true);

		const state = controller.getState();
		expect(state.activeTabKey).toBe("administrators");
		expect(
			state.openedTabs.find(
				({ key }) => key === programVersionsTabKey(PROGRAM_A),
			),
		).toEqual({ ...before, title: "Updater Desktop" });
		controller.dispose();
	});

	it("restores a dynamic title after the shell updates the same tab's query href", () => {
		const controller = createShellUiController({ storage: null });
		controller.hydrateForAccount({ accountId: ACCOUNT_A });
		const key = programVersionsTabKey(PROGRAM_A);
		const fallbackTitle = "Program versions";
		const dynamicTitle = "Updater Desktop";

		controller.openOrActivateTab(
			tab(
				"programVersions",
				`${programVersionsHref(PROGRAM_A)}?page=1`,
				fallbackTitle,
			),
		);
		expect(controller.retitleTab(key, dynamicTitle)).toBe(true);
		controller.openOrActivateTab(
			tab(
				"programVersions",
				`${programVersionsHref(PROGRAM_A)}?page=9&sort=version&direction=desc`,
				fallbackTitle,
			),
		);
		expect(controller.retitleTab(key, dynamicTitle)).toBe(true);

		expect(controller.getState()).toMatchObject({
			activeTabKey: key,
			openedTabs: [
				{ key: "programs" },
				{
					closable: true,
					href: `${programVersionsHref(PROGRAM_A)}?page=9&sort=version&direction=desc`,
					key,
					routeId: "programVersions",
					title: dynamicTitle,
				},
			],
		});
		controller.dispose();
	});

	it("does not create missing tabs while still rejecting invalid titles", () => {
		const controller = createShellUiController({ storage: null });
		controller.hydrateForAccount({ accountId: ACCOUNT_A });
		const before = controller.getState();

		expect(controller.retitleTab("missing-tab", "Missing")).toBe(false);
		expect(controller.getState()).toEqual(before);
		expect(() => controller.retitleTab("missing-tab", "")).toThrow(
			"non-empty canonical label",
		);
		controller.dispose();
	});

	it("closes inactive tabs without navigation and active tabs to the left neighbor", () => {
		const controller = createShellUiController({ storage: null });
		controller.hydrateForAccount({ accountId: ACCOUNT_A });
		controller.openOrActivateTab(
			tab("administrators", "/administrators", "Administrators"),
		);
		controller.openOrActivateTab(
			tab("monitoringOverview", "/monitoring/overview", "Monitoring"),
		);
		controller.openOrActivateTab(
			tab("profileSettings", "/settings/profile", "Profile"),
		);

		expect(controller.closeTab("administrators")).toEqual({
			closed: true,
			navigateTo: null,
		});
		expect(controller.getState().activeTabKey).toBe("profileSettings");
		expect(controller.closeTab("profileSettings")).toEqual({
			closed: true,
			navigateTo: "/monitoring/overview",
		});
		expect(controller.getState().activeTabKey).toBe("monitoringOverview");
		expect(controller.closeTab("monitoringOverview")).toEqual({
			closed: true,
			navigateTo: "/programs",
		});
		expect(controller.closeTab("programs")).toEqual({
			closed: false,
			navigateTo: null,
		});
		expect(controller.getState().openedTabs).toHaveLength(1);
		controller.dispose();
	});

	it("hydrates account-scoped tabs and preserves the current URL on reload", () => {
		const storage = new MemorySessionStorage();
		const first = createShellUiController({ storage });
		first.hydrateForAccount({ accountId: ACCOUNT_A, locale: "zh-CN" });
		first.openOrActivateTab(
			tab("programs", "/programs?name=alpha", "Programs"),
		);
		first.openOrActivateTab(
			tab("administrators", "/administrators?page=4", "Administrators"),
		);
		first.openOrActivateTab(
			tab(
				"programVersions",
				`${programVersionsHref(PROGRAM_A)}?page=1`,
				"Versions · Alpha",
			),
		);
		first.setLocale("en");
		first.setSidebarCollapsed(true);
		first.setMobileNavigationOpen(true);
		first.dispose();

		const reloaded = createShellUiController({ storage });
		reloaded.hydrateForAccount({
			accountId: ACCOUNT_A,
			currentTab: tab(
				"programVersions",
				`${programVersionsHref(PROGRAM_A)}?page=9`,
				"Versions · Alpha",
			),
		});

		const state = reloaded.getState();
		expect(state.openedTabs.map(({ href }) => href)).toEqual([
			"/programs?name=alpha",
			"/administrators?page=4",
			`${programVersionsHref(PROGRAM_A)}?page=9`,
		]);
		expect(state.activeTabKey).toBe(`programVersions:${PROGRAM_A}`);
		expect(state.locale).toBe("en");
		expect(state.sidebarCollapsed).toBe(true);
		expect(state.mobileNavigationOpen).toBe(false);
		reloaded.dispose();
	});

	it("drops corrupt, mismatched, unsafe, and duplicate hydrated tabs", () => {
		const storage = new MemorySessionStorage();
		storage.setItem(
			shellUiStorageKey(ACCOUNT_A),
			JSON.stringify({
				activeTabKey: "missing",
				locale: "invalid",
				openedTabs: [
					createOpenedTab(
						tab("administrators", "/administrators?page=1", "Admins"),
					),
					{
						closable: true,
						href: "/administrators?page=2",
						key: "administrators",
						routeId: "administrators",
						title: "Admins latest",
					},
					{
						closable: true,
						href: "/monitoring/overview",
						key: "wrong-key",
						routeId: "monitoringOverview",
						title: "Monitoring",
					},
					{
						closable: true,
						href: "/settings/profile#secret",
						key: "profileSettings",
						routeId: "profileSettings",
						title: "Profile",
					},
					{
						closable: true,
						href: "/dashboard",
						key: "dashboard",
						routeId: "dashboard",
						title: "Dashboard",
					},
					{
						closable: true,
						href: "/settings/system",
						key: "systemSettings",
						routeId: "systemSettings",
						title: "",
					},
				],
				sidebarCollapsed: "yes",
				version: 1,
			}),
		);
		const controller = createShellUiController({
			initialLocale: "en",
			storage,
		});

		controller.hydrateForAccount({ accountId: ACCOUNT_A });

		expect(controller.getState()).toMatchObject({
			activeTabKey: "programs",
			locale: "en",
			sidebarCollapsed: false,
		});
		expect(controller.getState().openedTabs).toHaveLength(2);
		expect(controller.getState().openedTabs[1]).toMatchObject({
			href: "/administrators?page=2",
			key: "administrators",
		});
		controller.dispose();
	});

	it("restores each account independently and lets profile locale win", () => {
		const storage = new MemorySessionStorage();
		const controller = createShellUiController({ storage });
		controller.hydrateForAccount({ accountId: ACCOUNT_A, locale: "en" });
		controller.openOrActivateTab(
			tab("administrators", "/administrators", "Administrators"),
		);
		controller.switchAccount({ accountId: ACCOUNT_B, locale: "zh-CN" });
		controller.openOrActivateTab(
			tab("monitoringAudit", "/monitoring/audit", "Audit"),
		);

		controller.switchAccount({ accountId: ACCOUNT_A, locale: "zh-CN" });
		expect(controller.getState().openedTabs.map(({ key }) => key)).toEqual([
			"programs",
			"administrators",
		]);
		expect(controller.getState().locale).toBe("zh-CN");

		controller.switchAccount({ accountId: ACCOUNT_B, locale: "en" });
		expect(controller.getState().openedTabs.map(({ key }) => key)).toEqual([
			"programs",
			"monitoringAudit",
		]);
		expect(controller.getState().locale).toBe("en");
		controller.dispose();
	});

	it("clears only the current account on logout", () => {
		const storage = new MemorySessionStorage();
		const controller = createShellUiController({ storage });
		controller.hydrateForAccount({ accountId: ACCOUNT_A });
		controller.openOrActivateTab(
			tab("administrators", "/administrators", "Administrators"),
		);
		controller.switchAccount({ accountId: ACCOUNT_B });
		controller.openOrActivateTab(
			tab("monitoringAudit", "/monitoring/audit", "Audit"),
		);
		expect(storage.getItem(shellUiStorageKey(ACCOUNT_A))).not.toBeNull();

		controller.logout();

		expect(storage.getItem(shellUiStorageKey(ACCOUNT_A))).not.toBeNull();
		expect(storage.getItem(shellUiStorageKey(ACCOUNT_B))).toBeNull();
		expect(controller.getState()).toMatchObject({
			accountId: null,
			activeTabKey: "programs",
			hydrated: false,
		});
		expect(controller.getState().openedTabs).toHaveLength(1);
		controller.dispose();
	});

	it("owns locale, sidebar, mobile state and returns subscription cleanup", () => {
		const controller = createShellUiController({ storage: null });
		controller.hydrateForAccount({ accountId: ACCOUNT_A });
		const listener = vi.fn();
		const unsubscribe = controller.subscribe(listener);

		controller.setLocale("en");
		controller.setSidebarCollapsed(true);
		controller.toggleSidebar();
		controller.setMobileNavigationOpen(true);
		expect(controller.getState()).toMatchObject({
			locale: "en",
			mobileNavigationOpen: true,
			sidebarCollapsed: false,
		});
		expect(listener).toHaveBeenCalledTimes(4);

		unsubscribe();
		controller.setMobileNavigationOpen(false);
		expect(listener).toHaveBeenCalledTimes(4);
		controller.dispose();
	});

	it("rejects route, href, title, account, and fragment mismatches", () => {
		expect(() =>
			createOpenedTab(tab("administrators", "/monitoring/audit", "Admins")),
		).toThrow("match its registered protected route");
		expect(() =>
			createOpenedTab(tab("administrators", "/administrators#row", "Admins")),
		).toThrow("match its registered protected route");
		expect(() =>
			createOpenedTab(tab("administrators", "/administrators", "")),
		).toThrow("non-empty canonical label");

		const controller = createShellUiController({ storage: null });
		expect(() => controller.hydrateForAccount({ accountId: " bad " })).toThrow(
			"canonical identifier",
		);
		controller.dispose();
	});
});
