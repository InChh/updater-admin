import { Store } from "@tanstack/store";

import { UPLOAD_MIME_TYPE_PATTERN } from "../../shared/api/uploads";
import { normalizeUploadPath } from "../../shared/uploads/path";
import type { OssMultipartCheckpoint } from "./oss-uploader.client";

export const UPLOAD_UI_STORAGE_KEY = "updater-admin:upload-queue:ui:v1";
export const MAX_UPLOAD_ERROR_LENGTH = 500;

export type UploadQueueStatus =
	| "queued"
	| "hashing"
	| "ready"
	| "uploading"
	| "uploaded"
	| "registering"
	| "complete"
	| "failed"
	| "cancelled";

export type UploadWorkStage = "hash" | "upload" | "registration";

export interface UploadFileSelection {
	readonly file: File;
	readonly path: string;
}

export interface UploadQueueItem {
	readonly attempt: number;
	readonly checkpoint: OssMultipartCheckpoint | null;
	readonly error: string | null;
	readonly failedStage: UploadWorkStage | null;
	readonly file: File;
	readonly fileMetadataId: string | null;
	readonly hashProgress: number;
	readonly id: string;
	readonly mimeType: string;
	readonly objectEtag: string | null;
	readonly objectKey: string | null;
	readonly path: string;
	readonly sha256: string | null;
	readonly size: number;
	readonly status: UploadQueueStatus;
	readonly uploadProgress: number;
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
	getState(): UploadQueueState;
	markHashProgress(id: string, progress: number): void;
	markHashSucceeded(id: string, sha256: string): void;
	markRegistrationSucceeded(id: string, fileMetadataId: string): void;
	markUploadCheckpoint(id: string, checkpoint: OssMultipartCheckpoint): void;
	markUploadProgress(id: string, progress: number): void;
	markUploadSucceeded(id: string, objectEtag: string): void;
	prepareRetry(id: string): UploadWorkStage | null;
	remove(id: string): void;
	setObjectTarget(id: string, objectKey: string): void;
	setShowCompleted(showCompleted: boolean): void;
	startHash(id: string): void;
	startRegistration(id: string): void;
	startUpload(id: string): void;
	subscribe(listener: (state: UploadQueueState) => void): () => void;
}

interface PersistedUploadQueueUiState {
	readonly showCompleted: boolean;
	readonly version: 1;
}

const ACTIVE_STATUS_TO_STAGE = {
	hashing: "hash",
	uploading: "upload",
} as const satisfies Partial<Record<UploadQueueStatus, UploadWorkStage>>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

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

