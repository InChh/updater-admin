import { Config } from "@alicloud/openapi-client";
import StsClientModule, {
	AssumeRoleRequest,
	type AssumeRoleResponse,
} from "@alicloud/sts20150401";

import type { TemporaryOssCredentials } from "../../../shared/api/uploads";
import { type EnvironmentSource, readOssEnvironment } from "../../env.server";
import { normalizeUploadPrefix } from "./path";

export const DEFAULT_UPLOAD_STS_DURATION_SECONDS = 900;
export const MAX_UPLOAD_STS_DURATION_SECONDS = 3_600;

const UPLOAD_ACTIONS = ["oss:PutObject", "oss:AbortMultipartUpload"] as const;

const OSS_BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const ROLE_SESSION_ALLOWED_PATTERN = /[^A-Za-z0-9.@_-]+/g;
const ROLE_SESSION_MAX_LENGTH = 64;
const ROLE_SESSION_PREFIX = "updater-upload-";

export type UploadStsErrorCode =
	| "ASSUME_ROLE_FAILED"
	| "INVALID_CONFIGURATION"
	| "INVALID_RESPONSE";

/** A secret-free integration error suitable for API and monitoring layers. */
export class UploadStsError extends Error {
	readonly code: UploadStsErrorCode;

	constructor(code: UploadStsErrorCode) {
		super(`Upload STS error: ${code}`);
		this.name = "UploadStsError";
		this.code = code;
	}
}

type AliyunStsClient = {
	assumeRole(request: AssumeRoleRequest): Promise<AssumeRoleResponse>;
};

type AliyunStsClientConstructor = new (
	configuration: Config,
) => AliyunStsClient;

/**
 * The Aliyun STS package is CommonJS. Native Node ESM exposes its default
 * class as `default.default`, while Vite may expose the class directly.
 */
export function resolveAliyunStsClientConstructor(
	moduleDefault: unknown,
): AliyunStsClientConstructor {
	if (typeof moduleDefault === "function") {
		return moduleDefault as AliyunStsClientConstructor;
	}
	if (
		typeof moduleDefault === "object" &&
		moduleDefault !== null &&
		"default" in moduleDefault &&
		typeof moduleDefault.default === "function"
	) {
		return moduleDefault.default as AliyunStsClientConstructor;
	}
	throw new UploadStsError("INVALID_CONFIGURATION");
}

export interface UploadStsConfiguration {
	readonly bucket: string;
	readonly uploadPrefix: string;
	readonly uploadRoleArn: string;
}

export interface UploadStsRuntimeConfiguration extends UploadStsConfiguration {
	readonly accessKeyId: string;
	readonly accessKeySecret: string;
	readonly stsEndpoint: string;
}

export interface UploadStsPolicy {
	readonly Statement: readonly [
		{
			readonly Action: typeof UPLOAD_ACTIONS;
			readonly Effect: "Allow";
			readonly Resource: readonly [string];
		},
	];
	readonly Version: "1";
}

export interface UploadAssumeRoleRequest {
	readonly durationSeconds: number;
	readonly policy: string;
	readonly roleArn: string;
	readonly roleSessionName: string;
}

export interface UploadAssumeRoleResponse {
	readonly credentials?: {
		readonly accessKeyId?: string;
		readonly accessKeySecret?: string;
		readonly expiration?: string;
		readonly securityToken?: string;
	};
	readonly statusCode?: number;
}

export interface UploadStsClient {
	assumeRole(
		request: UploadAssumeRoleRequest,
	): Promise<UploadAssumeRoleResponse>;
}

export interface IssueUploadCredentialsInput {
	/** Opaque administrator ID used only for the ActionTrail role-session name. */
	readonly actorId?: string;
}

export interface UploadStsService {
	issueUploadCredentials(
		input?: IssueUploadCredentialsInput,
	): Promise<TemporaryOssCredentials>;
}

export interface UploadStsServiceDependencies {
	readonly client?: UploadStsClient;
	readonly clientFactory?: (
		configuration: UploadStsRuntimeConfiguration,
	) => UploadStsClient;
	readonly configuration?: UploadStsConfiguration;
	readonly durationSeconds?: number;
	readonly environment?: EnvironmentSource;
}

function assertDurationSeconds(value: number): number {
	if (
		!Number.isInteger(value) ||
		value < DEFAULT_UPLOAD_STS_DURATION_SECONDS ||
		value > MAX_UPLOAD_STS_DURATION_SECONDS
	) {
		throw new UploadStsError("INVALID_CONFIGURATION");
	}
	return value;
}

function assertConfiguration(
	configuration: UploadStsConfiguration,
): UploadStsConfiguration {
	if (
		!OSS_BUCKET_PATTERN.test(configuration.bucket) ||
		configuration.uploadRoleArn.trim().length === 0 ||
		configuration.uploadPrefix.includes("*") ||
		configuration.uploadPrefix.includes("?")
	) {
		throw new UploadStsError("INVALID_CONFIGURATION");
	}
	return {
		bucket: configuration.bucket,
		uploadPrefix: normalizeUploadPrefix(configuration.uploadPrefix),
		uploadRoleArn: configuration.uploadRoleArn,
	};
}

