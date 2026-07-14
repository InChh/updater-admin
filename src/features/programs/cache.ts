import type { QueryClient } from "@tanstack/solid-query";

import { programQueryKeys } from "../../lib/api/query-keys";
import type { EntityResult } from "../../shared/api/common";
import type { ProgramDetailDto } from "../../shared/api/programs";

export function storeProgramDetail(
	queryClient: QueryClient,
	program: EntityResult<ProgramDetailDto>,
): void {
	queryClient.setQueryData(programQueryKeys.detail(program.data.id), program);
}

export function removeProgramDetail(
	queryClient: QueryClient,
	programId: string,
): void {
	queryClient.removeQueries({
		exact: true,
		queryKey: programQueryKeys.detail(programId),
	});
}

export function invalidateProgramLists(queryClient: QueryClient) {
	return queryClient.invalidateQueries({ queryKey: programQueryKeys.lists() });
}

export async function refreshStaleProgram(
	queryClient: QueryClient,
	programId: string,
): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({
			exact: true,
			queryKey: programQueryKeys.detail(programId),
		}),
		invalidateProgramLists(queryClient),
	]);
}
