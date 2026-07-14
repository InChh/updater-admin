import { describe, expect, it, vi } from "vitest";

import {
	HashCancelledError,
	type HashWorkerLike,
	type HashWorkerRequest,
	type HashWorkerResponse,
	hashFileIncrementally,
	MIN_HASH_CHUNK_SIZE,
	startHashWorkerTask,
} from "./hash-worker";

class FakeWorker implements HashWorkerLike {
	readonly requests: HashWorkerRequest[] = [];
	private readonly listeners = new Set<
		(event: MessageEvent<HashWorkerResponse>) => void
	>();

	addEventListener(
		_type: "message",
		listener: (event: MessageEvent<HashWorkerResponse>) => void,
	): void {
		this.listeners.add(listener);
	}

	emit(response: HashWorkerResponse): void {
		for (const listener of this.listeners) {
			listener(new MessageEvent("message", { data: response }));
		}
	}

	postMessage(message: HashWorkerRequest): void {
		this.requests.push(message);
	}

	removeEventListener(
		_type: "message",
		listener: (event: MessageEvent<HashWorkerResponse>) => void,
	): void {
		this.listeners.delete(listener);
	}
}

describe("incremental SHA-256 worker", () => {
	it("produces the canonical lowercase SHA-256 digest", async () => {
		await expect(hashFileIncrementally(new Blob(["abc"]))).resolves.toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("reads only bounded Blob slices and never the complete File buffer", async () => {
		const data = new Uint8Array(MIN_HASH_CHUNK_SIZE * 2 + 11).fill(7);
		const file = new File([data], "release.bin");
		const wholeFileArrayBuffer = vi.fn(() => {
			throw new Error("whole-file read must not happen");
		});
		Object.defineProperty(file, "arrayBuffer", {
			configurable: true,
			value: wholeFileArrayBuffer,
		});
		const chunks: number[] = [];
		const progress: number[] = [];
		const hasher = {
			digest: () => "digest",
			init() {
				return this;
			},
			update(chunk: Uint8Array) {
				chunks.push(chunk.byteLength);
				return this;
			},
		};

		await expect(
			hashFileIncrementally(file, {
				chunkSize: MIN_HASH_CHUNK_SIZE,
				createHasher: async () => hasher,
				onProgress: (value) => progress.push(value),
			}),
		).resolves.toBe("digest");

		expect(wholeFileArrayBuffer).not.toHaveBeenCalled();
		expect(chunks).toEqual([MIN_HASH_CHUNK_SIZE, MIN_HASH_CHUNK_SIZE, 11]);
		expect(progress[0]).toBe(0);
		expect(progress.at(-1)).toBe(1);
	});

	it("observes cancellation between bounded chunks", async () => {
		const file = new File(
			[new Uint8Array(MIN_HASH_CHUNK_SIZE * 3)],
			"release.bin",
		);
		let cancelled = false;
		const hasher = {
			digest: () => "unreachable",
			init() {
				return this;
			},
			update() {
				return this;
			},
		};

		await expect(
			hashFileIncrementally(file, {
				chunkSize: MIN_HASH_CHUNK_SIZE,
				createHasher: async () => hasher,
				isCancelled: () => cancelled,
				onProgress: (progress) => {
					if (progress > 0) cancelled = true;
				},
			}),
		).rejects.toBeInstanceOf(HashCancelledError);
	});

	it("rejects unbounded or invalid chunk sizes", async () => {
		await expect(
			hashFileIncrementally(new Blob(["a"]), {
				chunkSize: MIN_HASH_CHUNK_SIZE - 1,
			}),
		).rejects.toThrow("chunkSize must be an integer");
	});

	it("maps worker progress and completion to an isolated task", async () => {
		const worker = new FakeWorker();
		const onProgress = vi.fn();
		const task = startHashWorkerTask(
			worker,
			new File(["release"], "release.bin"),
			{ jobId: "job-1", onProgress },
		);
		expect(worker.requests[0]).toMatchObject({
			jobId: "job-1",
			type: "hash:start",
		});

		worker.emit({ jobId: "other-job", progress: 0.9, type: "hash:progress" });
		worker.emit({ jobId: "job-1", progress: 2, type: "hash:progress" });
		worker.emit({ jobId: "job-1", sha256: "abc", type: "hash:complete" });

		await expect(task.promise).resolves.toBe("abc");
		expect(onProgress).toHaveBeenCalledOnce();
		expect(onProgress).toHaveBeenCalledWith(1);
	});

	it("uses the cancel protocol and rejects with a typed error", async () => {
		const worker = new FakeWorker();
		const task = startHashWorkerTask(
			worker,
			new File(["release"], "release.bin"),
			{ jobId: "job-2" },
		);

		task.cancel();
		expect(worker.requests.at(-1)).toEqual({
			jobId: "job-2",
			type: "hash:cancel",
		});
		worker.emit({ jobId: "job-2", type: "hash:cancelled" });
		await expect(task.promise).rejects.toBeInstanceOf(HashCancelledError);
	});

	it("surfaces bounded worker errors", async () => {
		const worker = new FakeWorker();
		const task = startHashWorkerTask(
			worker,
			new File(["release"], "release.bin"),
			{ jobId: "job-3" },
		);

		worker.emit({
			jobId: "job-3",
			message: "Unable to read release file.",
			type: "hash:error",
		});
		await expect(task.promise).rejects.toThrow("Unable to read release file.");
	});
});
