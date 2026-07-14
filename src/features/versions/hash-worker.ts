import { createSHA256 } from "hash-wasm";

export const DEFAULT_HASH_CHUNK_SIZE = 4 * 1024 * 1024;
export const MIN_HASH_CHUNK_SIZE = 64 * 1024;
export const MAX_HASH_CHUNK_SIZE = 16 * 1024 * 1024;

export interface IncrementalHasher {
	digest(outputType?: "hex"): string;
	init(): IncrementalHasher;
	update(data: Uint8Array): IncrementalHasher;
}

export interface IncrementalHashOptions {
	readonly chunkSize?: number;
	readonly createHasher?: () => Promise<IncrementalHasher>;
	readonly isCancelled?: () => boolean;
	readonly onProgress?: (progress: number) => void;
}

export type HashWorkerRequest =
	| {
			readonly chunkSize?: number;
			readonly file: File;
			readonly jobId: string;
			readonly type: "hash:start";
	  }
	| {
			readonly jobId: string;
			readonly type: "hash:cancel";
	  };

export type HashWorkerResponse =
	| {
			readonly jobId: string;
			readonly progress: number;
			readonly type: "hash:progress";
	  }
	| {
			readonly jobId: string;
			readonly sha256: string;
			readonly type: "hash:complete";
	  }
	| {
			readonly jobId: string;
			readonly type: "hash:cancelled";
	  }
	| {
			readonly jobId: string;
			readonly message: string;
			readonly type: "hash:error";
	  };

export interface HashWorkerScope {
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<HashWorkerRequest>) => void,
	): void;
	postMessage(message: HashWorkerResponse): void;
}

export interface HashWorkerLike {
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<HashWorkerResponse>) => void,
	): void;
	postMessage(message: HashWorkerRequest): void;
	removeEventListener(
		type: "message",
		listener: (event: MessageEvent<HashWorkerResponse>) => void,
	): void;
}

export interface HashWorkerTask {
	readonly jobId: string;
	readonly promise: Promise<string>;
	cancel(): void;
}

export class HashCancelledError extends Error {
	constructor() {
		super("File hashing was cancelled.");
		this.name = "HashCancelledError";
	}
}

function normalizedChunkSize(value: number | undefined): number {
	const chunkSize = value ?? DEFAULT_HASH_CHUNK_SIZE;
	if (
		!Number.isSafeInteger(chunkSize) ||
		chunkSize < MIN_HASH_CHUNK_SIZE ||
		chunkSize > MAX_HASH_CHUNK_SIZE
	) {
		throw new RangeError(
			`chunkSize must be an integer between ${MIN_HASH_CHUNK_SIZE} and ${MAX_HASH_CHUNK_SIZE}.`,
		);
	}
	return chunkSize;
}

