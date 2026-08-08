// ali-oss 6.x does not expose a package entry declaration. The local ambient
// declaration plus this narrow adapter keeps the untyped SDK surface at one
// boundary and makes upload behavior injectable in tests.
import AliOss from "ali-oss";

/**
 * Keep SDK part fan-out deliberately small. The upload workflow may run more
 * than one file at a time, so this limit is only the per-file multiplier.
 */
export const OSS_MULTIPART_PARALLELISM = 2;
export const DEFAULT_OSS_UPLOAD_TIMEOUT_MS = 120_000;
export const OSS_STS_REFRESH_INTERVAL_MS = 60_000;
export const MIN_OSS_MULTIPART_PART_SIZE = 100 * 1024;
export const DEFAULT_OSS_MULTIPART_PART_SIZE = 4 * 1024 * 1024;
export const MAX_OSS_MULTIPART_PART_COUNT = 10_000;
/**
 * ali-oss buffers a simple browser PUT in memory and cannot report its upload
 * progress. Keep simple uploads within the same raw 8 MiB per-file payload
 * budget as two multipart parts; larger files retain checkpointed progress.
 */
export const MAX_OSS_SIMPLE_UPLOAD_FILE_SIZE_BYTES = 8 * 1024 * 1024;
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
	readonly refreshCredentials?: () => Promise<OssTemporaryCredentials>;
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}

export interface OssMultipartUploadResult {
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

export interface AliOssPutOptions {
	readonly headers: Readonly<{ "x-oss-forbid-overwrite": "true" }>;
	readonly mime?: string;
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
	put?(
		objectKey: string,
		file: File,
		options: AliOssPutOptions,
	): Promise<AliOssMultipartResult>;
}

export interface AliOssClientConfiguration {
	readonly accessKeyId: string;
	readonly accessKeySecret: string;
	readonly bucket: string;
	readonly region: string;
	readonly refreshSTSToken?: () => Promise<{
		readonly accessKeyId: string;
		readonly accessKeySecret: string;
		readonly stsToken: string;
	}>;
	readonly refreshSTSTokenInterval?: number;
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

/**
 * The deterministic content-addressed object was committed by an earlier
 * attempt, but its metadata transaction did not finish. Treat this provider
 * conflict as an ambiguous successful upload and let the server HEAD-verify it.
 */
export class OssUploadAlreadyExistsError extends Error {
	constructor() {
		super("OSS object already exists and requires server reconciliation.");
		this.name = "OssUploadAlreadyExistsError";
	}
}

export class OssMultipartEtagCorsError extends Error {
	constructor() {
		super(
			"OSS bucket CORS must expose the ETag response header for multipart uploads.",
		);
		this.name = "OssMultipartEtagCorsError";
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

function isAlreadyExistsError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const candidate = error as {
		readonly code?: unknown;
		readonly message?: unknown;
		readonly status?: unknown;
		readonly statusCode?: unknown;
	};
	if (candidate.code === "FileAlreadyExists") return true;
	const status = candidate.status ?? candidate.statusCode;
	return (
		status === 409 &&
		typeof candidate.message === "string" &&
		/object .*already exists|already exists .*not be overwritten/i.test(
			candidate.message,
		)
	);
}

function isMissingMultipartEtagCorsError(error: unknown): boolean {
	if (!error || typeof error !== "object" || !("message" in error)) {
		return false;
	}
	return (
		typeof error.message === "string" &&
		/please set the etag of expose-headers in oss/i.test(error.message)
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
	input: Pick<OssMultipartUploadInput, "bucket" | "credentials" | "region"> &
		Partial<Pick<OssMultipartUploadInput, "refreshCredentials">>,
): AliOssClientConfiguration {
	return {
		accessKeyId: input.credentials.accessKeyId,
		accessKeySecret: input.credentials.accessKeySecret,
		bucket: input.bucket,
		region: input.region,
		...(input.refreshCredentials
			? {
					refreshSTSToken: async () => {
						const credentials = await input.refreshCredentials?.();
						if (!credentials) {
							throw new Error("STS refresh returned no credentials.");
						}
						return {
							accessKeyId: credentials.accessKeyId,
							accessKeySecret: credentials.accessKeySecret,
							stsToken: credentials.securityToken,
						};
					},
					refreshSTSTokenInterval: OSS_STS_REFRESH_INTERVAL_MS,
				}
			: {}),
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
	const useSimpleUpload =
		input.file.size <= MAX_OSS_SIMPLE_UPLOAD_FILE_SIZE_BYTES &&
		typeof client.put === "function";
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

	const headers = { "x-oss-forbid-overwrite": "true" } as const;
	const options: AliOssMultipartOptions = {
		...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
		disabledMD5: true,
		headers,
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
		.then(async () => {
			if (cancelled) throw new OssUploadCancelledError();
			if (useSimpleUpload && client.put) {
				if (resumedUploadId) {
					await abortWithClient(
						client,
						input.objectKey,
						resumedUploadId,
						timeout,
					);
					latestCheckpoint = null;
				}
				input.onProgress?.(0);
				return client.put(input.objectKey, input.file, {
					headers,
					...(input.mimeType ? { mime: input.mimeType } : {}),
					timeout,
				});
			}
			return client.multipartUpload(input.objectKey, input.file, options);
		})
		.then(() => {
			if (cancelled || client.isCancel?.()) {
				throw new OssUploadCancelledError();
			}
			uploadCompleted = true;
			input.onProgress?.(1);
			return {
				objectKey: input.objectKey,
			};
		})
		.catch((error: unknown) => {
			if (cancelled || client.isCancel?.() || isCancelledError(error)) {
				throw new OssUploadCancelledError();
			}
			if (isAlreadyExistsError(error)) {
				throw new OssUploadAlreadyExistsError();
			}
			if (isMissingMultipartEtagCorsError(error)) {
				throw new OssMultipartEtagCorsError();
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