/**
 * Creates the inline session policy used by AssumeRole. Multipart initiate,
 * part upload, and completion are all covered by OSS PutObject. Cancellation
 * with a known upload ID additionally requires AbortMultipartUpload. Resume is
 * driven entirely by the in-memory client checkpoint and never lists remote
 * parts.
 */
export function createUploadStsPolicy(
	configuration: Pick<UploadStsConfiguration, "bucket" | "uploadPrefix">,
): UploadStsPolicy {
	const checked = assertConfiguration({
		...configuration,
		uploadRoleArn: "policy-only",
	});
	return {
		Statement: [
			{
				Action: UPLOAD_ACTIONS,
				Effect: "Allow",
				Resource: [`acs:oss:*:*:${checked.bucket}/${checked.uploadPrefix}*`],
			},
		],
		Version: "1",
	};
}

/** Produces a RAM-compatible, non-PII fallback role-session name. */
export function createUploadRoleSessionName(actorId?: string): string {
	const safeActorId = actorId
		?.normalize("NFKC")
		.replaceAll(ROLE_SESSION_ALLOWED_PATTERN, "-")
		.replaceAll(/-+/g, "-")
		.replace(/^[-.]+|[-.]+$/g, "");
	const suffix = safeActorId || "administrator";
	return `${ROLE_SESSION_PREFIX}${suffix}`.slice(0, ROLE_SESSION_MAX_LENGTH);
}

function canonicalExpiration(value: string | undefined): string {
	if (!value) throw new UploadStsError("INVALID_RESPONSE");
	const expiration = new Date(value);
	if (!Number.isFinite(expiration.getTime())) {
		throw new UploadStsError("INVALID_RESPONSE");
	}
	return expiration.toISOString();
}

function nonEmptyCredential(value: string | undefined): string {
	if (!value) throw new UploadStsError("INVALID_RESPONSE");
	return value;
}

function mapSdkResponse(
	response: AssumeRoleResponse,
): UploadAssumeRoleResponse {
	return {
		credentials: response.body?.credentials,
		statusCode: response.statusCode,
	};
}

function createAliyunUploadStsClient(
	configuration: UploadStsRuntimeConfiguration,
): UploadStsClient {
	const StsClient = resolveAliyunStsClientConstructor(StsClientModule);
	const client = new StsClient(
		new Config({
			accessKeyId: configuration.accessKeyId,
			accessKeySecret: configuration.accessKeySecret,
			endpoint: configuration.stsEndpoint,
		}),
	);

	return {
		async assumeRole(request) {
			const response = await client.assumeRole(new AssumeRoleRequest(request));
			return mapSdkResponse(response);
		},
	};
}

export function createUploadStsService(
	dependencies: UploadStsServiceDependencies = {},
): UploadStsService {
	let environment: ReturnType<typeof readOssEnvironment> | undefined;
	let configuration: UploadStsConfiguration | undefined;
	let client: UploadStsClient | undefined;

	const getEnvironment = () => {
		environment ??= readOssEnvironment(dependencies.environment);
		return environment;
	};
	const getConfiguration = () => {
		configuration ??= assertConfiguration(
			dependencies.configuration ?? getEnvironment(),
		);
		return configuration;
	};
	const getClient = () => {
		if (dependencies.client) return dependencies.client;
		client ??= (dependencies.clientFactory ?? createAliyunUploadStsClient)(
			getEnvironment(),
		);
		return client;
	};

	return {
		async issueUploadCredentials(input = {}) {
			const checkedConfiguration = getConfiguration();
			const request: UploadAssumeRoleRequest = {
				durationSeconds: assertDurationSeconds(
					dependencies.durationSeconds ?? DEFAULT_UPLOAD_STS_DURATION_SECONDS,
				),
				policy: JSON.stringify(createUploadStsPolicy(checkedConfiguration)),
				roleArn: checkedConfiguration.uploadRoleArn,
				roleSessionName: createUploadRoleSessionName(input.actorId),
			};

			let response: UploadAssumeRoleResponse;
			try {
				response = await getClient().assumeRole(request);
			} catch {
				throw new UploadStsError("ASSUME_ROLE_FAILED");
			}
			if (response.statusCode !== 200) {
				throw new UploadStsError("ASSUME_ROLE_FAILED");
			}

			return {
				accessKeyId: nonEmptyCredential(response.credentials?.accessKeyId),
				accessKeySecret: nonEmptyCredential(
					response.credentials?.accessKeySecret,
				),
				expiration: canonicalExpiration(response.credentials?.expiration),
				securityToken: nonEmptyCredential(response.credentials?.securityToken),
			};
		},
	};
}

let singleton: UploadStsService | undefined;

export function getUploadStsService(): UploadStsService {
	singleton ??= createUploadStsService();
	return singleton;
}

export function resetUploadStsServiceForTests(): void {
	singleton = undefined;
}
