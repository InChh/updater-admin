import { createRequire } from "node:module";

import { type EnvironmentSource, readOssEnvironment } from "../../env.server";

export type OssMetadataErrorCode =
	| "HEAD_FAILED"
	| "INVALID_METADATA"
	| "OBJECT_NOT_FOUND";

/** A secret-free integration error suitable for API and monitoring layers. */
export class OssMetadataError extends Error {
	readonly code: OssMetadataErrorCode;

	constructor(code: OssMetadataErrorCode) {
		super(`OSS metadata error: ${code}`);
		this.name = "OssMetadataError";
		this.code = code;
	}
}

type HeaderValue = number | readonly string[] | string | undefined;
type HeaderCollection = Headers | Readonly<Record<string, HeaderValue>>;

export interface AliOssMetadataResponse {
	readonly res?: {
		readonly headers?: HeaderCollection;
	};
	readonly status?: number;
}

export interface AliOssMetadataClient {
	getObjectMeta(objectKey: string): Promise<AliOssMetadataResponse>;
}

export interface OssMetadata {
	readonly etag: string;
	readonly size: bigint;
}

export interface OssMetadataClient {
	headObject(objectKey: string): Promise<OssMetadata>;
}

export interface AliOssClientOptions {
	readonly accessKeyId: string;
	readonly accessKeySecret: string;
	readonly bucket: string;
	readonly region: string;
	readonly secure: true;
}

interface AliOssConstructor {
	new (options: AliOssClientOptions): AliOssMetadataClient;
}

export interface OssMetadataClientDependencies {
	readonly client?: AliOssMetadataClient;
	readonly clientFactory?: (
		options: AliOssClientOptions,
	) => AliOssMetadataClient;
	readonly environment?: EnvironmentSource;
}

function loadAliOssClient(options: AliOssClientOptions): AliOssMetadataClient {
	const require = createRequire(import.meta.url);
	const loaded = require("ali-oss") as unknown;
	const candidate =
		typeof loaded === "object" && loaded !== null && "default" in loaded
			? loaded.default
			: loaded;
	if (typeof candidate !== "function") {
		throw new OssMetadataError("HEAD_FAILED");
	}
	return new (candidate as AliOssConstructor)(options);
}

function getHeader(
	headers: HeaderCollection | undefined,
	name: string,
): string | undefined {
	if (!headers) return undefined;
	if (headers instanceof Headers) return headers.get(name) ?? undefined;
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() !== name) continue;
		if (Array.isArray(value)) return value[0];
		return value === undefined ? undefined : String(value);
	}
	return undefined;
}

function normalizeEtag(value: string | undefined): string {
	if (!value) throw new OssMetadataError("INVALID_METADATA");
	const trimmed = value.trim();
	const normalized =
		trimmed.startsWith('"') && trimmed.endsWith('"')
			? trimmed.slice(1, -1)
			: trimmed;
	if (!normalized || /\p{Cc}/u.test(normalized)) {
		throw new OssMetadataError("INVALID_METADATA");
	}
	return normalized;
}

function normalizeSize(value: string | undefined): bigint {
	if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) {
		throw new OssMetadataError("INVALID_METADATA");
	}
	return BigInt(value);
}

function isNotFoundError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const status =
		"status" in error
			? error.status
			: "statusCode" in error
				? error.statusCode
				: undefined;
	return status === 404;
}

export function createOssMetadataClient(
	dependencies: OssMetadataClientDependencies = {},
): OssMetadataClient {
	let client: AliOssMetadataClient | undefined;
	const getClient = () => {
		if (dependencies.client) return dependencies.client;
		if (!client) {
			const environment = readOssEnvironment(dependencies.environment);
			client = (dependencies.clientFactory ?? loadAliOssClient)({
				accessKeyId: environment.accessKeyId,
				accessKeySecret: environment.accessKeySecret,
				bucket: environment.bucket,
				region: environment.region,
				secure: true,
			});
		}
		return client;
	};

	return {
		async headObject(objectKey) {
			if (!objectKey || objectKey.includes("\0")) {
				throw new OssMetadataError("INVALID_METADATA");
			}
			let response: AliOssMetadataResponse;
			try {
				response = await getClient().getObjectMeta(objectKey);
			} catch (error) {
				throw new OssMetadataError(
					isNotFoundError(error) ? "OBJECT_NOT_FOUND" : "HEAD_FAILED",
				);
			}
			if (response.status !== 200) {
				throw new OssMetadataError(
					response.status === 404 ? "OBJECT_NOT_FOUND" : "HEAD_FAILED",
				);
			}

			return {
				etag: normalizeEtag(getHeader(response.res?.headers, "etag")),
				size: normalizeSize(getHeader(response.res?.headers, "content-length")),
			};
		},
	};
}

let singleton: OssMetadataClient | undefined;

export function getOssMetadataClient(): OssMetadataClient {
	singleton ??= createOssMetadataClient();
	return singleton;
}

export function resetOssMetadataClientForTests(): void {
	singleton = undefined;
}
