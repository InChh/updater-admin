import { Store } from "@tanstack/store";

import type { DraftFileResolveStatus } from "../../shared/api/uploads";
import { UPLOAD_MIME_TYPE_PATTERN } from "../../shared/api/uploads";
import {
	containsHighConfidenceSecretText,
	isSensitiveUrl,
	REDACTION_MARKER,
	type RedactedJsonValue,
	redactSensitiveData,
} from "../../shared/security/redact";
import { normalizeUploadPath } from "../../shared/uploads/path";
import type { OssMultipartCheckpoint } from "./oss-uploader.client";

export const UPLOAD_UI_STORAGE_KEY = "updater-admin:upload-queue:ui:v1";
export const MAX_UPLOAD_ERROR_LENGTH = 500;

export type UploadQueueStatus =
	| "queued"
	| "hashing"
	| "resolving"
	| "ready"
	| "uploading"
	| "uploaded"
	| "registering"
	| "complete"
	| "failed"
	| "cancelled";

export type UploadWorkStage = "hash" | "resolution" | "upload" | "registration";

export interface UploadFileSelection {
	readonly file: File;
	readonly path: string;
}

export interface UploadQueueItem {
	readonly attempt: number;
	readonly checkpoint: OssMultipartCheckpoint | null;
	/** Presentation-only dismissal; lifecycle/output data remains authoritative. */
	readonly dismissed: boolean;
	readonly error: string | null;
	readonly failedStage: UploadWorkStage | null;
	readonly file: File;
	readonly fileMetadataId: string | null;
	readonly hashProgress: number;
	readonly id: string;
	readonly mimeType: string;
	readonly objectKey: string | null;
	readonly path: string;
	readonly resolutionStatus: DraftFileResolveStatus | null;
	readonly sha256: string | null;
	readonly size: number;
	readonly status: UploadQueueStatus;
	readonly uploadProgress: number;
	/** Server must HEAD the deterministic object before registration. */
	readonly verifyObject: boolean;
}

export interface UploadHashResult {
	readonly id: string;
	readonly sha256: string;
}

export interface UploadResolutionResult {
	readonly canonicalMimeType?: string;
	readonly id: string;
	readonly status: DraftFileResolveStatus;
}

export interface UploadRegistrationResult {
	readonly fileMetadataId: string;
	readonly id: string;
}

export interface UploadObjectTarget {
	readonly id: string;
	readonly objectKey: string;
}

export interface UploadQueueState {
	/** Byte-weighted transfer progress. Hashing and registration are separate. */
	readonly aggregateProgress: number;
	readonly items: readonly UploadQueueItem[];
	readonly showCompleted: boolean;
}

export interface UploadQueueStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface UploadQueueControllerOptions {
	readonly storage?: UploadQueueStorage | null;
	readonly storageKey?: string;
}

export interface UploadQueueController {
	readonly store: Store<UploadQueueState>;
	addFiles(files: readonly UploadFileSelection[]): readonly UploadQueueItem[];
	cancel(id: string): UploadWorkStage | null;
	clearCompleted(): void;
	dispose(): void;
	fail(id: string, stage: UploadWorkStage, error: unknown): void;
	failBatch(
		ids: readonly string[],
		stage: UploadWorkStage,
		error: unknown,
	): void;
	getItem(id: string): UploadQueueItem | null;
	getState(): UploadQueueState;
	markHashProgress(id: string, progress: number): void;
	markHashSucceeded(id: string, sha256: string): void;
	markHashSucceededBatch(results: readonly UploadHashResult[]): void;
	markResolutionSucceeded(
		id: string,
		status: DraftFileResolveStatus,
		canonicalMimeType?: string,
	): void;
	markResolutionSucceededBatch(
		results: readonly UploadResolutionResult[],
	): void;
	markRegistrationSucceeded(id: string, fileMetadataId: string): void;
	markRegistrationSucceededBatch(
		results: readonly UploadRegistrationResult[],
	): void;
	markUploadCheckpoint(id: string, checkpoint: OssMultipartCheckpoint): void;
	markUploadCommitted(id: string): void;
	markUploadProgress(id: string, progress: number): void;
	markUploadReconciled(id: string, fileMetadataId: string): void;
	markUploadSucceeded(id: string): void;
	prepareRetry(id: string): UploadWorkStage | null;
	remove(id: string): void;
	setObjectTarget(id: string, objectKey: string): void;
	setObjectTargetBatch(targets: readonly UploadObjectTarget[]): void;
	setShowCompleted(showCompleted: boolean): void;
	startHash(id: string): void;
	startHashBatch(ids: readonly string[]): void;
	startRegistration(id: string): void;
	startRegistrationBatch(ids: readonly string[]): void;
	startResolution(id: string): void;
	startResolutionBatch(ids: readonly string[]): void;
	startUpload(id: string): void;
	subscribe(listener: (state: UploadQueueState) => void): () => void;
}

