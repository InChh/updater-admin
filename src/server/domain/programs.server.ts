import type {
	EntityResult,
	FieldError,
	WeakEntityTag,
} from "../../shared/api/common";
import {
	formatWeakEntityTag,
	isWellFormedUnicode,
	parseWeakEntityTag,
} from "../../shared/api/common";
import {
	type CreateProgramInput,
	PROGRAM_MAX_PAGE,
	PROGRAM_PAGE_SIZES,
	PROGRAM_SORTS,
	type ProgramDetailDto,
	type ProgramListItemDto,
	type ProgramListSearch,
	type ProgramPage,
	type UpdateProgramInput,
} from "../../shared/api/programs";
import {
	createProgramsRepository,
	type DeleteProgramRepositoryResult,
	type ProgramDetailRecord,
	type ProgramMutationContext,
	ProgramNameConflictRepositoryError,
	ProgramNotFoundRepositoryError,
	type ProgramRecord,
	ProgramStaleWriteRepositoryError,
	type ProgramsRepository,
} from "../db/repositories/programs.server";

export class ProgramsValidationError extends Error {
	readonly fieldErrors: readonly FieldError[];

	constructor(fieldErrors: readonly FieldError[]) {
		super("Program input is invalid.");
		this.name = "ProgramsValidationError";
		this.fieldErrors = fieldErrors;
	}
}

export class ProgramNotFoundError extends Error {
	constructor() {
		super("Program was not found.");
		this.name = "ProgramNotFoundError";
	}
}

export class ProgramNameConflictError extends Error {
	readonly fieldErrors = [{ code: "NOT_UNIQUE", path: "name" }] as const;

	constructor() {
		super("A live program already uses this name.");
		this.name = "ProgramNameConflictError";
	}
}

export class ProgramPreconditionRequiredError extends Error {
	constructor() {
		super("A current program ETag is required.");
		this.name = "ProgramPreconditionRequiredError";
	}
}

export class ProgramStaleWriteError extends Error {
	constructor() {
		super("The program changed since it was loaded.");
		this.name = "ProgramStaleWriteError";
	}
}

export interface ProgramsService {
	create(
		input: CreateProgramInput,
		audit: ProgramMutationContext,
	): Promise<EntityResult<ProgramDetailDto>>;
	delete(
		id: string,
		ifMatch: string | null,
		audit: ProgramMutationContext,
	): Promise<DeleteProgramRepositoryResult>;
	getById(id: string): Promise<EntityResult<ProgramDetailDto>>;
	list(search: ProgramListSearch): Promise<ProgramPage>;
	update(
		id: string,
		ifMatch: string | null,
		input: UpdateProgramInput,
		audit: ProgramMutationContext,
	): Promise<EntityResult<ProgramDetailDto>>;
}

export interface ProgramsServiceDependencies {
	readonly getRepository?: () => ProgramsRepository;
	readonly now?: () => Date;
	readonly repository?: ProgramsRepository;
}

function characterLength(value: string): number {
	return [...value].length;
}

function isDatabaseSafeUnicode(value: string): boolean {
	return !value.includes("\0") && isWellFormedUnicode(value);
}

function normalizeName(value: unknown): string {
	if (typeof value !== "string") {
		throw new ProgramsValidationError([
			{ code: "INVALID_VALUE", path: "name" },
		]);
	}
	if (!isDatabaseSafeUnicode(value)) {
		throw new ProgramsValidationError([
			{ code: "INVALID_VALUE", path: "name" },
		]);
	}
	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new ProgramsValidationError([{ code: "REQUIRED", path: "name" }]);
	}
	if (characterLength(normalized) > 128) {
		throw new ProgramsValidationError([{ code: "TOO_LONG", path: "name" }]);
	}
	return normalized;
}

function normalizeDescription(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") {
		throw new ProgramsValidationError([
			{ code: "INVALID_VALUE", path: "description" },
		]);
	}
	if (!isDatabaseSafeUnicode(value)) {
		throw new ProgramsValidationError([
			{ code: "INVALID_VALUE", path: "description" },
		]);
	}
	const normalized = value.trim();
	if (normalized.length === 0) return null;
	if (characterLength(normalized) > 512) {
		throw new ProgramsValidationError([
			{ code: "TOO_LONG", path: "description" },
		]);
	}
	return normalized;
}

