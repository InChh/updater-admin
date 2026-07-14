// ali-oss 6.x publishes browser declarations internally but does not expose a
// package entry declaration. This narrow adapter keeps the untyped SDK surface
// at one boundary and makes upload behavior injectable in tests.
// @ts-expect-error -- upstream package has no resolvable root declaration.
import AliOss from "ali-oss";

export const OSS_MULTIPART_PARALLELISM = 4;
export const DEFAULT_OSS_UPLOAD_TIMEOUT_MS = 120_000;
export const MIN_OSS_MULTIPART_PART_SIZE = 100 * 1024;

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

function createClientConfiguration(
	input: OssMultipartUploadInput,
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

/**
 * Start one independently cancellable multipart upload. A fresh client is used
 * per file because ali-oss cancel() operates on the client, not an individual
 * request. Retrying passes the last in-memory checkpoint back as input.
 */
export function startOssMultipartUpload(
	input: OssMultipartUploadInput,
	dependencies: OssUploaderDependencies = {},
): OssMultipartUploadTask {
	const timeout = input.timeoutMs ?? DEFAULT_OSS_UPLOAD_TIMEOUT_MS;
	requirePositiveInteger(timeout, "timeoutMs");
	if (input.partSize !== undefined) {
		requirePositiveInteger(input.partSize, "partSize");
		if (input.partSize < MIN_OSS_MULTIPART_PART_SIZE) {
			throw new RangeError(
				`partSize must be at least ${MIN_OSS_MULTIPART_PART_SIZE} bytes.`,
			);
		}
	}
	if (input.signal?.aborted) {
		return {
			cancel: () => undefined,
			promise: Promise.reject(new OssUploadCancelledError()),
		};
	}

	const client = (dependencies.createClient ?? defaultClientFactory)(
		createClientConfiguration(input),
	);
	let cancelled = false;
	const cancel = () => {
		if (cancelled) return;
		cancelled = true;
		client.cancel();
	};
	input.signal?.addEventListener("abort", cancel, { once: true });

	const options: AliOssMultipartOptions = {
		...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
		disabledMD5: true,
		headers: { "x-oss-forbid-overwrite": "true" },
		...(input.mimeType ? { mime: input.mimeType } : {}),
		parallel: OSS_MULTIPART_PARALLELISM,
		...(input.partSize === undefined ? {} : { partSize: input.partSize }),
		progress: (progress, checkpoint) => {
			if (cancelled) return;
			if (checkpoint) input.onCheckpoint?.(checkpoint);
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

	return { cancel, promise };
}
