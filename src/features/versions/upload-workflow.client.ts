import { ApiProblemError } from "../../lib/api/client";
import type {
	CompleteUploadItemInput,
	CompleteUploadsRequest,
	CompleteUploadsResponse,
	ResolveDraftFilesRequest,
	ResolveDraftFilesResponse,
	UploadCredentialsRequest,
	UploadCredentialsResponse,
	UploadFileMetadataInput,
} from "../../shared/api/uploads";
import {
	MAX_COMPLETE_UPLOAD_FILES,
	MAX_RESOLVE_DRAFT_FILES,
	UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE,
	UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE,
} from "../../shared/api/uploads";
import { createUploadObjectKey } from "../../shared/uploads/object-key";
import { createUploadCredentialManager } from "./credential-manager.client";
import {
	createBrowserHashWorker,
	HashCancelledError,
	type HashWorkerTask,
	startHashWorkerTask,
} from "./hash-worker";
import {
	abortOssMultipartCheckpoint,
	type OssMultipartAbortInput,
	type OssMultipartAbortStatus,
	type OssMultipartUploadInput,
	type OssMultipartUploadTask,
	OssUploadAlreadyExistsError,
	OssUploadCancelledError,
	startOssMultipartUpload,
} from "./oss-uploader.client";
import type {
	UploadQueueController,
	UploadQueueItem,
	UploadWorkStage,
} from "./upload-store";

/** At most this many browser hash workers may retain file handles at once. */
export const UPLOAD_HASH_CONCURRENCY = 4;
/**
 * Publish completed hashes in bounded batches so large folders update their
 * aggregate counters while hashing is still running without cloning the full
 * queue once per fast, tiny file.
 */
export const UPLOAD_HASH_RESULT_BATCH_SIZE = 16;
export const UPLOAD_HASH_RESULT_PUBLISH_INTERVAL_MS = 100;
/**
 * At most this many files upload concurrently. Each file retains the ali-oss
 * multipart parallelism, so a large folder cannot fan out unboundedly.
 */
export const UPLOAD_FILE_CONCURRENCY = 4;
/** Resolve independent metadata batches concurrently before any direct upload. */
export const UPLOAD_RESOLUTION_CONCURRENCY = 4;
/** Keep the existing completion concurrency; the server batches DB writes. */
export const UPLOAD_REGISTRATION_CONCURRENCY = 4;
export const UPLOAD_METADATA_REQUEST_MAX_ATTEMPTS = 3;
export const UPLOAD_METADATA_REQUEST_RETRY_DELAYS_MS = [500, 1_500] as const;

export interface UploadWorkflowHashInput {
	readonly file: File;
	readonly itemId: string;
	readonly onProgress: (progress: number) => void;
}

export type StartUploadWorkflowHashTask = (
	input: UploadWorkflowHashInput,
) => HashWorkerTask;

export type StartUploadWorkflowMultipartTask = (
	input: OssMultipartUploadInput,
) => OssMultipartUploadTask;

export interface UploadWorkflowApi {
	completeUploads(
		input: CompleteUploadsRequest,
		signal?: AbortSignal,
		draft?: UploadDraftContext,
	): Promise<CompleteUploadsResponse>;
	requestCredentials(
		input: UploadCredentialsRequest,
		signal?: AbortSignal,
	): Promise<UploadCredentialsResponse>;
	resolveFiles?(
		input: ResolveDraftFilesRequest,
		signal?: AbortSignal,
		draft?: UploadDraftContext,
	): Promise<ResolveDraftFilesResponse>;
}

export interface UploadWorkflowDependencies extends UploadWorkflowApi {
	readonly abortCheckpoint?: AbortUploadWorkflowMultipartCheckpoint;
	readonly now?: () => number;
	readonly startHashTask?: StartUploadWorkflowHashTask;
	readonly startUploadTask?: StartUploadWorkflowMultipartTask;
	readonly waitForRetry?: (
		delayMs: number,
		signal: AbortSignal,
	) => Promise<void>;
}

export interface UploadWorkflow {
	readonly queue: UploadQueueController;
	cancel(itemId: string): UploadWorkStage | null;
	discard(itemId: string): Promise<void>;
	dispose(): void;
	getDraft(): UploadDraftContext | null;
	isRunning(): boolean;
	retry(itemId: string): Promise<UploadWorkStage | null>;
	setDraft(draft: UploadDraftContext): void;
	start(): Promise<void>;
}

