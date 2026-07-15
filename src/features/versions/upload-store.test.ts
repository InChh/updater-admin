import { describe, expect, it } from "vitest";

import type { UploadQueueStorage } from "./upload-store";
import {
	calculateAggregateUploadProgress,
	createUploadQueueController,
	safeUploadErrorMessage,
	UPLOAD_UI_STORAGE_KEY,
} from "./upload-store";

const SHA256 = "a".repeat(64);

class MemoryStorage implements UploadQueueStorage {
	readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

function file(name: string, size: number, type = "application/octet-stream") {
	return new File([new Uint8Array(size)], name, { type });
}

function prepareUpload(
	controller: ReturnType<typeof createUploadQueueController>,
	id: string,
) {
	controller.startHash(id);
	controller.markHashSucceeded(id, SHA256);
	controller.setObjectTarget(id, `releases/${id}`);
	controller.startUpload(id);
}

describe("upload queue store", () => {
	it("owns File objects in memory and rejects duplicate relative paths atomically", () => {
		const controller = createUploadQueueController({ storage: null });
		const release = file("app.bin", 3, "application/octet-stream");
		const [created] = controller.addFiles([
			{ file: release, path: "release/app.bin" },
		]);

		expect(created?.file).toBe(release);
		expect(created).toMatchObject({
			mimeType: "application/octet-stream",
			path: "release/app.bin",
			size: 3,
			status: "queued",
		});
		expect(() =>
			controller.addFiles([
				{ file: file("duplicate.bin", 1), path: "release/app.bin" },
			]),
		).toThrow("Duplicate upload path");
		expect(() =>
			controller.addFiles([
				{ file: file("accent.bin", 1), path: "release/e\u0301.bin" },
				{ file: file("accent-2.bin", 1), path: "release/é.bin" },
			]),
		).toThrow("Duplicate upload path");
		expect(controller.getState().items).toHaveLength(1);
		controller.dispose();
	});

	it("falls back invalid or empty browser MIME values before any upload work", () => {
		const controller = createUploadQueueController({ storage: null });
		const created = controller.addFiles([
			{
				file: file("parameterized.bin", 1, "text/plain; charset=utf-8"),
				path: "parameterized.bin",
			},
			{ file: file("unknown.bin", 1, ""), path: "unknown.bin" },
		]);

		expect(created.map(({ mimeType }) => mimeType)).toEqual([
			"application/octet-stream",
			"application/octet-stream",
		]);
		controller.dispose();
	});

	it("enforces deterministic hash, upload, and registration transitions", () => {
		const controller = createUploadQueueController({ storage: null });
		const [created] = controller.addFiles([
			{ file: file("app.bin", 100), path: "release/app.bin" },
		]);
		if (!created) throw new Error("fixture was not created");

		expect(() => controller.startUpload(created.id)).toThrow(
			"while it is queued",
		);
		controller.startHash(created.id);
		controller.markHashProgress(created.id, 1.5);
		expect(controller.getState().items[0]?.hashProgress).toBe(1);
		controller.markHashSucceeded(created.id, SHA256);
		controller.setObjectTarget(created.id, "releases/a/app.bin");
		controller.startUpload(created.id);
		controller.markUploadProgress(created.id, 0.45);
		controller.markUploadSucceeded(created.id, '"etag"');
		controller.startRegistration(created.id);
		expect(controller.cancel(created.id)).toBeNull();
		expect(controller.getState().items[0]?.status).toBe("registering");
		controller.markRegistrationSucceeded(created.id, "file-metadata-id");

		expect(controller.getState().items[0]).toMatchObject({
			attempt: 1,
			checkpoint: null,
			fileMetadataId: "file-metadata-id",
			objectEtag: '"etag"',
			sha256: SHA256,
			status: "complete",
			uploadProgress: 1,
		});
		expect(controller.getState().aggregateProgress).toBe(1);
		expect(() => controller.markUploadProgress(created.id, 0.8)).toThrow(
			"while it is complete",
		);
		controller.dispose();
	});

	it("calculates byte-weighted aggregate transfer progress", () => {
		const controller = createUploadQueueController({ storage: null });
		const [small, large] = controller.addFiles([
			{ file: file("small.bin", 100), path: "small.bin" },
			{ file: file("large.bin", 300), path: "large.bin" },
		]);
		if (!small || !large) throw new Error("fixtures were not created");

		prepareUpload(controller, small.id);
		prepareUpload(controller, large.id);
		controller.markUploadProgress(small.id, 1);
		controller.markUploadProgress(large.id, 0.5);

		expect(controller.getState().aggregateProgress).toBe(0.625);
		expect(calculateAggregateUploadProgress([])).toBe(0);
		controller.dispose();
	});

	it("preserves failed checkpoints but discards an aborted checkpoint after cancel", () => {
		const controller = createUploadQueueController({ storage: null });
		const [created] = controller.addFiles([
			{ file: file("app.bin", 10), path: "app.bin" },
		]);
		if (!created) throw new Error("fixture was not created");
		prepareUpload(controller, created.id);
		const checkpoint = {
			doneParts: [{ etag: "part", number: 1 }],
			uploadId: "upload-id",
		};
		controller.markUploadCheckpoint(created.id, checkpoint);
		controller.markUploadProgress(created.id, 0.4);
		controller.fail(created.id, "upload", new Error("network unavailable"));

		expect(controller.prepareRetry(created.id)).toBe("upload");
		expect(controller.getState().items[0]).toMatchObject({
			checkpoint,
			status: "ready",
			uploadProgress: 0.4,
		});
		controller.startUpload(created.id);
		expect(controller.getState().items[0]?.attempt).toBe(2);
		expect(controller.cancel(created.id)).toBe("upload");
		expect(controller.getState().items[0]?.status).toBe("cancelled");
		expect(controller.prepareRetry(created.id)).toBe("upload");
		expect(controller.getState().items[0]?.checkpoint).toBeNull();
		controller.dispose();
	});

	it("atomically completes a failed upload from server-reconciled metadata", () => {
		const controller = createUploadQueueController({ storage: null });
		const [created] = controller.addFiles([
			{ file: file("app.bin", 10), path: "app.bin" },
		]);
		if (!created) throw new Error("fixture was not created");
		prepareUpload(controller, created.id);
		controller.markUploadCheckpoint(created.id, {
			doneParts: [{ etag: "part", number: 1 }],
			uploadId: "upload-id",
		});
		controller.fail(created.id, "upload", new Error("response lost"));

		controller.markUploadReconciled(
			created.id,
			"canonical-etag",
			"file-metadata-id",
		);

		expect(controller.getState().items[0]).toMatchObject({
			attempt: 1,
			checkpoint: null,
			error: null,
			failedStage: null,
			fileMetadataId: "file-metadata-id",
			objectEtag: "canonical-etag",
			status: "complete",
			uploadProgress: 1,
		});
		expect(controller.getState().aggregateProgress).toBe(1);
		controller.dispose();
	});

	it("retries the exact failed stage and bounds error text", () => {
		const controller = createUploadQueueController({ storage: null });
		const [created] = controller.addFiles([
			{ file: file("app.bin", 1), path: "app.bin" },
		]);
		if (!created) throw new Error("fixture was not created");

		controller.startHash(created.id);
		controller.fail(created.id, "hash", "x".repeat(800));
		expect(controller.getState().items[0]?.error).toHaveLength(500);
		expect(controller.prepareRetry(created.id)).toBe("hash");
		expect(controller.getState().items[0]?.status).toBe("queued");

		prepareUpload(controller, created.id);
		controller.markUploadSucceeded(created.id, "etag");
		controller.startRegistration(created.id);
		controller.fail(created.id, "registration", new Error("database busy"));
		expect(controller.getState().items[0]?.error).toBe("database busy");
		expect(controller.prepareRetry(created.id)).toBe("registration");
		expect(controller.getState().items[0]?.status).toBe("uploaded");
		controller.dispose();
	});

	it("replaces sensitive Error, string, and nested provider diagnostics", () => {
		const controller = createUploadQueueController({ storage: null });
		const items = controller.addFiles([
			{ file: file("error.bin", 1), path: "error.bin" },
			{ file: file("string.bin", 1), path: "string.bin" },
			{ file: file("nested.bin", 1), path: "nested.bin" },
		]);
		const diagnostics: readonly unknown[] = [
			new Error("Authorization: Bearer error-secret"),
			"OSS failed at https://bucket.example/app.bin?token=string-secret",
			{
				message: "Provider request failed",
				response: {
					request: {
						url: "https://bucket.example/app.bin?X-Amz-Signature=nested-secret",
					},
				},
			},
		];

		for (const [index, item] of items.entries()) {
			controller.startHash(item.id);
			controller.fail(item.id, "hash", diagnostics[index]);
		}

		expect(controller.getState().items.map(({ error }) => error)).toEqual([
			"Upload failed.",
			"Upload failed.",
			"Upload failed.",
		]);
		const serialized = JSON.stringify(controller.getState());
		for (const secret of ["error-secret", "string-secret", "nested-secret"]) {
			expect(serialized).not.toContain(secret);
		}
		controller.dispose();
	});

	it("recognizes credential and sensitive query variants without hiding safe diagnostics", () => {
		for (const diagnostic of [
			"Provider failed https://user:password@bucket.example/app.bin",
			"Provider failed https://bucket.example/app.bin?authorization=synthetic",
			"Provider failed https://bucket.example/app.bin?cookie=synthetic",
			"Provider failed https://bucket.example/app.bin?token=synthetic",
			"Provider failed https://bucket.example/app.bin?client_secret=synthetic",
			"Provider failed with securityToken synthetic-secret-123",
			"Provider failed with Bearer eyJheader12345.eyJpayload12345.signature12345",
		]) {
			expect(safeUploadErrorMessage(diagnostic)).toBe("Upload failed.");
		}
		expect(
			safeUploadErrorMessage(
				"Provider unavailable; see https://status.example/help?code=timeout",
			),
		).toBe(
			"Provider unavailable; see https://status.example/help?code=timeout",
		);
	});

	it("persists only serializable UI preference and never queue payloads", () => {
		const storage = new MemoryStorage();
		const controller = createUploadQueueController({ storage });
		const release = file("permanent-key-must-not-persist.bin", 3);
		const [created] = controller.addFiles([
			{ file: release, path: "secret/path.bin" },
		]);
		if (!created) throw new Error("fixture was not created");
		prepareUpload(controller, created.id);
		controller.markUploadCheckpoint(created.id, {
			file: release,
			uploadId: "secret-upload-id",
		});
		controller.setShowCompleted(false);

		const raw = storage.getItem(UPLOAD_UI_STORAGE_KEY);
		expect(raw).toBe('{"showCompleted":false,"version":1}');
		expect(raw).not.toContain("secret/path.bin");
		expect(raw).not.toContain("secret-upload-id");

		const reloaded = createUploadQueueController({ storage });
		expect(reloaded.getState()).toEqual({
			aggregateProgress: 0,
			items: [],
			showCompleted: false,
		});
		controller.dispose();
		reloaded.dispose();
	});
});
