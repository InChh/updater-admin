import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { versionQueryKeys } from "../../lib/api/query-keys";
import { I18nProvider } from "../../lib/i18n/i18n";
import type { EntityResult } from "../../shared/api/common";
import type { ProgramDetailDto } from "../../shared/api/programs";
import type {
	VersionDetailDto,
	VersionListItemDto,
	VersionPage,
} from "../../shared/api/versions";
import type { VersionRouteSearch } from "./search";
import type { VersionDialogsProps } from "./version-dialogs";
import { VersionsPage } from "./versions-page";

const { notifyMock } = vi.hoisted(() => ({ notifyMock: vi.fn() }));

vi.mock("../../components/ui/toast", () => ({ notify: notifyMock }));
vi.mock("./version-dialogs", () => ({
	VersionDialogs: (props: VersionDialogsProps) => (
		<div
			data-dialog={props.dialog ?? "closed"}
			data-testid="version-dialog-stub"
		>
			<button onClick={props.onClose} type="button">
				Test close dialog
			</button>
			<button onClick={props.onDeleted} type="button">
				Test confirm deletion
			</button>
		</div>
	),
}));

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df500";
const FIRST_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const SECOND_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df502";

const PROGRAM: EntityResult<ProgramDetailDto> = {
	data: {
		createdAt: "2026-07-15T00:00:00.000Z",
		description: "Stable channel",
		id: PROGRAM_ID,
		name: "Release service",
		updatedAt: "2026-07-15T00:00:00.000Z",
		versionCount: 2,
	},
	etag: 'W/"1"',
};

function version(
	id: string,
	versionNumber: string,
	overrides: Partial<VersionListItemDto> = {},
): VersionListItemDto {
	return {
		associatedFileCount: 1,
		createdAt: "2026-07-15T00:00:00.000Z",
		description: `${versionNumber} release`,
		etag: 'W/"1"',
		expectedFileCount: null,
		fileCount: 1,
		finalizedAt: "2026-07-15T00:00:00.000Z",
		id,
		isActive: true,
		isLatest: false,
		lifecycleStatus: "finalized",
		programId: PROGRAM_ID,
		updatedAt: "2026-07-15T00:00:00.000Z",
		versionNumber,
		...overrides,
	};
}

const FIRST = version(FIRST_ID, "9.0.0", { isActive: false });
const SECOND = version(SECOND_ID, "1.0.0", { isLatest: true });

function page(
	items: readonly VersionListItemDto[] = [FIRST, SECOND],
	overrides: Partial<VersionPage> = {},
): VersionPage {
	return {
		items,
		page: 1,
		pageSize: 20,
		total: items.length,
		...overrides,
	};
}

function detail(
	item: VersionListItemDto,
	overrides: Partial<VersionDetailDto> = {},
): VersionDetailDto {
	const { etag: _etag, ...data } = item;
	return {
		...data,
		...overrides,
	};
}

function jsonResponse(
	value: unknown,
	status = 200,
	headers: Readonly<Record<string, string>> = {},
): Response {
	return new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json", ...headers },
		status,
	});
}

function entityResponse(
	value: VersionDetailDto,
	etag: `W/"${bigint}"` = 'W/"2"',
): Response {
	return jsonResponse(value, 200, { etag });
}

function problemResponse(code: string, requestId: string, status: number) {
	return jsonResponse(
		{
			code,
			detail: "private server detail",
			requestId,
			status,
			title: "Request failed",
			type: "about:blank",
		},
		status,
	);
}

interface RenderPageOptions {
	readonly configureClient?: (queryClient: QueryClient) => void;
	readonly fetcher: ReturnType<typeof vi.fn>;
	readonly search?: VersionRouteSearch;
}