export interface UploadDraftContext {
	readonly programId: string;
	readonly versionId: string;
}

export type AbortUploadWorkflowMultipartCheckpoint = (
	input: OssMultipartAbortInput,
) => Promise<OssMultipartAbortStatus>;

function defaultStartHashTask(input: UploadWorkflowHashInput): HashWorkerTask {
	const worker = createBrowserHashWorker();
	const task = startHashWorkerTask(worker, input.file, {
		jobId: input.itemId,
		onProgress: input.onProgress,
	});
	return {
		jobId: task.jobId,
		promise: task.promise.finally(() => worker.terminate()),
		cancel: () => task.cancel(),
	};
}

function findItem(
	queue: UploadQueueController,
	itemId: string,
): UploadQueueItem {
	const item = findItemOrNull(queue, itemId);
	if (!item) throw new RangeError(`Unknown upload queue item: ${itemId}`);
	return item;
}

function findItemOrNull(
	queue: UploadQueueController,
	itemId: string,
): UploadQueueItem | null {
	return queue.getItem(itemId);
}

function uploadMetadata(item: UploadQueueItem): UploadFileMetadataInput {
	if (!item.sha256) {
		throw new Error(`Upload item ${item.id} must be hashed first.`);
	}
	return {
		mimeType: item.mimeType,
		path: item.path,
		sha256: item.sha256,
		size: String(item.size),
	};
}

function completionInput(item: UploadQueueItem): CompleteUploadItemInput {
	if (!item.objectKey) {
		throw new Error(`Upload item ${item.id} must be uploaded first.`);
	}
	return {
		...uploadMetadata(item),
		objectKey: item.objectKey,
		...(item.verifyObject ? { verifyObject: true as const } : {}),
	};
}

function completedFilesByPath(
	response: CompleteUploadsResponse,
	items: readonly UploadQueueItem[],
): ReadonlyMap<string, CompleteUploadsResponse["files"][number]> {
	const itemsByPath = new Map(items.map((item) => [item.path, item]));
	const filesByPath = new Map<
		string,
		CompleteUploadsResponse["files"][number]
	>();
	for (const file of response.files) {
		const item = itemsByPath.get(file.path);
		if (!item) {
			throw new Error(
				`Upload completion returned an unexpected path: ${file.path}`,
			);
		}
		if (filesByPath.has(file.path)) {
			throw new Error(
				`Upload completion returned a duplicate path: ${file.path}`,
			);
		}
		if (
			file.checksumAlgorithm !== "sha256" ||
			file.sha256 !== item.sha256 ||
			file.size !== String(item.size) ||
			file.mimeType !== item.mimeType
		) {
			throw new Error(`Upload completion metadata did not match: ${file.path}`);
		}
		filesByPath.set(file.path, file);
	}
	for (const item of items) {
		if (!filesByPath.has(item.path)) {
			throw new Error(`Upload completion omitted path: ${item.path}`);
		}
	}
	return filesByPath;
}

async function runTaskPool<Item>(
	items: readonly Item[],
	concurrency: number,
	operation: (item: Item) => Promise<void>,
): Promise<void> {
	let cursor = 0;
	const failures = new Map<number, unknown>();
	const workers = Array.from(
		{ length: Math.min(concurrency, items.length) },
		async () => {
			while (true) {
				const index = cursor;
				cursor += 1;
				const item = items[index];
				if (item === undefined) return;
				try {
					await operation(item);
				} catch (error) {
					failures.set(index, error);
				}
			}
		},
	);
	await Promise.all(workers);
	for (let index = 0; index < items.length; index += 1) {
		if (failures.has(index)) throw failures.get(index);
	}
}

