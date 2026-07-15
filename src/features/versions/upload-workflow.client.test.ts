import { describe, expect, it, vi } from "vitest";
import { ApiProblemError } from "../../lib/api/client";
import type {
	CompleteUploadItemInput,
	CompleteUploadsRequest,
	CompleteUploadsResponse,
	UploadCredentialsRequest,
	UploadCredentialsResponse,
} from "../../shared/api/uploads";
import {
	MAX_COMPLETE_UPLOAD_FILES,
	UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE,
	UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE,
} from "../../shared/api/uploads";
import type { HashWorkerTask } from "./hash-worker";
import type {
	OssMultipartUploadInput,
	OssMultipartUploadResult,
} from "./oss-uploader.client";
import { OssUploadCancelledError } from "./oss-uploader.client";
import { createUploadQueueController } from "./upload-store";
import type {
	StartUploadWorkflowHashTask,
	StartUploadWorkflowMultipartTask,
} from "./upload-workflow.client";
import {
	createUploadWorkflow,
	UPLOAD_FILE_CONCURRENCY,
	UPLOAD_HASH_CONCURRENCY,
} from "./upload-workflow.client";

vi.mock("ali-oss", () => ({ default: class AliOssStub {} }));

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const CHECKPOINT = {
	doneParts: [{ etag: "part-etag", number: 1 }],
	uploadId: "multipart-upload-id",
};

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	reject(reason?: unknown): void;
	resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
	let resolvePromise!: (value: Value) => void;
	let rejectPromise!: (reason?: unknown) => void;
	const promise = new Promise<Value>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		promise,
		reject: rejectPromise,
		resolve: resolvePromise,
	};
}

function releaseFile(name: string, contents: string): File {
	return new File([contents], name, { type: "application/octet-stream" });
}

function hashForFile(file: File): string {
	return file.name.startsWith("alpha") ? HASH_A : HASH_B;
}

function resolvedHashTask(
	itemId: string,
	sha256: string,
	cancel = vi.fn(),
): HashWorkerTask {
	return { cancel, jobId: itemId, promise: Promise.resolve(sha256) };
}

function credentialsResponse(
	request: UploadCredentialsRequest,
): UploadCredentialsResponse {
	return {
		bucket: "release-bucket",
		credentials: {
			accessKeyId: "temporary-access-key",
			accessKeySecret: "temporary-secret",
			expiration: "2099-07-15T05:00:00.000Z",
			securityToken: "temporary-token",
		},
		// Reverse the response to prove that targets are joined by canonical path.
		objects: request.files
			.map(({ path, sha256 }) => ({
				objectKey: `releases/${sha256}/${path}`,
				path,
			}))
			.reverse(),
		region: "oss-cn-hangzhou",
	};
}

function completedFile(
	file: CompleteUploadItemInput,
): CompleteUploadsResponse["files"][number] {
	const submittedEtag = file.objectEtag ?? `"etag:${file.objectKey}"`;
	const objectEtag =
		submittedEtag.startsWith('"') && submittedEtag.endsWith('"')
			? submittedEtag.slice(1, -1)
			: submittedEtag;
	return {
		checksumAlgorithm: "sha256",
		createdAt: "2026-07-15T04:00:00.000Z",
		id: `metadata:${file.path}`,
		mimeType: file.mimeType,
		objectEtag,
		path: file.path,
		sha256: file.sha256,
		size: file.size,
		updatedAt: "2026-07-15T04:00:00.000Z",
	};
}

function apiProblem(
	code: string,
	status: number,
	fieldErrors?: readonly { readonly code: string; readonly path: string }[],
): ApiProblemError {
	return new ApiProblemError({
		code,
		...(fieldErrors ? { fieldErrors } : {}),
		requestId: "request-id",
		status,
		title: code,
		type: "https://updater.example/problems/upload",
	});
}

function missingObjectProblem(): ApiProblemError {
	return apiProblem(UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE, 409, [
		{ code: UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE, path: "files.0.objectKey" },
	]);
}

async function completeUploadedOrReportMissing(
	request: CompleteUploadsRequest,
): Promise<CompleteUploadsResponse> {
	if (request.files.some(({ objectEtag }) => objectEtag === undefined)) {
		throw missingObjectProblem();
	}
	return completionResponse(request);
}

function completionResponse(
	request: CompleteUploadsRequest,
): CompleteUploadsResponse {
	return {
		// Reverse the response to prove that metadata IDs are joined by path.
		files: request.files.map(completedFile).reverse(),
	};
}

function successfulUploader(
	uploads: OssMultipartUploadInput[],
): StartUploadWorkflowMultipartTask {
	return (input) => {
		uploads.push(input);
		input.onProgress?.(0.5);
		return {
			cancel: vi.fn(),
			promise: Promise.resolve({
				objectEtag: `"etag:${input.objectKey}"`,
				objectKey: input.objectKey,
			}),
		};
	};
}

