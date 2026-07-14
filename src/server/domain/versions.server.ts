import type { EntityResult, FieldError } from "../../shared/api/common";
import {
	formatWeakEntityTag,
	isWellFormedUnicode,
	parseWeakEntityTag,
} from "../../shared/api/common";
import {
	FILE_MAX_PAGE,
	FILE_PAGE_SIZES,
	FILE_SORTS,
	type FileDetailDto,
	type FileListSearch,
	type FileMetadataDto,
	type FilePage,
	VERSION_FILE_SORTS,
	type VersionFileListSearch,
} from "../../shared/api/files";
import {
	type CreateVersionInput,
	type SetVersionActivationInput,
	type UpdateVersionInput,
	VERSION_MAX_PAGE,
	VERSION_PAGE_SIZES,
	VERSION_SORTS,
	type VersionDetailDto,
	type VersionListItemDto,
	type VersionListSearch,
	type VersionPage,
} from "../../shared/api/versions";
import {
	createFilesRepository,
	type FileMetadataRecord,
	type FilesRepository,
} from "../db/repositories/files.server";
import {
	type ProgramMutationContext,
	ProgramNotFoundRepositoryError,
} from "../db/repositories/programs.server";
import {
	createVersionsRepository,
	type VersionDetailRecord,
	VersionFilesNotFoundRepositoryError,
	VersionNotFoundRepositoryError,
	VersionNotGreaterRepositoryError,
	VersionNumberConflictRepositoryError,
	type VersionRecord,
	VersionStaleWriteRepositoryError,
	type VersionsRepository,
} from "../db/repositories/versions.server";
import { ProgramNotFoundError } from "./programs.server";
import { parseVersionNumber } from "./version-number";

const VERSION_DESCRIPTION_MAX_LENGTH = 1024;
const FILE_PATH_MAX_LENGTH = 1024;
const VERSION_FILE_IDS_MAX_ITEMS = 10_000;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class VersionsValidationError extends Error {
	readonly fieldErrors: readonly FieldError[];

	constructor(fieldErrors: readonly FieldError[]) {
		super("Version input is invalid.");
		this.name = "VersionsValidationError";
		this.fieldErrors = fieldErrors;
	}
}

export class VersionNotFoundError extends Error {
	constructor() {
		super("Version was not found.");
		this.name = "VersionNotFoundError";
	}
}

export class FileNotFoundError extends Error {
	constructor() {
		super("File metadata was not found.");
		this.name = "FileNotFoundError";
	}
}

export class VersionNumberConflictError extends Error {
	readonly fieldErrors = [
		{ code: "NOT_UNIQUE", path: "versionNumber" },
	] as const;

	constructor() {
		super("A live version already uses this number.");
		this.name = "VersionNumberConflictError";
	}
}

export class VersionNotGreaterError extends Error {
	readonly currentMax?: string;
	readonly fieldErrors = [
		{ code: "VERSION_NOT_GREATER", path: "versionNumber" },
	] as const;

	constructor(currentMax?: string) {
		super("The version number is not greater than the historical maximum.");
		this.name = "VersionNotGreaterError";
		this.currentMax = currentMax;
	}
}

export class VersionPreconditionRequiredError extends Error {
	constructor() {
		super("A current version ETag is required.");
		this.name = "VersionPreconditionRequiredError";
	}
}

export class VersionStaleWriteError extends Error {
	constructor() {
		super("The version changed since it was loaded.");
		this.name = "VersionStaleWriteError";
	}
}

export interface VersionsService {
	create(
		programId: string,
		input: CreateVersionInput,
		audit: ProgramMutationContext,
	): Promise<EntityResult<VersionDetailDto>>;
	delete(
		programId: string,
		id: string,
		ifMatch: string | null,
		audit: ProgramMutationContext,
	): Promise<void>;
	getById(
		programId: string,
		id: string,
	): Promise<EntityResult<VersionDetailDto>>;
	list(programId: string, search: VersionListSearch): Promise<VersionPage>;
	listFiles(
		programId: string,
		id: string,
		search: VersionFileListSearch,
	): Promise<FilePage>;
	setActivation(
		programId: string,
		id: string,
		ifMatch: string | null,
		input: SetVersionActivationInput,
		audit: ProgramMutationContext,
	): Promise<EntityResult<VersionDetailDto>>;
	update(
		programId: string,
		id: string,
		ifMatch: string | null,
		input: UpdateVersionInput,
		audit: ProgramMutationContext,
	): Promise<EntityResult<VersionDetailDto>>;
}

