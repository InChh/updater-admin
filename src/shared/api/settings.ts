import type { SupportedLocale } from "./common";

export const SYSTEM_SETTINGS_PAGE_SIZES = [20, 50, 100] as const;

export type SystemSettingsPageSize =
	(typeof SYSTEM_SETTINGS_PAGE_SIZES)[number];

export interface SystemSettingsDto {
	readonly defaultLocale: SupportedLocale;
	readonly defaultPageSize: SystemSettingsPageSize;
	readonly repositoryUrl: string | null;
	readonly systemName: string;
}

export interface UpdateSystemSettingsInput {
	readonly defaultLocale: SupportedLocale;
	readonly defaultPageSize: SystemSettingsPageSize;
	readonly repositoryUrl: string | null;
	readonly systemName: string;
}
