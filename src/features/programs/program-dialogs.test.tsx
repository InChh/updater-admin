import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { programQueryKeys } from "../../lib/api/query-keys";
import { I18nProvider } from "../../lib/i18n/i18n";
import type { EntityResult } from "../../shared/api/common";
import type { ProgramDetailDto } from "../../shared/api/programs";
import { ProgramDialogs } from "./program-dialogs";

vi.mock("../../components/ui/toast", () => ({ notify: vi.fn() }));

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";

function entity(
	name = "Release service",
	etag: EntityResult<ProgramDetailDto>["etag"] = 'W/"1"',
): EntityResult<ProgramDetailDto> {
	return {
		data: {
			createdAt: "2026-07-15T00:00:00.000Z",
			description: "Stable channel",
			id: PROGRAM_ID,
			name,
			updatedAt: "2026-07-15T00:00:00.000Z",
			versionCount: 3,
		},
		etag,
	};
}

function jsonResponse(
	value: unknown,
	status = 200,
	headers?: HeadersInit,
): Response {
	return new Response(JSON.stringify(value), {
		headers: { "content-type": "application/json", ...headers },
		status,
	});
}

function renderDialog(
	queryClient: QueryClient,
	props: {
		readonly dialog: "delete" | "edit";
		readonly onClose: () => void;
		readonly onDeleted?: () => void;
	},
) {
	render(() => (
		<QueryClientProvider client={queryClient}>
			<I18nProvider locale="en">
				<ProgramDialogs
					dialog={props.dialog}
					onClose={props.onClose}
					onDeleted={props.onDeleted ?? (() => {})}
					programId={PROGRAM_ID}
				/>
			</I18nProvider>
		</QueryClientProvider>
	));
}

function createTestQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
}

afterEach(() => vi.unstubAllGlobals());

describe("ProgramDialogs", () => {
	it("confirms the program name and version count and delegates one delete navigation", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(programQueryKeys.detail(PROGRAM_ID), entity());
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(null, { status: 204 }),
		);
		vi.stubGlobal("fetch", fetcher);
		const onClose = vi.fn();
		const onDeleted = vi.fn();
		renderDialog(queryClient, { dialog: "delete", onClose, onDeleted });

		expect(
			await screen.findByText("Delete Release service and its 3 versions."),
		).toBeTruthy();
		expect(
			screen.getByText("File metadata and OSS objects will not be deleted."),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
		expect(onClose).not.toHaveBeenCalled();
		const [, init] =
			fetcher.mock.calls.find(([, request]) => request?.method === "DELETE") ??
			[];
		expect(init?.method).toBe("DELETE");
		expect(new Headers(init?.headers).get("x-updater-if-match")).toBe('W/"1"');
	});

	it("refreshes the edited detail and program lists after a stale write", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(programQueryKeys.detail(PROGRAM_ID), entity());
		const listKey = programQueryKeys.list({
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		queryClient.setQueryData(listKey, {
			items: [],
			page: 1,
			pageSize: 20,
			total: 0,
		});
		let patchAttempt = 0;
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				if (init?.method === "PATCH") {
					patchAttempt += 1;
					if (patchAttempt === 1) {
						return jsonResponse(
							{
								code: "STALE_WRITE",
								requestId: "req_stale",
								status: 409,
								title: "Stale write",
								type: "about:blank",
							},
							409,
						);
					}
					const body = JSON.parse(String(init.body)) as { name: string };
					const saved = entity(body.name, 'W/"3"');
					return jsonResponse(saved.data, 200, { etag: saved.etag });
				}
				const refreshed = entity("Updated elsewhere", 'W/"2"');
				return jsonResponse(refreshed.data, 200, { etag: refreshed.etag });
			},
		);
		vi.stubGlobal("fetch", fetcher);
		const onClose = vi.fn();
		renderDialog(queryClient, { dialog: "edit", onClose });
		await screen.findByDisplayValue("Release service");

		fireEvent.input(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "My edit" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect(
			await screen.findByText(
				"The program changed elsewhere. The latest data was loaded; review it and try again.",
			),
		).toBeTruthy();
		expect(onClose).not.toHaveBeenCalled();
		expect(
			queryClient.getQueryData<EntityResult<ProgramDetailDto>>(
				programQueryKeys.detail(PROGRAM_ID),
			)?.data.name,
		).toBe("Updated elsewhere");
		expect(await screen.findByDisplayValue("Updated elsewhere")).toBeTruthy();
		expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);

		fireEvent.input(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Reviewed edit" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
		const patchCalls = fetcher.mock.calls.filter(
			([, init]) => init?.method === "PATCH",
		);
		const secondPatch = patchCalls[patchCalls.length - 1]?.[1];
		expect(new Headers(secondPatch?.headers).get("x-updater-if-match")).toBe(
			'W/"2"',
		);
		expect(JSON.parse(String(secondPatch?.body))).toMatchObject({
			name: "Reviewed edit",
		});
	});

	it("does not dismiss an edit dialog while its mutation is pending", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(programQueryKeys.detail(PROGRAM_ID), entity());
		let resolvePatch: ((response: Response) => void) | undefined;
		const patchResponse = new Promise<Response>((resolve) => {
			resolvePatch = resolve;
		});
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				if (init?.method === "PATCH") return patchResponse;
				return jsonResponse(entity().data, 200, { etag: 'W/"1"' });
			},
		);
		vi.stubGlobal("fetch", fetcher);
		const onClose = vi.fn();
		renderDialog(queryClient, { dialog: "edit", onClose });
		await screen.findByDisplayValue("Release service");

		fireEvent.input(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Pending edit" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(
				fetcher.mock.calls.some(([, request]) => request?.method === "PATCH"),
			).toBe(true),
		);

		expect(
			screen.getByRole("button", { name: "Close" }).hasAttribute("disabled"),
		).toBe(true);
		expect(
			screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled"),
		).toBe(true);
		fireEvent.keyDown(document, { key: "Escape" });
		expect(onClose).not.toHaveBeenCalled();

		const saved = entity("Pending edit", 'W/"2"');
		resolvePatch?.(jsonResponse(saved.data, 200, { etag: saved.etag }));
		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
	});

	it("keeps cached detail visible and announces a background refresh error", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(programQueryKeys.detail(PROGRAM_ID), entity());
		await queryClient.invalidateQueries({
			queryKey: programQueryKeys.detail(PROGRAM_ID),
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse(
					{
						code: "INTERNAL_ERROR",
						requestId: "req_detail_refresh",
						status: 500,
						title: "Internal error",
						type: "about:blank",
					},
					500,
				),
			),
		);
		renderDialog(queryClient, { dialog: "edit", onClose: vi.fn() });

		expect(screen.getByRole("dialog", { name: "Edit program" })).toBeTruthy();
		expect(await screen.findByDisplayValue("Release service")).toBeTruthy();
		expect((await screen.findByRole("alert")).textContent).toContain(
			"Request ID: req_detail_refresh",
		);
	});
});
