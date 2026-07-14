import { apiClient } from "../../lib/api/client";
import { normalizeProgramListSearch } from "../../lib/api/query-keys";
import type { EntityResult, WeakEntityTag } from "../../shared/api/common";
import type {
	CreateProgramInput,
	ProgramDetailDto,
	ProgramListSearch,
	ProgramPage,
	UpdateProgramInput,
} from "../../shared/api/programs";
import { isCanonicalUuid } from "./search";

function programPath(programId: string): `/api/v1/programs/${string}` {
	if (!isCanonicalUuid(programId)) throw new TypeError("Invalid program ID.");
	return `/api/v1/programs/${programId}`;
}

export function canonicalProgramDescription(
	description: null | string | undefined,
): null | string {
	const trimmed = description?.trim() ?? "";
	return trimmed || null;
}

export async function listPrograms(
	search: ProgramListSearch,
	signal?: AbortSignal,
): Promise<ProgramPage> {
	const normalized = normalizeProgramListSearch(search);
	const parameters = new URLSearchParams({
		page: String(normalized.page),
		pageSize: String(normalized.pageSize),
		sort: normalized.sort,
	});
	if (normalized.name) parameters.set("name", normalized.name);
	return apiClient.json<ProgramPage>(
		`/api/v1/programs?${parameters.toString()}`,
		{ signal },
	);
}

export function getProgram(
	programId: string,
	signal?: AbortSignal,
): Promise<EntityResult<ProgramDetailDto>> {
	return apiClient.entity<ProgramDetailDto>(programPath(programId), { signal });
}

export function createProgram(
	input: CreateProgramInput,
): Promise<EntityResult<ProgramDetailDto>> {
	return apiClient.entity<ProgramDetailDto>("/api/v1/programs", {
		body: {
			description: canonicalProgramDescription(input.description),
			name: input.name.trim(),
		},
		method: "POST",
	});
}

export function updateProgram(
	programId: string,
	input: UpdateProgramInput,
	etag: WeakEntityTag,
): Promise<EntityResult<ProgramDetailDto>> {
	return apiClient.entity<ProgramDetailDto>(programPath(programId), {
		body: {
			...(input.description !== undefined
				? { description: canonicalProgramDescription(input.description) }
				: {}),
			...(input.name !== undefined ? { name: input.name.trim() } : {}),
		},
		ifMatch: etag,
		method: "PATCH",
	});
}

export function deleteProgram(
	programId: string,
	etag: WeakEntityTag,
): Promise<void> {
	return apiClient.noContent(programPath(programId), {
		ifMatch: etag,
		method: "DELETE",
	});
}
