import { fireEvent, render, screen } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../lib/i18n/i18n";
import type { AuditEventListItemDto } from "../../shared/api/audit";
import { AuditPage } from "./audit-page";
import type { AuditRouteSearch } from "./search";

const EVENT: AuditEventListItemDto = {
	action: "program.updated",
	actorId: "00000000-0000-4000-8000-000000000001",
	createdAt: "2026-07-15T00:00:00.000Z",
	id: "00000000-0000-4000-8000-000000000010",
	resourceId: "00000000-0000-4000-8000-000000000020",
	resourceType: "program",
	result: "success",
};

function renderPage(search: AuditRouteSearch) {
	const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
		Response.json({ items: [EVENT], page: 1, pageSize: 20, total: 1 }),
	);
	vi.stubGlobal("fetch", fetcher);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const onSearchChange = vi.fn();
	render(() => (
		<QueryClientProvider client={queryClient}>
			<I18nProvider locale="en">
				<AuditPage onSearchChange={onSearchChange} search={() => search} />
			</I18nProvider>
		</QueryClientProvider>
	));
	return { onSearchChange };
}

afterEach(() => vi.unstubAllGlobals());

describe("AuditPage", () => {
	it("keeps filters and the selected detail in route search", async () => {
		const search = {
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		} as const satisfies AuditRouteSearch;
		const { onSearchChange } = renderPage(search);
		await screen.findByText(EVENT.resourceId);

		fireEvent.input(screen.getByRole("textbox", { name: "Actor ID" }), {
			target: { value: EVENT.actorId },
		});
		fireEvent.input(screen.getByLabelText("From"), {
			target: { value: "2026-07-01" },
		});
		fireEvent.input(screen.getByLabelText("To"), {
			target: { value: "2026-07-15" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Search" }));
		expect(onSearchChange).toHaveBeenLastCalledWith({
			actorId: EVENT.actorId,
			from: "2026-07-01",
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
			to: "2026-07-15",
		});

		fireEvent.click(
			screen.getByRole("button", {
				name: `View details for audit event ${EVENT.id}`,
			}),
		);
		expect(onSearchChange).toHaveBeenLastCalledWith({
			...search,
			auditEventId: EVENT.id,
		});
	});

	it("rejects a reversed date range before navigation", async () => {
		const { onSearchChange } = renderPage({
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		await screen.findByText(EVENT.resourceId);
		fireEvent.input(screen.getByLabelText("From"), {
			target: { value: "2026-07-15" },
		});
		fireEvent.input(screen.getByLabelText("To"), {
			target: { value: "2026-07-01" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Search" }));
		expect(screen.getByRole("alert").textContent).toBe(
			"The start date cannot be after the end date.",
		);
		expect(onSearchChange).not.toHaveBeenCalled();
	});
});
