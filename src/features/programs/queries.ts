import { queryOptions } from "@tanstack/solid-query";

import { programQueryKeys } from "../../lib/api/query-keys";
import type { ProgramListSearch } from "../../shared/api/programs";
import { getProgram, listPrograms } from "./api";

export function programListQueryOptions(search: ProgramListSearch) {
	return queryOptions({
		queryFn: ({ signal }) => listPrograms(search, signal),
		queryKey: programQueryKeys.list(search),
	});
}

export function programDetailQueryOptions(programId: string) {
	return queryOptions({
		queryFn: ({ signal }) => getProgram(programId, signal),
		queryKey: programQueryKeys.detail(programId),
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
		staleTime: 0,
	});
}
