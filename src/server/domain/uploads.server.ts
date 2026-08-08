import type { FieldError } from "../../shared/api/common";
import type {
	TemporaryOssCredentials,
	UploadCredentialsRequest,
	UploadCredentialsResponse,
} from "../../shared/api/uploads";
import { UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE } from "../../shared/api/uploads";
import { getDatabase } from "../db/client.server";
import {
	type AuditRepository,
	createAuditRepository,
} from "../db/repositories/audit.server";
import type { ProgramMutationContext } from "../db/repositories/programs.server";
import { readOssEnvironment } from "../env.server";
import { normalizeUploadPrefix } from "../integrations/oss/path";
import {
	getUploadStsService,
	UploadStsError,
	type UploadStsService,
} from "../integrations/oss/sts.server";

const MAX_VALIDATION_ERRORS = 100;

export class UploadsValidationError extends Error {
	readonly fieldErrors: readonly FieldError[];

	constructor(fieldErrors: readonly FieldError[]) {
		super("Upload metadata is invalid.");
		this.name = "UploadsValidationError";
		this.fieldErrors = fieldErrors.slice(0, MAX_VALIDATION_ERRORS);
	}
}

export class UploadMetadataConflictError extends Error {
	readonly fieldErrors: readonly FieldError[];

	constructor(fieldErrors: readonly FieldError[]) {
		super("Upload metadata conflicts with the canonical object proof.");
		this.name = "UploadMetadataConflictError";
		this.fieldErrors = fieldErrors.slice(0, MAX_VALIDATION_ERRORS);
	}
}

export class UploadObjectNotFoundError extends Error {
	readonly fieldErrors: readonly FieldError[];

	constructor(index: number) {
		super("The uploaded object was not found at its canonical destination.");
		this.name = "UploadObjectNotFoundError";
		this.fieldErrors = [
			{
				code: UPLOAD_OBJECT_NOT_FOUND_FIELD_CODE,
				path: `files.${index}.objectKey`,
			},
		];
	}
}

export class UploadVerificationUnavailableError extends Error {
	constructor() {
		super("Upload object verification is temporarily unavailable.");
		this.name = "UploadVerificationUnavailableError";
	}
}

export class UploadCredentialsUnavailableError extends Error {
	constructor() {
		super("Upload credentials are temporarily unavailable.");
		this.name = "UploadCredentialsUnavailableError";
	}
}

export interface UploadsConfiguration {
	readonly bucket: string;
	readonly region: string;
	readonly uploadPrefix: string;
}

export interface UploadsService {
	issueCredentials(
		input: UploadCredentialsRequest,
		audit: ProgramMutationContext,
	): Promise<UploadCredentialsResponse>;
}

export interface UploadsServiceDependencies {
	readonly auditRepository?: AuditRepository;
	readonly configuration?: UploadsConfiguration;
	readonly getAuditRepository?: () => AuditRepository;
	readonly getConfiguration?: () => UploadsConfiguration;
	readonly getStsService?: () => UploadStsService;
	readonly stsService?: UploadStsService;
}

export function createUploadsService(
	dependencies: UploadsServiceDependencies = {},
): UploadsService {
	let auditRepository = dependencies.auditRepository;
	let configuration = dependencies.configuration;
	let stsService = dependencies.stsService;
	const resolveConfiguration = () => {
		configuration ??= dependencies.getConfiguration?.() ?? readOssEnvironment();
		return configuration;
	};
	const resolveAuditRepository = () => {
		auditRepository ??=
			dependencies.getAuditRepository?.() ??
			createAuditRepository(getDatabase());
		return auditRepository;
	};
	const resolveStsService = () => {
		stsService ??= dependencies.getStsService?.() ?? getUploadStsService();
		return stsService;
	};

	return {
		async issueCredentials(_input, audit) {
			const runtime = resolveConfiguration();
			const uploadPrefix = normalizeUploadPrefix(runtime.uploadPrefix);
			let credentials: TemporaryOssCredentials;
			try {
				credentials = await resolveStsService().issueUploadCredentials({
					actorId: audit.actorId,
				});
			} catch (error) {
				if (
					error instanceof UploadStsError &&
					error.code !== "INVALID_CONFIGURATION"
				) {
					throw new UploadCredentialsUnavailableError();
				}
				throw error;
			}
			await resolveAuditRepository().append({
				action: "upload.credentials.issued",
				actorId: audit.actorId,
				after: { credentialSetCount: 1 },
				before: null,
				ip: audit.ip,
				requestId: audit.requestId,
				resourceId: audit.requestId,
				resourceType: "upload",
				result: "success",
				userAgent: audit.userAgent,
			});
			return {
				bucket: runtime.bucket,
				credentials,
				region: runtime.region,
				uploadPrefix,
			};
		},
	};
}