function addTwoFiles(queue: ReturnType<typeof createUploadQueueController>) {
	return queue.addFiles([
		{ file: releaseFile("alpha.bin", "alpha"), path: "bin/alpha.bin" },
		{ file: releaseFile("beta.bin", "beta"), path: "assets/beta.bin" },
	]);
}

describe("browser upload workflow", () => {
	it("runs one credentials batch, maps targets and ETags by path, and exposes ordered completed IDs", async () => {
		const queue = createUploadQueueController({ storage: null });
		addTwoFiles(queue);
		const credentialsRequests: UploadCredentialsRequest[] = [];
		const completionRequests: CompleteUploadsRequest[] = [];
		const uploads: OssMultipartUploadInput[] = [];
		const hashCalls: string[] = [];
		const startHashTask: StartUploadWorkflowHashTask = (input) => {
			hashCalls.push(input.file.name);
			input.onProgress(1);
			return resolvedHashTask(input.itemId, hashForFile(input.file));
		};
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => {
				completionRequests.push(request);
				return completionResponse(request);
			},
			requestCredentials: async (request) => {
				credentialsRequests.push(request);
				return credentialsResponse(request);
			},
			startHashTask,
			startUploadTask: successfulUploader(uploads),
		});

		await workflow.start();

		expect(hashCalls).toEqual(["alpha.bin", "beta.bin"]);
		expect(credentialsRequests).toHaveLength(1);
		expect(credentialsRequests[0]?.files.map(({ path }) => path)).toEqual([
			"bin/alpha.bin",
			"assets/beta.bin",
		]);
		expect(uploads.map(({ objectKey }) => objectKey)).toEqual([
			`releases/${HASH_A}/bin/alpha.bin`,
			`releases/${HASH_B}/assets/beta.bin`,
		]);
		expect(completionRequests).toHaveLength(1);
		expect(
			completionRequests[0]?.files.map(({ objectEtag, objectKey, path }) => ({
				objectEtag,
				objectKey,
				path,
			})),
		).toEqual([
			{
				objectEtag: `"etag:releases/${HASH_A}/bin/alpha.bin"`,
				objectKey: `releases/${HASH_A}/bin/alpha.bin`,
				path: "bin/alpha.bin",
			},
			{
				objectEtag: `"etag:releases/${HASH_B}/assets/beta.bin"`,
				objectKey: `releases/${HASH_B}/assets/beta.bin`,
				path: "assets/beta.bin",
			},
		]);
		expect(workflow.getCompletedFileMetadataIds()).toEqual([
			"metadata:bin/alpha.bin",
			"metadata:assets/beta.bin",
		]);
		expect(
			queue.getState().items.every(({ status }) => status === "complete"),
		).toBe(true);
		queue.dispose();
	});

	it("chunks completion HEAD verification while preserving the selected file order", async () => {
		const queue = createUploadQueueController({ storage: null });
		const fileCount = MAX_COMPLETE_UPLOAD_FILES * 2 + 3;
		queue.addFiles(
			Array.from({ length: fileCount }, (_, index) => ({
				file: releaseFile(`file-${index}.bin`, String(index)),
				path: `release/file-${index}.bin`,
			})),
		);
		const completionRequests: CompleteUploadsRequest[] = [];
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => {
				completionRequests.push(request);
				return completionResponse(request);
			},
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) => resolvedHashTask(input.itemId, HASH_A),
			startUploadTask: successfulUploader([]),
		});

		await workflow.start();

		expect(completionRequests.map(({ files }) => files.length)).toEqual([
			MAX_COMPLETE_UPLOAD_FILES,
			MAX_COMPLETE_UPLOAD_FILES,
			3,
		]);
		expect(workflow.getCompletedFileMetadataIds()).toEqual(
			Array.from(
				{ length: fileCount },
				(_, index) => `metadata:release/file-${index}.bin`,
			),
		);
		queue.dispose();
	});

	it("requests a new object target when the same path is reselected with new content", async () => {
		const queue = createUploadQueueController({ storage: null });
		const credentialRequests: UploadCredentialsRequest[] = [];
		const uploads: OssMultipartUploadInput[] = [];
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async (request) => {
				credentialRequests.push(request);
				return credentialsResponse(request);
			},
			startHashTask: (input) =>
				resolvedHashTask(input.itemId, hashForFile(input.file)),
			startUploadTask: successfulUploader(uploads),
		});
		const [first] = queue.addFiles([
			{ file: releaseFile("alpha.bin", "alpha"), path: "bin/app.bin" },
		]);
		if (!first) throw new Error("fixture was not created");

		await workflow.start();
		await workflow.discard(first.id);
		queue.addFiles([
			{ file: releaseFile("beta.bin", "beta"), path: "bin/app.bin" },
		]);
		await workflow.start();

		expect(credentialRequests).toHaveLength(2);
		expect(credentialRequests.map(({ files }) => files[0]?.sha256)).toEqual([
			HASH_A,
			HASH_B,
		]);
		expect(uploads.map(({ objectKey }) => objectKey)).toEqual([
			`releases/${HASH_A}/bin/app.bin`,
			`releases/${HASH_B}/bin/app.bin`,
		]);
		queue.dispose();
	});

	it("retries only the failed hash before continuing the batch", async () => {
		const queue = createUploadQueueController({ storage: null });
		const [alpha] = addTwoFiles(queue);
		if (!alpha) throw new Error("fixture was not created");
		const hashAttempts = new Map<string, number>();
		const credentialRequests: UploadCredentialsRequest[] = [];
		const uploads: OssMultipartUploadInput[] = [];
		const startHashTask: StartUploadWorkflowHashTask = (input) => {
			const attempt = (hashAttempts.get(input.file.name) ?? 0) + 1;
			hashAttempts.set(input.file.name, attempt);
			if (input.file.name === "alpha.bin" && attempt === 1) {
				return {
					cancel: vi.fn(),
					jobId: input.itemId,
					promise: Promise.reject(new Error("hash worker crashed")),
				};
			}
			return resolvedHashTask(input.itemId, hashForFile(input.file));
		};
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async (request) => {
				credentialRequests.push(request);
				return credentialsResponse(request);
			},
			startHashTask,
			startUploadTask: successfulUploader(uploads),
		});

		await expect(workflow.start()).rejects.toThrow("hash worker crashed");
		expect(queue.getState().items).toMatchObject([
			{ failedStage: "hash", status: "failed" },
			{ status: "ready" },
		]);
		expect(credentialRequests).toHaveLength(0);

		await expect(workflow.retry(alpha.id)).resolves.toBe("hash");
		expect(hashAttempts).toEqual(
			new Map([
				["alpha.bin", 2],
				["beta.bin", 1],
			]),
		);
		expect(credentialRequests).toHaveLength(1);
		expect(uploads).toHaveLength(2);
		expect(workflow.getCompletedFileMetadataIds()).toHaveLength(2);
		queue.dispose();
	});

	it("queues a failed-file retry while another file in the folder is still running", async () => {
		const queue = createUploadQueueController({ storage: null });
		const [alpha] = addTwoFiles(queue);
		if (!alpha) throw new Error("fixture was not created");
		const betaHash = deferred<string>();
		let alphaAttempts = 0;
		const uploads: OssMultipartUploadInput[] = [];
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) => {
				if (input.file.name === "beta.bin") {
					return {
						cancel: vi.fn(),
						jobId: input.itemId,
						promise: betaHash.promise,
					};
				}
				alphaAttempts += 1;
				return alphaAttempts === 1
					? {
							cancel: vi.fn(),
							jobId: input.itemId,
							promise: Promise.reject(new Error("alpha hash failed")),
						}
					: resolvedHashTask(input.itemId, HASH_A);
			},
			startUploadTask: successfulUploader(uploads),
		});

		const startPromise = workflow.start();
		await vi.waitFor(() =>
			expect(queue.getState().items[0]).toMatchObject({
				failedStage: "hash",
				status: "failed",
			}),
		);
		const retryPromise = workflow.retry(alpha.id);
		let retrySettled = false;
		void retryPromise.finally(() => {
			retrySettled = true;
		});
		await Promise.resolve();
		expect(retrySettled).toBe(false);
		expect(workflow.isRunning()).toBe(true);

		betaHash.resolve(HASH_B);
		await expect(startPromise).rejects.toThrow("alpha hash failed");
		await expect(retryPromise).resolves.toBe("hash");

		expect(alphaAttempts).toBe(2);
		expect(uploads).toHaveLength(2);
		expect(workflow.getCompletedFileMetadataIds()).toHaveLength(2);
		expect(workflow.isRunning()).toBe(false);
		queue.dispose();
	});

	it("treats a queued retry as cancelled when its row is discarded", async () => {
		const queue = createUploadQueueController({ storage: null });
		const [alpha] = addTwoFiles(queue);
		if (!alpha) throw new Error("fixture was not created");
		const betaHash = deferred<string>();
		const uploads: OssMultipartUploadInput[] = [];
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) =>
				input.file.name === "beta.bin"
					? {
							cancel: vi.fn(),
							jobId: input.itemId,
							promise: betaHash.promise,
						}
					: {
							cancel: vi.fn(),
							jobId: input.itemId,
							promise: Promise.reject(new Error("alpha hash failed")),
						},
			startUploadTask: successfulUploader(uploads),
		});

		const startPromise = workflow.start();
		await vi.waitFor(() =>
			expect(queue.getState().items[0]).toMatchObject({ status: "failed" }),
		);
		const retryPromise = workflow.retry(alpha.id);
		await workflow.discard(alpha.id);
		betaHash.resolve(HASH_B);

		await expect(startPromise).rejects.toThrow("alpha hash failed");
		await expect(retryPromise).resolves.toBeNull();
		await workflow.start();
		expect(uploads).toHaveLength(1);
		expect(queue.getState().items).toHaveLength(1);
		expect(queue.getState().items[0]?.status).toBe("complete");
		queue.dispose();
	});

	it("preserves the multipart checkpoint and retries only the failed upload", async () => {
		const queue = createUploadQueueController({ storage: null });
		const [alpha] = addTwoFiles(queue);
		if (!alpha) throw new Error("fixture was not created");
		const uploadAttempts = new Map<string, number>();
		const uploadInputs: OssMultipartUploadInput[] = [];
		const credentialRequests: UploadCredentialsRequest[] = [];
		let completionCalls = 0;
		const startUploadTask: StartUploadWorkflowMultipartTask = (input) => {
			uploadInputs.push(input);
			const attempt = (uploadAttempts.get(input.objectKey) ?? 0) + 1;
			uploadAttempts.set(input.objectKey, attempt);
			if (input.objectKey.includes("alpha.bin") && attempt === 1) {
				input.onCheckpoint?.(CHECKPOINT);
				return {
					cancel: vi.fn(),
					promise: Promise.reject(new Error("OSS connection reset")),
				};
			}
			return {
				cancel: vi.fn(),
				promise: Promise.resolve({
					objectEtag: `"etag:${input.objectKey}"`,
					objectKey: input.objectKey,
				}),
			};
		};
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => {
				if (request.files.some(({ objectEtag }) => objectEtag === undefined)) {
					throw missingObjectProblem();
				}
				completionCalls += 1;
				return completionResponse(request);
			},
			requestCredentials: async (request) => {
				credentialRequests.push(request);
				return credentialsResponse(request);
			},
			startHashTask: (input) =>
				resolvedHashTask(input.itemId, hashForFile(input.file)),
			startUploadTask,
		});

		await expect(workflow.start()).rejects.toThrow("OSS connection reset");
		expect(queue.getState().items).toMatchObject([
			{ checkpoint: CHECKPOINT, failedStage: "upload", status: "failed" },
			{ status: "uploaded" },
		]);
		expect(completionCalls).toBe(0);

		await expect(workflow.retry(alpha.id)).resolves.toBe("upload");
		expect(credentialRequests).toHaveLength(1);
		expect(uploadInputs).toHaveLength(3);
		expect(uploadInputs[2]?.checkpoint).toBe(CHECKPOINT);
		expect(completionCalls).toBe(1);
		expect(workflow.getCompletedFileMetadataIds()).toHaveLength(2);
		queue.dispose();
	});

	it("refreshes nearly expired STS credentials before retrying the same object target", async () => {
		const queue = createUploadQueueController({ storage: null });
		const [alpha] = queue.addFiles([
			{ file: releaseFile("alpha.bin", "alpha"), path: "bin/alpha.bin" },
		]);
		if (!alpha) throw new Error("fixture was not created");
		let now = 0;
		let credentialCalls = 0;
		let hashCalls = 0;
		const uploadInputs: OssMultipartUploadInput[] = [];
		const startUploadTask: StartUploadWorkflowMultipartTask = (input) => {
			uploadInputs.push(input);
			if (uploadInputs.length === 1) {
				input.onCheckpoint?.(CHECKPOINT);
				return {
					cancel: vi.fn(),
					promise: Promise.reject(new Error("temporary upload failure")),
				};
			}
			return {
				cancel: vi.fn(),
				promise: Promise.resolve({
					objectEtag: `"etag:${input.objectKey}"`,
					objectKey: input.objectKey,
				}),
			};
		};
		const workflow = createUploadWorkflow(queue, {
			completeUploads: completeUploadedOrReportMissing,
			now: () => now,
			requestCredentials: async (request) => {
				credentialCalls += 1;
				const response = credentialsResponse(request);
				return {
					...response,
					credentials: {
						...response.credentials,
						accessKeyId: `temporary-access-key-${credentialCalls}`,
						expiration: new Date(now + 120_000).toISOString(),
					},
				};
			},
			startHashTask: (input) => {
				hashCalls += 1;
				return resolvedHashTask(input.itemId, HASH_A);
			},
			startUploadTask,
		});

		await expect(workflow.start()).rejects.toThrow("temporary upload failure");
		expect(credentialCalls).toBe(1);
		now = 70_000;

		await expect(workflow.retry(alpha.id)).resolves.toBe("upload");
		expect(credentialCalls).toBe(2);
		expect(hashCalls).toBe(1);
		expect(uploadInputs).toHaveLength(2);
		expect(uploadInputs[1]).toMatchObject({
			checkpoint: CHECKPOINT,
			credentials: { accessKeyId: "temporary-access-key-2" },
			objectKey: uploadInputs[0]?.objectKey,
		});
		expect(workflow.getCompletedFileMetadataIds()).toEqual([
			"metadata:bin/alpha.bin",
		]);
		queue.dispose();
	});

	it("retries one failed completion batch without rehashing or reuploading", async () => {
		const queue = createUploadQueueController({ storage: null });
		const [alpha] = addTwoFiles(queue);
		if (!alpha) throw new Error("fixture was not created");
		const uploads: OssMultipartUploadInput[] = [];
		const completionRequests: CompleteUploadsRequest[] = [];
		let hashCalls = 0;
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => {
				completionRequests.push(request);
				if (completionRequests.length === 1) {
					throw new Error("metadata transaction unavailable");
				}
				return completionResponse(request);
			},
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) => {
				hashCalls += 1;
				return resolvedHashTask(input.itemId, hashForFile(input.file));
			},
			startUploadTask: successfulUploader(uploads),
		});

		await expect(workflow.start()).rejects.toThrow(
			"metadata transaction unavailable",
		);
		const uploadedProofs = queue
			.getState()
			.items.map(({ objectEtag, objectKey, sha256 }) => ({
				objectEtag,
				objectKey,
				sha256,
			}));
		expect(queue.getState().items).toMatchObject([
			{ failedStage: "registration", status: "failed" },
			{ failedStage: "registration", status: "failed" },
		]);

		await expect(workflow.retry(alpha.id)).resolves.toBe("registration");
		expect(hashCalls).toBe(2);
		expect(uploads).toHaveLength(2);
		expect(completionRequests).toHaveLength(2);
		expect(
			queue.getState().items.map(({ objectEtag, objectKey, sha256 }) => ({
				objectEtag,
				objectKey,
				sha256,
			})),
		).toEqual(uploadedProofs);
		const completedIds = workflow.getCompletedFileMetadataIds();
		expect(completedIds).toEqual([
			"metadata:bin/alpha.bin",
			"metadata:assets/beta.bin",
		]);

		await workflow.start();
		expect(workflow.getCompletedFileMetadataIds()).toEqual(completedIds);
		expect(completionRequests).toHaveLength(2);
		queue.dispose();
	});

	it("cancels an active per-file upload and resumes that exact stage", async () => {
		const queue = createUploadQueueController({ storage: null });
		const [alpha] = queue.addFiles([
			{ file: releaseFile("alpha.bin", "alpha"), path: "bin/alpha.bin" },
		]);
		if (!alpha) throw new Error("fixture was not created");
		let uploadAttempts = 0;
		let firstUploadStarted: (() => void) | undefined;
		const uploadStarted = new Promise<void>((resolve) => {
			firstUploadStarted = resolve;
		});
		let rejectFirstUpload: ((reason?: unknown) => void) | undefined;
		const uploadInputs: OssMultipartUploadInput[] = [];
		const startUploadTask: StartUploadWorkflowMultipartTask = (input) => {
			uploadAttempts += 1;
			uploadInputs.push(input);
			if (uploadAttempts === 1) {
				input.onCheckpoint?.(CHECKPOINT);
				const promise = new Promise<OssMultipartUploadResult>(
					(_resolve, reject) => {
						rejectFirstUpload = reject;
						firstUploadStarted?.();
					},
				);
				return {
					cancel: () => rejectFirstUpload?.(new OssUploadCancelledError()),
					promise,
				};
			}
			return {
				cancel: vi.fn(),
				promise: Promise.resolve({
					objectEtag: `"etag:${input.objectKey}"`,
					objectKey: input.objectKey,
				}),
			};
		};
		let hashCalls = 0;
		const workflow = createUploadWorkflow(queue, {
			completeUploads: completeUploadedOrReportMissing,
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) => {
				hashCalls += 1;
				return resolvedHashTask(input.itemId, HASH_A);
			},
			startUploadTask,
		});

		const running = workflow.start();
		await uploadStarted;
		expect(workflow.isRunning()).toBe(true);
		expect(workflow.cancel(alpha.id)).toBe("upload");
		await expect(running).rejects.toBeInstanceOf(OssUploadCancelledError);
		expect(queue.getState().items[0]).toMatchObject({
			checkpoint: CHECKPOINT,
			failedStage: "upload",
			status: "cancelled",
		});

		await expect(workflow.retry(alpha.id)).resolves.toBe("upload");
		expect(hashCalls).toBe(1);
		expect(uploadAttempts).toBe(2);
		expect(uploadInputs[1]?.checkpoint).toBeNull();
		expect(workflow.getCompletedFileMetadataIds()).toEqual([
			"metadata:bin/alpha.bin",
		]);
		queue.dispose();
	});

	it("aborts a settled multipart checkpoint before removing a failed row", async () => {
		const queue = createUploadQueueController({ storage: null });
		const [item] = queue.addFiles([
			{ file: releaseFile("alpha.bin", "alpha"), path: "bin/alpha.bin" },
		]);
		if (!item) throw new Error("fixture was not created");
		const abortCheckpoint = vi.fn(async () => "aborted" as const);
		const workflow = createUploadWorkflow(queue, {
			abortCheckpoint,
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) => resolvedHashTask(input.itemId, HASH_A),
			startUploadTask: (input) => {
				input.onCheckpoint?.(CHECKPOINT);
				return {
					cancel: vi.fn(),
					promise: Promise.reject(new Error("multipart connection failed")),
				};
			},
		});

		await expect(workflow.start()).rejects.toThrow(
			"multipart connection failed",
		);
		await workflow.discard(item.id);

		expect(abortCheckpoint).toHaveBeenCalledWith(
			expect.objectContaining({
				bucket: "release-bucket",
				checkpoint: CHECKPOINT,
				objectKey: `releases/${HASH_A}/bin/alpha.bin`,
				region: "oss-cn-hangzhou",
			}),
		);
		expect(queue.getState().items).toHaveLength(0);
		queue.dispose();
	});

	it("reconciles a cancelled upload that committed before cancellation won the race", async () => {
		const queue = createUploadQueueController({ storage: null });
		const [item] = queue.addFiles([
			{ file: releaseFile("alpha.bin", "alpha"), path: "bin/alpha.bin" },
		]);
		if (!item) throw new Error("fixture was not created");
		const uploadStarted = deferred<void>();
		const uploadResult = deferred<OssMultipartUploadResult>();
		const uploadInputs: OssMultipartUploadInput[] = [];
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) => resolvedHashTask(input.itemId, HASH_A),
			startUploadTask: (input) => {
				uploadInputs.push(input);
				uploadStarted.resolve();
				return {
					cancel: () => uploadResult.reject(new OssUploadCancelledError()),
					promise: uploadResult.promise,
				};
			},
		});

		const running = workflow.start();
		await uploadStarted.promise;
		expect(workflow.cancel(item.id)).toBe("upload");
		await expect(running).rejects.toBeInstanceOf(OssUploadCancelledError);
		await expect(workflow.retry(item.id)).resolves.toBe("upload");

		expect(uploadInputs).toHaveLength(1);
		expect(queue.getState().items[0]).toMatchObject({
			attempt: 1,
			fileMetadataId: "metadata:bin/alpha.bin",
			status: "complete",
		});
		queue.dispose();
	});

	it("bounds hash workers independently of the selected file count", async () => {
		const queue = createUploadQueueController({ storage: null });
		const fileCount = UPLOAD_HASH_CONCURRENCY * 3 + 1;
		queue.addFiles(
			Array.from({ length: fileCount }, (_, index) => ({
				file: releaseFile(`file-${index}.bin`, String(index)),
				path: `files/file-${index}.bin`,
			})),
		);
		const gates = Array.from({ length: fileCount }, () => deferred<void>());
		const started: string[] = [];
		let active = 0;
		let maximumActive = 0;
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) => {
				const index = Number.parseInt(input.file.name.slice(5), 10);
				const gate = gates[index];
				if (!gate) throw new Error("missing hash gate");
				started.push(input.file.name);
				active += 1;
				maximumActive = Math.max(maximumActive, active);
				return {
					cancel: vi.fn(),
					jobId: input.itemId,
					promise: gate.promise
						.then(() => HASH_A)
						.finally(() => {
							active -= 1;
						}),
				};
			},
			startUploadTask: successfulUploader([]),
		});

		const running = workflow.start();
		await vi.waitFor(() => {
			expect(started).toHaveLength(UPLOAD_HASH_CONCURRENCY);
		});
		for (let index = 0; index < fileCount; index += 1) {
			gates[index]?.resolve();
			const expectedStarted = Math.min(
				fileCount,
				index + UPLOAD_HASH_CONCURRENCY + 1,
			);
			await vi.waitFor(() => {
				expect(started.length).toBeGreaterThanOrEqual(expectedStarted);
			});
		}
		await running;

		expect(maximumActive).toBe(UPLOAD_HASH_CONCURRENCY);
		expect(started).toEqual(
			Array.from({ length: fileCount }, (_, index) => `file-${index}.bin`),
		);
		queue.dispose();
	});

	it("bounds concurrent files while retaining per-file multipart behavior", async () => {
		const queue = createUploadQueueController({ storage: null });
		const fileCount = UPLOAD_FILE_CONCURRENCY * 2 + 1;
		queue.addFiles(
			Array.from({ length: fileCount }, (_, index) => ({
				file: releaseFile(`file-${index}.bin`, String(index)),
				path: `files/file-${index}.bin`,
			})),
		);
		const gates = Array.from({ length: fileCount }, () =>
			deferred<OssMultipartUploadResult>(),
		);
		const started: string[] = [];
		let active = 0;
		let maximumActive = 0;
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) => resolvedHashTask(input.itemId, HASH_A),
			startUploadTask: (input) => {
				const index = Number.parseInt(input.file.name.slice(5), 10);
				const gate = gates[index];
				if (!gate) throw new Error("missing upload gate");
				started.push(input.file.name);
				active += 1;
				maximumActive = Math.max(maximumActive, active);
				return {
					cancel: vi.fn(),
					promise: gate.promise.finally(() => {
						active -= 1;
					}),
				};
			},
		});

		const running = workflow.start();
		await vi.waitFor(() => {
			expect(started).toHaveLength(UPLOAD_FILE_CONCURRENCY);
		});
		for (let index = 0; index < fileCount; index += 1) {
			const item = queue.getState().items[index];
			if (!item?.objectKey) throw new Error("missing upload target");
			gates[index]?.resolve({
				objectEtag: `"etag:${item.objectKey}"`,
				objectKey: item.objectKey,
			});
			const expectedStarted = Math.min(
				fileCount,
				index + UPLOAD_FILE_CONCURRENCY + 1,
			);
			await vi.waitFor(() => {
				expect(started.length).toBeGreaterThanOrEqual(expectedStarted);
			});
		}
		await running;

		expect(maximumActive).toBe(UPLOAD_FILE_CONCURRENCY);
		expect(started).toEqual(
			Array.from({ length: fileCount }, (_, index) => `file-${index}.bin`),
		);
		queue.dispose();
	});

	it("ignores late hash callbacks after cancel and immediate removal", async () => {
		const queue = createUploadQueueController({ storage: null });
		const [item] = queue.addFiles([
			{ file: releaseFile("alpha.bin", "alpha"), path: "bin/alpha.bin" },
		]);
		if (!item) throw new Error("fixture was not created");
		const result = deferred<string>();
		let reportProgress: ((progress: number) => void) | undefined;
		let started: (() => void) | undefined;
		const taskStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) => {
				reportProgress = input.onProgress;
				started?.();
				return {
					cancel: () => result.reject(new Error("hash cancelled")),
					jobId: input.itemId,
					promise: result.promise,
				};
			},
			startUploadTask: successfulUploader([]),
		});

		const running = workflow.start();
		await taskStarted;
		expect(workflow.cancel(item.id)).toBe("hash");
		queue.remove(item.id);
		expect(() => reportProgress?.(0.75)).not.toThrow();
		expect(() => workflow.dispose()).not.toThrow();
		await expect(running).resolves.toBeUndefined();
		expect(queue.getState().items).toHaveLength(0);
		queue.dispose();
	});

	it("skips a queued file removed while it waits for a hash worker", async () => {
		const queue = createUploadQueueController({ storage: null });
		const items = queue.addFiles(
			Array.from({ length: UPLOAD_HASH_CONCURRENCY + 1 }, (_, index) => ({
				file: releaseFile(`file-${index}.bin`, String(index)),
				path: `files/file-${index}.bin`,
			})),
		);
		const waiting = items.at(-1);
		if (!waiting) throw new Error("fixture was not created");
		const gates = items.map(() => deferred<string>());
		let started = 0;
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) => {
				const index = Number.parseInt(input.file.name.slice(5), 10);
				const gate = gates[index];
				if (!gate) throw new Error("missing hash gate");
				started += 1;
				return {
					cancel: vi.fn(),
					jobId: input.itemId,
					promise: gate.promise,
				};
			},
			startUploadTask: successfulUploader([]),
		});

		const running = workflow.start();
		await vi.waitFor(() => {
			expect(started).toBe(UPLOAD_HASH_CONCURRENCY);
		});
		expect(workflow.cancel(waiting.id)).toBe("hash");
		queue.remove(waiting.id);
		for (const gate of gates.slice(0, UPLOAD_HASH_CONCURRENCY)) {
			gate.resolve(HASH_A);
		}

		await expect(running).resolves.toBeUndefined();
		expect(started).toBe(UPLOAD_HASH_CONCURRENCY);
		expect(queue.getState().items).toHaveLength(UPLOAD_HASH_CONCURRENCY);
		queue.dispose();
	});

	it("ignores late upload progress, checkpoint, and result after removal", async () => {
		const queue = createUploadQueueController({ storage: null });
		const [item] = queue.addFiles([
			{ file: releaseFile("alpha.bin", "alpha"), path: "bin/alpha.bin" },
		]);
		if (!item) throw new Error("fixture was not created");
		const result = deferred<OssMultipartUploadResult>();
		let uploadInput: OssMultipartUploadInput | undefined;
		let started: (() => void) | undefined;
		const taskStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) => resolvedHashTask(input.itemId, HASH_A),
			startUploadTask: (input) => {
				uploadInput = input;
				started?.();
				return { cancel: vi.fn(), promise: result.promise };
			},
		});

		const running = workflow.start();
		await taskStarted;
		expect(workflow.cancel(item.id)).toBe("upload");
		queue.remove(item.id);
		expect(() => uploadInput?.onProgress?.(0.8)).not.toThrow();
		expect(() => uploadInput?.onCheckpoint?.(CHECKPOINT)).not.toThrow();
		expect(() => workflow.dispose()).not.toThrow();
		if (!uploadInput) throw new Error("upload did not start");
		result.resolve({
			objectEtag: "late-etag",
			objectKey: uploadInput.objectKey,
		});
		await expect(running).resolves.toBeUndefined();
		expect(queue.getState().items).toHaveLength(0);
		queue.dispose();
	});

	it("reconciles a committed multipart upload after its browser response is lost", async () => {
		const queue = createUploadQueueController({ storage: null });
		const [item] = queue.addFiles([
			{ file: releaseFile("alpha.bin", "alpha"), path: "bin/alpha.bin" },
		]);
		if (!item) throw new Error("fixture was not created");
		const completionRequests: CompleteUploadsRequest[] = [];
		const uploadInputs: OssMultipartUploadInput[] = [];
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => {
				completionRequests.push(request);
				return completionResponse(request);
			},
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) => resolvedHashTask(input.itemId, HASH_A),
			startUploadTask: (input) => {
				uploadInputs.push(input);
				return {
					cancel: vi.fn(),
					promise: Promise.reject(
						new Error("OSS committed but the response was lost"),
					),
				};
			},
		});

		await expect(workflow.start()).rejects.toThrow("response was lost");
		await expect(workflow.retry(item.id)).resolves.toBe("upload");

		expect(uploadInputs).toHaveLength(1);
		expect(completionRequests).toHaveLength(1);
		expect(completionRequests[0]?.files[0]).not.toHaveProperty("objectEtag");
		expect(queue.getState().items[0]).toMatchObject({
			attempt: 1,
			fileMetadataId: "metadata:bin/alpha.bin",
			objectEtag: `etag:${uploadInputs[0]?.objectKey}`,
			status: "complete",
		});
		expect(workflow.getCompletedFileMetadataIds()).toEqual([
			"metadata:bin/alpha.bin",
		]);
		queue.dispose();
	});

	it.each([
		{
			label: "size conflict",
			problem: () =>
				apiProblem("UPLOAD_METADATA_CONFLICT", 409, [
					{ code: "CONFLICT", path: "files.0.size" },
				]),
		},
		{
			label: "ETag conflict",
			problem: () =>
				apiProblem("UPLOAD_METADATA_CONFLICT", 409, [
					{ code: "CONFLICT", path: "files.0.objectEtag" },
				]),
		},
		{
			label: "object-key metadata conflict",
			problem: () =>
				apiProblem("UPLOAD_METADATA_CONFLICT", 409, [
					{ code: "CONFLICT", path: "files.0.objectKey" },
				]),
		},
		{
			label: "verification outage",
			problem: () => apiProblem("UPLOAD_VERIFICATION_UNAVAILABLE", 503),
		},
	])("does not re-upload after a reconciliation $label and remains retryable", async ({
		problem,
	}) => {
		const queue = createUploadQueueController({ storage: null });
		const [item] = queue.addFiles([
			{ file: releaseFile("alpha.bin", "alpha"), path: "bin/alpha.bin" },
		]);
		if (!item) throw new Error("fixture was not created");
		let reconciliation: "error" | "missing" = "error";
		const uploadInputs: OssMultipartUploadInput[] = [];
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => {
				if (request.files[0]?.objectEtag === undefined) {
					if (reconciliation === "error") throw problem();
					throw missingObjectProblem();
				}
				return completionResponse(request);
			},
			requestCredentials: async (request) => credentialsResponse(request),
			startHashTask: (input) => resolvedHashTask(input.itemId, HASH_A),
			startUploadTask: (input) => {
				uploadInputs.push(input);
				return {
					cancel: vi.fn(),
					promise:
						uploadInputs.length === 1
							? Promise.reject(new Error("ambiguous upload failure"))
							: Promise.resolve({
									objectEtag: `"etag:${input.objectKey}"`,
									objectKey: input.objectKey,
								}),
				};
			},
		});

		await expect(workflow.start()).rejects.toThrow("ambiguous upload failure");
		await expect(workflow.retry(item.id)).rejects.toBeInstanceOf(
			ApiProblemError,
		);
		expect(uploadInputs).toHaveLength(1);
		expect(queue.getState().items[0]).toMatchObject({
			failedStage: "upload",
			status: "failed",
		});

		reconciliation = "missing";
		await expect(workflow.retry(item.id)).resolves.toBe("upload");
		expect(uploadInputs).toHaveLength(2);
		expect(queue.getState().items[0]?.status).toBe("complete");
		queue.dispose();
	});
});
