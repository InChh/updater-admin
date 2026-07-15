import { fireEvent, render, screen } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../lib/i18n/i18n";
import type { AdministratorDto } from "../../shared/api/administrators";
import { AdministratorsPage } from "./administrators-page";
import type { AdministratorRouteSearch } from "./search";

const CURRENT_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const OTHER_ID = "ba6f79db-c7c4-4a34-9ab5-2a85ca9df502";
const administrators: readonly AdministratorDto[] = [
	{
		createdAt: "2026-07-15T00:00:00.000Z",
		email: "current@example.com",
		enabled: true,
		etag: 'W/"1"',
		id: CURRENT_ID,
		lastLoginAt: "2026-07-15T01:00:00.000Z",
		locale: "en",
		mustChangePassword: false,
		name: "Current Admin",
		updatedAt: "2026-07-15T00:00:00.000Z",
	},
	{
		createdAt: "2026-07-14T00:00:00.000Z",
		email: "other@example.com",
		enabled: false,
		etag: 'W/"4"',
		id: OTHER_ID,
		lastLoginAt: null,
		locale: "zh-CN",
		mustChangePassword: true,
		name: "Other Admin",
		updatedAt: "2026-07-15T00:00:00.000Z",
	},
];

function renderPage(search: AdministratorRouteSearch) {
	const fetcher = vi.fn(
		async () =>
			new Response(
				JSON.stringify({
					items: administrators,
					page: 2,
					pageSize: 20,
					total: 22,
				}),
				{ headers: { "content-type": "application/json" } },
			),
	);
	vi.stubGlobal("fetch", fetcher);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const onSearchChange = vi.fn();
	render(() => (
		<QueryClientProvider client={queryClient}>
			<I18nProvider locale="en">
				<AdministratorsPage
					currentAdministratorId={CURRENT_ID}
					onSearchChange={onSearchChange}
					search={() => search}
				/>
			</I18nProvider>
		</QueryClientProvider>
	));
	return { onSearchChange };
}

afterEach(() => vi.unstubAllGlobals());

describe("AdministratorsPage", () => {
	it("keeps filters in URL search and opens row actions by administrator ID", async () => {
		const search = {
			page: 2,
			pageSize: 20,
			sort: "createdAt:desc",
		} as const satisfies AdministratorRouteSearch;
		const { onSearchChange } = renderPage(search);
		await screen.findByText("Current Admin");

		fireEvent.input(screen.getByRole("textbox", { name: "Name or email" }), {
			target: { value: "  other@example.com  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Search" }));
		expect(onSearchChange).toHaveBeenLastCalledWith({
			page: 1,
			pageSize: 20,
			query: "other@example.com",
			sort: "createdAt:desc",
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Enable administrator Other Admin" }),
		);
		expect(onSearchChange).toHaveBeenLastCalledWith({
			...search,
			administratorId: OTHER_ID,
			dialog: "enable",
		});
	});

	it("directs current-account credential and session work to safe self-service pages", async () => {
		renderPage({ page: 1, pageSize: 20, sort: "createdAt:desc" });
		await screen.findByText("Current Admin");
		for (const name of [
			"Disable administrator Current Admin",
			"Reset the temporary password for Current Admin",
			"Revoke all sessions for Current Admin",
		]) {
			const button = screen.getByRole("button", { name });
			expect(button).toBeInstanceOf(HTMLButtonElement);
			expect((button as HTMLButtonElement).disabled).toBe(true);
		}
		expect(
			(
				screen.getByRole("button", {
					name: "Reset the temporary password for Other Admin",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
		expect(
			(
				screen.getByRole("button", {
					name: "Revoke all sessions for Other Admin",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
	});
});
