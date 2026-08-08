import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { programQueryKeys, versionQueryKeys } from "../../lib/api/query-keys";
import { I18nProvider } from "../../lib/i18n/i18n";
import type { EntityResult } from "../../shared/api/common";
import type { VersionDetailDto } from "../../shared/api/versions";
import type { VersionDialog } from "./search";
import { createUploadQueueController } from "./upload-store";
import type {
	UploadDraftContext,
	UploadWorkflow,
} from "./upload-workflow.client";
import {
	VersionDialogs,
	type VersionUploadSession,
} from "./version-dialogs.client";

vi.mock("ali-oss", () => ({ default: class AliOssStub {} }));
vi.mock("../../components/ui/toast", () => ({ notify: vi.fn() }));

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const VERSION_ID = "84f19927-d53c-4b5c-a0bf-c836cf9c11cb";

function versionEntity(
	lifecycleStatus: "draft" | "finalized" = "finalized",
): EntityResult<VersionDetailDto> {
	return {
		data: {
			associatedFileCount: lifecycleStatus === "draft" ? 0 : 1,
			createdAt: "2026-07-15T00:00:00.000Z",
			description: "Stable release",
			expectedFileCount: lifecycleStatus === "draft" ? 1 : null,
			fileCount: lifecycleStatus === "draft" ? 0 : 1,
			finalizedAt:
				lifecycleStatus === "draft" ? null : "2026-07-15T01:00:00.000Z",
			id: VERSION_ID,
			isActive: false,
			isLatest: false,
			lifecycleStatus,
			programId: PROGRAM_ID,
			updatedAt: "2026-07-15T00:00:00.000Z",
			versionNumber: "1.0.0",
		},
		etag: 'W/"1"',
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

function createImmediateUploadSession(): VersionUploadSession {
	const queue = createUploadQueueController({ storage: null });
	let currentDraft: UploadDraftContext | null = null;
	const workflow: UploadWorkflow = {
		queue,
		cancel: (itemId) => queue.cancel(itemId),
		discard: async (itemId) => queue.remove(itemId),
		dispose: vi.fn(),
		getDraft: () => currentDraft,
		isRunning: () => false,
		retry: async () => null,
		setDraft: (draft) => {
			currentDraft = draft;
		},
		start: async () => {
			for (const item of queue.getState().items) {
				if (item.status !== "queued") continue;
				queue.startHash(item.id);
				queue.markHashSucceeded(item.id, "a".repeat(64));
				queue.startResolution(item.id);
				queue.markResolutionSucceeded(item.id, "reused");
			}
		},
	};
	return { queue, workflow };
}

function testQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
}

afterEach(() => vi.unstubAllGlobals());

describe("VersionDialogs", () => {
	it("creates a durable draft before upload and closes only after finalization", async () => {
		const queryClient = testQueryClient();
		queryClient.setQueryData(programQueryKeys.detail(PROGRAM_ID), {
			data: { id: PROGRAM_ID, versionCount: 0 },
			etag: 'W/"1"',
		});
		const session = createImmediateUploadSession();
		const draft = versionEntity("draft");
		const finalized = versionEntity("finalized");
		const fetcher = vi
			.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
				jsonResponse(draft.data, 201, { etag: draft.etag }),
			)
			.mockResolvedValueOnce(
				jsonResponse(draft.data, 201, { etag: draft.etag }),
			)
			.mockResolvedValueOnce(
				jsonResponse(finalized.data, 200, { etag: 'W/"2"' }),
			);
		vi.stubGlobal("fetch", fetcher);
		const onClose = vi.fn();
		render(() => (
			<QueryClientProvider client={queryClient}>
				<I18nProvider locale="en">
					<VersionDialogs
						dialog="create"
						onClose={onClose}
						onDeleted={() => {}}
						programId={PROGRAM_ID}
						uploadSessionFactory={() => session}
					/>
				</I18nProvider>
			</QueryClientProvider>
		));

		fireEvent.input(screen.getByRole("textbox", { name: /Version number/ }), {
			target: { value: "1.0.0" },
		});
		fireEvent.change(screen.getByLabelText("Choose program folder"), {
			target: {
				files: [
					new File(["release"], "app.bin", {
						type: "application/octet-stream",
					}),
				],
			},
		});
		fireEvent.click(screen.getByRole("button", { name: "Upload" }));

		await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
		expect(onClose).not.toHaveBeenCalled();
		expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
			description: "",
			expectedFileCount: 1,
			versionNumber: "1.0.0",
		});
		const finalize = await screen.findByRole("button", {
			name: "Finalize version",
		});
		await waitFor(() => expect(finalize.hasAttribute("disabled")).toBe(false));
		fireEvent.click(finalize);

		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
		expect(fetcher.mock.calls[1]?.[0]).toBe(
			`/api/v1/programs/${PROGRAM_ID}/versions/${VERSION_ID}/finalize`,
		);
		expect(
			new Headers(fetcher.mock.calls[1]?.[1]?.headers).get(
				"x-updater-if-match",
			),
		).toBe(draft.etag);
	});

	it("deletes only version metadata and invalidates the parent version count", async () => {
		const queryClient = testQueryClient();
		queryClient.setQueryData(
			versionQueryKeys.detail(PROGRAM_ID, VERSION_ID),
			versionEntity(),
		);
		queryClient.setQueryData(programQueryKeys.detail(PROGRAM_ID), {
			data: { id: PROGRAM_ID, versionCount: 1 },
			etag: 'W/"1"',
		});
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(null, { status: 204 }),
		);
		vi.stubGlobal("fetch", fetcher);
		const onDeleted = vi.fn();
		render(() => (
			<QueryClientProvider client={queryClient}>
				<I18nProvider locale="en">
					<VersionDialogs
						dialog="delete"
						onClose={() => {}}
						onDeleted={onDeleted}
						programId={PROGRAM_ID}
						versionId={VERSION_ID}
					/>
				</I18nProvider>
			</QueryClientProvider>
		));

		fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

		await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
		expect(fetcher.mock.calls[0]?.[1]?.method).toBe("DELETE");
		expect(String(fetcher.mock.calls[0]?.[0])).not.toContain("/uploads/");
		expect(
			queryClient.getQueryState(programQueryKeys.detail(PROGRAM_ID))
				?.isInvalidated,
		).toBe(true);
	});

	it("resumes a durable draft without enabling metadata edits", async () => {
		const queryClient = testQueryClient();
		queryClient.setQueryData(
			versionQueryKeys.detail(PROGRAM_ID, VERSION_ID),
			versionEntity("draft"),
		);
		render(() => (
			<QueryClientProvider client={queryClient}>
				<I18nProvider locale="en">
					<VersionDialogs
						dialog="edit"
						onClose={() => {}}
						onDeleted={() => {}}
						programId={PROGRAM_ID}
						uploadSessionFactory={createImmediateUploadSession}
						versionId={VERSION_ID}
					/>
				</I18nProvider>
			</QueryClientProvider>
		));

		expect(
			await screen.findByRole("heading", { name: "Resume draft upload" }),
		).toBeTruthy();
		expect(screen.getByLabelText("Choose program folder")).toBeTruthy();
		expect(
			screen
				.getByRole("textbox", { name: /Version number/ })
				.hasAttribute("disabled"),
		).toBe(true);
	});

	it("retains the live upload session when a draft dialog closes and reopens", async () => {
		const queryClient = testQueryClient();
		queryClient.setQueryData(
			versionQueryKeys.detail(PROGRAM_ID, VERSION_ID),
			versionEntity("draft"),
		);
		const session = createImmediateUploadSession();
		session.queue.addFiles([
			{
				file: new File(["release"], "app.bin"),
				path: "release/app.bin",
			},
		]);
		const sessionFactory = vi.fn(() => session);
		const [dialog, setDialog] = createSignal<VersionDialog | undefined>("edit");
		const view = render(() => (
			<QueryClientProvider client={queryClient}>
				<I18nProvider locale="en">
					<VersionDialogs
						dialog={dialog()}
						onClose={() => setDialog(undefined)}
						onDeleted={() => {}}
						programId={PROGRAM_ID}
						uploadSessionFactory={sessionFactory}
						versionId={VERSION_ID}
					/>
				</I18nProvider>
			</QueryClientProvider>
		));

		expect(
			await screen.findByRole("heading", { name: "Resume draft upload" }),
		).toBeTruthy();
		expect(screen.getByText(/^1 file/)).toBeTruthy();
		const itemId = session.queue.getState().items[0]?.id;
		if (!itemId) throw new Error("Missing retained upload item.");
		setDialog(undefined);
		await waitFor(() =>
			expect(screen.queryByLabelText("Choose program folder")).toBeNull(),
		);
		expect(session.workflow.dispose).not.toHaveBeenCalled();
		session.queue.startHash(itemId);
		session.queue.markHashProgress(itemId, 0.5);

		setDialog("edit");
		expect(
			await screen.findByRole("heading", { name: "Resume draft upload" }),
		).toBeTruthy();
		expect(screen.getByText(/^1 file/)).toBeTruthy();
		expect(
			(
				screen.getByRole("progressbar", {
					name: /release\/app\.bin/,
				}) as HTMLProgressElement
			).value,
		).toBe(0.5);
		expect(sessionFactory).toHaveBeenCalledOnce();
		expect(session.workflow.dispose).not.toHaveBeenCalled();

		view.unmount();
		expect(session.workflow.dispose).toHaveBeenCalledOnce();
	});

	it("promotes a newly created upload session into its resumable draft", async () => {
		const queryClient = testQueryClient();
		const session = createImmediateUploadSession();
		const sessionFactory = vi.fn(() => session);
		const draft = versionEntity("draft");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse(draft.data, 201, { etag: draft.etag })),
		);
		const [dialog, setDialog] = createSignal<VersionDialog | undefined>(
			"create",
		);
		const [versionId, setVersionId] = createSignal<string>();
		const view = render(() => (
			<QueryClientProvider client={queryClient}>
				<I18nProvider locale="en">
					<VersionDialogs
						dialog={dialog()}
						onClose={() => setDialog(undefined)}
						onDeleted={() => {}}
						programId={PROGRAM_ID}
						uploadSessionFactory={sessionFactory}
						versionId={versionId()}
					/>
				</I18nProvider>
			</QueryClientProvider>
		));

		fireEvent.input(screen.getByRole("textbox", { name: /Version number/ }), {
			target: { value: "1.0.0" },
		});
		fireEvent.change(screen.getByLabelText("Choose program folder"), {
			target: { files: [new File(["release"], "app.bin")] },
		});
		fireEvent.click(screen.getByRole("button", { name: "Upload" }));
		await waitFor(() =>
			expect(
				screen
					.getByRole("button", { name: "Finalize version" })
					.hasAttribute("disabled"),
			).toBe(false),
		);
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		await waitFor(() =>
			expect(screen.queryByLabelText("Choose program folder")).toBeNull(),
		);

		setVersionId(VERSION_ID);
		setDialog("edit");
		expect(
			await screen.findByRole("heading", { name: "Resume draft upload" }),
		).toBeTruthy();
		expect(screen.getByText(/^1 file/)).toBeTruthy();
		expect(sessionFactory).toHaveBeenCalledOnce();
		expect(session.workflow.dispose).not.toHaveBeenCalled();

		view.unmount();
		expect(session.workflow.dispose).toHaveBeenCalledOnce();
	});

	it("keeps finalized edit metadata-only and invalidates version details", async () => {
		const queryClient = testQueryClient();
		const current = versionEntity();
		queryClient.setQueryData(
			versionQueryKeys.detail(PROGRAM_ID, VERSION_ID),
			current,
		);
		const updated = {
			...current,
			data: { ...current.data, description: "Updated" },
			etag: 'W/"2"' as const,
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
				jsonResponse(updated.data, 200, { etag: updated.etag }),
			),
		);
		const onClose = vi.fn();
		render(() => (
			<QueryClientProvider client={queryClient}>
				<I18nProvider locale="en">
					<VersionDialogs
						dialog="edit"
						onClose={onClose}
						onDeleted={() => {}}
						programId={PROGRAM_ID}
						versionId={VERSION_ID}
					/>
				</I18nProvider>
			</QueryClientProvider>
		));

		const description = await screen.findByRole("textbox", {
			name: "Description",
		});
		fireEvent.input(description, { target: { value: "Updated" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
		expect(screen.queryByLabelText("Choose program folder")).toBeNull();
	});
});
