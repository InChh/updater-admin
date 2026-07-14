import { describe, expect, it, vi } from "vitest";

import type {
	AliOssClientLike,
	AliOssMultipartOptions,
	AliOssMultipartResult,
} from "./oss-uploader.client";
import {
	OSS_MULTIPART_PARALLELISM,
	OssUploadCancelledError,
	startOssMultipartUpload,
} from "./oss-uploader.client";

vi.mock("ali-oss", () => ({ default: class AliOssStub {} }));

const CREDENTIALS = {
	accessKeyId: "temporary-id",
	accessKeySecret: "temporary-secret",
	securityToken: "temporary-token",
};

function baseInput() {
	return {
		bucket: "release-bucket",
		credentials: CREDENTIALS,
		file: new File(["release"], "release.bin", {
			type: "application/octet-stream",
		}),
		objectKey: "updater/sha/release.bin",
		region: "oss-cn-hangzhou",
	};
}

describe("browser OSS multipart uploader", () => {
	it("uses STS configuration, parallelism four, progress, and checkpoints", async () => {
		const checkpoint = { doneParts: [], uploadId: "upload-1" };
		let options: AliOssMultipartOptions | undefined;
		const client: AliOssClientLike = {
			cancel: vi.fn(),
			multipartUpload: vi.fn(async (_objectKey, _file, nextOptions) => {
				options = nextOptions;
				await nextOptions.progress(-0.5, checkpoint);
				await nextOptions.progress(0.4, checkpoint);
				return { etag: '"object-etag"' };
			}),
		};
		const createClient = vi.fn(() => client);
		const onCheckpoint = vi.fn();
		const onProgress = vi.fn();

		const task = startOssMultipartUpload(
			{
				...baseInput(),
				onCheckpoint,
				onProgress,
				partSize: 1024 * 1024,
			},
			{ createClient },
		);

		await expect(task.promise).resolves.toEqual({
			objectEtag: '"object-etag"',
			objectKey: "updater/sha/release.bin",
		});
		expect(createClient).toHaveBeenCalledWith({
			accessKeyId: "temporary-id",
			accessKeySecret: "temporary-secret",
			bucket: "release-bucket",
			region: "oss-cn-hangzhou",
			secure: true,
			stsToken: "temporary-token",
		});
		expect(options).toMatchObject({
			disabledMD5: true,
			headers: { "x-oss-forbid-overwrite": "true" },
			parallel: OSS_MULTIPART_PARALLELISM,
			partSize: 1024 * 1024,
		});
		expect(onCheckpoint).toHaveBeenCalledTimes(2);
		expect(onCheckpoint).toHaveBeenLastCalledWith(checkpoint);
		expect(onProgress.mock.calls.map(([value]) => value)).toEqual([0, 0.4, 1]);
	});

	it("passes an in-memory checkpoint back when retrying", async () => {
		const checkpoint = {
			doneParts: [{ etag: "part-1", number: 1 }],
			uploadId: "upload-1",
		};
		let receivedOptions: AliOssMultipartOptions | undefined;
		const client: AliOssClientLike = {
			cancel: vi.fn(),
			multipartUpload: vi.fn(async (_objectKey, _file, options) => {
				receivedOptions = options;
				return { res: { headers: { ETag: "header-etag" } } };
			}),
		};

		const task = startOssMultipartUpload(
			{ ...baseInput(), checkpoint },
			{ createClient: () => client },
		);

		await expect(task.promise).resolves.toMatchObject({
			objectEtag: "header-etag",
		});
		expect(receivedOptions?.checkpoint).toBe(checkpoint);
	});

	it("cancels only its per-file client and normalizes the SDK cancel error", async () => {
		let rejectUpload: ((reason?: unknown) => void) | undefined;
		let cancelled = false;
		const client: AliOssClientLike = {
			cancel: vi.fn(() => {
				cancelled = true;
			}),
			isCancel: () => cancelled,
			multipartUpload: vi.fn(
				() =>
					new Promise<AliOssMultipartResult>((_resolve, reject) => {
						rejectUpload = reject;
					}),
			),
		};
		const task = startOssMultipartUpload(baseInput(), {
			createClient: () => client,
		});

		task.cancel();
		rejectUpload?.({ name: "cancel" });
		await expect(task.promise).rejects.toBeInstanceOf(OssUploadCancelledError);
		expect(client.cancel).toHaveBeenCalledOnce();
	});

	it("honors an already-aborted signal without creating an OSS client", async () => {
		const abortController = new AbortController();
		abortController.abort();
		const createClient = vi.fn();
		const task = startOssMultipartUpload(
			{ ...baseInput(), signal: abortController.signal },
			{ createClient },
		);

		await expect(task.promise).rejects.toBeInstanceOf(OssUploadCancelledError);
		expect(createClient).not.toHaveBeenCalled();
	});

	it("rejects a multipart part size below the OSS browser limit", () => {
		expect(() =>
			startOssMultipartUpload(
				{ ...baseInput(), partSize: 99 * 1024 },
				{ createClient: vi.fn() },
			),
		).toThrow("partSize must be at least");
	});

	it("fails closed when CORS does not expose an ETag", async () => {
		const client: AliOssClientLike = {
			cancel: vi.fn(),
			multipartUpload: vi.fn(async () => ({ res: { headers: {} } })),
		};
		const task = startOssMultipartUpload(baseInput(), {
			createClient: () => client,
		});

		await expect(task.promise).rejects.toThrow(
			"Expose the ETag response header in bucket CORS",
		);
	});
});
