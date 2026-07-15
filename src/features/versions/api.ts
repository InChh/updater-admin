import { apiClient } from "../../lib/api/client";
import { normalizeVersionListSearch } from "../../lib/api/query-keys";
import type { EntityResult, WeakEntityTag } from "../../shared/api/common";
import type {
	CompleteUploadsRequest,
	CompleteUploadsResponse,
	UploadCredentialsRequest,
	UploadCredentialsResponse,
} from "../../shared/api/uploads";
import type {
	CreateVersionInput,
	SetVersionActivationInput,
	UpdateVersionInput,
	VersionDetailDto,
	VersionListSearch,
	VersionPage,
} from "../../shared/api/versions";
import { isCanonicalUuid } from "../programs/search";

function programVersionsPath(
	programId: string,
): `/api/v1/programs/${string}/versions` {
	if (!isCanonicalUuid(programId)) throw new TypeError("Invalid program ID.");
	return `/api/v1/programs/${programId}/versions`;
}

function versionPath(
	programId: string,
	versionId: string,
): `/api/v1/programs/${string}/versions/${string}` {
	if (!isCanonicalUuid(versionId)) throw new TypeError("Invalid version ID.");
	return `${programVersionsPath(programId)}/${versionId}`;
}

export function canonicalVersionDescription(
	description: string | undefined,
): string {
	return description?.trim() ?? "";
}

export async function listVersions(
	programId: string,
	search: VersionListSearch,
	signal?: AbortSignal,
): Promise<VersionPage> {
	const normalized = normalizeVersionListSearch(search);
	const parameters = new URLSearchParams({
		page: String(normalized.page),
		pageSize: String(normalized.pageSize),
		sort: normalized.sort,
	});
	return apiClient.json<VersionPage>(
		`${programVersionsPath(programId)}?${parameters.toString()}`,
		{ signal },
	);
}

export function getVersion(
	programId: string,
	versionId: string,
	signal?: AbortSignal,
): Promise<EntityResult<VersionDetailDto>> {
	return apiClient.entity<VersionDetailDto>(versionPath(programId, versionId), {
		signal,
	});
}

export function createVersion(
	programId: string,
	input: CreateVersionInput,
): Promise<EntityResult<VersionDetailDto>> {
	return apiClient.entity<VersionDetailDto>(programVersionsPath(programId), {
		body: {
			description: canonicalVersionDescription(input.description),
			fileIds: [...input.fileIds],
			versionNumber: input.versionNumber.trim(),
		},
		method: "POST",
	});
}

export function updateVersion(
	programId: string,
	versionId: string,
	input: UpdateVersionInput,
	etag: WeakEntityTag,
): Promise<EntityResult<VersionDetailDto>> {
	return apiClient.entity<VersionDetailDto>(versionPath(programId, versionId), {
		body: {
			...(input.description === undefined
				? {}
				: { description: canonicalVersionDescription(input.description) }),
			...(input.fileIds === undefined ? {} : { fileIds: [...input.fileIds] }),
			...(input.versionNumber === undefined
				? {}
				: { versionNumber: input.versionNumber.trim() }),
		},
		ifMatch: etag,
		method: "PATCH",
	});
}

export function deleteVersion(
	programId: string,
	versionId: string,
	etag: WeakEntityTag,
): Promise<void> {
	return apiClient.noContent(versionPath(programId, versionId), {
		ifMatch: etag,
		method: "DELETE",
	});
}

export function setVersionActivation(
	programId: string,
	versionId: string,
	input: SetVersionActivationInput,
	etag: WeakEntityTag,
): Promise<EntityResult<VersionDetailDto>> {
	return apiClient.entity<VersionDetailDto>(
		`${versionPath(programId, versionId)}/activation`,
		{
			body: input,
			ifMatch: etag,
			method: "PUT",
		},
	);
}

export function requestUploadCredentials(
	input: UploadCredentialsRequest,
	signal?: AbortSignal,
): Promise<UploadCredentialsResponse> {
	return apiClient.json<UploadCredentialsResponse>(
		"/api/v1/uploads/credentials",
		{
			body: { files: [...input.files] },
			method: "POST",
			signal,
		},
	);
}

export function completeUploads(
	input: CompleteUploadsRequest,
	signal?: AbortSignal,
): Promise<CompleteUploadsResponse> {
	return apiClient.json<CompleteUploadsResponse>("/api/v1/uploads/complete", {
		body: { files: [...input.files] },
		method: "POST",
		signal,
	});
}
