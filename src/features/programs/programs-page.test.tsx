import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createSignal, type JSX } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { programQueryKeys } from "../../lib/api/query-keys";
import { I18nProvider } from "../../lib/i18n/i18n";
import type { ProgramListItemDto } from "../../shared/api/programs";
import { ProgramsPage } from "./programs-page";
import type { ProgramRouteSearch } from "./search";

interface LinkStubProps {
	readonly children?: JSX.Element;
	readonly params: Readonly<{ programId: string }>;
}

vi.mock("@tanstack/solid-router", () => ({
	Link: (props: LinkStubProps) => (
		<a href={`/programs/${props.params.programId}/versions`}>
			{props.children}
		</a>
	),
}));

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const PROGRAM: ProgramListItemDto = {
	createdAt: "2026-07-15T00:00:00.000Z",
	description: "Stable channel",
	etag: 'W/"1"',
	id: PROGRAM_ID,
	name: "Release service",
	updatedAt: "2026-07-15T00:00:00.000Z",
};

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json" },
		status,
	});
}

function renderPage(
	search: ProgramRouteSearch,
	fetcher: ReturnType<typeof vi.fn>,
	configureClient?: (queryClient: QueryClient) => void,
) {
	vi.stubGlobal("fetch", fetcher);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	configureClient?.(queryClient);
	const onSearchChange = vi.fn();
	render(() => (
		<QueryClientProvider client={queryClient}>
			<I18nProvider locale="en">
				<ProgramsPage onSearchChange={onSearchChange} search={() => search} />
			</I18nProvider>
		</QueryClientProvider>
	));
	return { onSearchChange, queryClient };
}

function renderReactivePage(
	search: ProgramRouteSearch,
	fetcher: ReturnType<typeof vi.fn>,
) {
	vi.stubGlobal("fetch", fetcher);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const onSearchChange = vi.fn();
	function TestPage() {
		const [currentSearch, setCurrentSearch] = createSignal(search);
		return (
			<ProgramsPage
				onSearchChange={(nextSearch, options) => {
					onSearchChange(nextSearch, options);
					setCurrentSearch(nextSearch);
				}}
				search={currentSearch}
			/>
		);
	}
	render(() => (
		<QueryClientProvider client={queryClient}>
			<I18nProvider locale="en">
				<TestPage />
			</I18nProvider>
		</QueryClientProvider>
	));
	return { onSearchChange, queryClient };
}

afterEach(() => vi.unstubAllGlobals());

