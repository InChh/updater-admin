import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../lib/i18n/i18n";
import { OpenedTabs } from "./tabs";
import type { OpenedTab } from "./ui-store";

const tabs = [
	{
		closable: false,
		href: "/programs",
		key: "programs",
		routeId: "programs",
		title: "Programs",
	},
	{
		closable: true,
		href: "/administrators",
		key: "administrators",
		routeId: "administrators",
		title: "Administrators",
	},
] as const satisfies readonly OpenedTab[];

const versionTab = {
	closable: true,
	href: "/programs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/versions?page=3",
	key: "programVersions:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	routeId: "programVersions",
	title: "Optimizer",
} as const satisfies OpenedTab;

describe("OpenedTabs", () => {
	it("activates adjacent tabs and restores focus after Delete", async () => {
		const onActivate = vi.fn();
		const onClose = vi.fn();
		render(() => (
			<I18nProvider locale="en">
				<OpenedTabs
					activeKey="programs"
					onActivate={onActivate}
					onClose={onClose}
					tabs={tabs}
				/>
			</I18nProvider>
		));

		const renderedTabs = screen.getAllByRole("tab");
		renderedTabs[0].focus();
		fireEvent.keyDown(renderedTabs[0], { key: "ArrowRight" });

		expect(document.activeElement).toBe(renderedTabs[1]);
		expect(onActivate).toHaveBeenCalledWith(tabs[1]);

		fireEvent.keyDown(renderedTabs[1], { key: "Delete" });
		expect(onClose).toHaveBeenCalledWith(tabs[1]);
		await Promise.resolve();
		expect(document.activeElement).toBe(renderedTabs[0]);
		expect(renderedTabs[0].getAttribute("aria-controls")).toBe("main-content");
	});

	it("keeps close controls separately labelled and clickable", () => {
		const onClose = vi.fn();
		render(() => (
			<I18nProvider locale="en">
				<OpenedTabs
					activeKey="administrators"
					onActivate={() => {}}
					onClose={onClose}
					tabs={tabs}
				/>
			</I18nProvider>
		));

		fireEvent.click(screen.getByRole("button", { name: /Close tab/ }));
		expect(onClose).toHaveBeenCalledWith(tabs[1]);
	});

	it("renders the program-scoped version title from the stored program name", () => {
		render(() => (
			<I18nProvider locale="en">
				<OpenedTabs
					activeKey={versionTab.key}
					onActivate={() => {}}
					onClose={() => {}}
					tabs={[tabs[0], versionTab]}
				/>
			</I18nProvider>
		));

		expect(
			screen
				.getByRole("tab", { name: "Versions · Optimizer" })
				.getAttribute("href"),
		).toBe(versionTab.href);
	});
});
