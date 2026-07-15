// ali-oss 6.x publishes browser declarations internally but does not expose a
// package entry declaration. This narrow adapter keeps the untyped SDK surface
// at one boundary and makes upload behavior injectable in tests.
// @ts-expect-error -- upstream package has no resolvable root declaration.
import AliOss from "ali-oss";

/**
 * Keep SDK part fan-out deliberately small. The upload workflow may run more
 * than one file at a time, so this limit is only the per-file multiplier.
 */
export const OSS_MULTIPART_PARALLELISM = 2;
export const DEFAULT_OSS_UPLOAD_TIMEOUT_MS = 120_000;
export const MIN_OSS_MULTIPART_PART_SIZE = 100 * 1024;
export const DEFAULT_OSS_MULTIPART_PART_SIZE = 4 * 1024 * 1024;
export const MAX_OSS_MULTIPART_PART_COUNT = 10_000;
/**
 * ali-oss retains up to `parallel` sliced part payloads per file. This bounds
 * those payload bytes; the browser and SDK may require additional overhead.
 */
export const MAX_OSS_MULTIPART_IN_FLIGHT_PART_BYTES_PER_FILE =
	DEFAULT_OSS_MULTIPART_PART_SIZE * OSS_MULTIPART_PARALLELISM;
/**
 * Files above this limit would make ali-oss silently increase partSize and
 * defeat the client memory bound. Server validation must use the same limit.
 */
export const MAX_OSS_MULTIPART_FILE_SIZE_BYTES =
	DEFAULT_OSS_MULTIPART_PART_SIZE * MAX_OSS_MULTIPART_PART_COUNT;

export interface OssTemporaryCredentials {
	readonly accessKeyId: string;
	readonly accessKeySecret: string;
	readonly securityToken: string;
}

/** An ali-oss checkpoint is deliberately opaque and must stay in memory. */
export type OssMultipartCheckpoint = Readonly<Record<string, unknown>>;

export interface OssMultipartUploadInput {
	readonly bucket: string;
	readonly checkpoint?: OssMultipartCheckpoint | null;
	readonly credentials: OssTemporaryCredentials;
	readonly file: File;
	readonly mimeType?: string;
	readonly objectKey: string;
	readonly onCheckpoint?: (checkpoint: OssMultipartCheckpoint) => void;
	readonly onProgress?: (progress: number) => void;
	readonly partSize?: number;
	readonly region: string;
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}

export interface OssMultipartUploadResult {
	readonly objectEtag: string;
	readonly objectKey: string;
}

export interface OssMultipartUploadTask {
	readonly promise: Promise<OssMultipartUploadResult>;
	cancel(): void;
	/** Resolves to a bounded status and never exposes an OSS provider error. */
	waitForCleanup?(): Promise<OssMultipartAbortStatus>;
}

export interface StartedOssMultipartUploadTask extends OssMultipartUploadTask {
	waitForCleanup(): Promise<OssMultipartAbortStatus>;
}

export type OssMultipartAbortStatus =
	| "aborted"
	| "failed"
	| "not-requested"
	| "unknown-upload"
	| "unsupported";

export interface OssMultipartAbortInput {
	readonly bucket: string;
	readonly checkpoint?: OssMultipartCheckpoint | null;
	readonly credentials: OssTemporaryCredentials;
	readonly objectKey: string;
	readonly region: string;
	readonly timeoutMs?: number;
}

export interface AliOssMultipartResult {
	readonly etag?: unknown;
	readonly res?: {
		readonly headers?: Readonly<Record<string, unknown>>;
	};
}

export interface AliOssMultipartOptions {
	readonly checkpoint?: OssMultipartCheckpoint;
	readonly disabledMD5: true;
	readonly headers: Readonly<{ "x-oss-forbid-overwrite": "true" }>;
	readonly mime?: string;
	readonly parallel: typeof OSS_MULTIPART_PARALLELISM;
	readonly partSize?: number;
	readonly progress: (
		progress: number,
		checkpoint?: OssMultipartCheckpoint,
	) => void | Promise<void>;
	readonly timeout: number;
}

export interface AliOssClientLike {
	abortMultipartUpload?(
		objectKey: string,
		uploadId: string,
		options?: Readonly<{ timeout: number }>,
	): Promise<unknown>;
	cancel(): void;
	isCancel?(): boolean;
	multipartUpload(
		objectKey: string,
		file: File,
		options: AliOssMultipartOptions,
	): Promise<AliOssMultipartResult>;
}

