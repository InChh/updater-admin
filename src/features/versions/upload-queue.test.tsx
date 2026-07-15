import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

import { UploadQueue } from "./upload-queue";
import { createUploadQueueController } from "./upload-store";

const SHA256 = "a".repeat(64);

describe("UploadQueue", () => {
	it("announces aggregate progress and exposes per-file cancel and retry", () => {
		const controller = createUploadQueueController({ storage: null });
		const [created] = controller.addFiles([
			{
				file: new File([new Uint8Array(100)], "app.bin"),
				path: "release/app.bin",
			},
		]);
		if (!created) throw new Error("fixture was not created");
		const onCancel = vi.fn();
		const onRetry = vi.fn();
		render(() => (
			<UploadQueue
				controller={controller}
				onCancel={(item) => {
					onCancel(item);
					controller.cancel(item.id);
				}}
				onRetry={(item) => {
					onRetry(item);
					controller.prepareRetry(item.id);
				}}
			/>
		));

		expect(screen.getByText("release/app.bin")).toBeTruthy();
		expect(screen.getByText("1 个文件 · 总计 100 B")).toBeTruthy();
		expect(
			screen.getByRole("progressbar", { name: "总上传进度" }),
		).toBeTruthy();
		controller.startHash(created.id);
		controller.markHashProgress(created.id, 0.25);
		expect(
			screen
				.getByRole("progressbar", {
					name: "release/app.bin 正在计算校验值",
				})
				.getAttribute("value"),
		).toBe("0.25");

		fireEvent.click(
			screen.getByRole("button", { name: "取消: release/app.bin" }),
		);
		expect(onCancel).toHaveBeenCalledWith(
			expect.objectContaining({ id: created.id }),
		);
		fireEvent.click(
			screen.getByRole("button", { name: "重试: release/app.bin" }),
		);
		expect(onRetry).toHaveBeenCalledWith(
			expect.objectContaining({ id: created.id }),
		);
		// The workflow callback owns both transitions so it can also stop the
		// active worker/client before preparing the exact retry stage.
		expect(controller.getState().items[0]?.status).toBe("queued");
		controller.dispose();
	});

	it("can hide and clear registered files without losing active items", () => {
		const controller = createUploadQueueController({ storage: null });
		const [completed, queued] = controller.addFiles([
			{ file: new File(["done"], "done.bin"), path: "done.bin" },
			{ file: new File(["next"], "next.bin"), path: "next.bin" },
		]);
		if (!completed || !queued) throw new Error("fixtures were not created");
		controller.startHash(completed.id);
		controller.markHashSucceeded(completed.id, SHA256);
		controller.setObjectTarget(completed.id, "releases/done.bin");
		controller.startUpload(completed.id);
		controller.markUploadSucceeded(completed.id, "etag");
		controller.startRegistration(completed.id);
		controller.markRegistrationSucceeded(completed.id, "metadata-id");
		render(() => <UploadQueue controller={controller} />);

		expect(screen.getByText("done.bin")).toBeTruthy();
		expect(screen.getByText("next.bin")).toBeTruthy();
		fireEvent.click(screen.getByRole("checkbox"));
		expect(screen.queryByText("done.bin")).toBeNull();
		expect(screen.getByText("next.bin")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "清除已完成" }));
		expect(controller.getState().items.map(({ id }) => id)).toEqual([
			completed.id,
			queued.id,
		]);
		expect(controller.getState().items[0]).toMatchObject({
			dismissed: true,
			fileMetadataId: "metadata-id",
			status: "complete",
		});
		expect(screen.queryByText("done.bin")).toBeNull();
		expect(screen.getByText("next.bin")).toBeTruthy();
		controller.dispose();
	});

	it("renders a generic diagnostic instead of signed provider details", () => {
		const controller = createUploadQueueController({ storage: null });
		const [item] = controller.addFiles([
			{ file: new File(["failed"], "failed.bin"), path: "failed.bin" },
		]);
		if (!item) throw new Error("fixture was not created");
		controller.startHash(item.id);
		controller.fail(
			item.id,
			"hash",
			"Provider failed https://bucket.example/file?security-token=render-secret",
		);

		render(() => <UploadQueue controller={controller} />);

		expect(screen.getByText("Upload failed.")).toBeTruthy();
		expect(screen.queryByText(/render-secret/)).toBeNull();
		controller.dispose();
	});
});
