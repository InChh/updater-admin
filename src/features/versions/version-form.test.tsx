import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

import { createUploadQueueController } from "./upload-store";
import type {
	UploadDraftContext,
	UploadWorkflow,
} from "./upload-workflow.client";
import {
	VersionForm,
	type VersionFormDraft,
	type VersionFormLabels,
} from "./version-form";

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const VERSION_ID = "31ddcbe4-4a31-4c35-9738-e88d974a20f4";
const ETAG = 'W/"1"' as const;

const labels: VersionFormLabels = {
	cancel: "Cancel",
	clearFolder: "Clear selected files",
	description: "Description",
	descriptionTooLong: "Description is too long",
	draftReady: "Draft saved",
	exclusions: "Exclude files or directories",
	exclusionsDescription: "One GitIgnore rule per line",
	exclusionsInvalid: "Invalid exclusion rules",
	filesExpected: "Folder does not match draft",
	filesRequired: "Files are required",
	finalizedFilesImmutable: "Finalized files are immutable",
	folder: "Program folder",
	folderPicker: {
		choose: "Choose folder",
		description: "Choose a release folder",
		errors: {
			ALL_FILES_EXCLUDED: "All files excluded",
			FILE_TOO_LARGE: "File too large",
			INVALID_PATH: "Invalid path",
		},
		selected: (count, excludedCount) =>
			`${count} selected, ${excludedCount} excluded`,
	},
	pending: "Saving",
	retry: "Retry",
	startUpload: "Upload",
	submit: "Finalize",
	uploadFailed: "Upload failed",
	uploadIncomplete: "Upload incomplete",
	uploadQueue: {
		associatedCount: (count) => `Associated ${count}`,
		aggregateProgress: "Upload progress",
		cancel: "Cancel upload",
		clearCompleted: "Clear completed",
		empty: "No files",
		failedCount: (count) => `Failed ${count}`,
		files: (count) => `${count} files`,
		hashedCount: (count) => `Hashed ${count}`,
		hideCompleted: "Hide completed",
		nextFiles: "Next files",
		previousFiles: "Previous files",
		remove: "Remove",
		retry: "Retry upload",
		reusedCount: (count) => `Reused ${count}`,
		showCompleted: "Show completed",
		status: {
			cancelled: "Cancelled",
			complete: "Associated",
			failed: "Failed",
			hashing: "Hashing",
			queued: "Queued",
			ready: "Ready",
			registering: "Registering",
			resolving: "Resolving",
			uploaded: "Uploaded",
			uploading: "Uploading",
		},
		totalSize: (bytes) => `Total ${bytes} bytes`,
		uploadedCount: (count) => `Uploaded ${count}`,
		uploadRequiredCount: (count) => `Upload required ${count}`,
		visibleRange: (from, to, total) => `${from}-${to} of ${total}`,
	},
	versionNumber: "Version number",
	versionNumberInvalid: "Invalid version number",
};

function draft(expectedFileCount: number): VersionFormDraft {
	return {
		etag: ETAG,
		expectedFileCount,
		programId: PROGRAM_ID,
		versionId: VERSION_ID,
	};
}

function createSession() {
	const queue = createUploadQueueController({ storage: null });
	let currentDraft: UploadDraftContext | null = null;
	const start = vi.fn(async () => {
		for (const item of queue.getState().items) {
			if (item.status !== "queued") continue;
			queue.startHash(item.id);
			queue.markHashSucceeded(item.id, "a".repeat(64));
			queue.startResolution(item.id);
			queue.markResolutionSucceeded(item.id, "reused");
		}
	});
	const workflow: UploadWorkflow = {
		queue,
		cancel: (itemId) => queue.cancel(itemId),
		discard: async (itemId) => queue.remove(itemId),
		dispose: vi.fn(),
		getDraft: () => currentDraft,
		isRunning: () => false,
		retry: async () => null,
		setDraft: (nextDraft) => {
			currentDraft = nextDraft;
		},
		start,
	};
	return { queue, start, workflow };
}

function folderFile(path: string): File {
	const file = new File(["release"], path.split("/").at(-1) ?? "file.bin", {
		type: "application/octet-stream",
	});
	Object.defineProperty(file, "webkitRelativePath", {
		configurable: true,
		value: path,
	});
	return file;
}

