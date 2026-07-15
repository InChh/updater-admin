import { apiClient } from "../../lib/api/client";
import type { EntityResult, WeakEntityTag } from "../../shared/api/common";
import type {
	SystemSettingsDto,
	UpdateSystemSettingsInput,
} from "../../shared/api/settings";

const SYSTEM_SETTINGS_PATH = "/api/v1/settings/system" as const;

export function getSystemSettings(
	signal?: AbortSignal,
): Promise<EntityResult<SystemSettingsDto>> {
	return apiClient.entity<SystemSettingsDto>(SYSTEM_SETTINGS_PATH, { signal });
}

export function updateSystemSettings(
	input: UpdateSystemSettingsInput,
	etag: WeakEntityTag,
): Promise<EntityResult<SystemSettingsDto>> {
	return apiClient.entity<SystemSettingsDto>(SYSTEM_SETTINGS_PATH, {
		body: {
			defaultLocale: input.defaultLocale,
			defaultPageSize: input.defaultPageSize,
			repositoryUrl: input.repositoryUrl?.trim() || null,
			systemName: input.systemName.trim(),
		},
		ifMatch: etag,
		method: "PATCH",
	});
}
