import type { FieldError } from "../../shared/api/common";
import { isWellFormedUnicode } from "../../shared/api/common";
import type { FileMetadataDto } from "../../shared/api/files";
import {
	type CompleteUploadsRequest,
	type CompleteUploadsResponse,
	DECIMAL_BYTE_SIZE_PATTERN,
	MAX_UPLOAD_FILES,
	MAX_UPLOAD_MIME_TYPE_CODE_POINTS,
	MAX_UPLOAD_OBJECT_KEY_BYTES,
	MAX_UPLOAD_SIZE_BYTES,
	SHA256_PATTERN,
	type TemporaryOssCredentials,
	UPLOAD_MIME_TYPE_PATTERN,
	type UploadCredentialsRequest,
	type UploadCredentialsResponse,
	type UploadFileMetadataInput,
} from "../../shared/api/uploads";
import { getDatabase } from "../db/client.server";
import {
	type AuditRepository,
	createAuditRepository,
} from "../db/repositories/audit.server";
import type { ProgramMutationContext } from "../db/repositories/programs.server";
import {
	createUploadsRepository,
	type RegisteredUploadMetadata,
	type RegisterUploadMetadataInput,
	UploadMetadataConflictRepositoryError,
	type UploadsRepository,
} from "../db/repositories/uploads.server";
import { readOssEnvironment } from "../env.server";
import {
	getOssMetadataClient,
	type OssMetadataClient,
	OssMetadataError,
} from "../integrations/oss/client.server";
import {
	createUploadObjectKey,
	UploadObjectKeyValidationError,
} from "../integrations/oss/object-key";
import {
	normalizeUploadPath,
	UploadPathValidationError,
} from "../integrations/oss/path";
import {
	getUploadStsService,
	UploadStsError,
	type UploadStsService,
} from "../integrations/oss/sts.server";

export const DEFAULT_UPLOAD_HEAD_CONCURRENCY = 4;
const MAX_UPLOAD_HEAD_CONCURRENCY = 16;
const MAX_VALIDATION_ERRORS = 100;

export class UploadsValidationError extends Error {
	readonly fieldErrors: readonly FieldError[];

	constructor(fieldErrors: readonly FieldError[]) {
		super("Upload metadata is invalid.");
		this.name = "UploadsValidationError";
		this.fieldErrors = fieldErrors.slice(0, MAX_VALIDATION_ERRORS);
	}
}

/**
 * A submitted completion proof disagrees with the canonical OSS object or an
 * existing metadata row. The error intentionally carries no object contents,
 * credentials, or provider response details.
 */
export class UploadMetadataConflictError extends Error {
	readonly fieldErrors: readonly FieldError[];

	constructor(fieldErrors: readonly FieldError[]) {
		super("Upload metadata conflicts with the canonical object proof.");
		this.name = "UploadMetadataConflictError";
		this.fieldErrors = fieldErrors.slice(0, MAX_VALIDATION_ERRORS);
	}
}

/** OSS could not answer a metadata verification request. */
export class UploadVerificationUnavailableError extends Error {
	constructor() {
		super("Upload object verification is temporarily unavailable.");
		this.name = "UploadVerificationUnavailableError";
	}
}

/** STS could not issue a usable short-lived browser credential. */
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
	complete(
		input: CompleteUploadsRequest,
		audit: ProgramMutationContext,
	): Promise<CompleteUploadsResponse>;
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
	readonly getMetadataClient?: () => OssMetadataClient;
	readonly getRepository?: () => UploadsRepository;
	readonly getStsService?: () => UploadStsService;
	readonly headConcurrency?: number;
	readonly metadataClient?: OssMetadataClient;
	readonly repository?: UploadsRepository;
	readonly stsService?: UploadStsService;
}

interface NormalizedUploadMetadata extends UploadFileMetadataInput {
	readonly sizeValue: bigint;
}

interface NormalizedCompletionMetadata extends NormalizedUploadMetadata {
	readonly objectEtag: string;
	readonly objectKey: string;
}

function characterLength(value: string): number {
	return [...value].length;
}

function isSafeText(value: string): boolean {
	return isWellFormedUnicode(value) && !/\p{Cc}/u.test(value);
}

