import { apiClient } from "../../lib/api/client";
import { normalizeAdministratorListSearch } from "../../lib/api/query-keys";
import type {
	AdministratorDto,
	AdministratorListSearch,
	AdministratorPage,
	CreateAdministratorInput,
	ResetAdministratorPasswordInput,
	SessionsRevokedResult,
	UpdateAdministratorInput,
} from "../../shared/api/administrators";
import type { WeakEntityTag } from "../../shared/api/common";
import { isCanonicalAdministratorId } from "./search";

function administratorPath(
	administratorId: string,
): `/api/v1/administrators/${string}` {
	if (!isCanonicalAdministratorId(administratorId)) {
		throw new TypeError("Invalid administrator ID.");
	}
	return `/api/v1/administrators/${administratorId}`;
}

export async function listAdministrators(
	search: AdministratorListSearch,
	signal?: AbortSignal,
): Promise<AdministratorPage> {
	const normalized = normalizeAdministratorListSearch(search);
	const parameters = new URLSearchParams({
		page: String(normalized.page),
		pageSize: String(normalized.pageSize),
		sort: normalized.sort,
	});
	if (normalized.query) parameters.set("query", normalized.query);
	if (normalized.status) parameters.set("status", normalized.status);
	return apiClient.json<AdministratorPage>(
		`/api/v1/administrators?${parameters.toString()}`,
		{ signal },
	);
}

export function createAdministrator(
	input: CreateAdministratorInput,
): Promise<AdministratorDto> {
	return apiClient.json<AdministratorDto>("/api/v1/administrators", {
		body: {
			email: input.email.trim().toLowerCase(),
			name: input.name.trim(),
			temporaryPassword: input.temporaryPassword,
		},
		method: "POST",
	});
}

export function updateAdministrator(
	administratorId: string,
	input: UpdateAdministratorInput,
	etag: WeakEntityTag,
): Promise<AdministratorDto> {
	return apiClient.json<AdministratorDto>(administratorPath(administratorId), {
		body: input,
		ifMatch: etag,
		method: "PATCH",
	});
}

export function resetAdministratorPassword(
	administratorId: string,
	input: ResetAdministratorPasswordInput,
): Promise<AdministratorDto> {
	return apiClient.json<AdministratorDto>(
		`${administratorPath(administratorId)}/reset-password`,
		{ body: input, method: "POST" },
	);
}

export function revokeAdministratorSessions(
	administratorId: string,
): Promise<SessionsRevokedResult> {
	return apiClient.json<SessionsRevokedResult>(
		`${administratorPath(administratorId)}/revoke-sessions`,
		{ method: "POST" },
	);
}