function renderPage(options: RenderPageOptions) {
	vi.stubGlobal("fetch", options.fetcher);
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	options.configureClient?.(queryClient);
	const onSearchChange = vi.fn();
	const initialSearch =
		options.search ??
		({
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		} as const satisfies VersionRouteSearch);

	function TestPage() {
		const [search, setSearch] = createSignal<VersionRouteSearch>(initialSearch);
		return (
			<VersionsPage
				onSearchChange={(nextSearch, navigationOptions) => {
					if (navigationOptions) {
						onSearchChange(nextSearch, navigationOptions);
					} else {
						onSearchChange(nextSearch);
					}
					setSearch(nextSearch);
				}}
				program={() => PROGRAM}
				search={search}
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

function deferredResponse() {
	let resolve!: (response: Response) => void;
	const promise = new Promise<Response>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

function requestMethod(init: RequestInit | undefined): string {
	return init?.method ?? "GET";
}

beforeEach(() => notifyMock.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("VersionsPage", () => {
	it("renders the nested management layout and keeps pagination, sort, and dialogs in URL state", async () => {
		const listPage = page([FIRST], { page: 2, total: 21 });
		const fetcher = vi.fn(async () => jsonResponse(listPage));
		const search = {
			page: 2,
			pageSize: 20,
			sort: "createdAt:desc",
		} as const satisfies VersionRouteSearch;
		const { onSearchChange } = renderPage({ fetcher, search });

		await screen.findByText("9.0.0");
		expect(
			screen.getByRole("heading", { level: 1, name: "Version management" }),
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { level: 2, name: "Release service" }),
		).toBeTruthy();
		expect(screen.getByText("21 versions for Release service")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
		expect(onSearchChange).toHaveBeenLastCalledWith({
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
			sort: "createdAt:asc",
		});
		const editButton = await screen.findByRole("button", {
			name: "Edit version 9.0.0",
		});

		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		expect(onSearchChange).toHaveBeenLastCalledWith({
			dialog: "create",
			page: 1,
			pageSize: 50,
			sort: "createdAt:asc",
		});
		fireEvent.click(editButton);
		expect(onSearchChange).toHaveBeenLastCalledWith({
			dialog: "edit",
			page: 1,
			pageSize: 50,
			sort: "createdAt:asc",
			versionId: FIRST_ID,
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Delete version 9.0.0" }),
		);
		expect(onSearchChange).toHaveBeenLastCalledWith({
			dialog: "delete",
			page: 1,
			pageSize: 50,
			sort: "createdAt:asc",
			versionId: FIRST_ID,
		});
		expect(
			screen.getByTestId("version-dialog-stub").getAttribute("data-dialog"),
		).toBe("delete");
	});

	it("decrements the page after deleting its final row and restores trigger focus", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse(page([FIRST], { page: 2, total: 21 })),
		);
		const { onSearchChange } = renderPage({
			fetcher,
			search: { page: 2, pageSize: 20, sort: "createdAt:desc" },
		});
		await screen.findByText("9.0.0");
		const deleteButton = screen.getByRole("button", {
			name: "Delete version 9.0.0",
		});
		deleteButton.focus();
		fireEvent.click(deleteButton);
		fireEvent.click(
			screen.getByRole("button", { name: "Test confirm deletion" }),
		);
		expect(onSearchChange).toHaveBeenLastCalledWith(
			{ page: 1, pageSize: 20, sort: "createdAt:desc" },
			{ replace: true },
		);

		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("button", { name: "Create" }),
			),
		);
	});

	it("optimistically updates only the selected row and reconciles the server latest flag", async () => {
		const activation = deferredResponse();
		let serverPage = page();
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				if (requestMethod(init) === "PUT") return activation.promise;
				return jsonResponse(serverPage);
			},
		);
		renderPage({ fetcher });
		await screen.findByText("9.0.0");
		const target = screen.getByRole("switch", {
			name: "Enable version 9.0.0",
		});
		fireEvent.click(target);
		await waitFor(() => {
			const optimisticTarget = screen.getByRole("switch", {
				name: "Disable version 9.0.0",
			});
			const currentSibling = screen.getByRole("switch", {
				name: "Disable version 1.0.0",
			});
			expect(optimisticTarget.getAttribute("aria-checked")).toBe("true");
			expect((optimisticTarget as HTMLInputElement).disabled).toBe(true);
			expect((currentSibling as HTMLInputElement).disabled).toBe(false);
		});
		const putCall = fetcher.mock.calls.find(
			([, init]) => requestMethod(init) === "PUT",
		);
		expect((putCall?.[1]?.headers as Headers).get("x-updater-if-match")).toBe(
			'W/"1"',
		);

		const activated = detail(FIRST, { isActive: true, isLatest: true });
		serverPage = page([
			{ ...FIRST, etag: 'W/"2"', isActive: true, isLatest: true },
			{ ...SECOND, isLatest: false },
		]);
		activation.resolve(entityResponse(activated));

		await waitFor(() => {
			expect(
				(
					screen.getByRole("switch", {
						name: "Disable version 9.0.0",
					}) as HTMLInputElement
				).disabled,
			).toBe(false);
			expect(
				within(screen.getByRole("row", { name: /9\.0\.0/ })).getByText(
					"Latest",
				),
			).toBeTruthy();
			expect(
				within(screen.getByRole("row", { name: /1\.0\.0/ })).queryByText(
					"Latest",
				),
			).toBeNull();
		});
		expect(notifyMock).toHaveBeenCalledWith("Version enabled.");
	});

	it("rolls an activation back on a localized API problem", async () => {
		const activation = deferredResponse();
		const initialPage = page([
			{ ...FIRST, isActive: true, isLatest: true },
			SECOND,
		]);
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) =>
				requestMethod(init) === "PUT"
					? activation.promise
					: jsonResponse(initialPage),
		);
		renderPage({ fetcher });
		await screen.findByText("9.0.0");
		const target = screen.getByRole("switch", {
			name: "Disable version 9.0.0",
		});

		fireEvent.click(target);
		await waitFor(() => {
			const optimisticTarget = screen.getByRole("switch", {
				name: "Enable version 9.0.0",
			});
			expect(optimisticTarget.getAttribute("aria-checked")).toBe("false");
			expect((optimisticTarget as HTMLInputElement).disabled).toBe(true);
		});
		activation.resolve(
			problemResponse("INTERNAL_ERROR", "req_activation", 500),
		);

		await waitFor(() => {
			const restoredTarget = screen.getByRole("switch", {
				name: "Disable version 9.0.0",
			});
			expect(restoredTarget.getAttribute("aria-checked")).toBe("true");
			expect((restoredTarget as HTMLInputElement).disabled).toBe(false);
		});
		expect(notifyMock).toHaveBeenCalledWith(
			"The status update failed and was rolled back.",
			"The service is temporarily unavailable. Request ID: req_activation",
			"error",
		);
	});

	it("runs unrelated row activations concurrently and rolls back only the failed row", async () => {
		const firstActivation = deferredResponse();
		const secondActivation = deferredResponse();
		const backgroundRefresh = deferredResponse();
		let getCount = 0;
		const initialPage = page();
		const fetcher = vi.fn(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				if (requestMethod(init) === "PUT") {
					return String(input).includes(FIRST_ID)
						? firstActivation.promise
						: secondActivation.promise;
				}
				getCount += 1;
				return getCount === 1
					? jsonResponse(initialPage)
					: backgroundRefresh.promise;
			},
		);
		const { queryClient } = renderPage({ fetcher });
		await screen.findByText("9.0.0");

		fireEvent.click(
			screen.getByRole("switch", { name: "Enable version 9.0.0" }),
		);
		fireEvent.click(
			screen.getByRole("switch", { name: "Disable version 1.0.0" }),
		);

		await waitFor(() => {
			const putCalls = fetcher.mock.calls.filter(
				([, init]) => requestMethod(init) === "PUT",
			);
			expect(putCalls).toHaveLength(2);
		});

		secondActivation.resolve(
			entityResponse(detail(SECOND, { isActive: false, isLatest: false })),
		);
		await waitFor(() => {
			const cached = queryClient.getQueryData<VersionPage>(
				versionQueryKeys.list(PROGRAM_ID, {
					page: 1,
					pageSize: 20,
					sort: "createdAt:desc",
				}),
			);
			expect(cached?.items.find(({ id }) => id === SECOND_ID)).toMatchObject({
				etag: 'W/"2"',
				isActive: false,
				isLatest: false,
			});
		});

		firstActivation.resolve(
			problemResponse("INTERNAL_ERROR", "req_first_activation", 500),
		);
		await waitFor(() => {
			const cached = queryClient.getQueryData<VersionPage>(
				versionQueryKeys.list(PROGRAM_ID, {
					page: 1,
					pageSize: 20,
					sort: "createdAt:desc",
				}),
			);
			expect(cached?.items).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: FIRST_ID, isActive: false }),
					expect.objectContaining({
						etag: 'W/"2"',
						id: SECOND_ID,
						isActive: false,
					}),
				]),
			);
		});

		backgroundRefresh.resolve(
			jsonResponse(
				page([
					{ ...FIRST, isActive: false },
					{ ...SECOND, etag: 'W/"2"', isActive: false, isLatest: false },
				]),
			),
		);
	});

	it("rolls back and refreshes a stale activation before reporting it", async () => {
		const activation = deferredResponse();
		const initialPage = page([
			{ ...FIRST, isActive: true, isLatest: true },
			SECOND,
		]);
		let getCount = 0;
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				if (requestMethod(init) === "PUT") return activation.promise;
				getCount += 1;
				return jsonResponse(initialPage);
			},
		);
		renderPage({ fetcher });
		await screen.findByText("9.0.0");
		const target = screen.getByRole("switch", {
			name: "Disable version 9.0.0",
		});
		fireEvent.click(target);
		await waitFor(() => {
			const optimisticTarget = screen.getByRole("switch", {
				name: "Enable version 9.0.0",
			});
			expect(optimisticTarget.getAttribute("aria-checked")).toBe("false");
			expect((optimisticTarget as HTMLInputElement).disabled).toBe(true);
		});
		activation.resolve(problemResponse("STALE_WRITE", "req_stale", 409));

		await waitFor(() => {
			const restoredTarget = screen.getByRole("switch", {
				name: "Disable version 9.0.0",
			});
			expect(restoredTarget.getAttribute("aria-checked")).toBe("true");
			expect((restoredTarget as HTMLInputElement).disabled).toBe(false);
			expect(getCount).toBeGreaterThan(1);
		});
		expect(notifyMock).toHaveBeenCalledWith(
			"The status update failed and was rolled back.",
			"The version changed elsewhere. The latest data was loaded; review it and try again.",
			"error",
		);
	});

	it("keeps cached rows visible while exposing a safe background error", async () => {
		const listSearch = {
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		} as const;
		const fetcher = vi.fn(async () =>
			problemResponse("INTERNAL_ERROR", "req_versions_refresh", 500),
		);
		renderPage({
			configureClient: (queryClient) => {
				queryClient.setQueryData(
					versionQueryKeys.list(PROGRAM_ID, listSearch),
					page(),
				);
			},
			fetcher,
		});

		expect(await screen.findByText("9.0.0")).toBeTruthy();
		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toContain(
			"The service is temporarily unavailable. Request ID: req_versions_refresh",
		);
		expect(alert.textContent).not.toContain("private server detail");
	});
});