function addError(
	errors: FieldError[],
	path: string,
	code = "INVALID_VALUE",
): void {
	if (errors.length < MAX_VALIDATION_ERRORS) errors.push({ code, path });
}

function normalizePath(
	value: unknown,
	path: string,
	errors: FieldError[],
): string | undefined {
	if (typeof value !== "string") {
		addError(errors, path);
		return undefined;
	}
	try {
		return normalizeUploadPath(value);
	} catch (error) {
		if (error instanceof UploadPathValidationError) {
			addError(errors, path);
			return undefined;
		}
		throw error;
	}
}

function normalizeSha256(
	value: unknown,
	path: string,
	errors: FieldError[],
): string | undefined {
	if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
		addError(errors, path, "INVALID_FORMAT");
		return undefined;
	}
	return value;
}

function normalizeSize(
	value: unknown,
	path: string,
	errors: FieldError[],
): { readonly text: string; readonly value: bigint } | undefined {
	if (typeof value !== "string" || !DECIMAL_BYTE_SIZE_PATTERN.test(value)) {
		addError(errors, path, "INVALID_FORMAT");
		return undefined;
	}
	const parsed = BigInt(value);
	if (parsed > MAX_UPLOAD_SIZE_BYTES) {
		addError(errors, path, "TOO_LARGE");
		return undefined;
	}
	return { text: value, value: parsed };
}

function normalizeMimeType(
	value: unknown,
	path: string,
	errors: FieldError[],
): string | undefined {
	if (typeof value !== "string" || !isSafeText(value)) {
		addError(errors, path);
		return undefined;
	}
	const normalized = value.trim();
	if (normalized.length === 0) {
		addError(errors, path, "REQUIRED");
		return undefined;
	}
	if (characterLength(normalized) > MAX_UPLOAD_MIME_TYPE_CODE_POINTS) {
		addError(errors, path, "TOO_LONG");
		return undefined;
	}
	if (!UPLOAD_MIME_TYPE_PATTERN.test(normalized)) {
		addError(errors, path, "INVALID_FORMAT");
		return undefined;
	}
	return normalized;
}

function normalizeSubmittedObjectKey(
	value: unknown,
	path: string,
	errors: FieldError[],
): string | undefined {
	if (typeof value !== "string" || value.length === 0 || !isSafeText(value)) {
		addError(errors, path);
		return undefined;
	}
	if (
		new TextEncoder().encode(value).byteLength > MAX_UPLOAD_OBJECT_KEY_BYTES
	) {
		addError(errors, path, "TOO_LONG");
		return undefined;
	}
	return value;
}

function expectedObjectKey(
	file: Pick<NormalizedUploadMetadata, "path" | "sha256">,
	index: number,
	uploadPrefix: string,
	errors: FieldError[],
): string | undefined {
	try {
		return createUploadObjectKey({
			path: file.path,
			prefix: uploadPrefix,
			sha256: file.sha256,
		});
	} catch (error) {
		if (
			error instanceof UploadObjectKeyValidationError &&
			error.code === "TOO_LONG"
		) {
			addError(errors, `files.${index}.path`, "TOO_LONG");
			return undefined;
		}
		throw error;
	}
}

function createObjectTargets(
	files: readonly NormalizedUploadMetadata[],
	uploadPrefix: string,
): UploadCredentialsResponse["objects"] {
	const errors: FieldError[] = [];
	const objects = files.flatMap((file, index) => {
		const objectKey = expectedObjectKey(file, index, uploadPrefix, errors);
		return objectKey === undefined ? [] : [{ objectKey, path: file.path }];
	});
	if (errors.length > 0) throw new UploadsValidationError(errors);
	return objects;
}

/** Normalizes the quoted or unquoted OSS ETag representation to one value. */
export function normalizeUploadEtag(value: unknown): string | null {
	if (typeof value !== "string" || !isWellFormedUnicode(value)) return null;
	const trimmed = value.trim();
	const startsQuoted = trimmed.startsWith('"');
	const endsQuoted = trimmed.endsWith('"');
	if (startsQuoted !== endsQuoted) return null;
	const normalized =
		startsQuoted && endsQuoted ? trimmed.slice(1, -1) : trimmed;
	if (
		normalized.length === 0 ||
		characterLength(normalized) > MAX_UPLOAD_MIME_TYPE_CODE_POINTS ||
		/\p{Cc}/u.test(normalized)
	) {
		return null;
	}
	return normalized;
}

