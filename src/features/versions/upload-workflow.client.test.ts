import { describe, expect, it, vi } from "vitest";

import { ApiProblemError } from "../../lib/api/client";
import type {
	CompleteUploadItemInput,
	CompleteUploadsRequest,
	ResolveDraftFilesRequest,
	UploadCredentialsResponse,
} from "../../shared/api/uploads";
import {
	MAX_COMPLETE_UPLOAD_FILES,
	MAX_RESOLVE_DRAFT_FILES,
	UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE,
	UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE,
} from "../../shared/api/uploads";
import type { HashWorkerTask } from "./hash-worker";
import type {
	OssMultipartUploadInput,
	OssMultipartUploadResult,
} from "./oss-uploader.client";
import { OssUploadAlreadyExistsError } from "./oss-uploader.client";
import { createUploadQueueController } from "./upload-store";
import {
	createUploadWorkflow,
	UPLOAD_FILE_CONCURRENCY,
	UPLOAD_HASH_CONCURRENCY,
	UPLOAD_HASH_RESULT_BATCH_SIZE,
	UPLOAD_REGISTRATION_CONCURRENCY,
	UPLOAD_RESOLUTION_CONCURRENCY,
} from "./upload-workflow.client";

vi.mock("ali-oss", () => ({ default: class AliOssStub {} }));

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const VERSION_ID = "31ddcbe4-4a31-4c35-9738-e88d974a20f4";
const HASH_A = "a".repeat(64);
const CHECKPOINT = {
	doneParts: [{ etag: "part-etag", number: 1 }],
	fileSize: 1,
	name: `releases/${HASH_A}/release/file-0.bin`,
	partSize: 4 * 1024 * 1024,
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
	return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function releaseFile(index: number): File {
	return new File([String(index)], `file-${index}.bin`, {
		type: "application/octet-stream",
	});
}

function addFiles(
	queue: ReturnType<typeof createUploadQueueController>,
	count: number,
) {
	queue.addFiles(
		Array.from({ length: count }, (_, index) => ({
			file: releaseFile(index),
			path: `release/file-${index}.bin`,
		})),
	);
}

function hashTask(itemId: string): HashWorkerTask {
	return {
		cancel: vi.fn(),
		jobId: itemId,
		promise: Promise.resolve(HASH_A),
	};
}

function credentials(
	accessKeyId = "temporary-access-key",
	expiration = 4_102_444_800_000,
): UploadCredentialsResponse {
	return {
		bucket: "release-bucket",
		credentials: {
			accessKeyId,
			accessKeySecret: "temporary-secret",
			expiration: new Date(expiration).toISOString(),
			securityToken: "temporary-token",
		},
		region: "oss-cn-hangzhou",
		uploadPrefix: "releases/",
	};
}

function completedFile(file: CompleteUploadItemInput) {
	return {
		checksumAlgorithm: "sha256" as const,
		createdAt: "2026-07-15T04:00:00.000Z",
		id: `metadata:${file.path}`,
		mimeType: file.mimeType,
		path: file.path,
		sha256: file.sha256,
		size: file.size,
		updatedAt: "2026-07-15T04:00:00.000Z",
	};
}

function completionResponse(request: CompleteUploadsRequest) {
	return { files: request.files.map(completedFile) };
}

function transientCompletionError(status: 502 | 503 | 504): ApiProblemError {
	return new ApiProblemError({
		code:
			status === 503 ? "UPLOAD_VERIFICATION_UNAVAILABLE" : "INVALID_RESPONSE",
		requestId: `req-${status}`,
		status,
		title: "Request failed",
		type: "about:blank",
	});
}

function successfulUploader(uploads: OssMultipartUploadInput[]) {
	return (input: OssMultipartUploadInput) => {
		uploads.push(input);
		return {
			cancel: vi.fn(),
			promise: Promise.resolve({
				objectKey: input.objectKey,
			}),
		};
	};
}

function configureDraft(
	workflow: ReturnType<typeof createUploadWorkflow>,
): void {
	workflow.setDraft({ programId: PROGRAM_ID, versionId: VERSION_ID });
}

describe("incremental browser upload workflow", () => {
	it("hashes files with four bounded browser workers", async () => {
		const queue = createUploadQueueController({ storage: null });
		addFiles(queue, UPLOAD_HASH_CONCURRENCY + 1);
		const gates = Array.from({ length: UPLOAD_HASH_CONCURRENCY + 1 }, () =>
			deferred<string>(),
		);
		let started = 0;
		let inFlight = 0;
		let maximumInFlight = 0;
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async () => credentials(),
			resolveFiles: async (request) => ({
				files: request.files.map(({ path }) => ({ path, status: "reused" })),
			}),
			startHashTask: (input) => {
				const gate = gates[started];
				if (!gate) throw new Error("Missing hash gate.");
				started += 1;
				inFlight += 1;
				maximumInFlight = Math.max(maximumInFlight, inFlight);
				return {
					cancel: vi.fn(),
					jobId: input.itemId,
					promise: gate.promise.finally(() => {
						inFlight -= 1;
					}),
				};
			},
			startUploadTask: successfulUploader([]),
		});
		configureDraft(workflow);

		const running = workflow.start();
		await vi.waitFor(() => expect(started).toBe(UPLOAD_HASH_CONCURRENCY));
		expect(maximumInFlight).toBe(UPLOAD_HASH_CONCURRENCY);
		gates[0]?.resolve(HASH_A);
		await vi.waitFor(() => expect(started).toBe(UPLOAD_HASH_CONCURRENCY + 1));
		for (const gate of gates.slice(1)) gate.resolve(HASH_A);
		await running;

		expect(maximumInFlight).toBe(UPLOAD_HASH_CONCURRENCY);
		workflow.dispose();
		queue.dispose();
	});

	it("publishes completed hash totals before the entire folder finishes", async () => {
		const queue = createUploadQueueController({ storage: null });
		addFiles(queue, UPLOAD_HASH_RESULT_BATCH_SIZE + 1);
		const finalHash = deferred<string>();
		let startedHashes = 0;
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async () => credentials(),
			resolveFiles: async (request) => ({
				files: request.files.map(({ path }) => ({ path, status: "reused" })),
			}),
			startHashTask: (input) => {
				const index = startedHashes;
				startedHashes += 1;
				return {
					cancel: vi.fn(),
					jobId: input.itemId,
					promise:
						index === UPLOAD_HASH_RESULT_BATCH_SIZE
							? finalHash.promise
							: Promise.resolve(HASH_A),
				};
			},
			startUploadTask: successfulUploader([]),
		});
		configureDraft(workflow);

		const running = workflow.start();
		await vi.waitFor(() =>
			expect(startedHashes).toBe(UPLOAD_HASH_RESULT_BATCH_SIZE + 1),
		);
		expect(
			queue.getState().items.filter(({ sha256 }) => sha256 !== null),
		).toHaveLength(UPLOAD_HASH_RESULT_BATCH_SIZE);

		finalHash.resolve(HASH_A);
		await running;
		expect(
			queue.getState().items.every(({ status }) => status === "complete"),
		).toBe(true);
		workflow.dispose();
		queue.dispose();
	});

	it("resolves 10,001 reusable files in bounded batches with zero STS and PUT", async () => {
		const queue = createUploadQueueController({ storage: null });
		addFiles(queue, 10_001);
		const resolveRequests: ResolveDraftFilesRequest[] = [];
		let resolving = 0;
		let maximumResolving = 0;
		const requestCredentials = vi.fn(async () => credentials());
		const startUploadTask = vi.fn(successfulUploader([]));
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials,
			resolveFiles: async (request) => {
				resolveRequests.push(request);
				resolving += 1;
				maximumResolving = Math.max(maximumResolving, resolving);
				await Promise.resolve();
				resolving -= 1;
				return {
					files: request.files.map(({ path }) => ({ path, status: "reused" })),
				};
			},
			startHashTask: (input) => hashTask(input.itemId),
			startUploadTask,
		});
		configureDraft(workflow);

		await workflow.start();

		expect(resolveRequests).toHaveLength(
			Math.ceil(10_001 / MAX_RESOLVE_DRAFT_FILES),
		);
		expect(
			resolveRequests.every(
				({ files }) => files.length <= MAX_RESOLVE_DRAFT_FILES,
			),
		).toBe(true);
		expect(maximumResolving).toBe(UPLOAD_RESOLUTION_CONCURRENCY);
		expect(requestCredentials).not.toHaveBeenCalled();
		expect(startUploadTask).not.toHaveBeenCalled();
		expect(
			queue
				.getState()
				.items.every(
					({ resolutionStatus, status }) =>
						resolutionStatus === "reused" && status === "complete",
				),
		).toBe(true);
		workflow.dispose();
		queue.dispose();
	});

	it("retries transient reuse-check gateway responses before failing the batch", async () => {
		const queue = createUploadQueueController({ storage: null });
		addFiles(queue, 3);
		let resolveCalls = 0;
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async () => credentials(),
			resolveFiles: async (request) => {
				resolveCalls += 1;
				if (resolveCalls === 1) throw transientCompletionError(502);
				if (resolveCalls === 2) throw transientCompletionError(504);
				return {
					files: request.files.map(({ path }) => ({ path, status: "reused" })),
				};
			},
			startHashTask: (input) => hashTask(input.itemId),
			startUploadTask: successfulUploader([]),
			waitForRetry: async () => undefined,
		});
		configureDraft(workflow);

		await workflow.start();

		expect(resolveCalls).toBe(3);
		expect(
			queue.getState().items.every(({ status }) => status === "complete"),
		).toBe(true);
		workflow.dispose();
		queue.dispose();
	});

	it("retries every failed reuse-check item from any one retry control", async () => {
		const queue = createUploadQueueController({ storage: null });
		addFiles(queue, 3);
		let failResolution = true;
		let resolveCalls = 0;
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async () => credentials(),
			resolveFiles: async (request) => {
				resolveCalls += 1;
				if (failResolution) throw new Error("reuse check failed");
				return {
					files: request.files.map(({ path }) => ({ path, status: "reused" })),
				};
			},
			startHashTask: (input) => hashTask(input.itemId),
			startUploadTask: successfulUploader([]),
		});
		configureDraft(workflow);

		await expect(workflow.start()).rejects.toThrow("reuse check failed");
		expect(
			queue
				.getState()
				.items.every(
					({ failedStage, status }) =>
						failedStage === "resolution" && status === "failed",
				),
		).toBe(true);
		failResolution = false;
		const firstItem = queue.getState().items[0];
		if (!firstItem) throw new Error("Missing retry fixture.");

		await workflow.retry(firstItem.id);

		expect(resolveCalls).toBe(2);
		expect(
			queue.getState().items.every(({ status }) => status === "complete"),
		).toBe(true);
		workflow.dispose();
		queue.dispose();
	});

	it("retries every failed upload from any one retry control", async () => {
		const queue = createUploadQueueController({ storage: null });
		addFiles(queue, 3);
		const attempts = new Map<string, number>();
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => {
				if (request.files.some(({ verifyObject }) => verifyObject)) {
					throw new ApiProblemError({
						code: UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE,
						fieldErrors: [
							{
								code: UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE,
								path: "files.0.objectKey",
							},
						],
						requestId: "req-missing-object",
						status: 409,
						title: "Object not found",
						type: "about:blank",
					});
				}
				return completionResponse(request);
			},
			requestCredentials: async () => credentials(),
			resolveFiles: async (request) => ({
				files: request.files.map(({ path }) => ({
					path,
					status: "uploadRequired",
				})),
			}),
			startHashTask: (input) => hashTask(input.itemId),
			startUploadTask: (input) => {
				const attempt = (attempts.get(input.objectKey) ?? 0) + 1;
				attempts.set(input.objectKey, attempt);
				return {
					cancel: vi.fn(),
					promise:
						attempt === 1
							? Promise.reject(new Error("upload failed"))
							: Promise.resolve({
									objectKey: input.objectKey,
								}),
				};
			},
		});
		configureDraft(workflow);

		await expect(workflow.start()).rejects.toThrow("upload failed");
		expect(
			queue
				.getState()
				.items.every(
					({ failedStage, status }) =>
						failedStage === "upload" && status === "failed",
				),
		).toBe(true);
		const firstItem = queue.getState().items[0];
		if (!firstItem) throw new Error("Missing retry fixture.");

		await workflow.retry(firstItem.id);

		expect([...attempts.values()]).toEqual([2, 2, 2]);
		expect(
			queue.getState().items.every(({ status }) => status === "complete"),
		).toBe(true);
		workflow.dispose();
		queue.dispose();
	});

	it("uploads 1,001 new files with one valid-window STS request", async () => {
		const queue = createUploadQueueController({ storage: null });
		addFiles(queue, 1_001);
		const credentialRequests: object[] = [];
		const completionRequests: CompleteUploadsRequest[] = [];
		const uploads: OssMultipartUploadInput[] = [];
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => {
				completionRequests.push(request);
				return completionResponse(request);
			},
			requestCredentials: async (request) => {
				credentialRequests.push(request);
				return credentials();
			},
			resolveFiles: async (request) => ({
				files: request.files.map(({ path }) => ({
					path,
					status: "uploadRequired",
				})),
			}),
			startHashTask: (input) => hashTask(input.itemId),
			startUploadTask: successfulUploader(uploads),
		});
		configureDraft(workflow);

		await workflow.start();

		expect(credentialRequests).toEqual([{}]);
		expect(uploads).toHaveLength(1_001);
		expect(completionRequests).toHaveLength(
			Math.ceil(1_001 / MAX_COMPLETE_UPLOAD_FILES),
		);
		expect(
			completionRequests.every(
				({ files }) => files.length <= MAX_COMPLETE_UPLOAD_FILES,
			),
		).toBe(true);
		expect(
			queue.getState().items.every(({ status }) => status === "complete"),
		).toBe(true);
		workflow.dispose();
		queue.dispose();
	});

	it("bounds completion request size/concurrency and retries transient gateway failures", async () => {
		const queue = createUploadQueueController({ storage: null });
		addFiles(
			queue,
			MAX_COMPLETE_UPLOAD_FILES * UPLOAD_REGISTRATION_CONCURRENCY + 1,
		);
		let completionCalls = 0;
		let inFlight = 0;
		let maximumInFlight = 0;
		const completionSizes: number[] = [];
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => {
				completionCalls += 1;
				const callNumber = completionCalls;
				completionSizes.push(request.files.length);
				inFlight += 1;
				maximumInFlight = Math.max(maximumInFlight, inFlight);
				await Promise.resolve();
				inFlight -= 1;
				if (callNumber === 1) throw transientCompletionError(504);
				if (callNumber === 2) throw transientCompletionError(503);
				return completionResponse(request);
			},
			requestCredentials: async () => credentials(),
			resolveFiles: async (request) => ({
				files: request.files.map(({ path }) => ({
					path,
					status: "uploadRequired",
				})),
			}),
			startHashTask: (input) => hashTask(input.itemId),
			startUploadTask: successfulUploader([]),
			waitForRetry: async () => undefined,
		});
		configureDraft(workflow);

		await workflow.start();

		expect(completionCalls).toBe(UPLOAD_REGISTRATION_CONCURRENCY + 3);
		expect(maximumInFlight).toBe(UPLOAD_REGISTRATION_CONCURRENCY);
		expect(
			completionSizes.every((size) => size <= MAX_COMPLETE_UPLOAD_FILES),
		).toBe(true);
		expect(
			queue.getState().items.every(({ status }) => status === "complete"),
		).toBe(true);
		workflow.dispose();
		queue.dispose();
	});

	it("HEAD-reconciles only an already-existing OSS object", async () => {
		const queue = createUploadQueueController({ storage: null });
		addFiles(queue, 1);
		const completionRequests: CompleteUploadsRequest[] = [];
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => {
				completionRequests.push(request);
				return completionResponse(request);
			},
			requestCredentials: async () => credentials(),
			resolveFiles: async (request) => ({
				files: request.files.map(({ path }) => ({
					path,
					status: "uploadRequired",
				})),
			}),
			startHashTask: (input) => hashTask(input.itemId),
			startUploadTask: () => ({
				cancel: vi.fn(),
				promise: Promise.reject(new OssUploadAlreadyExistsError()),
			}),
		});
		configureDraft(workflow);

		await workflow.start();

		expect(completionRequests).toHaveLength(1);
		expect(completionRequests[0]?.files[0]).toMatchObject({
			verifyObject: true,
		});
		expect(queue.getState().items[0]).toMatchObject({
			error: null,
			failedStage: null,
			status: "complete",
		});
		workflow.dispose();
		queue.dispose();
	});

	it("reuses unchanged A, uploads changed B and new C, and omits removed D", async () => {
		const queue = createUploadQueueController({ storage: null });
		queue.addFiles(
			["a.bin", "b.bin", "c.bin"].map((name, index) => ({
				file: releaseFile(index),
				path: `release/${name}`,
			})),
		);
		const uploads: OssMultipartUploadInput[] = [];
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async () => credentials(),
			resolveFiles: async (request) => ({
				files: request.files.map(({ path }) => ({
					path,
					status: path.endsWith("a.bin") ? "reused" : "uploadRequired",
				})),
			}),
			startHashTask: (input) => hashTask(input.itemId),
			startUploadTask: successfulUploader(uploads),
		});
		configureDraft(workflow);

		await workflow.start();

		expect(uploads.map(({ objectKey }) => objectKey)).toEqual([
			`releases/${HASH_A}/release/b.bin`,
			`releases/${HASH_A}/release/c.bin`,
		]);
		expect(uploads.some(({ objectKey }) => objectKey.endsWith("d.bin"))).toBe(
			false,
		);
		expect(queue.getState().items[0]).toMatchObject({
			resolutionStatus: "reused",
			status: "complete",
		});
		workflow.dispose();
		queue.dispose();
	});

	it("recovers after reselect by skipping an already-associated file", async () => {
		const queue = createUploadQueueController({ storage: null });
		addFiles(queue, 2);
		const credentialRequests: object[] = [];
		const uploads: OssMultipartUploadInput[] = [];
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			requestCredentials: async (request) => {
				credentialRequests.push(request);
				return credentials();
			},
			resolveFiles: async (request) => ({
				files: request.files.map(({ path }, index) => ({
					path,
					status: index === 0 ? "alreadyAssociated" : "uploadRequired",
				})),
			}),
			startHashTask: (input) => hashTask(input.itemId),
			startUploadTask: successfulUploader(uploads),
		});
		configureDraft(workflow);

		await workflow.start();

		expect(credentialRequests).toEqual([{}]);
		expect(uploads).toHaveLength(1);
		expect(queue.getState().items).toMatchObject([
			{ resolutionStatus: "alreadyAssociated", status: "complete" },
			{ resolutionStatus: "uploadRequired", status: "complete" },
		]);
		workflow.dispose();
		queue.dispose();
	});

	it("coalesces concurrent ali-oss refresh callbacks across active files", async () => {
		const queue = createUploadQueueController({ storage: null });
		addFiles(queue, UPLOAD_FILE_CONCURRENCY);
		let now = 0;
		let credentialCalls = 0;
		const uploadInputs: OssMultipartUploadInput[] = [];
		const uploadGates = Array.from({ length: UPLOAD_FILE_CONCURRENCY }, () =>
			deferred<OssMultipartUploadResult>(),
		);
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			now: () => now,
			requestCredentials: async () => {
				credentialCalls += 1;
				return credentials(`temporary-key-${credentialCalls}`, now + 120_000);
			},
			resolveFiles: async (request) => ({
				files: request.files.map(({ path }) => ({
					path,
					status: "uploadRequired",
				})),
			}),
			startHashTask: (input) => hashTask(input.itemId),
			startUploadTask: (input) => {
				const index = uploadInputs.length;
				uploadInputs.push(input);
				const gate = uploadGates[index];
				if (!gate) throw new Error("Missing upload gate.");
				return { cancel: vi.fn(), promise: gate.promise };
			},
		});
		configureDraft(workflow);
		const running = workflow.start();
		await vi.waitFor(() =>
			expect(uploadInputs).toHaveLength(UPLOAD_FILE_CONCURRENCY),
		);
		now = 60_000;

		const refreshed = await Promise.all(
			uploadInputs.map((input) => {
				if (!input.refreshCredentials) {
					throw new Error("Refresh callback was not configured.");
				}
				return input.refreshCredentials();
			}),
		);

		expect(credentialCalls).toBe(2);
		expect(
			refreshed.every(({ accessKeyId }) => accessKeyId === "temporary-key-2"),
		).toBe(true);
		for (let index = 0; index < uploadGates.length; index += 1) {
			const input = uploadInputs[index];
			const gate = uploadGates[index];
			if (!input || !gate) throw new Error("Missing upload fixture.");
			gate.resolve({
				objectKey: input.objectKey,
			});
		}
		await running;
		workflow.dispose();
		queue.dispose();
	});

	it("retains the checkpoint and leaves the draft incomplete when refresh fails", async () => {
		const queue = createUploadQueueController({ storage: null });
		addFiles(queue, 1);
		let now = 0;
		let credentialCalls = 0;
		const workflow = createUploadWorkflow(queue, {
			completeUploads: async (request) => completionResponse(request),
			now: () => now,
			requestCredentials: async () => {
				credentialCalls += 1;
				if (credentialCalls > 1) throw new Error("STS unavailable");
				return credentials("temporary-key-1", 120_000);
			},
			resolveFiles: async (request) => ({
				files: request.files.map(({ path }) => ({
					path,
					status: "uploadRequired",
				})),
			}),
			startHashTask: (input) => hashTask(input.itemId),
			startUploadTask: (input) => {
				now = 60_000;
				input.onCheckpoint?.(CHECKPOINT);
				return {
					cancel: vi.fn(),
					promise: Promise.resolve()
						.then(() => input.refreshCredentials?.())
						.then(() => {
							throw new Error("Expected refresh to fail.");
						}),
				};
			},
		});
		configureDraft(workflow);

		await expect(workflow.start()).rejects.toThrow("STS unavailable");
		expect(queue.getState().items[0]).toMatchObject({
			checkpoint: CHECKPOINT,
			failedStage: "upload",
			status: "failed",
		});
		expect(queue.getState().items[0]?.status).not.toBe("complete");
		workflow.dispose();
		queue.dispose();
	});
});