function clampProgress(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

function safeErrorMessage(error: unknown): string {
	const message =
		error instanceof Error ? error.message : "Unable to hash file.";
	return [...message].slice(0, 500).join("") || "Unable to hash file.";
}

function throwIfCancelled(isCancelled: (() => boolean) | undefined): void {
	if (isCancelled?.()) throw new HashCancelledError();
}

/**
 * Hash a file without ever materializing the complete file in memory. Only the
 * current bounded Blob slice is converted to an ArrayBuffer.
 */
export async function hashFileIncrementally(
	file: Blob,
	options: IncrementalHashOptions = {},
): Promise<string> {
	const chunkSize = normalizedChunkSize(options.chunkSize);
	throwIfCancelled(options.isCancelled);
	const hasher = await (options.createHasher ?? createSHA256)();
	hasher.init();
	options.onProgress?.(0);

	for (let offset = 0; offset < file.size; offset += chunkSize) {
		throwIfCancelled(options.isCancelled);
		const end = Math.min(offset + chunkSize, file.size);
		const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
		throwIfCancelled(options.isCancelled);
		hasher.update(chunk);
		options.onProgress?.(clampProgress(end / Math.max(file.size, 1)));
	}

	throwIfCancelled(options.isCancelled);
	if (file.size === 0) options.onProgress?.(1);
	return hasher.digest("hex");
}

export function installHashWorker(scope: HashWorkerScope): void {
	const cancelledJobs = new Set<string>();
	const activeJobs = new Set<string>();

	scope.addEventListener("message", (event) => {
		const request = event.data;
		if (request.type === "hash:cancel") {
			cancelledJobs.add(request.jobId);
			return;
		}
		if (activeJobs.has(request.jobId)) {
			scope.postMessage({
				jobId: request.jobId,
				message: "A hashing job with this identifier is already running.",
				type: "hash:error",
			});
			return;
		}

		activeJobs.add(request.jobId);
		void hashFileIncrementally(request.file, {
			...(request.chunkSize === undefined
				? {}
				: { chunkSize: request.chunkSize }),
			isCancelled: () => cancelledJobs.has(request.jobId),
			onProgress: (progress) => {
				scope.postMessage({
					jobId: request.jobId,
					progress,
					type: "hash:progress",
				});
			},
		})
			.then((sha256) => {
				scope.postMessage({
					jobId: request.jobId,
					sha256,
					type: "hash:complete",
				});
			})
			.catch((error: unknown) => {
				if (error instanceof HashCancelledError) {
					scope.postMessage({
						jobId: request.jobId,
						type: "hash:cancelled",
					});
					return;
				}
				scope.postMessage({
					jobId: request.jobId,
					message: safeErrorMessage(error),
					type: "hash:error",
				});
			})
			.finally(() => {
				activeJobs.delete(request.jobId);
				cancelledJobs.delete(request.jobId);
			});
	});
}

let fallbackJobSequence = 0;

function createJobId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	fallbackJobSequence += 1;
	return `hash-${fallbackJobSequence}`;
}

export function startHashWorkerTask(
	worker: HashWorkerLike,
	file: File,
	options: {
		readonly chunkSize?: number;
		readonly jobId?: string;
		readonly onProgress?: (progress: number) => void;
	} = {},
): HashWorkerTask {
	const jobId = options.jobId ?? createJobId();
	let settled = false;
	let rejectTask: ((reason?: unknown) => void) | undefined;
	const listener = (event: MessageEvent<HashWorkerResponse>) => {
		if (event.data.jobId !== jobId || settled) return;
		if (event.data.type === "hash:progress") {
			options.onProgress?.(clampProgress(event.data.progress));
			return;
		}
		settled = true;
		worker.removeEventListener("message", listener);
		if (event.data.type === "hash:complete") {
			resolveTask?.(event.data.sha256);
			return;
		}
		if (event.data.type === "hash:cancelled") {
			rejectTask?.(new HashCancelledError());
			return;
		}
		rejectTask?.(new Error(event.data.message));
	};
	let resolveTask: ((value: string) => void) | undefined;
	const promise = new Promise<string>((resolve, reject) => {
		resolveTask = resolve;
		rejectTask = reject;
		worker.addEventListener("message", listener);
		worker.postMessage({
			...(options.chunkSize === undefined
				? {}
				: { chunkSize: normalizedChunkSize(options.chunkSize) }),
			file,
			jobId,
			type: "hash:start",
		});
	});

	return {
		jobId,
		promise,
		cancel: () => {
			if (settled) return;
			worker.postMessage({ jobId, type: "hash:cancel" });
		},
	};
}

export function createBrowserHashWorker(): Worker {
	if (typeof Worker === "undefined") {
		throw new Error("Web Workers are not available in this environment.");
	}
	return new Worker(new URL("./hash-worker.ts", import.meta.url), {
		type: "module",
	});
}

const possibleWorkerScope = globalThis as typeof globalThis & {
	close?: () => void;
};

if (
	typeof document === "undefined" &&
	typeof possibleWorkerScope.close === "function" &&
	typeof possibleWorkerScope.postMessage === "function" &&
	typeof possibleWorkerScope.addEventListener === "function"
) {
	installHashWorker(possibleWorkerScope as unknown as HashWorkerScope);
}
