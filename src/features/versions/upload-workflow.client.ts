import { ApiProblemError } from "../../lib/api/client";
import type {
	CompleteUploadItemInput,
	CompleteUploadsRequest,
	CompleteUploadsResponse,
	UploadCredentialsRequest,
	UploadCredentialsResponse,
	UploadFileMetadataInput,
} from "../../shared/api/uploads";
import {
	MAX_COMPLETE_UPLOAD_FILES,
	UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE,
	UPLOAD_OBJECT_NOT_FOUND_PROBLEM_CODE,
} from "../../shared/api/uploads";
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
	OssUploadCancelledError,
	startOssMultipartUpload,
} from "./oss-uploader.client";
import type {
	UploadQueueController,
	UploadQueueItem,
	UploadWorkStage,
} from "./upload-store";

export const UPLOAD_CREDENTIAL_EXPIRY_SKEW_MS = 60_000;
/** At most this many browser hash workers may retain file handles at once. */
export const UPLOAD_HASH_CONCURRENCY = 2;
/**
 * At most this many files upload concurrently. Each file retains the ali-oss
 * multipart parallelism, so a 1,000-file selection cannot fan out unboundedly.
 */
export const UPLOAD_FILE_CONCURRENCY = 4;

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
	): Promise<CompleteUploadsResponse>;
	requestCredentials(
		input: UploadCredentialsRequest,
		signal?: AbortSignal,
	): Promise<UploadCredentialsResponse>;
}

export interface UploadWorkflowDependencies extends UploadWorkflowApi {
	readonly abortCheckpoint?: AbortUploadWorkflowMultipartCheckpoint;
	readonly now?: () => number;
	readonly startHashTask?: StartUploadWorkflowHashTask;
	readonly startUploadTask?: StartUploadWorkflowMultipartTask;
}

export interface UploadWorkflow {
	readonly queue: UploadQueueController;
	cancel(itemId: string): UploadWorkStage | null;
	discard(itemId: string): Promise<void>;
	dispose(): void;
	/** Returns IDs in queue order only when every selected file is registered. */
	getCompletedFileMetadataIds(): readonly string[] | null;
	isRunning(): boolean;
	retry(itemId: string): Promise<UploadWorkStage | null>;
	start(): Promise<void>;
}

export type AbortUploadWorkflowMultipartCheckpoint = (
	input: OssMultipartAbortInput,
) => Promise<OssMultipartAbortStatus>;

interface UploadAuthorization {
	readonly metadataByPath: ReadonlyMap<string, string>;
	readonly response: UploadCredentialsResponse;
	readonly targetsByPath: ReadonlyMap<string, string>;
}

function uploadFingerprint(item: UploadQueueItem): string {
	if (!item.sha256) {
		throw new Error(`Upload item ${item.id} must be hashed first.`);
	}
	return `${item.sha256}\u0000${item.size}\u0000${item.mimeType}`;
}

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
	return queue.getState().items.find(({ id }) => id === itemId) ?? null;
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
	if (!item.objectEtag || !item.objectKey) {
		throw new Error(`Upload item ${item.id} must be uploaded first.`);
	}
	return {
		...uploadMetadata(item),
		objectEtag: item.objectEtag,
		objectKey: item.objectKey,
	};
}