export interface FilesService {
	getById(id: string): Promise<EntityResult<FileDetailDto>>;
	list(search: FileListSearch): Promise<FilePage>;
}

export interface VersionsServiceDependencies {
	readonly filesRepository?: FilesRepository;
	readonly getFilesRepository?: () => FilesRepository;
	readonly getRepository?: () => VersionsRepository;
	readonly now?: () => Date;
	readonly repository?: VersionsRepository;
}

export interface FilesServiceDependencies {
	readonly getRepository?: () => FilesRepository;
	readonly repository?: FilesRepository;
}

function characterLength(value: string): number {
	return [...value].length;
}

function isDatabaseSafeUnicode(value: string): boolean {
	return !value.includes("\0") && isWellFormedUnicode(value);
}

function normalizeDescription(value: unknown): string {
	if (value === undefined) return "";
	if (typeof value !== "string" || !isDatabaseSafeUnicode(value)) {
		throw new VersionsValidationError([
			{ code: "INVALID_VALUE", path: "description" },
		]);
	}
	const normalized = value.trim();
	if (characterLength(normalized) > VERSION_DESCRIPTION_MAX_LENGTH) {
		throw new VersionsValidationError([
			{ code: "TOO_LONG", path: "description" },
		]);
	}
	return normalized;
}

function normalizeVersionNumber(value: unknown) {
	const parsed = parseVersionNumber(value);
	if (!parsed) {
		throw new VersionsValidationError([
			{ code: "INVALID_FORMAT", path: "versionNumber" },
		]);
	}
	return parsed;
}

function normalizeFileIds(
	value: unknown,
	options: { readonly required: boolean },
): readonly string[] {
	if (
		!Array.isArray(value) ||
		(options.required && value.length === 0) ||
		value.length > VERSION_FILE_IDS_MAX_ITEMS
	) {
		throw new VersionsValidationError([
			{
				code: options.required ? "REQUIRED" : "INVALID_VALUE",
				path: "fileIds",
			},
		]);
	}
	const errors: FieldError[] = [];
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const [index, item] of value.entries()) {
		if (typeof item !== "string" || !UUID_PATTERN.test(item)) {
			errors.push({ code: "INVALID_VALUE", path: `fileIds.${index}` });
			continue;
		}
		if (seen.has(item)) {
			errors.push({ code: "DUPLICATE_VALUE", path: `fileIds.${index}` });
			continue;
		}
		seen.add(item);
		ids.push(item);
	}
	if (errors.length > 0) throw new VersionsValidationError(errors);
	return ids;
}

function normalizeVersionSearch(search: VersionListSearch): VersionListSearch {
	const errors: FieldError[] = [];
	if (
		!Number.isSafeInteger(search.page) ||
		search.page < 1 ||
		search.page > VERSION_MAX_PAGE
	) {
		errors.push({ code: "INVALID_VALUE", path: "page" });
	}
	if (!VERSION_PAGE_SIZES.includes(search.pageSize)) {
		errors.push({ code: "INVALID_VALUE", path: "pageSize" });
	}
	if (!VERSION_SORTS.includes(search.sort)) {
		errors.push({ code: "INVALID_VALUE", path: "sort" });
	}
	if (errors.length > 0) throw new VersionsValidationError(errors);
	return search;
}

function normalizeVersionFileSearch(
	search: VersionFileListSearch,
): VersionFileListSearch {
	const errors = validateFilePagination(search);
	if (!VERSION_FILE_SORTS.includes(search.sort)) {
		errors.push({ code: "INVALID_VALUE", path: "sort" });
	}
	if (errors.length > 0) throw new VersionsValidationError(errors);
	return search;
}

