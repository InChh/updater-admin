import type {
	AdministratorDto,
	AdministratorListSearch,
	AdministratorPage,
	CreateAdministratorInput,
	ResetAdministratorPasswordInput,
	SessionsRevokedResult,
	UpdateAdministratorInput,
} from "../../shared/api/administrators";
import {
	ADMINISTRATOR_MAX_PAGE,
	ADMINISTRATOR_PAGE_SIZES,
	ADMINISTRATOR_SORTS,
	ADMINISTRATOR_STATUSES,
} from "../../shared/api/administrators";
import {
	type FieldError,
	formatWeakEntityTag,
	isWellFormedUnicode,
	parseWeakEntityTag,
	SUPPORTED_LOCALES,
} from "../../shared/api/common";
import {
	AdministratorCredentialError,
	type CreateTemporaryPasswordAdministratorInput,
	createTemporaryPasswordAdministrator,
	type ResetAdministratorPasswordInput as ResetCredentialInput,
	resetAdministratorTemporaryPassword,
} from "../auth/administrator-credentials.server";
import {
	type AdministratorMutationContext,
	AdministratorNotFoundRepositoryError,
	type AdministratorRecord,
	AdministratorSelfDisableRepositoryError,
	AdministratorStaleWriteRepositoryError,
	type AdministratorsRepository,
	createAdministratorsRepository,
	LastActiveAdministratorRepositoryError,
} from "../db/repositories/administrators.server";

export class AdministratorsValidationError extends Error {
	readonly fieldErrors: readonly FieldError[];

	constructor(fieldErrors: readonly FieldError[]) {
		super("Administrator input is invalid.");
		this.name = "AdministratorsValidationError";
		this.fieldErrors = fieldErrors;
	}
}

export class AdministratorNotFoundError extends Error {
	constructor() {
		super("Administrator was not found.");
		this.name = "AdministratorNotFoundError";
	}
}

export class AdministratorEmailConflictError extends Error {
	readonly fieldErrors = [{ code: "NOT_UNIQUE", path: "email" }] as const;

	constructor() {
		super("An administrator already uses this email address.");
		this.name = "AdministratorEmailConflictError";
	}
}

export class AdministratorSelfDisableError extends Error {
	constructor() {
		super("An administrator cannot disable the current account.");
		this.name = "AdministratorSelfDisableError";
	}
}

export class LastActiveAdministratorError extends Error {
	constructor() {
		super("At least one active administrator is required.");
		this.name = "LastActiveAdministratorError";
	}
}

export class AdministratorPreconditionRequiredError extends Error {
	constructor() {
		super("Administrator mutation requires If-Match.");
		this.name = "AdministratorPreconditionRequiredError";
	}
}

export class AdministratorStaleWriteError extends Error {
	constructor() {
		super("Administrator row version is stale.");
		this.name = "AdministratorStaleWriteError";
	}
}

export interface AdministratorsService {
	create(
		input: CreateAdministratorInput,
		headers: Headers,
		audit: AdministratorMutationContext,
	): Promise<AdministratorDto>;
	list(search: AdministratorListSearch): Promise<AdministratorPage>;
	resetPassword(
		id: string,
		input: ResetAdministratorPasswordInput,
		headers: Headers,
		audit: AdministratorMutationContext,
	): Promise<AdministratorDto>;
	revokeSessions(
		id: string,
		headers: Headers,
		audit: AdministratorMutationContext,
	): Promise<SessionsRevokedResult>;
	update(
		id: string,
		ifMatch: string | null,
		input: UpdateAdministratorInput,
		headers: Headers,
		audit: AdministratorMutationContext,
	): Promise<AdministratorDto>;
}

export interface AdministratorsServiceDependencies {
	readonly createCredential?: (
		input: CreateTemporaryPasswordAdministratorInput,
	) => Promise<{ userId: string }>;
	readonly getRepository?: () => AdministratorsRepository;
	readonly repository?: AdministratorsRepository;
	readonly resetCredential?: (
		input: ResetCredentialInput,
	) => Promise<{ userId: string }>;
}