function normalizeListSearch(search: ProgramListSearch): ProgramListSearch {
	const errors: FieldError[] = [];
	if (
		!Number.isSafeInteger(search.page) ||
		search.page < 1 ||
		search.page > PROGRAM_MAX_PAGE
	) {
		errors.push({ code: "INVALID_VALUE", path: "page" });
	}
	if (!PROGRAM_PAGE_SIZES.includes(search.pageSize)) {
		errors.push({ code: "INVALID_VALUE", path: "pageSize" });
	}
	if (!PROGRAM_SORTS.includes(search.sort)) {
		errors.push({ code: "INVALID_VALUE", path: "sort" });
	}

	let name: string | undefined;
	if (search.name !== undefined) {
		if (typeof search.name !== "string") {
			errors.push({ code: "INVALID_VALUE", path: "name" });
		} else if (!isDatabaseSafeUnicode(search.name)) {
			errors.push({ code: "INVALID_VALUE", path: "name" });
		} else {
			const normalized = search.name.trim();
			if (characterLength(normalized) > 128) {
				errors.push({ code: "TOO_LONG", path: "name" });
			} else if (normalized.length > 0) {
				name = normalized;
			}
		}
	}

	if (errors.length > 0) throw new ProgramsValidationError(errors);
	return {
		...(name === undefined ? {} : { name }),
		page: search.page,
		pageSize: search.pageSize,
		sort: search.sort,
	};
}

function parseExpectedRowVersion(ifMatch: string | null): bigint {
	if (ifMatch === null) throw new ProgramPreconditionRequiredError();
	const rowVersion = parseWeakEntityTag(ifMatch);
	if (rowVersion === null) throw new ProgramStaleWriteError();
	return rowVersion;
}

function programBase(record: ProgramRecord) {
	return {
		createdAt: record.createdAt.toISOString(),
		description: record.description,
		id: record.id,
		name: record.name,
		updatedAt: record.updatedAt.toISOString(),
	};
}

function listItem(record: ProgramRecord): ProgramListItemDto {
	return {
		...programBase(record),
		etag: formatWeakEntityTag(record.rowVersion),
	};
}

function detail(record: ProgramDetailRecord): ProgramDetailDto {
	return {
		...programBase(record),
		versionCount: record.versionCount,
	};
}

function entityResult(
	record: ProgramDetailRecord,
): EntityResult<ProgramDetailDto> {
	return {
		data: detail(record),
		etag: formatWeakEntityTag(record.rowVersion),
	};
}

function mapRepositoryError(error: unknown): never {
	if (error instanceof ProgramNameConflictRepositoryError) {
		throw new ProgramNameConflictError();
	}
	if (error instanceof ProgramNotFoundRepositoryError) {
		throw new ProgramNotFoundError();
	}
	if (error instanceof ProgramStaleWriteRepositoryError) {
		throw new ProgramStaleWriteError();
	}
	throw error;
}

async function withRepositoryErrorMapping<T>(
	operation: () => Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		return mapRepositoryError(error);
	}
}

function normalizeUpdate(input: UpdateProgramInput): {
	readonly description?: string | null;
	readonly name?: string;
} {
	if (input.name === undefined && input.description === undefined) {
		throw new ProgramsValidationError([
			{ code: "AT_LEAST_ONE_REQUIRED", path: "$" },
		]);
	}
	return {
		...(input.description === undefined
			? {}
			: { description: normalizeDescription(input.description) }),
		...(input.name === undefined ? {} : { name: normalizeName(input.name) }),
	};
}

export function createProgramsService(
	dependencies: ProgramsServiceDependencies = {},
): ProgramsService {
	let repository = dependencies.repository;
	const resolveRepository = () => {
		repository ??= dependencies.getRepository?.() ?? createProgramsRepository();
		return repository;
	};
	const now = dependencies.now ?? (() => new Date());

	return {
		async create(input, audit) {
			const name = normalizeName(input.name);
			const description = normalizeDescription(input.description);
			const created = await withRepositoryErrorMapping(() =>
				resolveRepository().create({ audit, description, name }),
			);
			return entityResult(created);
		},
		async delete(id, ifMatch, audit) {
			const expectedRowVersion = parseExpectedRowVersion(ifMatch);
			return withRepositoryErrorMapping(() =>
				resolveRepository().delete({
					audit,
					expectedRowVersion,
					id,
					now: now(),
				}),
			);
		},
		async getById(id) {
			const found = await resolveRepository().findById(id);
			if (!found) throw new ProgramNotFoundError();
			return entityResult(found);
		},
		async list(search) {
			const normalized = normalizeListSearch(search);
			const result = await resolveRepository().list(normalized);
			return {
				items: result.items.map(listItem),
				page: normalized.page,
				pageSize: normalized.pageSize,
				total: result.total,
			};
		},
		async update(id, ifMatch, input, audit) {
			const expectedRowVersion = parseExpectedRowVersion(ifMatch);
			const normalized = normalizeUpdate(input);
			const updated = await withRepositoryErrorMapping(() =>
				resolveRepository().update({
					audit,
					expectedRowVersion,
					id,
					now: now(),
					...normalized,
				}),
			);
			return entityResult(updated);
		},
	};
}

export function formatProgramEtag(rowVersion: bigint): WeakEntityTag {
	return formatWeakEntityTag(rowVersion);
}