export interface AliOssClientConfiguration {
	readonly accessKeyId: string;
	readonly accessKeySecret: string;
	readonly bucket: string;
	readonly region: string;
	readonly secure: true;
	readonly stsToken: string;
}

export type AliOssClientFactory = (
	configuration: AliOssClientConfiguration,
) => AliOssClientLike;

export interface OssUploaderDependencies {
	readonly createClient?: AliOssClientFactory;
}

export class OssUploadCancelledError extends Error {
	constructor() {
		super("File upload was cancelled.");
		this.name = "OssUploadCancelledError";
	}
}

type AliOssConstructor = new (
	configuration: AliOssClientConfiguration,
) => AliOssClientLike;

const AliOssClient = AliOss as unknown as AliOssConstructor;

function defaultClientFactory(
	configuration: AliOssClientConfiguration,
): AliOssClientLike {
	return new AliOssClient(configuration);
}

function clampProgress(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

function isCancelledError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	return "name" in error && error.name === "cancel";
}

function resultEtag(result: AliOssMultipartResult): string {
	const direct = typeof result.etag === "string" ? result.etag.trim() : "";
	if (direct) return direct;

	for (const [name, value] of Object.entries(result.res?.headers ?? {})) {
		if (name.toLowerCase() !== "etag" || typeof value !== "string") continue;
		const header = value.trim();
		if (header) return header;
	}
	throw new Error(
		"OSS upload completed without an ETag. Expose the ETag response header in bucket CORS.",
	);
}

function requirePositiveInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive integer.`);
	}
}

function requireNonNegativeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
}

function validatePartSize(value: number): void {
	requirePositiveInteger(value, "partSize");
	if (value < MIN_OSS_MULTIPART_PART_SIZE) {
		throw new RangeError(
			`partSize must be at least ${MIN_OSS_MULTIPART_PART_SIZE} bytes.`,
		);
	}
	if (value > DEFAULT_OSS_MULTIPART_PART_SIZE) {
		throw new RangeError(
			`partSize must not exceed ${DEFAULT_OSS_MULTIPART_PART_SIZE} bytes.`,
		);
	}
}

function checkpointPartSize(
	checkpoint: OssMultipartCheckpoint | null | undefined,
): number | null {
	if (!checkpoint || !("partSize" in checkpoint)) return null;
	const value = checkpoint?.partSize;
	if (typeof value !== "number") {
		throw new RangeError("checkpoint partSize must be a number.");
	}
	return value;
}

function checkpointUploadId(
	checkpoint: OssMultipartCheckpoint | null | undefined,
): string | null {
	const value = checkpoint?.uploadId;
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

/**
 * Resolve an explicit part size without allowing ali-oss to increase it at
 * runtime. Callers can share `MAX_OSS_MULTIPART_FILE_SIZE_BYTES` with server
 * validation to reject oversized files before issuing STS credentials.
 */
export function resolveOssMultipartPartSize(
	fileSize: number,
	requestedPartSize = DEFAULT_OSS_MULTIPART_PART_SIZE,
): number {
	requireNonNegativeInteger(fileSize, "fileSize");
	validatePartSize(requestedPartSize);
	const maximumFileSize = requestedPartSize * MAX_OSS_MULTIPART_PART_COUNT;
	if (fileSize > maximumFileSize) {
		throw new RangeError(
			`fileSize must not exceed ${maximumFileSize} bytes for the selected partSize.`,
		);
	}
	return requestedPartSize;
}

function createClientConfiguration(
	input: Pick<OssMultipartUploadInput, "bucket" | "credentials" | "region">,
): AliOssClientConfiguration {
	return {
		accessKeyId: input.credentials.accessKeyId,
		accessKeySecret: input.credentials.accessKeySecret,
		bucket: input.bucket,
		region: input.region,
		secure: true,
		stsToken: input.credentials.securityToken,
	};
}

async function abortWithClient(
	client: AliOssClientLike,
	objectKey: string,
	uploadId: string | null,
	timeout: number,
): Promise<OssMultipartAbortStatus> {
	if (!uploadId) return "unknown-upload";
	if (!client.abortMultipartUpload) return "unsupported";
	try {
		await client.abortMultipartUpload(objectKey, uploadId, { timeout });
		return "aborted";
	} catch {
		// Provider failures can contain signed URLs or request details. Lifecycle
		// cleanup is the fallback, so expose only a bounded status to the caller.
		return "failed";
	}
}

/**
 * Best-effort cleanup for a failed upload that is discarded after its task has
 * settled. Unknown IDs, unsupported SDK adapters and provider failures are
 * intentionally represented as statuses for bucket lifecycle fallback.
 */
export async function abortOssMultipartCheckpoint(
	input: OssMultipartAbortInput,
	dependencies: OssUploaderDependencies = {},
): Promise<OssMultipartAbortStatus> {
	const timeout = input.timeoutMs ?? DEFAULT_OSS_UPLOAD_TIMEOUT_MS;
	requirePositiveInteger(timeout, "timeoutMs");
	const uploadId = checkpointUploadId(input.checkpoint);
	if (!uploadId) return "unknown-upload";
	try {
		const client = (dependencies.createClient ?? defaultClientFactory)(
			createClientConfiguration(input),
		);
		return await abortWithClient(client, input.objectKey, uploadId, timeout);
	} catch {
		return "failed";
	}
}

/**
 * Start one independently cancellable multipart upload. A fresh client is used
 * per file because ali-oss cancel() operates on the client, not an individual
 * request. Retrying passes the last in-memory checkpoint back as input.
 */
export function startOssMultipartUpload(
	input: OssMultipartUploadInput,
	dependencies: OssUploaderDependencies = {},
): StartedOssMultipartUploadTask {
	const timeout = input.timeoutMs ?? DEFAULT_OSS_UPLOAD_TIMEOUT_MS;
	requirePositiveInteger(timeout, "timeoutMs");
	const resumedPartSize = checkpointPartSize(input.checkpoint);
	const resumedUploadId = checkpointUploadId(input.checkpoint);
	if (resumedUploadId) {
		if (resumedPartSize === null) {
			throw new RangeError("multipart checkpoint must include partSize.");
		}
		if (input.checkpoint?.fileSize !== input.file.size) {
			throw new RangeError(
				"multipart checkpoint fileSize must match the file.",
			);
		}
		if (input.checkpoint?.name !== input.objectKey) {
			throw new RangeError(
				"multipart checkpoint name must match the object key.",
			);
		}
	}
	if (
		input.partSize !== undefined &&
		resumedPartSize !== null &&
		input.partSize !== resumedPartSize
	) {
		throw new RangeError("partSize must match the multipart checkpoint.");
	}
	const partSize = resolveOssMultipartPartSize(
		input.file.size,
		input.partSize ?? resumedPartSize ?? DEFAULT_OSS_MULTIPART_PART_SIZE,
	);
	if (input.signal?.aborted) {
		return {
			cancel: () => undefined,
			promise: Promise.reject(new OssUploadCancelledError()),
			waitForCleanup: async () => "not-requested",
		};
	}

	const client = (dependencies.createClient ?? defaultClientFactory)(
		createClientConfiguration(input),
	);
	let cancelled = false;
	let uploadCompleted = false;
	let latestCheckpoint = input.checkpoint ?? null;
	let cleanupPromise: Promise<OssMultipartAbortStatus> =
		Promise.resolve("not-requested");
	const cancel = () => {
		if (cancelled || uploadCompleted) return;
		cancelled = true;
		try {
			client.cancel();
		} catch {
			// Cancellation must remain immediate even if an SDK adapter misbehaves.
		}
		cleanupPromise = abortWithClient(
			client,
			input.objectKey,
			checkpointUploadId(latestCheckpoint),
			timeout,
		);
	};
	input.signal?.addEventListener("abort", cancel, { once: true });

	const options: AliOssMultipartOptions = {
		...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
		disabledMD5: true,
		headers: { "x-oss-forbid-overwrite": "true" },
		...(input.mimeType ? { mime: input.mimeType } : {}),
		parallel: OSS_MULTIPART_PARALLELISM,
		partSize,
		progress: (progress, checkpoint) => {
			if (cancelled) return;
			if (checkpoint) {
				latestCheckpoint = checkpoint;
				input.onCheckpoint?.(checkpoint);
			}
			input.onProgress?.(clampProgress(progress));
		},
		timeout,
	};

	const promise = Promise.resolve()
		.then(() => {
			if (cancelled) throw new OssUploadCancelledError();
			return client.multipartUpload(input.objectKey, input.file, options);
		})
		.then((result) => {
			if (cancelled || client.isCancel?.()) {
				throw new OssUploadCancelledError();
			}
			uploadCompleted = true;
			input.onProgress?.(1);
			return {
				objectEtag: resultEtag(result),
				objectKey: input.objectKey,
			};
		})
		.catch((error: unknown) => {
			if (cancelled || client.isCancel?.() || isCancelledError(error)) {
				throw new OssUploadCancelledError();
			}
			throw error;
		})
		.finally(() => input.signal?.removeEventListener("abort", cancel));

	return {
		cancel,
		promise,
		waitForCleanup: () => cleanupPromise,
	};
}