function normalizeBaseFiles(
	files: unknown,
): readonly NormalizedUploadMetadata[] {
	if (
		!Array.isArray(files) ||
		files.length < 1 ||
		files.length > MAX_UPLOAD_FILES
	) {
		throw new UploadsValidationError([
			{
				code:
					Array.isArray(files) && files.length > MAX_UPLOAD_FILES
						? "TOO_MANY"
						: "REQUIRED",
				path: "files",
			},
		]);
	}

	const errors: FieldError[] = [];
	const normalized: NormalizedUploadMetadata[] = [];
	const paths = new Set<string>();
	for (const [index, candidate] of files.entries()) {
		const prefix = `files.${index}`;
		if (typeof candidate !== "object" || candidate === null) {
			addError(errors, prefix);
			continue;
		}
		const item = candidate as Record<string, unknown>;
		const path = normalizePath(item.path, `${prefix}.path`, errors);
		if (path !== undefined) {
			if (paths.has(path)) {
				addError(errors, `${prefix}.path`, "DUPLICATE_VALUE");
			} else {
				paths.add(path);
			}
		}
		const sha256 = normalizeSha256(item.sha256, `${prefix}.sha256`, errors);
		const size = normalizeSize(item.size, `${prefix}.size`, errors);
		const mimeType = normalizeMimeType(
			item.mimeType,
			`${prefix}.mimeType`,
			errors,
		);
		if (path !== undefined && sha256 && size && mimeType) {
			normalized.push({
				mimeType,
				path,
				sha256,
				size: size.text,
				sizeValue: size.value,
			});
		}
	}
	if (errors.length > 0) throw new UploadsValidationError(errors);
	return normalized;
}

function normalizeCompletionFiles(
	files: unknown,
	uploadPrefix: string,
): readonly NormalizedCompletionMetadata[] {
	const baseFiles = normalizeBaseFiles(files);
	const submitted = files as readonly Record<string, unknown>[];
	const errors: FieldError[] = [];
	const conflicts: FieldError[] = [];
	const normalized: NormalizedCompletionMetadata[] = [];
	for (const [index, base] of baseFiles.entries()) {
		const prefix = `files.${index}`;
		const objectKey = normalizeSubmittedObjectKey(
			submitted[index]?.objectKey,
			`${prefix}.objectKey`,
			errors,
		);
		const objectEtag = normalizeUploadEtag(submitted[index]?.objectEtag);
		if (objectEtag === null) {
			addError(errors, `${prefix}.objectEtag`);
		}
		const canonicalObjectKey = expectedObjectKey(
			base,
			index,
			uploadPrefix,
			errors,
		);
		if (objectKey !== undefined && objectKey !== canonicalObjectKey) {
			addError(conflicts, `${prefix}.objectKey`, "CONFLICT");
		}
		if (objectKey && objectEtag !== null) {
			normalized.push({ ...base, objectEtag, objectKey });
		}
	}
	if (errors.length > 0) throw new UploadsValidationError(errors);
	if (conflicts.length > 0) throw new UploadMetadataConflictError(conflicts);
	return normalized;
}

