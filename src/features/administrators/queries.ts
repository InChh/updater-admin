import { queryOptions } from "@tanstack/solid-query";

import { administratorQueryKeys } from "../../lib/api/query-keys";
import type { AdministratorListSearch } from "../../shared/api/administrators";
import { listAdministrators } from "./api";

export function administratorListQueryOptions(search: AdministratorListSearch) {
	return queryOptions({
		queryFn: ({ signal }) => listAdministrators(search, signal),
		queryKey: administratorQueryKeys.list(search),
	});
}