function characterLength(value: string): number {
	return [...value].length;
}

function isDatabaseSafeUnicode(value: string): boolean {
	return !value.includes("\0") && isWellFormedUnicode(value);
}

function normalizeName(value: unknown): string {
	if (typeof value !== "string" || !isDatabaseSafeUnicode(value)) {
		throw new AdministratorsValidationError([
			{ code: "INVALID_VALUE", path: "name" },
		]);
	}
	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new AdministratorsValidationError([
			{ code: "REQUIRED", path: "name" },
		]);
	}
	if (characterLength(normalized) > 128) {
		throw new AdministratorsValidationError([
			{ code: "TOO_LONG", path: "name" },
		]);
	}
	return normalized;
}

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function normalizeEmail(value: unknown): string {
	if (typeof value !== "string" || !isDatabaseSafeUnicode(value)) {
		throw new AdministratorsValidationError([
			{ code: "INVALID_VALUE", path: "email" },
		]);
	}
	const normalized = value.trim().toLowerCase();
	if (
		normalized.length === 0 ||
		normalized.length > 320 ||
		!SIMPLE_EMAIL_PATTERN.test(normalized)
	) {
		throw new AdministratorsValidationError([
			{ code: "INVALID_VALUE", path: "email" },
		]);
	}
	return normalized;
}

function normalizeListSearch(
	search: AdministratorListSearch,
): AdministratorListSearch {
	const fieldErrors: FieldError[] = [];
	if (
		!Number.isSafeInteger(search.page) ||
		search.page < 1 ||
		search.page > ADMINISTRATOR_MAX_PAGE
	) {
		fieldErrors.push({ code: "INVALID_VALUE", path: "page" });
	}
	if (!ADMINISTRATOR_PAGE_SIZES.includes(search.pageSize)) {
		fieldErrors.push({ code: "INVALID_VALUE", path: "pageSize" });
	}
	if (!ADMINISTRATOR_SORTS.includes(search.sort)) {
		fieldErrors.push({ code: "INVALID_VALUE", path: "sort" });
	}
	if (
		search.status !== undefined &&
		!ADMINISTRATOR_STATUSES.includes(search.status)
	) {
		fieldErrors.push({ code: "INVALID_VALUE", path: "status" });
	}

	let query: string | undefined;
	if (search.query !== undefined) {
		if (
			typeof search.query !== "string" ||
			!isDatabaseSafeUnicode(search.query)
		) {
			fieldErrors.push({ code: "INVALID_VALUE", path: "query" });
		} else {
			const normalized = search.query.trim();
			if (characterLength(normalized) > 320) {
				fieldErrors.push({ code: "TOO_LONG", path: "query" });
			} else if (normalized.length > 0) {
				query = normalized;
			}
		}
	}

	if (fieldErrors.length > 0) {
		throw new AdministratorsValidationError(fieldErrors);
	}
	return {
		page: search.page,
		pageSize: search.pageSize,
		...(query === undefined ? {} : { query }),
		sort: search.sort,
		...(search.status === undefined ? {} : { status: search.status }),
	};
}

function dto(record: AdministratorRecord): AdministratorDto {
	return {
		createdAt: record.createdAt.toISOString(),
		email: record.email,
		enabled: !(record.banned ?? false),
		etag: formatWeakEntityTag(record.rowVersion),
		id: record.id,
		lastLoginAt: record.lastLoginAt?.toISOString() ?? null,
		locale: record.locale,
		mustChangePassword: record.mustChangePassword,
		name: record.name,
		updatedAt: record.updatedAt.toISOString(),
	};
}

function mapRepositoryError(error: unknown): never {
	if (error instanceof AdministratorNotFoundRepositoryError) {
		throw new AdministratorNotFoundError();
	}
	if (error instanceof AdministratorSelfDisableRepositoryError) {
		throw new AdministratorSelfDisableError();
	}
	if (error instanceof LastActiveAdministratorRepositoryError) {
		throw new LastActiveAdministratorError();
	}
	if (error instanceof AdministratorStaleWriteRepositoryError) {
		throw new AdministratorStaleWriteError();
	}
	throw error;
}

