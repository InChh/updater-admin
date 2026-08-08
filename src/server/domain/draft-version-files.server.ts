import type { FieldError } from "../../shared/api/common";
import { isWellFormedUnicode } from "../../shared/api/common";
import type {
	CompleteUploadsRequest,
	CompleteUploadsResponse,
	ResolveDraftFilesRequest,
	ResolveDraftFilesResponse,
	UploadFileMetadataInput,
} from "../../shared/api/uploads";
import {
	DECIMAL_BYTE_SIZE_PATTERN,
	MAX_COMPLETE_UPLOAD_FILES,
	MAX_RESOLVE_DRAFT_FILES,
	MAX_UPLOAD_MIME_TYPE_CODE_POINTS,
	MAX_UPLOAD_OBJECT_KEY_BYTES,
	MAX_UPLOAD_SIZE_BYTES,
	SHA256_PATTERN,
	UPLOAD_MIME_TYPE_PATTERN,
} from "../../shared/api/uploads";
import type {
	VersionFileCursorPage,
	VersionFileCursorSearch,
} from "../../shared/api/versions";
import {
	VERSION_FILE_PAGE_DEFAULT_SIZE,
	VERSION_FILE_PAGE_MAX_SIZE,
} from "../../shared/api/versions";
import {
	createUploadObjectKey,
	UploadObjectKeyValidationError,
} from "../../shared/uploads/object-key";
import {
	normalizeUploadPath,
	UploadPathValidationError,
} from "../../shared/uploads/path";
import {
	createDraftVersionFilesRepository,
	type DraftFileRecord,
	type DraftVersionFilesRepository,
	DraftVersionFinalizedRepositoryError,
	DraftVersionNotFoundRepositoryError,
	DraftVersionPathConflictRepositoryError,
} from "../db/repositories/draft-version-files.server";
import {
	type ProgramMutationContext,
	ProgramNotFoundRepositoryError,
} from "../db/repositories/programs.server";
import {
	type RegisterUploadMetadataInput,
	UploadMetadataConflictRepositoryError,
} from "../db/repositories/uploads.server";
import { readOssEnvironment } from "../env.server";
import {
	getOssMetadataClient,
	type OssMetadataClient,
	OssMetadataError,
} from "../integrations/oss/client.server";
import { ProgramNotFoundError } from "./programs.server";
import {
	UploadMetadataConflictError,
	UploadObjectNotFoundError,
	UploadVerificationUnavailableError,
} from "./uploads.server";

export const DEFAULT_DRAFT_COMPLETION_HEAD_CONCURRENCY = 16;
const MAX_DRAFT_COMPLETION_HEAD_CONCURRENCY = 16;
const MAX_VALIDATION_ERRORS = 100;

interface NormalizedDraftFile extends UploadFileMetadataInput {
	readonly sizeValue: bigint;
}

interface NormalizedCompletedDraftFile extends NormalizedDraftFile {
	readonly objectKey: string;
	readonly verifyObject: boolean;
}

export class DraftVersionFilesValidationError extends Error {
	readonly fieldErrors: readonly FieldError[];

	constructor(fieldErrors: readonly FieldError[]) {
		super("Draft version file input is invalid.");
		this.name = "DraftVersionFilesValidationError";
		this.fieldErrors = fieldErrors;
	}
}

export class DraftVersionFilesNotFoundError extends Error {
	constructor() {
		super("Draft version was not found.");
		this.name = "DraftVersionFilesNotFoundError";
	}
}

export class DraftVersionFinalizedError extends Error {
	constructor() {
		super("Finalized version membership is immutable.");
		this.name = "DraftVersionFinalizedError";
	}
}

export class DraftVersionPathConflictError extends Error {
	readonly fieldErrors: readonly FieldError[];

	constructor(index: number) {
		super("The draft already contains different content at this path.");
		this.name = "DraftVersionPathConflictError";
		this.fieldErrors = [{ code: "CONFLICT", path: `files.${index}.path` }];
	}
}

export interface DraftVersionFilesService {
	complete(
		programId: string,
		versionId: string,
		input: CompleteUploadsRequest,
		audit: ProgramMutationContext,
	): Promise<CompleteUploadsResponse>;
	listFiles(
		programId: string,
		versionId: string,
		search: VersionFileCursorSearch,
	): Promise<VersionFileCursorPage>;
	resolve(
		programId: string,
		versionId: string,
		input: ResolveDraftFilesRequest,
		audit: ProgramMutationContext,
	): Promise<ResolveDraftFilesResponse>;
}

