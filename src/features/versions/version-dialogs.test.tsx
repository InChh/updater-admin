import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { programQueryKeys, versionQueryKeys } from "../../lib/api/query-keys";
import { I18nProvider } from "../../lib/i18n/i18n";
import type { EntityResult } from "../../shared/api/common";
import type { VersionDetailDto } from "../../shared/api/versions";
import { createUploadQueueController } from "./upload-store";
import type { UploadWorkflow } from "./upload-workflow.client";
import {
	VersionDialogs,
	type VersionUploadSession,
} from "./version-dialogs.client";

vi.mock("ali-oss", () => ({ default: class AliOssStub {} }));
vi.mock("../../components/ui/toast", () => ({ notify: vi.fn() }));

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const VERSION_ID = "84f19927-d53c-4b5c-a0bf-c836cf9c11cb";
const SIBLING_VERSION_ID = "84f19927-d53c-4b5c-a0bf-c836cf9c11cc";

function versionEntity(): EntityResult<VersionDetailDto> {
	return {
		data: {
			createdAt: "2026-07-15T00:00:00.000Z",
			description: "Stable release",
			fileCount: 1,
			fileIds: ["7095f861-5cff-4f1b-9be8-4b22e0fc4a27"],
			id: VERSION_ID,
			isActive: false,
			isLatest: false,
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
	const workflow: UploadWorkflow = {
		queue,
		cancel: (itemId) => queue.cancel(itemId),
		discard: async (itemId) => queue.remove(itemId),
		dispose: vi.fn(),
		getCompletedFileMetadataIds: () => {
			const items = queue.getState().items;
			if (
				items.length === 0 ||
				items.some((item) => item.status !== "complete")
			) {
				return null;
			}
			return items.map(() => "7095f861-5cff-4f1b-9be8-4b22e0fc4a27");
		},
		isRunning: () => false,
		retry: async () => null,
		start: async () => {
			for (const item of queue.getState().items) {
				if (item.status !== "queued") continue;
				queue.startHash(item.id);
				queue.markHashSucceeded(item.id, "a".repeat(64));
				queue.setObjectTarget(item.id, `releases/${item.path}`);
				queue.startUpload(item.id);
				queue.markUploadSucceeded(item.id, `etag-${item.id}`);
				queue.startRegistration(item.id);
				queue.markRegistrationSucceeded(
					item.id,
					"7095f861-5cff-4f1b-9be8-4b22e0fc4a27",
				);
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
	it("keeps completed upload metadata after final create fails and retries the same version payload", async () => {
		const queryClient = testQueryClient();
		queryClient.setQueryData(programQueryKeys.detail(PROGRAM_ID), {
			data: { id: PROGRAM_ID, versionCount: 0 },
			etag: 'W/"1"',
		});
		const session = createImmediateUploadSession();
		let createAttempts = 0;
		const requestBodies: unknown[] = [];
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				createAttempts += 1;
				requestBodies.push(JSON.parse(String(init?.body)) as unknown);
				if (createAttempts === 1) {
					return jsonResponse(
						{
							code: "INTERNAL_ERROR",
							requestId: "req_version_create",
							status: 500,
							title: "Internal error",
							type: "about:blank",
						},
						500,
					);
				}
				const created = versionEntity();
				return jsonResponse(created.data, 201, { etag: created.etag });
			},
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

		fireEvent.input(screen.getByRole("textbox", { name: "Version number" }), {
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
		const createButton = screen.getByRole("button", { name: "Create" });
		await waitFor(() =>
			expect(createButton.hasAttribute("disabled")).toBe(false),
		);
		fireEvent.click(createButton);

		expect(
			await screen.findByText(
				"The service is temporarily unavailable. Request ID: req_version_create",
			),
		).toBeTruthy();
		expect(session.queue.getState().items[0]?.status).toBe("complete");
		expect(onClose).not.toHaveBeenCalled();
		const retryCreate = await screen.findByRole("button", { name: "Create" });
		fireEvent.click(retryCreate);

		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
		expect(requestBodies).toHaveLength(2);
		expect(requestBodies[1]).toEqual(requestBodies[0]);
		expect(requestBodies[0]).toEqual({
			description: "",
			fileIds: ["7095f861-5cff-4f1b-9be8-4b22e0fc4a27"],
			versionNumber: "1.0.0",
		});
		expect(
			queryClient.getQueryState(programQueryKeys.detail(PROGRAM_ID))
				?.isInvalidated,
		).toBe(true);
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
		queryClient.setQueryData(
			versionQueryKeys.detail(PROGRAM_ID, SIBLING_VERSION_ID),
			{
				...versionEntity(),
				data: {
					...versionEntity().data,
					id: SIBLING_VERSION_ID,
					isLatest: true,
					versionNumber: "2.0.0",
				},
			},
		);
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

		expect(await screen.findByText("Delete version 1.0.0.")).toBeTruthy();
		expect(
			screen.getByText("File metadata and OSS objects will not be deleted."),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
		expect(fetcher).toHaveBeenCalledOnce();
		const [input, init] = fetcher.mock.calls[0] ?? [];
		expect(String(input)).toContain(
			`/api/v1/programs/${PROGRAM_ID}/versions/${VERSION_ID}`,
		);
		expect(String(input)).not.toContain("/uploads/");
		expect(init?.method).toBe("DELETE");
		expect(init?.body).toBeUndefined();
		expect(new Headers(init?.headers).get("if-match")).toBe('W/"1"');
		expect(
			queryClient.getQueryState(programQueryKeys.detail(PROGRAM_ID))
				?.isInvalidated,
		).toBe(true);
		expect(
			queryClient.getQueryState(
				versionQueryKeys.detail(PROGRAM_ID, SIBLING_VERSION_ID),
			)?.isInvalidated,
		).toBe(true);
	});

	it("invalidates every program-scoped detail after an edit can change latest authority", async () => {
		const queryClient = testQueryClient();
		const current = versionEntity();
		queryClient.setQueryData(
			versionQueryKeys.detail(PROGRAM_ID, VERSION_ID),
			current,
		);
		queryClient.setQueryData(
			versionQueryKeys.detail(PROGRAM_ID, SIBLING_VERSION_ID),
			{
				...current,
				data: {
					...current.data,
					id: SIBLING_VERSION_ID,
					isLatest: true,
					versionNumber: "2.0.0",
				},
			},
		);
		const updated = {
			...current,
			data: {
				...current.data,
				isActive: true,
				isLatest: true,
				versionNumber: "3.0.0",
			},
			etag: 'W/"2"' as const,
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
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

		const versionInput = await screen.findByRole("textbox", {
			name: "Version number",
		});
		fireEvent.input(versionInput, { target: { value: "3.0.0" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
		expect(
			queryClient.getQueryData<EntityResult<VersionDetailDto>>(
				versionQueryKeys.detail(PROGRAM_ID, VERSION_ID),
			),
		).toMatchObject({
			data: { isLatest: true, versionNumber: "3.0.0" },
			etag: 'W/"2"',
		});
		expect(
			queryClient.getQueryState(
				versionQueryKeys.detail(PROGRAM_ID, SIBLING_VERSION_ID),
			)?.isInvalidated,
		).toBe(true);
	});
});
