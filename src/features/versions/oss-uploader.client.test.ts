import { describe, expect, it, vi } from "vitest";

import { MAX_UPLOAD_SIZE_BYTES } from "../../shared/api/uploads";

import type {
	AliOssClientConfiguration,
	AliOssClientLike,
	AliOssMultipartOptions,
	AliOssMultipartResult,
	AliOssPutOptions,
} from "./oss-uploader.client";
import {
	abortOssMultipartCheckpoint,
	DEFAULT_OSS_MULTIPART_PART_SIZE,
	MAX_OSS_MULTIPART_FILE_SIZE_BYTES,
	MAX_OSS_MULTIPART_IN_FLIGHT_PART_BYTES_PER_FILE,
	MAX_OSS_MULTIPART_PART_COUNT,
	MAX_OSS_SIMPLE_UPLOAD_FILE_SIZE_BYTES,
	OSS_MULTIPART_PARALLELISM,
	OSS_STS_REFRESH_INTERVAL_MS,
	OssMultipartEtagCorsError,
	OssUploadAlreadyExistsError,
	OssUploadCancelledError,
	resolveOssMultipartPartSize,
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
	it("uses a bounded simple PUT without requiring a part ETag", async () => {
		let options: AliOssPutOptions | undefined;
		const onProgress = vi.fn();
		const client: AliOssClientLike = {
			cancel: vi.fn(),
			multipartUpload: vi.fn(),
			put: vi.fn(async (_objectKey, _file, nextOptions) => {
				options = nextOptions;
				return { etag: '"object-etag"' };
			}),
		};

		const task = startOssMultipartUpload(
			{ ...baseInput(), mimeType: "application/octet-stream", onProgress },
			{ createClient: () => client },
		);

		await expect(task.promise).resolves.toEqual({
			objectKey: "updater/sha/release.bin",
		});
		expect(client.put).toHaveBeenCalledOnce();
		expect(client.multipartUpload).not.toHaveBeenCalled();
		expect(options).toEqual({
			headers: { "x-oss-forbid-overwrite": "true" },
			mime: "application/octet-stream",
			timeout: 120_000,
		});
		expect(onProgress.mock.calls.map(([value]) => value)).toEqual([0, 1]);
		expect(MAX_OSS_SIMPLE_UPLOAD_FILE_SIZE_BYTES).toBe(8 * 1024 * 1024);
	});

	it("keeps files above the simple memory bound on multipart upload", async () => {
		const file = new File(
			[new Uint8Array(MAX_OSS_SIMPLE_UPLOAD_FILE_SIZE_BYTES + 1)],
			"large.bin",
		);
		const client: AliOssClientLike = {
			cancel: vi.fn(),
			multipartUpload: vi.fn(async () => ({ etag: '"multipart-etag"' })),
			put: vi.fn(async () => ({ etag: '"simple-etag"' })),
		};
		const task = startOssMultipartUpload(
			{ ...baseInput(), file },
			{ createClient: () => client },
		);

		await expect(task.promise).resolves.toEqual({
			objectKey: "updater/sha/release.bin",
		});
		expect(client.multipartUpload).toHaveBeenCalledOnce();
		expect(client.put).not.toHaveBeenCalled();
	});

	it("accepts a simple PUT when the final ETag is not exposed", async () => {
		const client: AliOssClientLike = {
			cancel: vi.fn(),
			multipartUpload: vi.fn(),
			put: vi.fn(async () => ({ res: { headers: {} } })),
		};
		const task = startOssMultipartUpload(baseInput(), {
			createClient: () => client,
		});

		await expect(task.promise).resolves.toEqual({
			objectKey: "updater/sha/release.bin",
		});
		expect(client.multipartUpload).not.toHaveBeenCalled();
	});

	it("uses STS configuration, bounded defaults, progress, and checkpoints", async () => {
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
		expect(OSS_MULTIPART_PARALLELISM).toBe(2);
		expect(onCheckpoint).toHaveBeenCalledTimes(2);
		expect(onCheckpoint).toHaveBeenLastCalledWith(checkpoint);
		expect(onProgress.mock.calls.map(([value]) => value)).toEqual([0, 0.4, 1]);
	});

	it("always supplies the explicit bounded default part size", async () => {
		let options: AliOssMultipartOptions | undefined;
		const client: AliOssClientLike = {
			cancel: vi.fn(),
			multipartUpload: vi.fn(async (_objectKey, _file, nextOptions) => {
				options = nextOptions;
				return { etag: '"object-etag"' };
			}),
		};

		const task = startOssMultipartUpload(baseInput(), {
			createClient: () => client,
		});

		await task.promise;
		expect(options?.partSize).toBe(DEFAULT_OSS_MULTIPART_PART_SIZE);
		expect(MAX_OSS_MULTIPART_IN_FLIGHT_PART_BYTES_PER_FILE).toBe(
			DEFAULT_OSS_MULTIPART_PART_SIZE * OSS_MULTIPART_PARALLELISM,
		);
	});

	it("wires the shared refresh callback into every ali-oss client", async () => {
		const captured: { configuration?: AliOssClientConfiguration } = {};
		const refreshCredentials = vi.fn(async () => ({
			accessKeyId: "refreshed-id",
			accessKeySecret: "refreshed-secret",
			securityToken: "refreshed-token",
		}));
		const client: AliOssClientLike = {
			cancel: vi.fn(),
			multipartUpload: vi.fn(async () => ({ etag: '"etag"' })),
		};
		const task = startOssMultipartUpload(
			{ ...baseInput(), refreshCredentials },
			{
				createClient: (nextConfiguration) => {
					captured.configuration = nextConfiguration;
					return client;
				},
			},
		);

		await task.promise;
		const configuration = captured.configuration;
		if (!configuration?.refreshSTSToken) {
			throw new Error("Refresh callback was not configured.");
		}
		await expect(configuration.refreshSTSToken()).resolves.toEqual({
			accessKeyId: "refreshed-id",
			accessKeySecret: "refreshed-secret",
			stsToken: "refreshed-token",
		});
		expect(configuration.refreshSTSTokenInterval).toBe(
			OSS_STS_REFRESH_INTERVAL_MS,
		);
		expect(refreshCredentials).toHaveBeenCalledOnce();
	});

	it("passes an in-memory checkpoint back when retrying", async () => {
		const input = baseInput();
		const checkpoint = {
			doneParts: [{ etag: "part-1", number: 1 }],
			fileSize: input.file.size,
			name: input.objectKey,
			partSize: DEFAULT_OSS_MULTIPART_PART_SIZE,
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
			{ ...input, checkpoint },
			{ createClient: () => client },
		);

		await expect(task.promise).resolves.toEqual({ objectKey: input.objectKey });
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

	it("aborts the known multipart upload after immediate cancellation", async () => {
		let rejectUpload: ((reason?: unknown) => void) | undefined;
		let publishCheckpoint:
			| ((
					checkpoint: Readonly<Record<string, unknown>>,
			  ) => Promise<void> | void)
			| undefined;
		const abortMultipartUpload = vi.fn(async () => undefined);
		const client: AliOssClientLike = {
			abortMultipartUpload,
			cancel: vi.fn(),
			multipartUpload: vi.fn(
				(_objectKey, _file, options) =>
					new Promise<AliOssMultipartResult>((_resolve, reject) => {
						publishCheckpoint = (_checkpoint) =>
							options.progress(0, _checkpoint);
						rejectUpload = reject;
					}),
			),
		};
		const task = startOssMultipartUpload(baseInput(), {
			createClient: () => client,
		});
		await vi.waitFor(() => expect(publishCheckpoint).toBeTypeOf("function"));
		await publishCheckpoint?.({
			partSize: DEFAULT_OSS_MULTIPART_PART_SIZE,
			uploadId: "upload-known",
		});

		task.cancel();
		expect(client.cancel).toHaveBeenCalledOnce();
		expect(abortMultipartUpload).toHaveBeenCalledWith(
			"updater/sha/release.bin",
			"upload-known",
			{ timeout: 120_000 },
		);
		await expect(task.waitForCleanup()).resolves.toBe("aborted");
		rejectUpload?.({ name: "cancel" });
		await expect(task.promise).rejects.toBeInstanceOf(OssUploadCancelledError);
	});

	it("falls back safely when cancellation happens before an upload ID exists", async () => {
		let rejectUpload: ((reason?: unknown) => void) | undefined;
		const abortMultipartUpload = vi.fn(async () => undefined);
		const client: AliOssClientLike = {
			abortMultipartUpload,
			cancel: vi.fn(),
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
		await expect(task.waitForCleanup()).resolves.toBe("unknown-upload");
		expect(abortMultipartUpload).not.toHaveBeenCalled();
		rejectUpload?.({ name: "cancel" });
		await expect(task.promise).rejects.toBeInstanceOf(OssUploadCancelledError);
	});

	it("aborts a known failed multipart task when the caller discards it", async () => {
		const checkpoint = {
			fileSize: baseInput().file.size,
			name: baseInput().objectKey,
			partSize: DEFAULT_OSS_MULTIPART_PART_SIZE,
			uploadId: "upload-discarded",
		};
		const abortMultipartUpload = vi.fn(async () => undefined);
		const client: AliOssClientLike = {
			abortMultipartUpload,
			cancel: vi.fn(),
			multipartUpload: vi.fn(async (_objectKey, _file, options) => {
				await options.progress(0.25, checkpoint);
				throw new Error("network unavailable");
			}),
		};
		const task = startOssMultipartUpload(baseInput(), {
			createClient: () => client,
		});

		await expect(task.promise).rejects.toThrow("network unavailable");
		task.cancel();
		await expect(task.waitForCleanup()).resolves.toBe("aborted");
		expect(abortMultipartUpload).toHaveBeenCalledWith(
			"updater/sha/release.bin",
			"upload-discarded",
			{ timeout: 120_000 },
		);
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

	it("rejects part sizes that would exceed the deterministic memory bound", () => {
		expect(() =>
			resolveOssMultipartPartSize(1, DEFAULT_OSS_MULTIPART_PART_SIZE + 1),
		).toThrow("partSize must not exceed");
	});

	it("accepts the maximum bounded file size and rejects the next byte", () => {
		expect(MAX_OSS_MULTIPART_FILE_SIZE_BYTES).toBe(
			DEFAULT_OSS_MULTIPART_PART_SIZE * MAX_OSS_MULTIPART_PART_COUNT,
		);
		expect(resolveOssMultipartPartSize(MAX_OSS_MULTIPART_FILE_SIZE_BYTES)).toBe(
			DEFAULT_OSS_MULTIPART_PART_SIZE,
		);
		expect(() =>
			resolveOssMultipartPartSize(MAX_OSS_MULTIPART_FILE_SIZE_BYTES + 1),
		).toThrow(`fileSize must not exceed ${MAX_OSS_MULTIPART_FILE_SIZE_BYTES}`);
		expect(MAX_UPLOAD_SIZE_BYTES).toBe(
			BigInt(MAX_OSS_MULTIPART_FILE_SIZE_BYTES),
		);
	});

	it("rejects a resume checkpoint that changes the bounded part size", () => {
		const input = baseInput();
		expect(() =>
			startOssMultipartUpload(
				{
					...input,
					checkpoint: {
						fileSize: input.file.size,
						name: input.objectKey,
						partSize: DEFAULT_OSS_MULTIPART_PART_SIZE,
						uploadId: "upload-1",
					},
					partSize: 1024 * 1024,
				},
				{ createClient: vi.fn() },
			),
		).toThrow("partSize must match the multipart checkpoint");
	});

	it("rejects an incomplete resume checkpoint before the SDK can resize parts", () => {
		expect(() =>
			startOssMultipartUpload(
				{
					...baseInput(),
					checkpoint: {
						partSize: String(DEFAULT_OSS_MULTIPART_PART_SIZE),
						uploadId: "upload-1",
					},
				},
				{ createClient: vi.fn() },
			),
		).toThrow("checkpoint partSize must be a number");
	});

	it("returns bounded cleanup statuses without leaking provider errors", async () => {
		const sensitiveError = new Error(
			`request failed with ${CREDENTIALS.accessKeySecret}`,
		);
		const client: AliOssClientLike = {
			abortMultipartUpload: vi.fn(async () => {
				throw sensitiveError;
			}),
			cancel: vi.fn(),
			multipartUpload: vi.fn(),
		};
		const result = await abortOssMultipartCheckpoint(
			{
				...baseInput(),
				checkpoint: { uploadId: "upload-failed" },
			},
			{ createClient: () => client },
		);

		expect(result).toBe("failed");
		expect(JSON.stringify(result)).not.toContain(CREDENTIALS.accessKeySecret);
	});

	it("does not create a cleanup client when the checkpoint has no upload ID", async () => {
		const createClient = vi.fn();
		await expect(
			abortOssMultipartCheckpoint(
				{ ...baseInput(), checkpoint: { doneParts: [] } },
				{ createClient },
			),
		).resolves.toBe("unknown-upload");
		expect(createClient).not.toHaveBeenCalled();
	});

	it("does not require a final multipart ETag after the SDK completes", async () => {
		const client: AliOssClientLike = {
			cancel: vi.fn(),
			multipartUpload: vi.fn(async () => ({ res: { headers: {} } })),
		};
		const task = startOssMultipartUpload(baseInput(), {
			createClient: () => client,
		});

		await expect(task.promise).resolves.toEqual({
			objectKey: "updater/sha/release.bin",
		});
	});

	it("normalizes a missing multipart part ETag into an actionable CORS error", async () => {
		const client: AliOssClientLike = {
			cancel: vi.fn(),
			multipartUpload: vi.fn(async () => {
				throw new Error(
					"Please set the etag of expose-headers in OSS part_num: 1",
				);
			}),
		};
		const task = startOssMultipartUpload(baseInput(), {
			createClient: () => client,
		});

		await expect(task.promise).rejects.toBeInstanceOf(
			OssMultipartEtagCorsError,
		);
	});

	it("reports an ambiguous success when a prior attempt already committed the object", async () => {
		const client: AliOssClientLike = {
			cancel: vi.fn(),
			multipartUpload: vi.fn(async () => {
				throw {
					code: "FileAlreadyExists",
					message:
						"The object you specified already exists and can not be overwritten.",
					status: 409,
				};
			}),
		};
		const task = startOssMultipartUpload(baseInput(), {
			createClient: () => client,
		});

		await expect(task.promise).rejects.toBeInstanceOf(
			OssUploadAlreadyExistsError,
		);
	});
});