function validateFilePagination(search: {
	readonly page: number;
	readonly pageSize: number;
}): FieldError[] {
	const errors: FieldError[] = [];
	if (
		!Number.isSafeInteger(search.page) ||
		search.page < 1 ||
		search.page > FILE_MAX_PAGE
	) {
		errors.push({ code: "INVALID_VALUE", path: "page" });
	}
	if (!FILE_PAGE_SIZES.includes(search.pageSize as 20 | 50 | 100)) {
		errors.push({ code: "INVALID_VALUE", path: "pageSize" });
	}
	return errors;
}

function normalizeFileSearch(search: FileListSearch): FileListSearch {
	const errors = validateFilePagination(search);
	if (!FILE_SORTS.includes(search.sort)) {
		errors.push({ code: "INVALID_VALUE", path: "sort" });
	}
	let path: string | undefined;
	if (search.path !== undefined) {
		if (
			typeof search.path !== "string" ||
			!isDatabaseSafeUnicode(search.path)
		) {
			errors.push({ code: "INVALID_VALUE", path: "path" });
		} else {
			const normalized = search.path.trim();
			if (characterLength(normalized) > FILE_PATH_MAX_LENGTH) {
				errors.push({ code: "TOO_LONG", path: "path" });
			} else if (normalized.length > 0) {
				path = normalized;
			}
		}
	}
	if (errors.length > 0) throw new VersionsValidationError(errors);
	return {
		page: search.page,
		pageSize: search.pageSize,
		...(path === undefined ? {} : { path }),
		sort: search.sort,
	};
}

function parseExpectedRowVersion(ifMatch: string | null): bigint {
	if (ifMatch === null) throw new VersionPreconditionRequiredError();
	const rowVersion = parseWeakEntityTag(ifMatch);
	if (rowVersion === null) throw new VersionStaleWriteError();
	return rowVersion;
}

function versionBase(record: VersionRecord) {
	return {
		createdAt: record.createdAt.toISOString(),
		description: record.description,
		fileCount: record.fileCount,
		id: record.id,
		isActive: record.isActive,
		isLatest: record.isLatest,
		programId: record.programId,
		updatedAt: record.updatedAt.toISOString(),
		versionNumber: record.versionNumber,
	};
}

function versionListItem(record: VersionRecord): VersionListItemDto {
	return {
		...versionBase(record),
		etag: formatWeakEntityTag(record.rowVersion),
	};
}

function versionEntity(
	record: VersionDetailRecord,
): EntityResult<VersionDetailDto> {
	return {
		data: { ...versionBase(record), fileIds: [...record.fileIds] },
		etag: formatWeakEntityTag(record.rowVersion),
	};
}