function selectFolder(files: readonly File[]): void {
	fireEvent.change(screen.getByLabelText("Choose folder"), {
		target: { files },
	});
}

describe("VersionForm", () => {
	it("creates a draft before resolve and finalizes after reused files associate", async () => {
		const session = createSession();
		const onPrepareDraft = vi.fn(async () => draft(1));
		const onSubmit = vi.fn(async () => undefined);
		render(() => (
			<VersionForm
				labels={labels}
				mode="create"
				onCancel={vi.fn()}
				onPrepareDraft={onPrepareDraft}
				onSubmit={onSubmit}
				queue={session.queue}
				workflow={session.workflow}
			/>
		));

		fireEvent.input(screen.getByLabelText(/Version number/), {
			target: { value: "1.0.0" },
		});
		selectFolder([folderFile("release/app.bin")]);
		fireEvent.click(screen.getByRole("button", { name: "Upload" }));

		await waitFor(() => expect(session.start).toHaveBeenCalledOnce());
		expect(onPrepareDraft).toHaveBeenCalledWith(
			{ description: "", versionNumber: "1.0.0" },
			1,
		);
		expect(screen.getByText("Draft saved")).toBeTruthy();
		expect(screen.getByText("Reused 1")).toBeTruthy();
		expect(screen.getByText("Associated 1")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith(
				{ description: "", versionNumber: "1.0.0" },
				draft(1),
			),
		);
		session.queue.dispose();
	});

	it("requires the full expected folder when resuming a draft", async () => {
		const session = createSession();
		render(() => (
			<VersionForm
				initialDraft={draft(2)}
				initialValue={{ description: "Draft", versionNumber: "1.0.0" }}
				labels={labels}
				mode="resume"
				onCancel={vi.fn()}
				onSubmit={vi.fn(async () => undefined)}
				queue={session.queue}
				workflow={session.workflow}
			/>
		));

		selectFolder([folderFile("release/app.bin")]);

		expect(screen.getByRole("alert").textContent).toContain(
			"Folder does not match draft",
		);
		expect(session.start).not.toHaveBeenCalled();
		session.queue.dispose();
	});

	it("applies editable GitIgnore rules before draft creation and hashing", async () => {
		const session = createSession();
		const onPrepareDraft = vi.fn(async () => draft(2));
		render(() => (
			<VersionForm
				labels={labels}
				mode="create"
				onCancel={vi.fn()}
				onPrepareDraft={onPrepareDraft}
				onSubmit={vi.fn(async () => undefined)}
				queue={session.queue}
				workflow={session.workflow}
			/>
		));

		fireEvent.input(screen.getByLabelText(/Version number/), {
			target: { value: "1.0.0" },
		});
		fireEvent.input(screen.getByLabelText("Exclude files or directories"), {
			target: { value: "logs/\n**/*.tmp\n!important.tmp" },
		});
		selectFolder([
			folderFile("release/logs/debug.log"),
			folderFile("release/cache/generated.tmp"),
			folderFile("release/important.tmp"),
			folderFile("release/bin/app.exe"),
		]);

		expect(screen.getByText("2 selected, 2 excluded")).toBeTruthy();
		expect(session.queue.getState().items.map(({ path }) => path)).toEqual([
			"bin/app.exe",
			"important.tmp",
		]);
		expect(
			screen
				.getByLabelText("Exclude files or directories")
				.hasAttribute("disabled"),
		).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Upload" }));
		await waitFor(() => expect(session.start).toHaveBeenCalledOnce());
		expect(onPrepareDraft).toHaveBeenCalledWith(
			{ description: "", versionNumber: "1.0.0" },
			2,
		);
		session.queue.dispose();
	});

	it("does not expose file replacement for finalized versions", async () => {
		const session = createSession();
		const onSubmit = vi.fn(async () => undefined);
		render(() => (
			<VersionForm
				initialValue={{ description: "Stable", versionNumber: "1.0.0" }}
				labels={labels}
				mode="edit"
				onCancel={vi.fn()}
				onSubmit={onSubmit}
				queue={session.queue}
				workflow={session.workflow}
			/>
		));

		expect(screen.getByText("Finalized files are immutable")).toBeTruthy();
		expect(screen.queryByLabelText("Choose folder")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Finalize" }));

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith(
				{ description: "Stable", versionNumber: "1.0.0" },
				undefined,
			),
		);
		session.queue.dispose();
	});
});
