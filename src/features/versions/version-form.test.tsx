import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import { createUploadQueueController } from "./upload-store";
import {
	createUploadWorkflow,
	type UploadWorkflow,
} from "./upload-workflow.client";
import {
	VersionForm,
	type VersionFormLabels,
	type VersionFormValue,
} from "./version-form";

vi.mock("ali-oss", () => ({ default: class AliOssStub {} }));

const FILE_METADATA_ID = "7095f861-5cff-4f1b-9be8-4b22e0fc4a27";

const labels: VersionFormLabels = {
	cancel: "Cancel",
	clearFolder: "Clear selected files",
	confirm: "Confirm",
	description: "Description",
	descriptionTooLong: "Description is too long",
	filesRequired: "Files are required",
	folder: "Program folder",
	folderPicker: {
		choose: "Choose folder",
		description: "Choose a release folder",
		errors: {
			FILE_TOO_LARGE: "File too large",
			INVALID_PATH: "Invalid path",
			TOO_MANY_FILES: "Too many files",
		},
		selected: (count) => `${count} selected`,
	},
	pending: "Saving",
	preserveFiles: "Preserve existing files",
	removeAllFiles: "Remove every file relation",
	removeAllFilesConfirm: "Confirm removing every file relation",
	replaceFiles: "Replace existing files",
	retry: "Retry",
	startUpload: "Upload",
	submit: "Save",
	uploadFailed: "Upload failed",
	uploadIncomplete: "Upload incomplete",
	uploadQueue: {
		aggregateProgress: "Upload progress",
		cancel: "Cancel upload",
		clearCompleted: "Clear completed",
		empty: "No files",
		files: (count) => `${count} files`,
		hideCompleted: "Hide completed",
		remove: "Remove",
		retry: "Retry upload",
		showCompleted: "Show completed",
		status: {
			cancelled: "Cancelled",
			complete: "Registered",
			failed: "Failed",
			hashing: "Hashing",
			queued: "Queued",
			ready: "Ready",
			registering: "Registering",
			uploaded: "Uploaded",
			uploading: "Uploading",
		},
		totalSize: (bytes) => `Total ${bytes} bytes`,
	},
	versionNumber: "Version number",
	versionNumberInvalid: "Invalid version number",
};

function createImmediateUploadSession() {
	const queue = createUploadQueueController({ storage: null });
	const start = vi.fn(async () => {
		for (const item of queue.getState().items) {
			if (item.status !== "queued") continue;
			queue.startHash(item.id);
			queue.markHashSucceeded(item.id, "a".repeat(64));
			queue.setObjectTarget(item.id, `releases/${item.path}`);
			queue.startUpload(item.id);
			queue.markUploadSucceeded(item.id, `etag-${item.id}`);
			queue.startRegistration(item.id);
			queue.markRegistrationSucceeded(item.id, `metadata-${item.id}`);
		}
	});
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
			return items.map((item) => item.fileMetadataId ?? "");
		},
		isRunning: () => false,
		retry: async () => null,
		start,
	};
	return { queue, start, workflow };
}

function createRealUploadSession() {
	const queue = createUploadQueueController({ storage: null });
	const workflow = createUploadWorkflow(queue, {
		completeUploads: async (request) => ({
			files: request.files.map((file) => ({
				checksumAlgorithm: "sha256" as const,
				createdAt: "2026-07-15T04:00:00.000Z",
				id: FILE_METADATA_ID,
				mimeType: file.mimeType,
				objectEtag: file.objectEtag ?? "etag",
				path: file.path,
				sha256: file.sha256,
				size: file.size,
				updatedAt: "2026-07-15T04:00:00.000Z",
			})),
		}),
		now: () => Date.parse("2026-07-15T04:00:00.000Z"),
		requestCredentials: async (request) => ({
			bucket: "release-bucket",
			credentials: {
				accessKeyId: "temporary-access-key",
				accessKeySecret: "temporary-secret",
				expiration: "2099-07-15T05:00:00.000Z",
				securityToken: "temporary-token",
			},
			objects: request.files.map(({ path, sha256 }) => ({
				objectKey: `releases/${sha256}/${path}`,
				path,
			})),
			region: "oss-cn-hangzhou",
		}),
		startHashTask: (input) => ({
			cancel: vi.fn(),
			jobId: input.itemId,
			promise: Promise.resolve("a".repeat(64)),
		}),
		startUploadTask: (input) => ({
			cancel: vi.fn(),
			promise: Promise.resolve({
				objectEtag: `etag-${input.objectKey}`,
				objectKey: input.objectKey,
			}),
		}),
	});
	return { queue, workflow };
}

function selectFile(name = "app.bin") {
	const input = screen.getByLabelText("Choose folder");
	fireEvent.change(input, {
		target: {
			files: [
				new File(["release"], name, { type: "application/octet-stream" }),
			],
		},
	});
}