function isMissingReconciliationObject(error: unknown): boolean {
	if (
		!(error instanceof ApiProblemError) ||
		error.code !== UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE ||
		error.status !== 409
	) {
		return false;
	}
	const fieldErrors = error.problem.fieldErrors ?? [];
	return (
		fieldErrors.length === 1 &&
		fieldErrors[0]?.code === UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE &&
		fieldErrors[0].path === "files.0.objectKey"
	);
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

function isRetryableMetadataRequestError(error: unknown): boolean {
	if (error instanceof ApiProblemError) {
		return error.status === 502 || error.status === 503 || error.status === 504;
	}
	return error instanceof TypeError;
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) {
		return Promise.reject(
			new DOMException("The request was aborted.", "AbortError"),
		);
	}
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, delayMs);
		const onAbort = () => {
			clearTimeout(timeout);
			reject(new DOMException("The request was aborted.", "AbortError"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

async function retryTransientMetadataRequest<Result>(
	request: () => Promise<Result>,
	signal: AbortSignal,
	waitBeforeRetry: (delayMs: number, signal: AbortSignal) => Promise<void>,
): Promise<Result> {
	for (
		let attempt = 1;
		attempt <= UPLOAD_METADATA_REQUEST_MAX_ATTEMPTS;
		attempt += 1
	) {
		try {
			return await request();
		} catch (error) {
			if (
				signal.aborted ||
				isAbortError(error) ||
				!isRetryableMetadataRequestError(error) ||
				attempt === UPLOAD_METADATA_REQUEST_MAX_ATTEMPTS
			) {
				throw error;
			}
			const retryDelay = UPLOAD_METADATA_REQUEST_RETRY_DELAYS_MS[attempt - 1];
			if (retryDelay === undefined) throw error;
			await waitBeforeRetry(retryDelay, signal);
		}
	}
	throw new Error("Metadata request exhausted its retry budget.");
}

export function createUploadWorkflow(
	queue: UploadQueueController,
	dependencies: UploadWorkflowDependencies,
): UploadWorkflow {
	const now = dependencies.now ?? Date.now;
	const startHashTask = dependencies.startHashTask ?? defaultStartHashTask;
	const startUploadTask =
		dependencies.startUploadTask ?? startOssMultipartUpload;
	const waitBeforeRetry = dependencies.waitForRetry ?? waitForRetry;
	const abortCheckpoint =
		dependencies.abortCheckpoint ?? abortOssMultipartCheckpoint;
	const credentialManager = createUploadCredentialManager({
		now,
		requestCredentials: dependencies.requestCredentials,
	});
	const activeHashTasks = new Map<string, HashWorkerTask>();
	const activeUploadTasks = new Map<string, OssMultipartUploadTask>();
	const activeRequests = new Set<AbortController>();
	let draft: UploadDraftContext | null = null;
	let disposed = false;
	let scheduledOperations = 0;
	let operationTail: Promise<void> = Promise.resolve();

	const assertUsable = () => {
		if (disposed) throw new Error("Upload workflow has been disposed.");
	};

	const cleanupSettledCheckpoint = (
		item: UploadQueueItem,
	): Promise<OssMultipartAbortStatus> | null => {
		const currentAuthorization = credentialManager.peekCredentials();
		const checkpoint = item.checkpoint;
		const objectKey = item.objectKey;

		if (!checkpoint || !objectKey || !currentAuthorization) return null;
		if (
			!item.sha256 ||
			createUploadObjectKey({
				path: item.path,
				prefix: currentAuthorization.uploadPrefix,
				sha256: item.sha256,
			}) !== objectKey
		) {
			return null;
		}

		return Promise.resolve()
			.then(() =>
				abortCheckpoint({
					bucket: currentAuthorization.bucket,
					checkpoint,
					credentials: {
						accessKeyId: currentAuthorization.credentials.accessKeyId,
						accessKeySecret: currentAuthorization.credentials.accessKeySecret,
						securityToken: currentAuthorization.credentials.securityToken,
					},
					objectKey,
					region: currentAuthorization.region,
				}),
			)
			.catch(() => "failed" as const);
	};

	const enqueueOperation = <Result>(
		operation: () => Promise<Result>,
	): Promise<Result> => {
		assertUsable();
		scheduledOperations += 1;
		const result = operationTail.then(async () => {
			assertUsable();
			return operation();
		});
		const tracked = result.finally(() => {
			scheduledOperations -= 1;
		});
		// A failed operation must not poison later explicitly queued retries, while
		// the caller still receives its own rejection through `tracked`.
		operationTail = tracked.then(
			() => undefined,
			() => undefined,
		);
		return tracked;
	};

	const runExclusive = <Result>(
		operation: () => Promise<Result>,
	): Promise<Result> => {
		assertUsable();
		if (scheduledOperations > 0) {
			return Promise.reject(new Error("Upload workflow is already running."));
		}
		return enqueueOperation(operation);
	};

	const computeHash = async (itemId: string): Promise<string | null> => {
		const hashingItem = findItemOrNull(queue, itemId);
		if (!hashingItem || hashingItem.status !== "hashing") return null;
		const task = startHashTask({
			file: hashingItem.file,
			itemId,
			onProgress: (progress) => {
				if (findItemOrNull(queue, itemId)?.status === "hashing") {
					queue.markHashProgress(itemId, progress);
				}
			},
		});
		activeHashTasks.set(itemId, task);
		try {
			const sha256 = await task.promise;
			const current = findItemOrNull(queue, itemId);
			if (!current) return null;
			if (current.status === "cancelled") {
				throw new HashCancelledError();
			}
			return current.status === "hashing" ? sha256 : null;
		} finally {
			if (activeHashTasks.get(itemId) === task) {
				activeHashTasks.delete(itemId);
			}
		}
	};

	const runHashItems = async (
		items: readonly UploadQueueItem[],
	): Promise<void> => {
		if (items.length === 0) return;
		const ids = items.map(({ id }) => id);
		queue.startHashBatch(ids);
		let pendingResults: Array<{
			readonly id: string;
			readonly sha256: string;
		}> = [];
		let lastPublishedAt = now();
		const publishHashResults = (force = false) => {
			if (pendingResults.length === 0) return;
			if (
				!force &&
				pendingResults.length < UPLOAD_HASH_RESULT_BATCH_SIZE &&
				now() - lastPublishedAt < UPLOAD_HASH_RESULT_PUBLISH_INTERVAL_MS
			) {
				return;
			}
			const committable = pendingResults.filter(
				({ id }) => findItemOrNull(queue, id)?.status === "hashing",
			);
			pendingResults = [];
			lastPublishedAt = now();
			queue.markHashSucceededBatch(committable);
		};
		let hasPoolError = false;
		let poolError: unknown;
		try {
			await runTaskPool(items, UPLOAD_HASH_CONCURRENCY, async ({ id }) => {
				try {
					const sha256 = await computeHash(id);
					if (sha256 && findItemOrNull(queue, id)?.status === "hashing") {
						pendingResults.push({ id, sha256 });
						publishHashResults();
					}
				} catch (error) {
					if (findItemOrNull(queue, id)?.status === "hashing") {
						queue.fail(id, "hash", error);
					}
					throw error;
				}
			});
		} catch (error) {
			hasPoolError = true;
			poolError = error;
		}
		publishHashResults(true);
		if (hasPoolError) throw poolError;
	};

	const requireDraft = (): UploadDraftContext => {
		if (!draft)
			throw new Error("Select or create a draft before uploading files.");
		return draft;
	};

	const resolveReadyItems = async (
		items: readonly UploadQueueItem[],
	): Promise<void> => {
		const batches: UploadQueueItem[][] = [];
		for (
			let offset = 0;
			offset < items.length;
			offset += MAX_RESOLVE_DRAFT_FILES
		) {
			batches.push(items.slice(offset, offset + MAX_RESOLVE_DRAFT_FILES));
		}
		await runTaskPool(batches, UPLOAD_RESOLUTION_CONCURRENCY, async (batch) => {
			queue.startResolutionBatch(batch.map(({ id }) => id));
			const resolvingItems = batch.map(({ id }) => findItem(queue, id));
			const request: ResolveDraftFilesRequest = {
				files: resolvingItems.map(uploadMetadata),
			};
			const abortController = new AbortController();
			activeRequests.add(abortController);
			try {
				const resolveFiles = dependencies.resolveFiles;
				const response: ResolveDraftFilesResponse = resolveFiles
					? await retryTransientMetadataRequest(
							() =>
								resolveFiles(request, abortController.signal, requireDraft()),
							abortController.signal,
							waitBeforeRetry,
						)
					: {
							files: resolvingItems.map(({ path }) => ({
								path,
								status: "uploadRequired" as const,
							})),
						};
				if (response.files.length !== resolvingItems.length) {
					throw new Error(
						"Draft resolution returned an unexpected item count.",
					);
				}
				const resolvedFiles = resolvingItems.map((item, index) => {
					const result = response.files[index];
					if (!result || result.path !== item.path) {
						throw new Error("Draft resolution did not preserve request order.");
					}
					return { item, result };
				});
				queue.markResolutionSucceededBatch(
					resolvedFiles
						.filter(
							({ item }) =>
								findItemOrNull(queue, item.id)?.status === "resolving",
						)
						.map(({ item, result }) => ({
							...(result.canonicalMimeType === undefined
								? {}
								: { canonicalMimeType: result.canonicalMimeType }),
							id: item.id,
							status: result.status,
						})),
				);
			} catch (error) {
				const activeIds = resolvingItems
					.filter(({ id }) => findItemOrNull(queue, id)?.status === "resolving")
					.map(({ id }) => id);
				queue.failBatch(activeIds, "resolution", error);
				throw error;
			} finally {
				activeRequests.delete(abortController);
			}
		});
	};

	const ensureUploadTargets = async (
		items: readonly UploadQueueItem[],
	): Promise<UploadCredentialsResponse> => {
		const credentials = await credentialManager.getCredentials();
		const targets: Array<{ readonly id: string; readonly objectKey: string }> =
			[];
		for (const snapshot of items) {
			const item = findItemOrNull(queue, snapshot.id);
			if (!item || !item.sha256) continue;
			const objectKey = createUploadObjectKey({
				path: item.path,
				prefix: credentials.uploadPrefix,
				sha256: item.sha256,
			});
			if (item.objectKey && item.objectKey !== objectKey) {
				throw new Error(`Upload object target changed: ${item.path}`);
			}
			if (item.status === "ready" && !item.objectKey) {
				targets.push({ id: item.id, objectKey });
			}
		}
		queue.setObjectTargetBatch(targets);
		return credentials;
	};

	const runUploadItem = async (
		itemId: string,
		uploadAuthorization: UploadCredentialsResponse,
	): Promise<void> => {
		const readyItem = findItemOrNull(queue, itemId);
		if (!readyItem || readyItem.status !== "ready") return;
		const objectKey = readyItem.objectKey;
		if (!objectKey) {
			throw new Error(`Upload target is unavailable for: ${readyItem.path}`);
		}

		queue.startUpload(itemId);
		const item = findItem(queue, itemId);
		let task: OssMultipartUploadTask;
		try {
			task = startUploadTask({
				bucket: uploadAuthorization.bucket,
				checkpoint: item.checkpoint,
				credentials: {
					accessKeyId: uploadAuthorization.credentials.accessKeyId,
					accessKeySecret: uploadAuthorization.credentials.accessKeySecret,
					securityToken: uploadAuthorization.credentials.securityToken,
				},
				file: item.file,
				mimeType: item.mimeType,
				objectKey,
				onCheckpoint: (checkpoint) => {
					if (findItemOrNull(queue, itemId)?.status === "uploading") {
						queue.markUploadCheckpoint(itemId, checkpoint);
					}
				},
				onProgress: (progress) => {
					if (findItemOrNull(queue, itemId)?.status === "uploading") {
						queue.markUploadProgress(itemId, progress);
					}
				},
				region: uploadAuthorization.region,
				refreshCredentials: async () => {
					const refreshed = await credentialManager.getCredentials();
					return {
						accessKeyId: refreshed.credentials.accessKeyId,
						accessKeySecret: refreshed.credentials.accessKeySecret,
						securityToken: refreshed.credentials.securityToken,
					};
				},
			});
		} catch (error) {
			const current = findItemOrNull(queue, itemId);
			if (!current) return;
			if (current.status === "uploading") queue.fail(itemId, "upload", error);
			throw error;
		}
		activeUploadTasks.set(itemId, task);
		try {
			const result = await task.promise;
			const current = findItemOrNull(queue, itemId);
			if (!current) return;
			if (current.status === "cancelled") {
				throw new OssUploadCancelledError();
			}
			if (result.objectKey !== objectKey) {
				throw new Error(`OSS returned a different object target: ${item.path}`);
			}
			if (current.status === "uploading") {
				queue.markUploadSucceeded(itemId);
			}
		} catch (error) {
			const current = findItemOrNull(queue, itemId);
			if (!current) return;
			if (current.status === "uploading") {
				if (error instanceof OssUploadAlreadyExistsError) {
					// The deterministic object already exists, so this attempt cannot
					// prove whether the expected bytes are present. Mark only this item
					// for server-side HEAD reconciliation before metadata registration.
					queue.markUploadCommitted(itemId);
					return;
				}
				queue.fail(itemId, "upload", error);
			}
			throw error;
		} finally {
			if (activeUploadTasks.get(itemId) === task) {
				activeUploadTasks.delete(itemId);
			}
		}
	};

	const registerUploadedItems = async (
		items: readonly UploadQueueItem[],
	): Promise<void> => {
		const batches: UploadQueueItem[][] = [];
		for (
			let offset = 0;
			offset < items.length;
			offset += MAX_COMPLETE_UPLOAD_FILES
		) {
			batches.push(items.slice(offset, offset + MAX_COMPLETE_UPLOAD_FILES));
		}
		await runTaskPool(
			batches,
			UPLOAD_REGISTRATION_CONCURRENCY,
			async (batch) => {
				queue.startRegistrationBatch(batch.map(({ id }) => id));
				const registeringItems = batch.map(({ id }) => findItem(queue, id));
				const request: CompleteUploadsRequest = {
					files: registeringItems.map(completionInput),
				};
				const abortController = new AbortController();
				activeRequests.add(abortController);
				try {
					const response = await retryTransientMetadataRequest(
						() =>
							dependencies.completeUploads(
								request,
								abortController.signal,
								dependencies.resolveFiles ? requireDraft() : undefined,
							),
						abortController.signal,
						waitBeforeRetry,
					);
					const filesByPath = completedFilesByPath(response, registeringItems);
					const registrations = registeringItems.map((item) => {
						const file = filesByPath.get(item.path);
						if (!file) {
							throw new Error(`Upload completion omitted path: ${item.path}`);
						}
						return {
							fileMetadataId: file.id,
							id: item.id,
						};
					});
					queue.markRegistrationSucceededBatch(registrations);
				} catch (error) {
					const activeIds = registeringItems
						.filter(
							({ id }) => findItemOrNull(queue, id)?.status === "registering",
						)
						.map(({ id }) => id);
					queue.failBatch(activeIds, "registration", error);
					throw error;
				} finally {
					activeRequests.delete(abortController);
				}
			},
		);
	};

	const reconcileFailedUpload = async (
		item: UploadQueueItem,
	): Promise<boolean> => {
		if (!item.objectKey) return false;
		const request: CompleteUploadsRequest = {
			files: [
				{
					...uploadMetadata(item),
					objectKey: item.objectKey,
					verifyObject: true,
				},
			],
		};
		const abortController = new AbortController();
		activeRequests.add(abortController);
		try {
			const response = await retryTransientMetadataRequest(
				() =>
					dependencies.completeUploads(
						request,
						abortController.signal,
						dependencies.resolveFiles ? requireDraft() : undefined,
					),
				abortController.signal,
				waitBeforeRetry,
			);
			const file = completedFilesByPath(response, [item]).get(item.path);
			if (!file) {
				throw new Error(`Upload completion omitted path: ${item.path}`);
			}
			const current = findItemOrNull(queue, item.id);
			if (!current) return true;
			if (
				(current.status !== "failed" && current.status !== "cancelled") ||
				current.failedStage !== "upload" ||
				current.objectKey !== item.objectKey ||
				current.sha256 !== item.sha256
			) {
				throw new Error(`Upload reconciliation state changed: ${item.path}`);
			}
			queue.markUploadReconciled(item.id, file.id);
			return true;
		} catch (error) {
			if (isMissingReconciliationObject(error)) return false;
			throw error;
		} finally {
			activeRequests.delete(abortController);
		}
	};

	const advance = async (): Promise<void> => {
		let items = queue.getState().items;
		if (items.length === 0) return;
		if (
			items.some(
				({ status }) =>
					status !== "ready" && status !== "uploaded" && status !== "complete",
			)
		) {
			return;
		}

		const unresolvedItems = items.filter(
			({ resolutionStatus, status }) =>
				status === "ready" && resolutionStatus === null,
		);
		if (unresolvedItems.length > 0) {
			await resolveReadyItems(unresolvedItems);
		}

		items = queue.getState().items;
		const readyItems = items.filter(
			({ resolutionStatus, status }) =>
				status === "ready" && resolutionStatus === "uploadRequired",
		);
		if (readyItems.length > 0) {
			const uploadAuthorization = await ensureUploadTargets(readyItems);
			const stillReadyItems = readyItems.filter(
				({ id }) => findItemOrNull(queue, id)?.status === "ready",
			);
			await runTaskPool(stillReadyItems, UPLOAD_FILE_CONCURRENCY, ({ id }) =>
				runUploadItem(id, uploadAuthorization),
			);
		}

		items = queue.getState().items;
		if (
			items.some(({ status }) => status !== "uploaded" && status !== "complete")
		) {
			return;
		}
		const uploadedItems = items.filter(({ status }) => status === "uploaded");
		if (uploadedItems.length > 0) await registerUploadedItems(uploadedItems);
	};

	return {
		queue,
		cancel: (itemId) => {
			assertUsable();
			const stage = queue.cancel(itemId);
			if (stage === "hash") activeHashTasks.get(itemId)?.cancel();
			if (stage === "upload") activeUploadTasks.get(itemId)?.cancel();
			return stage;
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			const activeUploadIds = new Set(activeUploadTasks.keys());
			for (const [itemId, task] of activeHashTasks) {
				if (findItemOrNull(queue, itemId)?.status === "hashing") {
					queue.cancel(itemId);
				}
				task.cancel();
			}
			for (const [itemId, task] of activeUploadTasks) {
				if (findItemOrNull(queue, itemId)?.status === "uploading") {
					queue.cancel(itemId);
				}
				task.cancel();
			}
			for (const item of queue.getState().items) {
				if (!activeUploadIds.has(item.id)) {
					void cleanupSettledCheckpoint(item);
				}
			}
			for (const request of activeRequests) request.abort();
			activeRequests.clear();
			credentialManager.dispose();
			draft = null;
		},
		discard: async (itemId) => {
			assertUsable();
			const item = findItem(queue, itemId);
			const hashTask = activeHashTasks.get(itemId);
			const uploadTask = activeUploadTasks.get(itemId);
			const stage = queue.cancel(itemId);
			if (stage === "hash") hashTask?.cancel();
			if (stage === "upload") uploadTask?.cancel();
			const cleanup = uploadTask ? null : cleanupSettledCheckpoint(item);
			queue.remove(itemId);
			if (cleanup) await cleanup;
		},
		getDraft: () => draft,
		isRunning: () => scheduledOperations > 0,
		retry: (itemId) =>
			enqueueOperation(async () => {
				const retryItem = findItemOrNull(queue, itemId);
				if (
					!retryItem ||
					(retryItem.status !== "failed" && retryItem.status !== "cancelled")
				) {
					return null;
				}
				const retryIds = queue
					.getState()
					.items.filter(
						(item) => item.status === "failed" || item.id === retryItem.id,
					)
					.map(({ id }) => id);
				const retryIdSet = new Set(retryIds);
				const reconciliationItems = queue
					.getState()
					.items.filter(
						(item) =>
							retryIdSet.has(item.id) &&
							item.failedStage === "upload" &&
							item.objectKey !== null,
					);
				await runTaskPool(
					reconciliationItems,
					UPLOAD_REGISTRATION_CONCURRENCY,
					async (item) => {
						try {
							await reconcileFailedUpload(item);
						} catch {
							// A reconciliation outage must not turn the one-click retry into a
							// serial blocker. Fall back to the normal resumable upload path;
							// overwrite protection and completion verification stay authoritative.
						}
					},
				);
				const stage =
					findItemOrNull(queue, retryItem.id)?.status === "complete"
						? retryItem.failedStage
						: queue.prepareRetry(retryItem.id);
				if (!stage) return null;
				for (const id of retryIds) {
					if (
						id !== retryItem.id &&
						findItemOrNull(queue, id)?.status === "failed"
					) {
						queue.prepareRetry(id);
					}
				}
				await runHashItems(
					queue
						.getState()
						.items.filter(
							(item) => retryIdSet.has(item.id) && item.status === "queued",
						),
				);
				await advance();
				return stage;
			}),
		setDraft: (nextDraft) => {
			assertUsable();
			if (!nextDraft.programId.trim() || !nextDraft.versionId.trim()) {
				throw new TypeError("Draft identifiers must be non-empty.");
			}
			if (
				draft &&
				(draft.programId !== nextDraft.programId ||
					draft.versionId !== nextDraft.versionId)
			) {
				throw new Error("An upload workflow cannot switch drafts.");
			}
			draft = { ...nextDraft };
		},
		start: () =>
			runExclusive(async () => {
				const items = queue.getState().items;
				if (items.length === 0) {
					throw new Error("Select at least one file before starting uploads.");
				}
				await runHashItems(items.filter(({ status }) => status === "queued"));
				await advance();
			}),
	};
}