function fileMetadataDto(record: {
	readonly checksumAlgorithm: "sha256";
	readonly createdAt: Date;
	readonly id: string;
	readonly mimeType: string;
	readonly objectEtag: string;
	readonly path: string;
	readonly sha256: string;
	readonly size: bigint;
	readonly updatedAt: Date;
}): FileMetadataDto {
	return {
		checksumAlgorithm: record.checksumAlgorithm,
		createdAt: record.createdAt.toISOString(),
		id: record.id,
		mimeType: record.mimeType,
		objectEtag: record.objectEtag,
		path: record.path,
		sha256: record.sha256,
		size: record.size.toString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

async function verifyObjects(
	files: readonly NormalizedCompletionMetadata[],
	client: OssMetadataClient,
	concurrency: number,
): Promise<void> {
	let cursor = 0;
	let firstFailure:
		| { readonly error: unknown; readonly index: number }
		| undefined;
	const recordFailure = (index: number, error: unknown) => {
		const current = firstFailure;
		if (current === undefined || index < current.index) {
			firstFailure = { error, index };
		}
	};
	const workers = Array.from(
		{ length: Math.min(concurrency, files.length) },
		async () => {
			while (firstFailure === undefined) {
				const index = cursor;
				cursor += 1;
				const file = files[index];
				if (!file) return;
				try {
					const metadata = await client.headObject(file.objectKey);
					const conflicts: FieldError[] = [];
					if (metadata.size !== file.sizeValue) {
						conflicts.push({ code: "CONFLICT", path: `files.${index}.size` });
					}
					if (metadata.etag !== file.objectEtag) {
						conflicts.push({
							code: "CONFLICT",
							path: `files.${index}.objectEtag`,
						});
					}
					if (conflicts.length > 0) {
						throw new UploadMetadataConflictError(conflicts);
					}
				} catch (error) {
					if (
						error instanceof OssMetadataError &&
						(error.code === "OBJECT_NOT_FOUND" ||
							error.code === "INVALID_METADATA")
					) {
						const mappedError = new UploadMetadataConflictError([
							{ code: "CONFLICT", path: `files.${index}.objectKey` },
						]);
						recordFailure(index, mappedError);
					} else if (
						error instanceof OssMetadataError &&
						error.code === "HEAD_FAILED"
					) {
						recordFailure(index, new UploadVerificationUnavailableError());
					} else {
						recordFailure(index, error);
					}
				}
			}
		},
	);
	await Promise.all(workers);
	if (firstFailure !== undefined) throw firstFailure.error;
}

function assertHeadConcurrency(value: number): number {
	if (
		!Number.isInteger(value) ||
		value < 1 ||
		value > MAX_UPLOAD_HEAD_CONCURRENCY
	) {
		throw new RangeError("Invalid upload HEAD concurrency.");
	}
	return value;
}

export function createUploadsService(
	dependencies: UploadsServiceDependencies = {},
): UploadsService {
	let auditRepository = dependencies.auditRepository;
	let configuration = dependencies.configuration;
	let metadataClient = dependencies.metadataClient;
	let repository = dependencies.repository;
	let stsService = dependencies.stsService;
	const headConcurrency = assertHeadConcurrency(
		dependencies.headConcurrency ?? DEFAULT_UPLOAD_HEAD_CONCURRENCY,
	);
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
	const resolveMetadataClient = () => {
		metadataClient ??=
			dependencies.getMetadataClient?.() ?? getOssMetadataClient();
		return metadataClient;
	};
	const resolveRepository = () => {
		repository ??= dependencies.getRepository?.() ?? createUploadsRepository();
		return repository;
	};
	const resolveStsService = () => {
		stsService ??= dependencies.getStsService?.() ?? getUploadStsService();
		return stsService;
	};

	return {
		async complete(input, audit) {
			const files = normalizeCompletionFiles(
				input.files,
				resolveConfiguration().uploadPrefix,
			);
			await verifyObjects(files, resolveMetadataClient(), headConcurrency);
			let completed: readonly RegisteredUploadMetadata[];
			try {
				completed = await resolveRepository().complete({
					audit,
					files: files.map(
						({ mimeType, objectEtag, objectKey, path, sha256, sizeValue }) =>
							({
								mimeType,
								objectEtag,
								objectKey,
								path,
								sha256,
								size: sizeValue,
							}) satisfies RegisterUploadMetadataInput,
					),
				});
			} catch (error) {
				if (error instanceof UploadMetadataConflictRepositoryError) {
					throw new UploadMetadataConflictError([
						{ code: "CONFLICT", path: `files.${error.index}` },
					]);
				}
				throw error;
			}
			return { files: completed.map(fileMetadataDto) };
		},
		async issueCredentials(input, audit) {
			const files = normalizeBaseFiles(input.files);
			const runtime = resolveConfiguration();
			// Validate deterministic destinations before consuming STS quota.
			const objects = createObjectTargets(files, runtime.uploadPrefix);
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
				after: { fileCount: objects.length },
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
				objects,
				region: runtime.region,
			};
		},
	};
}