function targetMap(
	response: UploadCredentialsResponse,
	items: readonly UploadQueueItem[],
): ReadonlyMap<string, string> {
	const expectedPaths = new Set(items.map(({ path }) => path));
	const targetsByPath = new Map<string, string>();
	for (const target of response.objects) {
		if (!expectedPaths.has(target.path)) {
			throw new Error(
				`Upload credentials returned an unexpected path: ${target.path}`,
			);
		}
		if (targetsByPath.has(target.path)) {
			throw new Error(
				`Upload credentials returned a duplicate path: ${target.path}`,
			);
		}
		targetsByPath.set(target.path, target.objectKey);
	}
	for (const item of items) {
		if (!targetsByPath.has(item.path)) {
			throw new Error(`Upload credentials omitted path: ${item.path}`);
		}
	}
	return targetsByPath;
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
			file.mimeType !== item.mimeType ||
			file.objectEtag === null ||
			(item.objectEtag !== null &&
				comparableEtag(file.objectEtag) !== comparableEtag(item.objectEtag))
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

function comparableEtag(value: string | null): string | null {
	if (value === null) return null;
	const trimmed = value.trim();
	return trimmed.startsWith('"') && trimmed.endsWith('"')
		? trimmed.slice(1, -1)
		: trimmed;
}

function hasReusableCredentials(
	response: UploadCredentialsResponse,
	now: number,
): boolean {
	const expiration = Date.parse(response.credentials.expiration);
	return (
		Number.isFinite(expiration) &&
		expiration - now > UPLOAD_CREDENTIAL_EXPIRY_SKEW_MS
	);
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

export function createUploadWorkflow(
	queue: UploadQueueController,
	dependencies: UploadWorkflowDependencies,
): UploadWorkflow {
	const now = dependencies.now ?? Date.now;
	const startHashTask = dependencies.startHashTask ?? defaultStartHashTask;
	const startUploadTask =
		dependencies.startUploadTask ?? startOssMultipartUpload;
	const abortCheckpoint =
		dependencies.abortCheckpoint ?? abortOssMultipartCheckpoint;
	const activeHashTasks = new Map<string, HashWorkerTask>();
	const activeUploadTasks = new Map<string, OssMultipartUploadTask>();
	let activeRequest: AbortController | null = null;
	let authorization: UploadAuthorization | null = null;
	let disposed = false;
	let scheduledOperations = 0;
	let operationTail: Promise<void> = Promise.resolve();

	const assertUsable = () => {
		if (disposed) throw new Error("Upload workflow has been disposed.");
	};

	const cleanupSettledCheckpoint = (
		item: UploadQueueItem,
	): Promise<OssMultipartAbortStatus> | null => {
		const currentAuthorization = authorization;
		const checkpoint = item.checkpoint;
		const objectKey = item.objectKey;

		if (!checkpoint || !objectKey || !currentAuthorization) return null;
		if (currentAuthorization.targetsByPath.get(item.path) !== objectKey)
			return null;

		return Promise.resolve()
			.then(() =>
				abortCheckpoint({
					bucket: currentAuthorization.response.bucket,
					checkpoint,
					credentials: {
						accessKeyId: currentAuthorization.response.credentials.accessKeyId,
						accessKeySecret:
							currentAuthorization.response.credentials.accessKeySecret,
						securityToken:
							currentAuthorization.response.credentials.securityToken,
					},
					objectKey,
					region: currentAuthorization.response.region,
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

	const runHashItem = async (itemId: string): Promise<void> => {
		const queuedItem = findItemOrNull(queue, itemId);
		if (!queuedItem || queuedItem.status !== "queued") return;
		queue.startHash(itemId);
		let task: HashWorkerTask;
		try {
			task = startHashTask({
				file: queuedItem.file,
				itemId,
				onProgress: (progress) => {
					if (findItemOrNull(queue, itemId)?.status === "hashing") {
						queue.markHashProgress(itemId, progress);
					}
				},
			});
		} catch (error) {
			const current = findItemOrNull(queue, itemId);
			if (!current) return;
			if (current.status === "hashing") queue.fail(itemId, "hash", error);
			throw error;
		}
		activeHashTasks.set(itemId, task);
		try {
			const sha256 = await task.promise;
			const current = findItemOrNull(queue, itemId);
			if (!current) return;
			if (current.status === "cancelled") {
				throw new HashCancelledError();
			}
			if (current.status === "hashing") {
				queue.markHashSucceeded(itemId, sha256);
			}
		} catch (error) {
			const current = findItemOrNull(queue, itemId);
			if (!current) return;
			if (current.status === "hashing") {
				queue.fail(itemId, "hash", error);
			}
			throw error;
		} finally {
			if (activeHashTasks.get(itemId) === task) {
				activeHashTasks.delete(itemId);
			}
		}
	};

	const requestAuthorization = async (
		items: readonly UploadQueueItem[],
	): Promise<UploadAuthorization> => {
		const currentAuthorization = authorization;
		if (
			currentAuthorization &&
			hasReusableCredentials(currentAuthorization.response, now()) &&
			items.every((item) => {
				const objectKey = currentAuthorization.targetsByPath.get(item.path);
				return (
					objectKey &&
					currentAuthorization.metadataByPath.get(item.path) ===
						uploadFingerprint(item) &&
					(!item.objectKey || item.objectKey === objectKey)
				);
			})
		) {
			return currentAuthorization;
		}

		const request: UploadCredentialsRequest = {
			files: items.map(uploadMetadata),
		};
		const abortController = new AbortController();
		activeRequest = abortController;
		try {
			const response = await dependencies.requestCredentials(
				request,
				abortController.signal,
			);
			if (!hasReusableCredentials(response, now())) {
				throw new Error(
					"Upload credentials are invalid or expire too soon to start an upload.",
				);
			}
			const targetsByPath = targetMap(response, items);
			for (const item of items) {
				const objectKey = targetsByPath.get(item.path);
				if (item.objectKey && item.objectKey !== objectKey) {
					throw new Error(
						`Upload credentials changed object target: ${item.path}`,
					);
				}
			}
			const nextAuthorization = {
				metadataByPath: new Map(
					items.map((item) => [item.path, uploadFingerprint(item)]),
				),
				response,
				targetsByPath,
			} satisfies UploadAuthorization;
			authorization = nextAuthorization;
			return nextAuthorization;
		} finally {
			if (activeRequest === abortController) activeRequest = null;
		}
	};

	const ensureUploadTargets = async (
		items: readonly UploadQueueItem[],
	): Promise<UploadAuthorization> => {
		const authorizationItems = queue
			.getState()
			.items.filter((item) => item.sha256 && !item.fileMetadataId);
		const nextAuthorization = await requestAuthorization(authorizationItems);
		for (const snapshot of items) {
			const item = findItemOrNull(queue, snapshot.id);
			if (!item) continue;
			const objectKey = nextAuthorization.targetsByPath.get(item.path);
			if (!objectKey) {
				throw new Error(`Upload credentials omitted path: ${item.path}`);
			}
			if (item.objectKey && item.objectKey !== objectKey) {
				throw new Error(
					`Upload credentials changed object target: ${item.path}`,
				);
			}
			if (item.status === "ready" && !item.objectKey) {
				queue.setObjectTarget(item.id, objectKey);
			}
		}
		return nextAuthorization;
	};

	const runUploadItem = async (
		itemId: string,
		uploadAuthorization: UploadAuthorization,
	): Promise<void> => {
		const readyItem = findItemOrNull(queue, itemId);
		if (!readyItem || readyItem.status !== "ready") return;
		const objectKey = uploadAuthorization.targetsByPath.get(readyItem.path);
		if (!objectKey || readyItem.objectKey !== objectKey) {
			throw new Error(`Upload target is unavailable for: ${readyItem.path}`);
		}

		queue.startUpload(itemId);
		const item = findItem(queue, itemId);
		let task: OssMultipartUploadTask;
		try {
			task = startUploadTask({
				bucket: uploadAuthorization.response.bucket,
				checkpoint: item.checkpoint,
				credentials: {
					accessKeyId: uploadAuthorization.response.credentials.accessKeyId,
					accessKeySecret:
						uploadAuthorization.response.credentials.accessKeySecret,
					securityToken: uploadAuthorization.response.credentials.securityToken,
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
				region: uploadAuthorization.response.region,
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
				queue.markUploadSucceeded(itemId, result.objectEtag);
			}
		} catch (error) {
			const current = findItemOrNull(queue, itemId);
			if (!current) return;
			if (current.status === "uploading") {
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
		for (
			let offset = 0;
			offset < items.length;
			offset += MAX_COMPLETE_UPLOAD_FILES
		) {
			const batch = items.slice(offset, offset + MAX_COMPLETE_UPLOAD_FILES);
			for (const item of batch) queue.startRegistration(item.id);
			const registeringItems = batch.map(({ id }) => findItem(queue, id));
			const request: CompleteUploadsRequest = {
				files: registeringItems.map(completionInput),
			};
			const abortController = new AbortController();
			activeRequest = abortController;
			try {
				const response = await dependencies.completeUploads(
					request,
					abortController.signal,
				);
				const filesByPath = completedFilesByPath(response, registeringItems);
				for (const item of registeringItems) {
					const file = filesByPath.get(item.path);
					if (!file) {
						throw new Error(`Upload completion omitted path: ${item.path}`);
					}
					queue.markRegistrationSucceeded(item.id, file.id);
				}
			} catch (error) {
				for (const item of registeringItems) {
					if (findItemOrNull(queue, item.id)?.status === "registering") {
						queue.fail(item.id, "registration", error);
					}
				}
				throw error;
			} finally {
				if (activeRequest === abortController) activeRequest = null;
			}
		}
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
				},
			],
		};
		const abortController = new AbortController();
		activeRequest = abortController;
		try {
			const response = await dependencies.completeUploads(
				request,
				abortController.signal,
			);
			const file = completedFilesByPath(response, [item]).get(item.path);
			if (!file?.objectEtag) {
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
			queue.markUploadReconciled(item.id, file.objectEtag, file.id);
			return true;
		} catch (error) {
			if (isMissingReconciliationObject(error)) return false;
			throw error;
		} finally {
			if (activeRequest === abortController) activeRequest = null;
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

		const readyItems = items.filter(({ status }) => status === "ready");
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
			activeRequest?.abort();
			activeRequest = null;
			authorization = null;
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
		getCompletedFileMetadataIds: () => {
			const items = queue.getState().items;
			if (items.length === 0) return null;
			const fileMetadataIds: string[] = [];
			for (const item of items) {
				if (item.status !== "complete" || !item.fileMetadataId) return null;
				fileMetadataIds.push(item.fileMetadataId);
			}
			return fileMetadataIds;
		},
		isRunning: () => scheduledOperations > 0,
		retry: (itemId) =>
			enqueueOperation(async () => {
				const retryItem = findItemOrNull(queue, itemId);
				if (!retryItem) return null;
				if (
					(retryItem.status === "failed" || retryItem.status === "cancelled") &&
					retryItem.failedStage === "upload" &&
					retryItem.objectKey &&
					!retryItem.objectEtag
				) {
					const reconciled = await reconcileFailedUpload(retryItem);
					if (reconciled) {
						await advance();
						return "upload";
					}
					if (!findItemOrNull(queue, itemId)) return "upload";
				}
				const stage = queue.prepareRetry(itemId);
				if (!stage) return null;
				if (stage === "registration") {
					for (const item of queue.getState().items) {
						if (
							item.id !== itemId &&
							item.status === "failed" &&
							item.failedStage === "registration"
						) {
							queue.prepareRetry(item.id);
						}
					}
				} else if (stage === "hash") {
					await runHashItem(itemId);
				} else {
					const item = findItem(queue, itemId);
					const uploadAuthorization = await ensureUploadTargets([item]);
					await runUploadItem(itemId, uploadAuthorization);
				}
				await advance();
				return stage;
			}),
		start: () =>
			runExclusive(async () => {
				const items = queue.getState().items;
				if (items.length === 0) {
					throw new Error("Select at least one file before starting uploads.");
				}
				await runTaskPool(
					items.filter(({ status }) => status === "queued"),
					UPLOAD_HASH_CONCURRENCY,
					({ id }) => runHashItem(id),
				);
				await advance();
			}),
	};
}
