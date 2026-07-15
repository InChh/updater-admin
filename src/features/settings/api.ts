import { apiClient } from "../../lib/api/client";
import type { EntityResult, WeakEntityTag } from "../../shared/api/common";
import type {
	ChangePasswordInput,
	PasswordChangedResult,
	ProfileDto,
	UpdateProfileInput,
} from "../../shared/api/profile";

export function getProfile(
	signal?: AbortSignal,
): Promise<EntityResult<ProfileDto>> {
	return apiClient.entity<ProfileDto>("/api/v1/profile", { signal });
}

export function updateProfile(
	input: UpdateProfileInput,
	etag: WeakEntityTag,
): Promise<EntityResult<ProfileDto>> {
	return apiClient.entity<ProfileDto>("/api/v1/profile", {
		body: {
			...(input.locale === undefined ? {} : { locale: input.locale }),
			...(input.name === undefined ? {} : { name: input.name.trim() }),
		},
		ifMatch: etag,
		method: "PATCH",
	});
}

export function changeProfilePassword(
	input: ChangePasswordInput,
): Promise<PasswordChangedResult> {
	return apiClient.json<PasswordChangedResult>(
		"/api/v1/profile/change-password",
		{ body: input, method: "POST" },
	);
}
