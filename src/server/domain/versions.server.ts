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
} from "../../shared/api/files";
import type {
	CreateDraftVersionInput,
	SetVersionActivationInput,
	UpdateVersionInput,
	VersionDetailDto,
	VersionListItemDto,
	VersionListSearch,
	VersionPage,
} from "../../shared/api/versions";
import {
	VERSION_MAX_PAGE,
	VERSION_PAGE_SIZES,
	VERSION_SORTS,
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
	DraftFileCountConflictRepositoryError,
	DraftIncompleteRepositoryError,
	DraftPathConflictRepositoryError,
	type VersionDetailRecord,
	VersionDraftRequiredRepositoryError,
	VersionFinalizedRequiredRepositoryError,
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
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const FILE_PATH_MAX_LENGTH = 1024;

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

export class VersionDraftRequiredError extends Error {
	constructor() {
		super("The version is already finalized.");
		this.name = "VersionDraftRequiredError";
	}
}

export class VersionFinalizedRequiredError extends Error {
	constructor() {
		super("Draft versions cannot be activated.");
		this.name = "VersionFinalizedRequiredError";
	}
}

export class DraftIncompleteError extends Error {
	readonly actual: number;
	readonly expected: number;

	constructor(expected: number, actual: number) {
		super("The draft is incomplete.");
		this.name = "DraftIncompleteError";
		this.expected = expected;
		this.actual = actual;
	}
}

export class DraftFileCountConflictError extends Error {
	readonly actual: number;
	readonly expected: number;

	constructor(expected: number, actual: number) {
		super("The draft file count conflicts with its expected count.");
		this.name = "DraftFileCountConflictError";
		this.expected = expected;
		this.actual = actual;
	}
}

export class DraftPathConflictError extends Error {
	constructor() {
		super("The draft contains duplicate canonical paths.");
		this.name = "DraftPathConflictError";
	}
}

export interface VersionsService {
	createDraft(
		programId: string,
		input: CreateDraftVersionInput,
		audit: ProgramMutationContext,
	): Promise<EntityResult<VersionDetailDto>>;
	delete(
		programId: string,
		id: string,
		ifMatch: string | null,
		audit: ProgramMutationContext,
	): Promise<void>;
	finalize(
		programId: string,
		id: string,
		ifMatch: string | null,
		audit: ProgramMutationContext,
	): Promise<EntityResult<VersionDetailDto>>;
	getById(
		programId: string,
		id: string,
	): Promise<EntityResult<VersionDetailDto>>;
	list(programId: string, search: VersionListSearch): Promise<VersionPage>;
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

function normalizeExpectedFileCount(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 1 ||
		value > POSTGRES_INTEGER_MAX
	) {
		throw new VersionsValidationError([
			{ code: "INVALID_VALUE", path: "expectedFileCount" },
		]);
	}
	return value;
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

function normalizeVersionSearch(search: VersionListSearch): VersionListSearch {
	if (
		!Number.isInteger(search.page) ||
		search.page < 1 ||
		search.page > VERSION_MAX_PAGE
	) {
		throw new VersionsValidationError([
			{ code: "INVALID_VALUE", path: "page" },
		]);
	}
	if (!VERSION_PAGE_SIZES.includes(search.pageSize)) {
		throw new VersionsValidationError([
			{ code: "INVALID_VALUE", path: "pageSize" },
		]);
	}
	if (!VERSION_SORTS.includes(search.sort)) {
		throw new VersionsValidationError([
			{ code: "INVALID_VALUE", path: "sort" },
		]);
	}
	return search;
}

function normalizeFileSearch(search: FileListSearch): FileListSearch {
	const errors: FieldError[] = [];
	if (
		!Number.isInteger(search.page) ||
		search.page < 1 ||
		search.page > FILE_MAX_PAGE
	) {
		errors.push({ code: "INVALID_VALUE", path: "page" });
	}
	if (!FILE_PAGE_SIZES.includes(search.pageSize)) {
		errors.push({ code: "INVALID_VALUE", path: "pageSize" });
	}
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

function versionBase(record: VersionRecord): VersionDetailDto {
	return {
		associatedFileCount: record.associatedFileCount,
		createdAt: record.createdAt.toISOString(),
		description: record.description,
		expectedFileCount: record.expectedFileCount,
		fileCount: record.fileCount,
		finalizedAt: record.finalizedAt?.toISOString() ?? null,
		id: record.id,
		isActive: record.isActive,
		isLatest: record.isLatest,
		lifecycleStatus: record.lifecycleStatus,
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
		data: versionBase(record),
		etag: formatWeakEntityTag(record.rowVersion),
	};
}

function fileDto(record: FileMetadataRecord): FileMetadataDto {
	return {
		checksumAlgorithm: "sha256",
		createdAt: record.createdAt.toISOString(),
		id: record.id,
		mimeType: record.mimeType,
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
	if (error instanceof VersionDraftRequiredRepositoryError) {
		throw new VersionDraftRequiredError();
	}
	if (error instanceof VersionFinalizedRequiredRepositoryError) {
		throw new VersionFinalizedRequiredError();
	}
	if (error instanceof DraftIncompleteRepositoryError) {
		throw new DraftIncompleteError(error.expected, error.actual);
	}
	if (error instanceof DraftFileCountConflictRepositoryError) {
		throw new DraftFileCountConflictError(error.expected, error.actual);
	}
	if (error instanceof DraftPathConflictRepositoryError) {
		throw new DraftPathConflictError();
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
	const resolveRepository = () => {
		repository ??= dependencies.getRepository?.() ?? createVersionsRepository();
		return repository;
	};
	const now = dependencies.now ?? (() => new Date());

	return {
		async createDraft(programId, input, audit) {
			const version = normalizeVersionNumber(input.versionNumber);
			const description = normalizeDescription(input.description);
			const expectedFileCount = normalizeExpectedFileCount(
				input.expectedFileCount,
			);
			const created = await mapRepositoryErrors(() =>
				resolveRepository().createDraft({
					audit,
					description,
					expectedFileCount,
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
		async finalize(programId, id, ifMatch, audit) {
			const expectedRowVersion = parseExpectedRowVersion(ifMatch);
			const finalized = await mapRepositoryErrors(() =>
				resolveRepository().finalize({
					audit,
					expectedRowVersion,
					id,
					now: now(),
					programId,
				}),
			);
			return versionEntity(finalized);
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
			const updated = await mapRepositoryErrors(() =>
				resolveRepository().update({
					audit,
					...(description === undefined ? {} : { description }),
					expectedRowVersion,
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
