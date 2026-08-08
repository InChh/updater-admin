import { createFileRoute, useNavigate } from "@tanstack/solid-router";

import { ProgramsPage } from "../../features/programs/programs-page";
import {
	programListLoaderDeps,
	validateProgramRouteSearch,
} from "../../features/programs/search";
import {
	applySystemDefaultPageSize,
	resolveSystemDefaultPageSize,
} from "../../features/settings/system-defaults";

export const Route = createFileRoute("/_authenticated/programs/")({
	validateSearch: validateProgramRouteSearch,
	loaderDeps: ({ search }) => programListLoaderDeps(search),
	loader: ({ context, deps }) => {
		const listSearch = applySystemDefaultPageSize(
			deps,
			resolveSystemDefaultPageSize(context.queryClient),
		);
		return { pageSize: listSearch.pageSize };
	},
	component: ProgramsIndexRoute,
});

function ProgramsIndexRoute() {
	const data = Route.useLoaderData();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	return (
		<ProgramsPage
			onSearchChange={(nextSearch, options) => {
				void navigate({
					replace: options?.replace,
					search: nextSearch,
				});
			}}
			search={() => ({ ...search(), pageSize: data().pageSize })}
		/>
	);
}