describe("ProgramsPage", () => {
	it("resets pagination for filter, reset, page-size, and server sort changes", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse({
				items: [PROGRAM],
				page: 4,
				pageSize: 20,
				total: 100,
			}),
		);
		const { onSearchChange } = renderPage(
			{ page: 4, pageSize: 20, sort: "createdAt:desc" },
			fetcher,
		);
		await screen.findByText("Release service");

		fireEvent.input(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "  release  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Search" }));
		expect(onSearchChange).toHaveBeenLastCalledWith({
			name: "release",
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});

		fireEvent.click(
			screen.getByRole("button", {
				name: "Created time, switch to ascending",
			}),
		);
		expect(onSearchChange).toHaveBeenLastCalledWith({
			page: 1,
			pageSize: 20,
			sort: "createdAt:asc",
		});

		fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), {
			target: { value: "50" },
		});
		expect(onSearchChange).toHaveBeenLastCalledWith({
			page: 1,
			pageSize: 50,
			sort: "createdAt:desc",
		});

		fireEvent.click(screen.getByRole("button", { name: "Reset" }));
		expect(onSearchChange).toHaveBeenLastCalledWith({
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
	});

	it("writes create, edit, and delete dialogs into canonical URL search state", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse({ items: [PROGRAM], page: 2, pageSize: 20, total: 21 }),
		);
		const search = {
			name: "release",
			page: 2,
			pageSize: 20,
			sort: "createdAt:desc",
		} as const satisfies ProgramRouteSearch;
		const { onSearchChange } = renderPage(search, fetcher);
		await screen.findByText("Release service");

		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		expect(onSearchChange).toHaveBeenLastCalledWith({
			...search,
			dialog: "create",
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Edit program Release service" }),
		);
		expect(onSearchChange).toHaveBeenLastCalledWith({
			...search,
			dialog: "edit",
			programId: PROGRAM_ID,
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Delete program Release service" }),
		);
		expect(onSearchChange).toHaveBeenLastCalledWith({
			...search,
			dialog: "delete",
			programId: PROGRAM_ID,
		});
	});

	it("renders the server-backed empty state", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse({ items: [], page: 1, pageSize: 20, total: 0 }),
		);
		renderPage({ page: 1, pageSize: 20, sort: "createdAt:desc" }, fetcher);

		expect(
			await screen.findByText("No programs yet. Create the first program."),
		).toBeTruthy();
		expect(screen.getByText("0–0 of 0")).toBeTruthy();
	});

	it("renders a safe API error with a retry action", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse(
				{
					code: "INTERNAL_ERROR",
					detail: "database details must not render",
					requestId: "req_programs",
					status: 500,
					title: "Internal error",
					type: "about:blank",
				},
				500,
			),
		);
		renderPage({ page: 1, pageSize: 20, sort: "createdAt:desc" }, fetcher);

		await waitFor(() =>
			expect(
				screen.getByText(
					"The service is temporarily unavailable. Request ID: req_programs",
				),
			).toBeTruthy(),
		);
		expect(screen.queryByText(/database details/)).toBeNull();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	});

	it("preserves an open dialog when clamping a now-empty page", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse({ items: [], page: 4, pageSize: 20, total: 20 }),
		);
		const search = {
			dialog: "create",
			name: "release",
			page: 4,
			pageSize: 20,
			sort: "createdAt:desc",
		} as const satisfies ProgramRouteSearch;
		const { onSearchChange } = renderPage(search, fetcher);

		await waitFor(() =>
			expect(onSearchChange).toHaveBeenCalledWith(
				{ ...search, page: 1 },
				{ replace: true },
			),
		);
	});

	it("restores focus to the action that opened a dialog", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse({ items: [PROGRAM], page: 1, pageSize: 20, total: 1 }),
		);
		const { onSearchChange } = renderReactivePage(
			{ page: 1, pageSize: 20, sort: "createdAt:desc" },
			fetcher,
		);
		await screen.findByText("Release service");
		const createButton = screen.getByRole("button", { name: "Create" });

		fireEvent.click(createButton);
		const dialog = await screen.findByRole("dialog", {
			name: "Create program",
		});
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		await waitFor(() =>
			expect(onSearchChange).toHaveBeenLastCalledWith(
				{ page: 1, pageSize: 20, sort: "createdAt:desc" },
				{ replace: true },
			),
		);
		fireEvent.animationEnd(dialog);

		await waitFor(() => expect(document.activeElement).toBe(createButton));
	});

	it("keeps cached rows visible and announces a background list error", async () => {
		const search = {
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		} as const satisfies ProgramRouteSearch;
		const fetcher = vi.fn(async () =>
			jsonResponse(
				{
					code: "INTERNAL_ERROR",
					requestId: "req_list_refresh",
					status: 500,
					title: "Internal error",
					type: "about:blank",
				},
				500,
			),
		);
		renderPage(search, fetcher, (queryClient) => {
			queryClient.setQueryData(programQueryKeys.list(search), {
				items: [PROGRAM],
				page: 1,
				pageSize: 20,
				total: 1,
			});
		});

		expect(await screen.findByText("Release service")).toBeTruthy();
		expect((await screen.findByRole("alert")).textContent).toContain(
			"Request ID: req_list_refresh",
		);
	});
});