function requireItem(
	items: readonly UploadQueueItem[],
	id: string,
): UploadQueueItem {
	const item = items.find((candidate) => candidate.id === id);
	if (!item) throw new RangeError(`Unknown upload queue item: ${id}`);
	return item;
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

function safeErrorMessage(error: unknown): string {
	const value =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "Upload failed.";
	return (
		[...value].slice(0, MAX_UPLOAD_ERROR_LENGTH).join("") || "Upload failed."
	);
}

function updateItem(
	state: UploadQueueState,
	id: string,
	updater: (item: UploadQueueItem) => UploadQueueItem,
): UploadQueueState {
	requireItem(state.items, id);
	return withDerivedState({
		items: state.items.map((item) => (item.id === id ? updater(item) : item)),
		showCompleted: state.showCompleted,
	});
}

function cancelledStage(item: UploadQueueItem): UploadWorkStage | null {
	if (item.status in ACTIVE_STATUS_TO_STAGE) {
		return ACTIVE_STATUS_TO_STAGE[
			item.status as keyof typeof ACTIVE_STATUS_TO_STAGE
		];
	}
	if (!item.sha256) return "hash";
	if (!item.objectEtag) return "upload";
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
		error: null,
		failedStage: null,
		file: selection.file,
		fileMetadataId: null,
		hashProgress: 0,
		id: `upload-${queueItemSequence}`,
		mimeType: UPLOAD_MIME_TYPE_PATTERN.test(selection.file.type)
			? selection.file.type
			: "application/octet-stream",
		objectEtag: null,
		objectKey: null,
		path: selection.path,
		sha256: null,
		size: selection.file.size,
		status: "queued",
		uploadProgress: 0,
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
			store.setState((state) =>
				withDerivedState({
					items: [...state.items, ...created],
					showCompleted: state.showCompleted,
				}),
			);
			return created;
		},
		cancel: (id) => {
			const item = requireItem(store.state.items, id);
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
				updateItem(state, id, (current) => ({
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
					items: state.items.filter((item) => item.status !== "complete"),
					showCompleted: state.showCompleted,
				}),
			),
		dispose: () => persistenceSubscription.unsubscribe(),
		fail: (id, stage, error) =>
			store.setState((state) =>
				updateItem(state, id, (item) => {
					const expectedStatus =
						stage === "hash"
							? "hashing"
							: stage === "upload"
								? "uploading"
								: "registering";
					requireStatus(item, [expectedStatus], `fail ${stage}`);
					return {
						...item,
						error: safeErrorMessage(error),
						failedStage: stage,
						status: "failed",
					};
				}),
			),
		getState: () => store.state,
		markHashProgress: (id, hashProgress) =>
			store.setState((state) =>
				updateItem(state, id, (item) => {
					requireStatus(item, ["hashing"], "report hash progress for");
					return { ...item, hashProgress: clampProgress(hashProgress) };
				}),
			),
		markHashSucceeded: (id, sha256) => {
			if (!SHA256_PATTERN.test(sha256)) {
				throw new TypeError("sha256 must be lowercase hexadecimal.");
			}
			store.setState((state) =>
				updateItem(state, id, (item) => {
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
		markRegistrationSucceeded: (id, fileMetadataId) => {
			requireCanonicalValue(fileMetadataId, "fileMetadataId");
			store.setState((state) =>
				updateItem(state, id, (item) => {
					requireStatus(item, ["registering"], "complete registration for");
					return {
						...item,
						error: null,
						failedStage: null,
						fileMetadataId,
						status: "complete",
					};
				}),
			);
		},
		markUploadCheckpoint: (id, checkpoint) =>
			store.setState((state) =>
				updateItem(state, id, (item) => {
					requireStatus(item, ["uploading"], "checkpoint");
					return { ...item, checkpoint };
				}),
			),
		markUploadProgress: (id, uploadProgress) =>
			store.setState((state) =>
				updateItem(state, id, (item) => {
					requireStatus(item, ["uploading"], "report upload progress for");
					return { ...item, uploadProgress: clampProgress(uploadProgress) };
				}),
			),
		markUploadSucceeded: (id, objectEtag) => {
			requireCanonicalValue(objectEtag, "objectEtag");
			store.setState((state) =>
				updateItem(state, id, (item) => {
					requireStatus(item, ["uploading"], "complete upload for");
					return {
						...item,
						checkpoint: null,
						error: null,
						failedStage: null,
						objectEtag,
						status: "uploaded",
						uploadProgress: 1,
					};
				}),
			);
		},
		prepareRetry: (id) => {
			const item = requireItem(store.state.items, id);
			const stage = retryStage(item);
			if (!stage) return null;
			store.setState((state) =>
				updateItem(state, id, (current) => ({
					...current,
					error: null,
					failedStage: null,
					status:
						stage === "hash"
							? "queued"
							: stage === "upload"
								? "ready"
								: "uploaded",
				})),
			);
			return stage;
		},
		remove: (id) => {
			const item = requireItem(store.state.items, id);
			requireStatus(
				item,
				["queued", "ready", "uploaded", "complete", "failed", "cancelled"],
				"remove",
			);
			store.setState((state) =>
				withDerivedState({
					items: state.items.filter((candidate) => candidate.id !== id),
					showCompleted: state.showCompleted,
				}),
			);
		},
		setObjectTarget: (id, objectKey) => {
			requireCanonicalValue(objectKey, "objectKey");
			store.setState((state) =>
				updateItem(state, id, (item) => {
					requireStatus(item, ["ready"], "assign an object target to");
					return { ...item, objectKey };
				}),
			);
		},
		setShowCompleted: (nextShowCompleted) =>
			store.setState((state) => ({
				...state,
				showCompleted: nextShowCompleted,
			})),
		startHash: (id) =>
			store.setState((state) =>
				updateItem(state, id, (item) => {
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
				updateItem(state, id, (item) => {
					requireStatus(item, ["uploaded"], "start registration for");
					return {
						...item,
						error: null,
						failedStage: null,
						status: "registering",
					};
				}),
			),
		startUpload: (id) =>
			store.setState((state) =>
				updateItem(state, id, (item) => {
					requireStatus(item, ["ready"], "start upload for");
					if (!item.sha256 || !item.objectKey) {
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