function selectFolderFiles(files: readonly File[]) {
	const input = screen.getByLabelText("Choose folder");
	fireEvent.change(input, { target: { files } });
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

describe("VersionForm", () => {
	it("waits for valid fields and an explicit upload action after folder validation", async () => {
		const session = createImmediateUploadSession();
		render(() => (
			<VersionForm
				labels={labels}
				mode="create"
				onCancel={() => {}}
				onSubmit={async () => {}}
				queue={session.queue}
				workflow={session.workflow}
			/>
		));

		selectFile();
		const upload = screen.getByRole("button", { name: "Upload" });
		expect(upload.hasAttribute("disabled")).toBe(true);
		expect(session.start).not.toHaveBeenCalled();
		expect(screen.getByText("1 files · Total 7 bytes")).toBeTruthy();

		fireEvent.input(screen.getByRole("textbox", { name: "Version number" }), {
			target: { value: "1.0.0" },
		});
		await waitFor(() => expect(upload.hasAttribute("disabled")).toBe(false));
		fireEvent.click(upload);

		await waitFor(() => expect(session.start).toHaveBeenCalledOnce());
		expect(session.queue.getState().items[0]?.status).toBe("complete");
	});

	it("discards a previously valid queue when the latest folder selection is invalid", async () => {
		const session = createImmediateUploadSession();
		render(() => (
			<VersionForm
				labels={labels}
				mode="create"
				onCancel={() => {}}
				onSubmit={async () => {}}
				queue={session.queue}
				workflow={session.workflow}
			/>
		));

		fireEvent.input(screen.getByRole("textbox", { name: "Version number" }), {
			target: { value: "1.0.0" },
		});
		selectFolderFiles([folderFile("release/app.bin")]);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Upload" }).hasAttribute("disabled"),
			).toBe(false),
		);

		selectFolderFiles([folderFile("release/../escape.bin")]);

		await waitFor(() => expect(session.queue.getState().items).toHaveLength(0));
		expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
		expect(screen.getByText("Invalid path")).toBeTruthy();
	});

	it("requires a canonical version and completed upload metadata before create", async () => {
		const session = createImmediateUploadSession();
		const onSubmit = vi.fn(async (_value: VersionFormValue) => {});
		render(() => (
			<VersionForm
				labels={labels}
				mode="create"
				onCancel={() => {}}
				onSubmit={onSubmit}
				queue={session.queue}
				workflow={session.workflow}
			/>
		));

		const save = screen.getByRole("button", { name: "Save" });
		expect(save.hasAttribute("disabled")).toBe(true);
		const versionInput = screen.getByRole("textbox", {
			name: "Version number",
		});
		fireEvent.input(versionInput, { target: { value: "01.2.0" } });
		fireEvent.blur(versionInput);
		expect(await screen.findByText("Invalid version number")).toBeTruthy();

		const correctedVersionInput = screen.getByRole("textbox", {
			name: "Version number",
		});
		fireEvent.input(correctedVersionInput, { target: { value: " 1.2.0 " } });
		fireEvent.blur(correctedVersionInput);
		await waitFor(() =>
			expect(screen.queryByText("Invalid version number")).toBeNull(),
		);
		fireEvent.input(screen.getByRole("textbox", { name: "Description" }), {
			target: { value: "  Stable release  " },
		});
		selectFile();
		fireEvent.click(screen.getByRole("button", { name: "Upload" }));
		await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
		fireEvent.click(save);

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith({
				description: "Stable release",
				fileIds: [expect.stringMatching(/^metadata-upload-/)],
				versionNumber: "1.2.0",
			}),
		);
	});

	it("preserves file relations by default and requires an explicit remove-all confirmation", async () => {
		const session = createImmediateUploadSession();
		const onSubmit = vi.fn(async (_value: VersionFormValue) => {});
		render(() => (
			<VersionForm
				initialValue={{ description: "Current", versionNumber: "1.0.0" }}
				labels={labels}
				mode="edit"
				onCancel={() => {}}
				onSubmit={onSubmit}
				queue={session.queue}
				workflow={session.workflow}
			/>
		));

		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
		expect(onSubmit.mock.calls[0]?.[0]).toEqual({
			description: "Current",
			versionNumber: "1.0.0",
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Remove every file relation" }),
		);
		const confirmation = screen.getByRole("alertdialog", {
			name: "Remove every file relation",
		});
		expect(confirmation).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Confirm", hidden: false }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
		expect(onSubmit.mock.calls[1]?.[0]).toEqual({
			description: "Current",
			fileIds: [],
			versionNumber: "1.0.0",
		});
	});

	it("keeps completed metadata IDs available across a failed final mutation retry", async () => {
		const session = createImmediateUploadSession();
		const [submitError, setSubmitError] = createSignal("");
		const submittedValues: VersionFormValue[] = [];
		render(() => (
			<VersionForm
				labels={labels}
				mode="create"
				onCancel={() => {}}
				onSubmit={async (value) => {
					submittedValues.push(value);
					setSubmitError("Version API failed");
				}}
				queue={session.queue}
				submitError={submitError()}
				workflow={session.workflow}
			/>
		));

		fireEvent.input(screen.getByRole("textbox", { name: "Version number" }), {
			target: { value: "2.0.0" },
		});
		selectFile("client.exe");
		fireEvent.click(screen.getByRole("button", { name: "Upload" }));
		const save = screen.getByRole("button", { name: "Save" });
		await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
		fireEvent.click(save);
		expect(await screen.findByText("Version API failed")).toBeTruthy();
		fireEvent.click(save);

		await waitFor(() => expect(submittedValues).toHaveLength(2));
		expect(submittedValues[1]?.fileIds).toEqual(submittedValues[0]?.fileIds);
		expect(session.queue.getState().items[0]?.status).toBe("complete");
	});

	it.each([
		"create",
		"edit",
	] as const)("keeps completed metadata after clearing queue rows for %s submit", async (mode) => {
		const session = createRealUploadSession();
		const onSubmit = vi.fn(async (_value: VersionFormValue) => {});
		const initialValue =
			mode === "edit"
				? { description: "Current release", versionNumber: "2.0.0" }
				: undefined;
		render(() => (
			<VersionForm
				{...(initialValue ? { initialValue } : {})}
				labels={labels}
				mode={mode}
				onCancel={() => {}}
				onSubmit={onSubmit}
				queue={session.queue}
				workflow={session.workflow}
			/>
		));

		if (mode === "create") {
			fireEvent.input(screen.getByRole("textbox", { name: "Version number" }), {
				target: { value: "3.0.0" },
			});
		}
		selectFile("app.bin");
		fireEvent.click(screen.getByRole("button", { name: "Upload" }));
		await waitFor(() =>
			expect(session.queue.getState().items[0]?.status).toBe("complete"),
		);

		fireEvent.click(screen.getByRole("button", { name: "Clear completed" }));
		expect(session.queue.getState().items[0]).toMatchObject({
			dismissed: true,
			fileMetadataId: FILE_METADATA_ID,
			status: "complete",
		});
		expect(session.workflow.getCompletedFileMetadataIds()).toEqual([
			FILE_METADATA_ID,
		]);
		expect(screen.queryByText("app.bin")).toBeNull();

		const save = screen.getByRole("button", { name: "Save" });
		expect(save.hasAttribute("disabled")).toBe(false);
		fireEvent.click(save);
		await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
		expect(onSubmit.mock.calls[0]?.[0]).toEqual({
			description: mode === "edit" ? "Current release" : "",
			fileIds: [FILE_METADATA_ID],
			versionNumber: mode === "edit" ? "2.0.0" : "3.0.0",
		});
	});

	it("resets the native folder picker label after clearing a selection", async () => {
		const session = createImmediateUploadSession();
		render(() => (
			<VersionForm
				labels={labels}
				mode="create"
				onCancel={() => {}}
				onSubmit={async () => {}}
				queue={session.queue}
				workflow={session.workflow}
			/>
		));

		selectFile();
		expect(await screen.findByText("1 selected")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Clear selected files" }),
		);

		await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());
		expect(
			screen.getAllByText("Choose a release folder").length,
		).toBeGreaterThan(0);
		expect(session.queue.getState().items).toHaveLength(0);
	});

	it("clears old upload metadata and restores preserve mode when the edit revision changes", async () => {
		const session = createImmediateUploadSession();
		const [revision, setRevision] = createSignal('W/"1"');
		const [initialValue, setInitialValue] = createSignal({
			description: "First detail",
			versionNumber: "1.0.0",
		});
		const onSubmit = vi.fn(async (_value: VersionFormValue) => {});
		render(() => (
			<VersionForm
				initialRevision={revision()}
				initialValue={initialValue()}
				labels={labels}
				mode="edit"
				onCancel={() => {}}
				onSubmit={onSubmit}
				queue={session.queue}
				workflow={session.workflow}
			/>
		));

		selectFile("old.bin");
		fireEvent.click(screen.getByRole("button", { name: "Upload" }));
		await waitFor(() =>
			expect(session.queue.getState().items[0]?.status).toBe("complete"),
		);
		setInitialValue({
			description: "Refreshed detail",
			versionNumber: "2.0.0",
		});
		setRevision('W/"2"');

		await waitFor(() => expect(session.queue.getState().items).toHaveLength(0));
		expect(screen.getByDisplayValue("Refreshed detail")).toBeTruthy();
		expect(screen.getByDisplayValue("2.0.0")).toBeTruthy();
		expect(screen.getByText("Preserve existing files")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
		expect(onSubmit.mock.calls[0]?.[0]).toEqual({
			description: "Refreshed detail",
			versionNumber: "2.0.0",
		});
	});
});
