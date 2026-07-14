import { createFileRoute, useNavigate } from "@tanstack/solid-router";

import { ProgramsPage } from "../../features/programs/programs-page";
import { programListQueryOptions } from "../../features/programs/queries";
import {
	programListSearch,
	validateProgramRouteSearch,
} from "../../features/programs/search";

export const Route = createFileRoute("/_authenticated/programs/")({
	validateSearch: validateProgramRouteSearch,
	loaderDeps: ({ search }) => programListSearch(search),
	loader: ({ context, deps }) =>
		context.queryClient.ensureQueryData(programListQueryOptions(deps)),
	component: ProgramsIndexRoute,
});

function ProgramsIndexRoute() {
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
			search={search}
		/>
	);
}
