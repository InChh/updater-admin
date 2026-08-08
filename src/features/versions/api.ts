import { apiClient } from "../../lib/api/client";
import { normalizeVersionListSearch } from "../../lib/api/query-keys";
import type { EntityResult, WeakEntityTag } from "../../shared/api/common";
import type {
	CompleteUploadsRequest,
	CompleteUploadsResponse,
	ResolveDraftFilesRequest,
	ResolveDraftFilesResponse,
	UploadCredentialsRequest,
	UploadCredentialsResponse,
} from "../../shared/api/uploads";
import type {
	CreateVersionInput,
	FinalizeDraftVersionResponse,
	SetVersionActivationInput,
	UpdateVersionInput,
	VersionDetailDto,
	VersionFileCursorPage,
	VersionFileCursorSearch,
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
	return apiClient.entity<VersionDetailDto>(
		`${programVersionsPath(programId)}/drafts`,
		{
			body: {
				description: canonicalVersionDescription(input.description),
				expectedFileCount: input.expectedFileCount,
				versionNumber: input.versionNumber.trim(),
			},
			method: "POST",
		},
	);
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
			...(input.versionNumber === undefined
				? {}
				: { versionNumber: input.versionNumber.trim() }),
		},
		ifMatch: etag,
		method: "PATCH",
	});
}

export function finalizeDraftVersion(
	programId: string,
	versionId: string,
	etag: WeakEntityTag,
): Promise<EntityResult<FinalizeDraftVersionResponse>> {
	return apiClient.entity<FinalizeDraftVersionResponse>(
		`${versionPath(programId, versionId)}/finalize`,
		{
			body: {},
			ifMatch: etag,
			method: "POST",
		},
	);
}

export function listVersionFiles(
	programId: string,
	versionId: string,
	search: VersionFileCursorSearch = {},
	signal?: AbortSignal,
): Promise<VersionFileCursorPage> {
	const parameters = new URLSearchParams();
	if (search.cursor !== undefined) parameters.set("cursor", search.cursor);
	if (search.pageSize !== undefined) {
		parameters.set("pageSize", String(search.pageSize));
	}
	const serializedParameters = parameters.toString();
	const query = serializedParameters ? `?${serializedParameters}` : "";
	return apiClient.json<VersionFileCursorPage>(
		`${versionPath(programId, versionId)}/files${query}`,
		{ signal },
	);
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
			body: { ...input },
			method: "POST",
			signal,
		},
	);
}

export function resolveDraftFiles(
	programId: string,
	versionId: string,
	input: ResolveDraftFilesRequest,
	signal?: AbortSignal,
): Promise<ResolveDraftFilesResponse> {
	return apiClient.json<ResolveDraftFilesResponse>(
		`${versionPath(programId, versionId)}/files/resolve`,
		{
			body: { files: [...input.files] },
			method: "POST",
			signal,
		},
	);
}

export function completeDraftFiles(
	programId: string,
	versionId: string,
	input: CompleteUploadsRequest,
	signal?: AbortSignal,
): Promise<CompleteUploadsResponse> {
	return apiClient.json<CompleteUploadsResponse>(
		`${versionPath(programId, versionId)}/files/complete`,
		{
			body: { files: [...input.files] },
			method: "POST",
			signal,
		},
	);
}
