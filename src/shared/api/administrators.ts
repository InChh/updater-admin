import type { Page, SupportedLocale, WeakEntityTag } from "./common";

export const ADMINISTRATOR_PAGE_SIZES = [20, 50, 100] as const;
export const ADMINISTRATOR_SORTS = [
	"createdAt:desc",
	"createdAt:asc",
	"name:asc",
	"name:desc",
] as const;
export const ADMINISTRATOR_STATUSES = ["active", "disabled"] as const;
export const ADMINISTRATOR_MAX_PAGE = 1_000_000;

export type AdministratorPageSize = (typeof ADMINISTRATOR_PAGE_SIZES)[number];
export type AdministratorSort = (typeof ADMINISTRATOR_SORTS)[number];
export type AdministratorStatus = (typeof ADMINISTRATOR_STATUSES)[number];

export interface AdministratorDto {
	readonly createdAt: string;
	readonly email: string;
	readonly enabled: boolean;
	readonly etag: WeakEntityTag;
	readonly id: string;
	readonly lastLoginAt: string | null;
	readonly locale: SupportedLocale;
	readonly mustChangePassword: boolean;
	readonly name: string;
	readonly updatedAt: string;
}

export interface AdministratorListSearch {
	readonly page: number;
	readonly pageSize: AdministratorPageSize;
	readonly query?: string;
	readonly sort: AdministratorSort;
	readonly status?: AdministratorStatus;
}

export interface AdministratorPage extends Page<AdministratorDto> {
	readonly pageSize: AdministratorPageSize;
}

export interface CreateAdministratorInput {
	readonly email: string;
	readonly name: string;
	readonly temporaryPassword: string;
}

export type UpdateAdministratorInput =
	| {
			readonly enabled: boolean;
			readonly locale?: SupportedLocale;
			readonly name?: string;
	  }
	| {
			readonly enabled?: boolean;
			readonly locale: SupportedLocale;
			readonly name?: string;
	  }
	| {
			readonly enabled?: boolean;
			readonly locale?: SupportedLocale;
			readonly name: string;
	  };

export interface ResetAdministratorPasswordInput {
	readonly temporaryPassword: string;
}

export interface SessionsRevokedResult {
	readonly success: true;
}