export interface DraftVersionFilesServiceDependencies {
	readonly completionHeadConcurrency?: number;
	readonly getMetadataClient?: () => OssMetadataClient;
	readonly getRepository?: () => DraftVersionFilesRepository;
	readonly getUploadPrefix?: () => string;
	readonly metadataClient?: OssMetadataClient;
	readonly repository?: DraftVersionFilesRepository;
	readonly uploadPrefix?: string;
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

function normalizeBaseFiles(
	files: unknown,
	maxFiles: number,
): readonly NormalizedDraftFile[] {
	if (!Array.isArray(files) || files.length < 1 || files.length > maxFiles) {
		throw new DraftVersionFilesValidationError([
			{
				code:
					Array.isArray(files) && files.length > maxFiles
						? "TOO_MANY"
						: "REQUIRED",
				path: "files",
			},
		]);
	}
	const errors: FieldError[] = [];
	const normalized: NormalizedDraftFile[] = [];
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
		if (
			path !== undefined &&
			sha256 !== undefined &&
			size !== undefined &&
			mimeType !== undefined
		) {
			normalized.push({
				mimeType,
				path,
				sha256,
				size: size.text,
				sizeValue: size.value,
			});
		}
	}
	if (errors.length > 0) throw new DraftVersionFilesValidationError(errors);
	return normalized;
}

function normalizeObjectKey(
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

function normalizeCompletionFiles(
	files: unknown,
	uploadPrefix: string,
): readonly NormalizedCompletedDraftFile[] {
	const base = normalizeBaseFiles(files, MAX_COMPLETE_UPLOAD_FILES);
	const source = files as readonly Record<string, unknown>[];
	const errors: FieldError[] = [];
	const completed: NormalizedCompletedDraftFile[] = [];
	for (const [index, file] of base.entries()) {
		const submitted = source[index] ?? {};
		const objectKey = normalizeObjectKey(
			submitted.objectKey,
			`files.${index}.objectKey`,
			errors,
		);
		let expected: string | undefined;
		try {
			expected = createUploadObjectKey({
				path: file.path,
				prefix: uploadPrefix,
				sha256: file.sha256,
			});
		} catch (error) {
			if (error instanceof UploadObjectKeyValidationError) {
				addError(errors, `files.${index}.path`, "TOO_LONG");
				continue;
			}
			throw error;
		}
		if (objectKey !== undefined && objectKey !== expected) {
			addError(errors, `files.${index}.objectKey`, "CONFLICT");
		}
		if (
			submitted.verifyObject !== undefined &&
			submitted.verifyObject !== true
		) {
			addError(errors, `files.${index}.verifyObject`);
		}
		if (objectKey !== undefined && objectKey === expected) {
			completed.push({
				...file,
				objectKey,
				verifyObject: submitted.verifyObject === true,
			});
		}
	}
	if (errors.length > 0) throw new DraftVersionFilesValidationError(errors);
	return completed;
}

function assertCompletionHeadConcurrency(value: number): number {
	if (
		!Number.isInteger(value) ||
		value < 1 ||
		value > MAX_DRAFT_COMPLETION_HEAD_CONCURRENCY
	) {
		throw new RangeError("Invalid draft completion HEAD concurrency.");
	}
	return value;
}

async function verifyCompletedObjects(
	files: readonly NormalizedCompletedDraftFile[],
	client: OssMetadataClient,
	concurrency: number,
): Promise<void> {
	const pending = files
		.map((file, index) => ({ file, index }))
		.filter(({ file }) => file.verifyObject);
	if (pending.length === 0) return;
	let cursor = 0;
	let firstFailure:
		| { readonly error: unknown; readonly index: number }
		| undefined;
	const recordFailure = (index: number, error: unknown) => {
		if (firstFailure === undefined || index < firstFailure.index) {
			firstFailure = { error, index };
		}
	};
	const workers = Array.from(
		{ length: Math.min(concurrency, pending.length) },
		async () => {
			while (firstFailure === undefined) {
				const index = cursor;
				cursor += 1;
				const pendingFile = pending[index];
				if (!pendingFile) return;
				const { file, index: originalIndex } = pendingFile;
				try {
					const metadata = await client.headObject(file.objectKey);
					const conflicts: FieldError[] = [];
					if (metadata.size !== file.sizeValue) {
						conflicts.push({
							code: "CONFLICT",
							path: `files.${originalIndex}.size`,
						});
					}
					if (conflicts.length > 0) {
						throw new UploadMetadataConflictError(conflicts);
					}
				} catch (error) {
					if (
						error instanceof OssMetadataError &&
						error.code === "OBJECT_NOT_FOUND"
					) {
						recordFailure(
							originalIndex,
							new UploadObjectNotFoundError(originalIndex),
						);
					} else if (
						error instanceof OssMetadataError &&
						error.code === "HEAD_FAILED"
					) {
						recordFailure(
							originalIndex,
							new UploadVerificationUnavailableError(),
						);
					} else if (
						error instanceof OssMetadataError &&
						error.code === "INVALID_METADATA"
					) {
						recordFailure(
							originalIndex,
							new UploadMetadataConflictError([
								{
									code: "CONFLICT",
									path: `files.${originalIndex}.objectKey`,
								},
							]),
						);
					} else {
						recordFailure(originalIndex, error);
					}
				}
			}
		},
	);
	await Promise.all(workers);
	if (firstFailure !== undefined) throw firstFailure.error;
}

function fileDto(record: DraftFileRecord) {
	return {
		checksumAlgorithm: record.checksumAlgorithm,
		createdAt: record.createdAt.toISOString(),
		id: record.id,
		mimeType: record.mimeType,
		path: record.path,
		sha256: record.sha256,
		size: record.size.toString(),
		updatedAt: record.updatedAt.toISOString(),
	};
}

function encodeCursor(path: string): string {
	return Buffer.from(path, "utf8").toString("base64url");
}

function decodeCursor(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 4096 ||
		!/^[A-Za-z0-9_-]+$/.test(value)
	) {
		throw new DraftVersionFilesValidationError([
			{ code: "INVALID_VALUE", path: "cursor" },
		]);
	}
	const decoded = Buffer.from(value, "base64url").toString("utf8");
	try {
		if (
			encodeCursor(decoded) !== value ||
			normalizeUploadPath(decoded) !== decoded
		) {
			throw new UploadPathValidationError("EMPTY");
		}
	} catch (error) {
		if (error instanceof UploadPathValidationError) {
			throw new DraftVersionFilesValidationError([
				{ code: "INVALID_VALUE", path: "cursor" },
			]);
		}
		throw error;
	}
	return decoded;
}