function parseExpectedRowVersion(ifMatch: string | null): bigint {
	if (ifMatch === null) throw new AdministratorPreconditionRequiredError();
	const rowVersion = parseWeakEntityTag(ifMatch);
	if (rowVersion === null) throw new AdministratorStaleWriteError();
	return rowVersion;
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

function mapCredentialError(error: unknown): never {
	if (
		error instanceof AdministratorCredentialError &&
		error.code === "INVALID_TEMPORARY_PASSWORD"
	) {
		throw new AdministratorsValidationError([
			{ code: "PASSWORD_POLICY", path: "temporaryPassword" },
		]);
	}
	if (
		error instanceof AdministratorCredentialError &&
		error.code === "ADMINISTRATOR_EMAIL_CONFLICT"
	) {
		throw new AdministratorEmailConflictError();
	}
	throw error;
}

export function createAdministratorsService(
	dependencies: AdministratorsServiceDependencies = {},
): AdministratorsService {
	let repository = dependencies.repository;
	const resolveRepository = () => {
		repository ??=
			dependencies.getRepository?.() ?? createAdministratorsRepository();
		return repository;
	};
	const createCredential =
		dependencies.createCredential ?? createTemporaryPasswordAdministrator;
	const resetCredential =
		dependencies.resetCredential ?? resetAdministratorTemporaryPassword;

	return {
		async create(input, headers, audit) {
			const name = normalizeName(input.name);
			const email = normalizeEmail(input.email);
			let userId: string;
			try {
				({ userId } = await createCredential({
					audit,
					email,
					headers,
					name,
					temporaryPassword: input.temporaryPassword,
				}));
			} catch (error) {
				return mapCredentialError(error);
			}
			const created = await resolveRepository().findById(userId);
			if (!created) {
				throw new Error("Created administrator could not be loaded.");
			}
			return dto(created);
		},
		async list(search) {
			const normalized = normalizeListSearch(search);
			const result = await resolveRepository().list(normalized);
			return {
				items: result.items.map(dto),
				page: normalized.page,
				pageSize: normalized.pageSize,
				total: result.total,
			};
		},
		async resetPassword(id, input, headers, audit) {
			const current = await resolveRepository().findById(id);
			if (!current) throw new AdministratorNotFoundError();
			try {
				await resetCredential({
					audit,
					headers,
					temporaryPassword: input.temporaryPassword,
					userId: id,
				});
			} catch (error) {
				return mapCredentialError(error);
			}
			const updated = await resolveRepository().findById(id);
			if (!updated) throw new AdministratorNotFoundError();
			return dto(updated);
		},
		async revokeSessions(id, headers, audit) {
			await withRepositoryErrorMapping(() =>
				resolveRepository().revokeSessions({ audit, headers, id }),
			);
			return { success: true };
		},
		async update(id, ifMatch, input, headers, audit) {
			const expectedRowVersion = parseExpectedRowVersion(ifMatch);
			if (
				input.name === undefined &&
				input.locale === undefined &&
				input.enabled === undefined
			) {
				throw new AdministratorsValidationError([
					{ code: "AT_LEAST_ONE_REQUIRED", path: "$" },
				]);
			}
			if (input.enabled === false && id === audit.actorId) {
				throw new AdministratorSelfDisableError();
			}
			if (
				input.locale !== undefined &&
				!SUPPORTED_LOCALES.includes(input.locale)
			) {
				throw new AdministratorsValidationError([
					{ code: "INVALID_VALUE", path: "locale" },
				]);
			}
			const normalized = {
				...(input.enabled === undefined ? {} : { enabled: input.enabled }),
				...(input.locale === undefined ? {} : { locale: input.locale }),
				...(input.name === undefined
					? {}
					: { name: normalizeName(input.name) }),
			};
			return dto(
				await withRepositoryErrorMapping(() =>
					resolveRepository().update({
						audit,
						expectedRowVersion,
						headers,
						id,
						...normalized,
					}),
				),
			);
		},
	};
}
