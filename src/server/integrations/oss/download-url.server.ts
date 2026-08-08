import AliOssClientModule from "ali-oss";

import { PUBLIC_RELEASE_DOWNLOAD_URL_TTL_SECONDS } from "../../../shared/api/public-releases";
import { type EnvironmentSource, readOssEnvironment } from "../../env.server";
import {
	type AliOssClientOptions,
	resolveAliOssClientConstructor,
} from "./client.server";

export class OssDownloadUrlError extends Error {
	readonly code = "SIGN_FAILED" as const;

	constructor() {
		super("OSS download URL signing failed.");
		this.name = "OssDownloadUrlError";
	}
}

export interface OssDownloadUrlSigner {
	signGetUrl(objectKey: string): Promise<string>;
}

export interface AliOssDownloadClient {
	signatureUrlV4(
		method: "GET",
		expiresSeconds: number,
		request: undefined,
		objectKey: string,
	): Promise<unknown>;
}

interface AliOssDownloadConstructor {
	new (options: AliOssClientOptions): AliOssDownloadClient;
}

export interface OssDownloadUrlSignerDependencies {
	readonly client?: AliOssDownloadClient;
	readonly clientFactory?: (
		options: AliOssClientOptions,
	) => AliOssDownloadClient;
	readonly environment?: EnvironmentSource;
}

function loadAliOssDownloadClient(
	options: AliOssClientOptions,
): AliOssDownloadClient {
	const AliOssClient = resolveAliOssClientConstructor(
		AliOssClientModule,
	) as unknown as AliOssDownloadConstructor;
	return new AliOssClient(options);
}

function validatedHttpsUrl(value: unknown): string {
	if (typeof value !== "string" || !value) throw new OssDownloadUrlError();
	try {
		const parsed = new URL(value);
		if (
			parsed.protocol !== "https:" ||
			!parsed.hostname ||
			parsed.username ||
			parsed.password
		) {
			throw new OssDownloadUrlError();
		}
		return value;
	} catch (error) {
		if (error instanceof OssDownloadUrlError) throw error;
		throw new OssDownloadUrlError();
	}
}

export function createOssDownloadUrlSigner(
	dependencies: OssDownloadUrlSignerDependencies = {},
): OssDownloadUrlSigner {
	let client: AliOssDownloadClient | undefined;
	const getClient = () => {
		if (dependencies.client) return dependencies.client;
		if (!client) {
			const environment = readOssEnvironment(dependencies.environment);
			client = (dependencies.clientFactory ?? loadAliOssDownloadClient)({
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
		async signGetUrl(objectKey) {
			if (!objectKey || objectKey.includes("\0")) {
				throw new OssDownloadUrlError();
			}
			try {
				return validatedHttpsUrl(
					await getClient().signatureUrlV4(
						"GET",
						PUBLIC_RELEASE_DOWNLOAD_URL_TTL_SECONDS,
						undefined,
						objectKey,
					),
				);
			} catch {
				throw new OssDownloadUrlError();
			}
		},
	};
}

let singleton: OssDownloadUrlSigner | undefined;

export function getOssDownloadUrlSigner(): OssDownloadUrlSigner {
	singleton ??= createOssDownloadUrlSigner();
	return singleton;
}

export function resetOssDownloadUrlSignerForTests(): void {
	singleton = undefined;
}