interface PersistedUploadQueueUiState {
	readonly showCompleted: boolean;
	readonly version: 1;
}

const ACTIVE_STATUS_TO_STAGE = {
	hashing: "hash",
	resolving: "resolution",
	uploading: "upload",
} as const satisfies Partial<Record<UploadQueueStatus, UploadWorkStage>>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_UPLOAD_ERROR = "Upload failed.";
const EMBEDDED_URL_PATTERN = /(?:https?:\/\/|\/\/)[^\s<>"']+/giu;
const KEY_VALUE_PATTERN =
	/(?:^|[\s?&#;,])([A-Za-z][A-Za-z0-9_.-]{0,63})\s*(?:=|:)\s*([^\s,;]+)/gu;

function browserSessionStorage(): UploadQueueStorage | null {
	if (typeof window === "undefined") return null;
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

function clampProgress(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

function transferProgress(item: UploadQueueItem): number {
	if (
		item.status === "uploaded" ||
		item.status === "registering" ||
		item.status === "complete"
	) {
		return 1;
	}
	return item.uploadProgress;
}

export function calculateAggregateUploadProgress(
	items: readonly UploadQueueItem[],
): number {
	if (items.length === 0) return 0;
	let transferred = 0;
	let total = 0;
	for (const item of items) {
		// Give empty files one unit so a queue of zero-byte files still advances.
		const weight = Math.max(1, item.size);
		total += weight;
		transferred += weight * transferProgress(item);
	}
	return clampProgress(transferred / total);
}

function withDerivedState(
	state: Omit<UploadQueueState, "aggregateProgress">,
): UploadQueueState {
	return {
		...state,
		aggregateProgress: calculateAggregateUploadProgress(state.items),
	};
}

function initialState(showCompleted: boolean): UploadQueueState {
	return {
		aggregateProgress: 0,
		items: [],
		showCompleted,
	};
}

function parsePersistedUiState(raw: string | null): boolean {
	if (!raw) return true;
	try {
		const value: unknown = JSON.parse(raw);
		if (
			value !== null &&
			typeof value === "object" &&
			"version" in value &&
			value.version === 1 &&
			"showCompleted" in value &&
			typeof value.showCompleted === "boolean"
		) {
			return value.showCompleted;
		}
	} catch {
		// Corrupt UI preferences are ignored; upload data is never hydrated.
	}
	return true;
}

function persistedUiState(
	state: UploadQueueState,
): PersistedUploadQueueUiState {
	return {
		showCompleted: state.showCompleted,
		version: 1,
	};
}

function requireCanonicalValue(value: string, name: string): void {
	const hasControlCharacter = [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 32 || codePoint === 127;
	});
	if (!value || value !== value.trim() || hasControlCharacter) {
		throw new TypeError(`${name} must be a non-empty canonical value.`);
	}
}

function requireStatus(
	item: UploadQueueItem,
	allowed: readonly UploadQueueStatus[],
	action: string,
): void {
	if (!allowed.includes(item.status)) {
		throw new Error(
			`Cannot ${action} upload item ${item.id} while it is ${item.status}.`,
		);
	}
}

function containsRedactionMarker(value: RedactedJsonValue): boolean {
	if (value === REDACTION_MARKER) return true;
	if (Array.isArray(value)) return value.some(containsRedactionMarker);
	if (typeof value !== "object" || value === null) return false;
	return Object.values(value).some(containsRedactionMarker);
}

function assignmentUsesSensitiveKey(value: string): boolean {
	for (const match of value.matchAll(KEY_VALUE_PATTERN)) {
		const key = match[1];
		if (!key) continue;
		const redacted = redactSensitiveData({ [key]: match[2] ?? "value" });
		if (containsRedactionMarker(redacted)) return true;
	}
	return false;
}

function textContainsSensitiveData(value: string): boolean {
	if (
		containsHighConfidenceSecretText(value) ||
		isSensitiveUrl(value) ||
		assignmentUsesSensitiveKey(value)
	) {
		return true;
	}
	for (const match of value.matchAll(EMBEDDED_URL_PATTERN)) {
		if (match[0] && isSensitiveUrl(match[0])) return true;
	}
	return false;
}

function valueContainsSensitiveText(
	value: unknown,
	ancestors = new WeakSet<object>(),
): boolean {
	if (typeof value === "string") return textContainsSensitiveData(value);
	if (typeof value !== "object" || value === null) return false;
	if (ancestors.has(value)) return false;
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			return value.some((item) => valueContainsSensitiveText(item, ancestors));
		}
		return Object.values(value).some((item) =>
			valueContainsSensitiveText(item, ancestors),
		);
	} finally {
		ancestors.delete(value);
	}
}

function diagnosticSource(error: unknown): unknown {
	if (!(error instanceof Error)) return error;
	return {
		...Object.fromEntries(Object.entries(error)),
		cause: error.cause,
		message: error.message,
	};
}

export function safeUploadErrorMessage(error: unknown): string {
	const value =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: DEFAULT_UPLOAD_ERROR;
	const source = diagnosticSource(error);
	if (
		containsRedactionMarker(redactSensitiveData(source)) ||
		valueContainsSensitiveText(source)
	) {
		return DEFAULT_UPLOAD_ERROR;
	}
	return (
		[...value].slice(0, MAX_UPLOAD_ERROR_LENGTH).join("") ||
		DEFAULT_UPLOAD_ERROR
	);
}

function cancelledStage(item: UploadQueueItem): UploadWorkStage | null {
	if (item.status in ACTIVE_STATUS_TO_STAGE) {
		return ACTIVE_STATUS_TO_STAGE[
			item.status as keyof typeof ACTIVE_STATUS_TO_STAGE
		];
	}
	if (!item.sha256) return "hash";
	if (!item.resolutionStatus) return "resolution";
	if (!item.objectKey) return "upload";
	if (!item.fileMetadataId) return "registration";
	return null;
}

function retryStage(item: UploadQueueItem): UploadWorkStage | null {
	if (item.status !== "failed" && item.status !== "cancelled") return null;
	return item.failedStage ?? cancelledStage(item);
}

let queueItemSequence = 0;

function createQueueItem(selection: UploadFileSelection): UploadQueueItem {
	requireCanonicalValue(selection.path, "path");
	queueItemSequence += 1;
	return {
		attempt: 0,
		checkpoint: null,
		dismissed: false,
		error: null,
		failedStage: null,
		file: selection.file,
		fileMetadataId: null,
		hashProgress: 0,
		id: `upload-${queueItemSequence}`,
		mimeType: UPLOAD_MIME_TYPE_PATTERN.test(selection.file.type)
			? selection.file.type
			: "application/octet-stream",
		objectKey: null,
		path: selection.path,
		resolutionStatus: null,
		sha256: null,
		size: selection.file.size,
		status: "queued",
		uploadProgress: 0,
		verifyObject: false,
	};
}

export function createUploadQueueController(
	options: UploadQueueControllerOptions = {},
): UploadQueueController {
	const storage =
		options.storage === undefined ? browserSessionStorage() : options.storage;
	const storageKey = options.storageKey ?? UPLOAD_UI_STORAGE_KEY;
	let showCompleted = true;
	if (storage) {
		try {
			showCompleted = parsePersistedUiState(storage.getItem(storageKey));
		} catch {
			showCompleted = true;
		}
	}
	const store = new Store<UploadQueueState>(initialState(showCompleted));
	const itemIndexes = new Map<string, number>();
	const getItem = (id: string): UploadQueueItem | null => {
		const index = itemIndexes.get(id);
		if (index === undefined) return null;
		const item = store.state.items[index];
		return item?.id === id ? item : null;
	};
	const getRequiredItem = (id: string): UploadQueueItem => {
		const item = getItem(id);
		if (!item) throw new RangeError(`Unknown upload queue item: ${id}`);
		return item;
	};
	const rebuildItemIndexes = (items: readonly UploadQueueItem[]) => {
		itemIndexes.clear();
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			if (item) itemIndexes.set(item.id, index);
		}
	};
	const updateStoredItems = (
		state: UploadQueueState,
		ids: readonly string[],
		updater: (item: UploadQueueItem, id: string) => UploadQueueItem,
	): UploadQueueState => {
		if (ids.length === 0) return state;
		const seen = new Set<string>();
		const updates: Array<readonly [number, UploadQueueItem]> = [];
		for (const id of ids) {
			if (seen.has(id)) throw new Error(`Duplicate upload queue item: ${id}`);
			seen.add(id);
			const index = itemIndexes.get(id);
			if (index === undefined) {
				throw new RangeError(`Unknown upload queue item: ${id}`);
			}
			const item = state.items[index];
			if (!item || item.id !== id) {
				throw new RangeError(`Unknown upload queue item: ${id}`);
			}
			updates.push([index, updater(item, id)]);
		}
		const items = [...state.items];
		for (const [index, item] of updates) items[index] = item;
		return withDerivedState({ items, showCompleted: state.showCompleted });
	};
	const updateStoredItem = (
		state: UploadQueueState,
		id: string,
		updater: (item: UploadQueueItem) => UploadQueueItem,
	): UploadQueueState =>
		updateStoredItems(state, [id], (item) => updater(item));
	let lastPersistedShowCompleted = showCompleted;
	const persistenceSubscription = store.subscribe((state) => {
		if (!storage || state.showCompleted === lastPersistedShowCompleted) return;
		lastPersistedShowCompleted = state.showCompleted;
		try {
			// Intentionally persist only this serializable view preference. File,
			// checkpoint, object key, hash, and credentials never enter storage.
			storage.setItem(storageKey, JSON.stringify(persistedUiState(state)));
		} catch {
			// Persistence is best effort; the in-memory queue remains authoritative.
		}
	});

	return {
		store,
		addFiles: (files) => {
			const existingPaths = new Set(store.state.items.map(({ path }) => path));
			const batchPaths = new Set<string>();
			const created = files.map((selection) => {
				const path = normalizeUploadPath(selection.path);
				if (existingPaths.has(path) || batchPaths.has(path)) {
					throw new Error(`Duplicate upload path: ${path}`);
				}
				batchPaths.add(path);
				return createQueueItem({ ...selection, path });
			});
			const firstIndex = store.state.items.length;
			for (let index = 0; index < created.length; index += 1) {
				const item = created[index];
				if (item) itemIndexes.set(item.id, firstIndex + index);
			}
			store.setState((state) =>
				withDerivedState({
					items: [...state.items, ...created],
					showCompleted: state.showCompleted,
				}),
			);
			return created;
		},
		cancel: (id) => {
			const item = getRequiredItem(id);
			if (
				item.status === "complete" ||
				item.status === "uploaded" ||
				item.status === "registering" ||
				item.status === "failed" ||
				item.status === "cancelled"
			) {
				return null;
			}
			const stage = cancelledStage(item);
			store.setState((state) =>
				updateStoredItem(state, id, (current) => ({
					...current,
					error: null,
					failedStage: stage,
					status: "cancelled",
				})),
			);
			return stage;
		},
		clearCompleted: () =>
			store.setState((state) =>
				withDerivedState({
					items: state.items.map((item) =>
						item.status === "complete" ? { ...item, dismissed: true } : item,
					),
					showCompleted: state.showCompleted,
				}),
			),
		dispose: () => persistenceSubscription.unsubscribe(),
		fail: (id, stage, error) =>
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					const expectedStatus =
						stage === "hash"
							? "hashing"
							: stage === "resolution"
								? "resolving"
								: stage === "upload"
									? "uploading"
									: "registering";
					requireStatus(item, [expectedStatus], `fail ${stage}`);
					return {
						...item,
						error: safeUploadErrorMessage(error),
						failedStage: stage,
						status: "failed",
					};
				}),
			),
		failBatch: (ids, stage, error) =>
			store.setState((state) =>
				updateStoredItems(state, ids, (item) => {
					const expectedStatus =
						stage === "hash"
							? "hashing"
							: stage === "resolution"
								? "resolving"
								: stage === "upload"
									? "uploading"
									: "registering";
					requireStatus(item, [expectedStatus], `fail ${stage}`);
					return {
						...item,
						error: safeUploadErrorMessage(error),
						failedStage: stage,
						status: "failed",
					};
				}),
			),
		getItem,
		getState: () => store.state,
		markHashProgress: (id, hashProgress) =>
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["hashing"], "report hash progress for");
					return { ...item, hashProgress: clampProgress(hashProgress) };
				}),
			),
		markHashSucceeded: (id, sha256) => {
			if (!SHA256_PATTERN.test(sha256)) {
				throw new TypeError("sha256 must be lowercase hexadecimal.");
			}
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["hashing"], "complete hashing for");
					return {
						...item,
						error: null,
						failedStage: null,
						hashProgress: 1,
						sha256,
						status: "ready",
					};
				}),
			);
		},
		markHashSucceededBatch: (results) => {
			for (const { sha256 } of results) {
				if (!SHA256_PATTERN.test(sha256)) {
					throw new TypeError("sha256 must be lowercase hexadecimal.");
				}
			}
			const resultsById = new Map(results.map((result) => [result.id, result]));
			store.setState((state) =>
				updateStoredItems(
					state,
					results.map(({ id }) => id),
					(item, id) => {
						const result = resultsById.get(id);
						if (!result) throw new RangeError(`Missing hash result: ${id}`);
						requireStatus(item, ["hashing"], "complete hashing for");
						return {
							...item,
							error: null,
							failedStage: null,
							hashProgress: 1,
							sha256: result.sha256,
							status: "ready",
						};
					},
				),
			);
		},
		markResolutionSucceeded: (id, resolutionStatus, canonicalMimeType) => {
			if (
				canonicalMimeType !== undefined &&
				!UPLOAD_MIME_TYPE_PATTERN.test(canonicalMimeType)
			) {
				throw new TypeError("canonicalMimeType must be a valid MIME type.");
			}
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["resolving"], "complete resolution for");
					return {
						...item,
						dismissed: false,
						error: null,
						failedStage: null,
						mimeType: canonicalMimeType ?? item.mimeType,
						resolutionStatus,
						status:
							resolutionStatus === "uploadRequired" ? "ready" : "complete",
						uploadProgress:
							resolutionStatus === "uploadRequired" ? item.uploadProgress : 1,
					};
				}),
			);
		},
		markResolutionSucceededBatch: (results) => {
			for (const { canonicalMimeType } of results) {
				if (
					canonicalMimeType !== undefined &&
					!UPLOAD_MIME_TYPE_PATTERN.test(canonicalMimeType)
				) {
					throw new TypeError("canonicalMimeType must be a valid MIME type.");
				}
			}
			const resultsById = new Map(results.map((result) => [result.id, result]));
			store.setState((state) =>
				updateStoredItems(
					state,
					results.map(({ id }) => id),
					(item, id) => {
						const result = resultsById.get(id);
						if (!result) {
							throw new RangeError(`Missing resolution result: ${id}`);
						}
						requireStatus(item, ["resolving"], "complete resolution for");
						return {
							...item,
							dismissed: false,
							error: null,
							failedStage: null,
							mimeType: result.canonicalMimeType ?? item.mimeType,
							resolutionStatus: result.status,
							status: result.status === "uploadRequired" ? "ready" : "complete",
							uploadProgress:
								result.status === "uploadRequired" ? item.uploadProgress : 1,
						};
					},
				),
			);
		},
		markRegistrationSucceeded: (id, fileMetadataId) => {
			requireCanonicalValue(fileMetadataId, "fileMetadataId");
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["registering"], "complete registration for");
					return {
						...item,
						dismissed: false,
						error: null,
						failedStage: null,
						fileMetadataId,
						resolutionStatus: "uploadRequired",
						status: "complete",
						verifyObject: false,
					};
				}),
			);
		},
		markRegistrationSucceededBatch: (results) => {
			for (const { fileMetadataId } of results) {
				requireCanonicalValue(fileMetadataId, "fileMetadataId");
			}
			const resultsById = new Map(results.map((result) => [result.id, result]));
			store.setState((state) =>
				updateStoredItems(
					state,
					results.map(({ id }) => id),
					(item, id) => {
						const result = resultsById.get(id);
						if (!result) {
							throw new RangeError(`Missing registration result: ${id}`);
						}
						requireStatus(item, ["registering"], "complete registration for");
						return {
							...item,
							dismissed: false,
							error: null,
							failedStage: null,
							fileMetadataId: result.fileMetadataId,
							resolutionStatus: "uploadRequired",
							status: "complete",
							verifyObject: false,
						};
					},
				),
			);
		},
		markUploadCheckpoint: (id, checkpoint) =>
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["uploading"], "checkpoint");
					return { ...item, checkpoint };
				}),
			),
		markUploadCommitted: (id) =>
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["uploading"], "complete upload for");
					return {
						...item,
						checkpoint: null,
						error: null,
						failedStage: null,
						status: "uploaded",
						uploadProgress: 1,
						verifyObject: true,
					};
				}),
			),
		markUploadProgress: (id, uploadProgress) =>
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["uploading"], "report upload progress for");
					return { ...item, uploadProgress: clampProgress(uploadProgress) };
				}),
			),
		markUploadReconciled: (id, fileMetadataId) => {
			requireCanonicalValue(fileMetadataId, "fileMetadataId");
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["failed", "cancelled"], "reconcile upload for");
					if (
						item.failedStage !== "upload" ||
						!item.objectKey ||
						!item.sha256
					) {
						throw new Error(
							`Cannot reconcile upload item ${item.id} without failed upload proof.`,
						);
					}
					return {
						...item,
						checkpoint: null,
						dismissed: false,
						error: null,
						failedStage: null,
						fileMetadataId,
						resolutionStatus: "uploadRequired",
						status: "complete",
						uploadProgress: 1,
						verifyObject: false,
					};
				}),
			);
		},
		markUploadSucceeded: (id) => {
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["uploading"], "complete upload for");
					return {
						...item,
						checkpoint: null,
						error: null,
						failedStage: null,
						status: "uploaded",
						uploadProgress: 1,
						verifyObject: false,
					};
				}),
			);
		},
		prepareRetry: (id) => {
			const item = getRequiredItem(id);
			const stage = retryStage(item);
			if (!stage) return null;
			const discardCancelledCheckpoint =
				item.status === "cancelled" && stage === "upload";
			store.setState((state) =>
				updateStoredItem(state, id, (current) => ({
					...current,
					checkpoint: discardCancelledCheckpoint ? null : current.checkpoint,
					error: null,
					failedStage: null,
					verifyObject: stage === "upload" ? false : current.verifyObject,
					status:
						stage === "hash"
							? "queued"
							: stage === "resolution"
								? "ready"
								: stage === "upload"
									? "ready"
									: "uploaded",
				})),
			);
			return stage;
		},
		remove: (id) => {
			const item = getRequiredItem(id);
			requireStatus(
				item,
				["queued", "ready", "uploaded", "complete", "failed", "cancelled"],
				"remove",
			);
			store.setState((state) => {
				const items = state.items.filter((candidate) => candidate.id !== id);
				rebuildItemIndexes(items);
				return withDerivedState({
					items,
					showCompleted: state.showCompleted,
				});
			});
		},
		setObjectTarget: (id, objectKey) => {
			requireCanonicalValue(objectKey, "objectKey");
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["ready"], "assign an object target to");
					return { ...item, objectKey };
				}),
			);
		},
		setObjectTargetBatch: (targets) => {
			for (const { objectKey } of targets) {
				requireCanonicalValue(objectKey, "objectKey");
			}
			const targetsById = new Map(targets.map((target) => [target.id, target]));
			store.setState((state) =>
				updateStoredItems(
					state,
					targets.map(({ id }) => id),
					(item, id) => {
						const target = targetsById.get(id);
						if (!target) throw new RangeError(`Missing object target: ${id}`);
						requireStatus(item, ["ready"], "assign an object target to");
						return { ...item, objectKey: target.objectKey };
					},
				),
			);
		},
		setShowCompleted: (nextShowCompleted) =>
			store.setState((state) => ({
				...state,
				showCompleted: nextShowCompleted,
			})),
		startHash: (id) =>
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["queued"], "start hashing");
					return {
						...item,
						error: null,
						failedStage: null,
						hashProgress: 0,
						status: "hashing",
					};
				}),
			),
		startHashBatch: (ids) =>
			store.setState((state) =>
				updateStoredItems(state, ids, (item) => {
					requireStatus(item, ["queued"], "start hashing");
					return {
						...item,
						error: null,
						failedStage: null,
						hashProgress: 0,
						status: "hashing",
					};
				}),
			),
		startRegistration: (id) =>
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["uploaded"], "start registration for");
					return {
						...item,
						error: null,
						failedStage: null,
						status: "registering",
					};
				}),
			),
		startRegistrationBatch: (ids) =>
			store.setState((state) =>
				updateStoredItems(state, ids, (item) => {
					requireStatus(item, ["uploaded"], "start registration for");
					return {
						...item,
						error: null,
						failedStage: null,
						status: "registering",
					};
				}),
			),
		startResolution: (id) =>
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["ready"], "start resolution for");
					if (!item.sha256) {
						throw new Error("A hash is required before draft resolution.");
					}
					return {
						...item,
						error: null,
						failedStage: null,
						status: "resolving",
					};
				}),
			),
		startResolutionBatch: (ids) =>
			store.setState((state) =>
				updateStoredItems(state, ids, (item) => {
					requireStatus(item, ["ready"], "start resolution for");
					if (!item.sha256) {
						throw new Error("A hash is required before draft resolution.");
					}
					return {
						...item,
						error: null,
						failedStage: null,
						status: "resolving",
					};
				}),
			),
		startUpload: (id) =>
			store.setState((state) =>
				updateStoredItem(state, id, (item) => {
					requireStatus(item, ["ready"], "start upload for");
					if (
						!item.sha256 ||
						!item.objectKey ||
						item.resolutionStatus !== "uploadRequired"
					) {
						throw new Error(
							"A hash and object target are required before upload.",
						);
					}
					return {
						...item,
						attempt: item.attempt + 1,
						error: null,
						failedStage: null,
						status: "uploading",
					};
				}),
			),
		subscribe: (listener) => {
			const subscription = store.subscribe(listener);
			return () => subscription.unsubscribe();
		},
	};
}