function fileDto(record: FileMetadataRecord): FileMetadataDto {
	return {
		checksumAlgorithm: "sha256",
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

function mapRepositoryError(error: unknown): never {
	if (error instanceof ProgramNotFoundRepositoryError) {
		throw new ProgramNotFoundError();
	}
	if (error instanceof VersionNotFoundRepositoryError) {
		throw new VersionNotFoundError();
	}
	if (error instanceof VersionStaleWriteRepositoryError) {
		throw new VersionStaleWriteError();
	}
	if (error instanceof VersionNumberConflictRepositoryError) {
		throw new VersionNumberConflictError();
	}
	if (error instanceof VersionNotGreaterRepositoryError) {
		throw new VersionNotGreaterError(error.currentMax);
	}
	if (error instanceof VersionFilesNotFoundRepositoryError) {
		throw new VersionsValidationError([{ code: "NOT_FOUND", path: "fileIds" }]);
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

export function createVersionsService(
	dependencies: VersionsServiceDependencies = {},
): VersionsService {
	let repository = dependencies.repository;
	let filesRepository = dependencies.filesRepository;
	const resolveRepository = () => {
		repository ??= dependencies.getRepository?.() ?? createVersionsRepository();
		return repository;
	};
	const resolveFilesRepository = () => {
		filesRepository ??=
			dependencies.getFilesRepository?.() ?? createFilesRepository();
		return filesRepository;
	};
	const now = dependencies.now ?? (() => new Date());

	return {
		async create(programId, input, audit) {
			const version = normalizeVersionNumber(input.versionNumber);
			const description = normalizeDescription(input.description);
			const fileIds = normalizeFileIds(input.fileIds, { required: true });
			const created = await mapRepositoryErrors(() =>
				resolveRepository().create({
					audit,
					description,
					fileIds,
					isActive: false,
					programId,
					versionMajor: version.major,
					versionMinor: version.minor,
					versionNumber: version.normalized,
					versionPatch: version.patch,
				}),
			);
			return versionEntity(created);
		},
		async delete(programId, id, ifMatch, audit) {
			const expectedRowVersion = parseExpectedRowVersion(ifMatch);
			await mapRepositoryErrors(() =>
				resolveRepository().delete({
					audit,
					expectedRowVersion,
					id,
					now: now(),
					programId,
				}),
			);
		},
		async getById(programId, id) {
			const record = await mapRepositoryErrors(() =>
				resolveRepository().findById(programId, id),
			);
			if (!record) throw new VersionNotFoundError();
			return versionEntity(record);
		},
		async list(programId, search) {
			const normalized = normalizeVersionSearch(search);
			const result = await mapRepositoryErrors(() =>
				resolveRepository().list({ programId, ...normalized }),
			);
			return {
				items: result.items.map(versionListItem),
				page: normalized.page,
				pageSize: normalized.pageSize,
				total: result.total,
			};
		},
		async listFiles(programId, id, search) {
			const normalized = normalizeVersionFileSearch(search);
			const result = await mapRepositoryErrors(() =>
				resolveFilesRepository().listForVersion({
					...normalized,
					programId,
					versionId: id,
				}),
			);
			return {
				items: result.items.map(fileDto),
				page: normalized.page,
				pageSize: normalized.pageSize,
				total: result.total,
			};
		},
		async setActivation(programId, id, ifMatch, input, audit) {
			if (typeof input.isActive !== "boolean") {
				throw new VersionsValidationError([
					{ code: "INVALID_VALUE", path: "isActive" },
				]);
			}
			const expectedRowVersion = parseExpectedRowVersion(ifMatch);
			const updated = await mapRepositoryErrors(() =>
				resolveRepository().setActivation({
					audit,
					expectedRowVersion,
					id,
					isActive: input.isActive,
					now: now(),
					programId,
				}),
			);
			return versionEntity(updated);
		},
		async update(programId, id, ifMatch, input, audit) {
			if (
				input.description === undefined &&
				input.fileIds === undefined &&
				input.versionNumber === undefined
			) {
				throw new VersionsValidationError([
					{ code: "AT_LEAST_ONE_REQUIRED", path: "$" },
				]);
			}
			const version =
				input.versionNumber === undefined
					? undefined
					: normalizeVersionNumber(input.versionNumber);
			const expectedRowVersion = parseExpectedRowVersion(ifMatch);
			const description =
				input.description === undefined
					? undefined
					: normalizeDescription(input.description);
			const fileIds =
				input.fileIds === undefined
					? undefined
					: normalizeFileIds(input.fileIds, { required: false });
			const updated = await mapRepositoryErrors(() =>
				resolveRepository().update({
					audit,
					...(description === undefined ? {} : { description }),
					expectedRowVersion,
					...(fileIds === undefined ? {} : { fileIds }),
					id,
					now: now(),
					programId,
					...(version === undefined
						? {}
						: {
								versionMajor: version.major,
								versionMinor: version.minor,
								versionNumber: version.normalized,
								versionPatch: version.patch,
							}),
				}),
			);
			return versionEntity(updated);
		},
	};
}

export function createFilesService(
	dependencies: FilesServiceDependencies = {},
): FilesService {
	let repository = dependencies.repository;
	const resolveRepository = () => {
		repository ??= dependencies.getRepository?.() ?? createFilesRepository();
		return repository;
	};
	return {
		async getById(id) {
			const record = await resolveRepository().findById(id);
			if (!record) throw new FileNotFoundError();
			return {
				data: fileDto(record),
				etag: formatWeakEntityTag(record.rowVersion),
			};
		},
		async list(search) {
			const normalized = normalizeFileSearch(search);
			const result = await resolveRepository().list(normalized);
			return {
				items: result.items.map(fileDto),
				page: normalized.page,
				pageSize: normalized.pageSize,
				total: result.total,
			};
		},
	};
}
