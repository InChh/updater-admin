import type {
	EntityResult,
	FieldError,
	SupportedLocale,
} from "../../shared/api/common";
import {
	formatWeakEntityTag,
	isWellFormedUnicode,
	parseWeakEntityTag,
	SUPPORTED_LOCALES,
} from "../../shared/api/common";
import type {
	SystemSettingsDto,
	SystemSettingsPageSize,
	UpdateSystemSettingsInput,
} from "../../shared/api/settings";
import { SYSTEM_SETTINGS_PAGE_SIZES } from "../../shared/api/settings";
import { isSensitiveUrl } from "../../shared/security/redact";
import {
	createSettingsRepository,
	type SettingsMutationContext,
	type SettingsRepository,
	SettingsStaleWriteRepositoryError,
	type SystemSettingsRecord,
} from "../db/repositories/settings.server";

export class SettingsValidationError extends Error {
	readonly fieldErrors: readonly FieldError[];

	constructor(fieldErrors: readonly FieldError[]) {
		super("System settings input is invalid.");
		this.name = "SettingsValidationError";
		this.fieldErrors = fieldErrors;
	}
}

export class SettingsPreconditionRequiredError extends Error {
	constructor() {
		super("A current system settings ETag is required.");
		this.name = "SettingsPreconditionRequiredError";
	}
}

export class SettingsStaleWriteError extends Error {
	constructor() {
		super("System settings changed since they were loaded.");
		this.name = "SettingsStaleWriteError";
	}
}

export interface SettingsService {
	get(): Promise<EntityResult<SystemSettingsDto>>;
	update(
		ifMatch: string | null,
		input: UpdateSystemSettingsInput,
		audit: SettingsMutationContext,
	): Promise<EntityResult<SystemSettingsDto>>;
}

export interface SettingsServiceDependencies {
	readonly getRepository?: () => SettingsRepository;
	readonly now?: () => Date;
	readonly repository?: SettingsRepository;
}

const DEFAULT_LOCALE: SupportedLocale = "zh-CN";
const DEFAULT_PAGE_SIZE: SystemSettingsPageSize = 20;
const SYSTEM_NAME_MAX_LENGTH = 128;
const REPOSITORY_URL_MAX_LENGTH = 2048;

function characterLength(value: string): number {
	return [...value].length;
}

function isDatabaseSafeUnicode(value: string): boolean {
	return !value.includes("\0") && isWellFormedUnicode(value);
}

function normalizeSystemName(value: unknown): string {
	if (typeof value !== "string" || !isDatabaseSafeUnicode(value)) {
		throw new SettingsValidationError([
			{ code: "INVALID_VALUE", path: "systemName" },
		]);
	}
	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new SettingsValidationError([
			{ code: "REQUIRED", path: "systemName" },
		]);
	}
	if (characterLength(normalized) > SYSTEM_NAME_MAX_LENGTH) {
		throw new SettingsValidationError([
			{ code: "TOO_LONG", path: "systemName" },
		]);
	}
	return normalized;
}

function normalizeLocale(value: unknown): SupportedLocale {
	if (
		typeof value !== "string" ||
		!SUPPORTED_LOCALES.includes(value as SupportedLocale)
	) {
		throw new SettingsValidationError([
			{ code: "INVALID_VALUE", path: "defaultLocale" },
		]);
	}
	return value as SupportedLocale;
}

function normalizePageSize(value: unknown): SystemSettingsPageSize {
	if (
		typeof value !== "number" ||
		!SYSTEM_SETTINGS_PAGE_SIZES.includes(value as SystemSettingsPageSize)
	) {
		throw new SettingsValidationError([
			{ code: "INVALID_VALUE", path: "defaultPageSize" },
		]);
	}
	return value as SystemSettingsPageSize;
}

function normalizeRepositoryUrl(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value !== "string" || !isDatabaseSafeUnicode(value)) {
		throw new SettingsValidationError([
			{ code: "INVALID_VALUE", path: "repositoryUrl" },
		]);
	}
	const normalized = value.trim();
	if (normalized.length === 0) return null;
	if (characterLength(normalized) > REPOSITORY_URL_MAX_LENGTH) {
		throw new SettingsValidationError([
			{ code: "TOO_LONG", path: "repositoryUrl" },
		]);
	}
	try {
		const parsed = new URL(normalized);
		if (
			parsed.protocol !== "https:" ||
			parsed.hostname.length === 0 ||
			parsed.username.length > 0 ||
			parsed.password.length > 0 ||
			isSensitiveUrl(normalized)
		) {
			throw new Error("Repository URL must be credential-free HTTPS.");
		}
	} catch {
		throw new SettingsValidationError([
			{ code: "INVALID_URL", path: "repositoryUrl" },
		]);
	}
	return normalized;
}

function recordLocale(value: string): SupportedLocale {
	return SUPPORTED_LOCALES.includes(value as SupportedLocale)
		? (value as SupportedLocale)
		: DEFAULT_LOCALE;
}

function recordPageSize(value: number): SystemSettingsPageSize {
	return SYSTEM_SETTINGS_PAGE_SIZES.includes(value as SystemSettingsPageSize)
		? (value as SystemSettingsPageSize)
		: DEFAULT_PAGE_SIZE;
}

function dto(record: SystemSettingsRecord): SystemSettingsDto {
	return {
		defaultLocale: recordLocale(record.defaultLocale),
		defaultPageSize: recordPageSize(record.defaultPageSize),
		repositoryUrl: record.repositoryUrl,
		systemName: record.systemName,
	};
}

function entityResult(
	record: SystemSettingsRecord,
): EntityResult<SystemSettingsDto> {
	return {
		data: dto(record),
		etag: formatWeakEntityTag(record.rowVersion),
	};
}

function parseExpectedRowVersion(ifMatch: string | null): bigint {
	if (ifMatch === null) throw new SettingsPreconditionRequiredError();
	const rowVersion = parseWeakEntityTag(ifMatch);
	if (rowVersion === null) throw new SettingsStaleWriteError();
	return rowVersion;
}

function normalizeUpdate(input: UpdateSystemSettingsInput) {
	return {
		defaultLocale: normalizeLocale(input.defaultLocale),
		defaultPageSize: normalizePageSize(input.defaultPageSize),
		repositoryUrl: normalizeRepositoryUrl(input.repositoryUrl),
		systemName: normalizeSystemName(input.systemName),
	};
}

export function createSettingsService(
	dependencies: SettingsServiceDependencies = {},
): SettingsService {
	let repository = dependencies.repository;
	const resolveRepository = () => {
		repository ??= dependencies.getRepository?.() ?? createSettingsRepository();
		return repository;
	};
	const now = dependencies.now ?? (() => new Date());

	return {
		async get() {
			return entityResult(await resolveRepository().getOrCreate());
		},
		async update(ifMatch, input, audit) {
			const expectedRowVersion = parseExpectedRowVersion(ifMatch);
			const normalized = normalizeUpdate(input);
			try {
				const updated = await resolveRepository().update({
					audit,
					expectedRowVersion,
					now: now(),
					...normalized,
				});
				return entityResult(updated);
			} catch (error) {
				if (error instanceof SettingsStaleWriteRepositoryError) {
					throw new SettingsStaleWriteError();
				}
				throw error;
			}
		},
	};
}