function normalizePageSize(value: unknown): number {
	if (value === undefined) return VERSION_FILE_PAGE_DEFAULT_SIZE;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 1 ||
		value > VERSION_FILE_PAGE_MAX_SIZE
	) {
		throw new DraftVersionFilesValidationError([
			{ code: "INVALID_VALUE", path: "pageSize" },
		]);
	}
	return value;
}

function mapRepositoryError(error: unknown): never {
	if (error instanceof ProgramNotFoundRepositoryError) {
		throw new ProgramNotFoundError();
	}
	if (error instanceof DraftVersionNotFoundRepositoryError) {
		throw new DraftVersionFilesNotFoundError();
	}
	if (error instanceof DraftVersionFinalizedRepositoryError) {
		throw new DraftVersionFinalizedError();
	}
	if (error instanceof DraftVersionPathConflictRepositoryError) {
		throw new DraftVersionPathConflictError(error.index);
	}
	if (error instanceof UploadMetadataConflictRepositoryError) {
		throw new UploadMetadataConflictError([
			{ code: "CONFLICT", path: `files.${error.index}` },
		]);
	}
	throw error;
}

async function mapRepositoryErrors<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		return mapRepositoryError(error);
	}
}

export function createDraftVersionFilesService(
	dependencies: DraftVersionFilesServiceDependencies = {},
): DraftVersionFilesService {
	let metadataClient = dependencies.metadataClient;
	let repository = dependencies.repository;
	let uploadPrefix = dependencies.uploadPrefix;
	const completionHeadConcurrency = assertCompletionHeadConcurrency(
		dependencies.completionHeadConcurrency ??
			DEFAULT_DRAFT_COMPLETION_HEAD_CONCURRENCY,
	);
	const resolveMetadataClient = () => {
		metadataClient ??=
			dependencies.getMetadataClient?.() ?? getOssMetadataClient();
		return metadataClient;
	};
	const resolveRepository = () => {
		repository ??=
			dependencies.getRepository?.() ?? createDraftVersionFilesRepository();
		return repository;
	};
	const resolveUploadPrefix = () => {
		uploadPrefix ??=
			dependencies.getUploadPrefix?.() ?? readOssEnvironment().uploadPrefix;
		return uploadPrefix;
	};

	return {
		async complete(programId, versionId, input, audit) {
			const files = normalizeCompletionFiles(
				input.files,
				resolveUploadPrefix(),
			);
			await verifyCompletedObjects(
				files,
				resolveMetadataClient(),
				completionHeadConcurrency,
			);
			const completed = await mapRepositoryErrors(() =>
				resolveRepository().complete({
					audit,
					files: files.map(
						({ mimeType, objectKey, path, sha256, sizeValue }) =>
							({
								mimeType,
								objectKey,
								path,
								sha256,
								size: sizeValue,
							}) satisfies RegisterUploadMetadataInput,
					),
					programId,
					versionId,
				}),
			);
			return { files: completed.map(fileDto) };
		},
		async listFiles(programId, versionId, search) {
			const afterPath = decodeCursor(search.cursor);
			const pageSize = normalizePageSize(search.pageSize);
			const result = await mapRepositoryErrors(() =>
				resolveRepository().listVersionFiles({
					...(afterPath === undefined ? {} : { afterPath }),
					limit: pageSize,
					programId,
					versionId,
				}),
			);
			const last = result.items.at(-1);
			return {
				items: result.items.map(fileDto),
				nextCursor: result.hasMore && last ? encodeCursor(last.path) : null,
				pageSize,
				versionId,
			};
		},
		async resolve(programId, versionId, input, audit) {
			const files = normalizeBaseFiles(input.files, MAX_RESOLVE_DRAFT_FILES);
			const associated = await mapRepositoryErrors(() =>
				resolveRepository().resolve({
					audit,
					files: files.map(({ mimeType, path, sha256, sizeValue }) => ({
						mimeType,
						path,
						sha256,
						size: sizeValue,
					})),
					programId,
					versionId,
				}),
			);
			return { files: associated };
		},
	};
}
