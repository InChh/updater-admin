import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../lib/i18n/i18n";
import {
	beginPathNavigation,
	completePathNavigation,
	NavigationPendingPage,
	pathnameFromHref,
} from "./navigation-pending";

describe("navigation pending state", () => {
	it("tracks path navigation from start until the matching route mounts", () => {
		expect(
			beginPathNavigation(null, {
				pathChanged: true,
				toHref: "/administrators?page=1",
			}),
		).toBe("/administrators?page=1");
		expect(
			beginPathNavigation("/administrators?page=1", {
				pathChanged: false,
				toHref: "/administrators?page=2",
			}),
		).toBe("/administrators?page=1");
		expect(
			completePathNavigation("/administrators?page=1", "/programs?page=1"),
		).toBe("/administrators?page=1");
		expect(
			completePathNavigation(
				"/administrators?page=1",
				"/administrators?page=1&sort=createdAt%3Adesc",
			),
		).toBeNull();
	});

	it("compares pathname separately from search state", () => {
		expect(pathnameFromHref("/programs?page=2#table")).toBe("/programs");
		expect(pathnameFromHref("/administrators")).toBe("/administrators");
	});

	it("renders the destination title immediately", () => {
		render(() => (
			<I18nProvider locale="zh-CN">
				<NavigationPendingPage href="/monitoring/audit?page=1" />
			</I18nProvider>
		));

		expect(screen.getByRole("heading", { name: "审计记录" }).textContent).toBe(
			"审计记录",
		);
		expect(screen.getByRole("status").textContent).toContain("正在加载");
	});
});
