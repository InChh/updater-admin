import { createFileRoute, useNavigate } from "@tanstack/solid-router";

import { ProgramsPage } from "../../features/programs/programs-page";
import { programListQueryOptions } from "../../features/programs/queries";
import {
	programListLoaderDeps,
	validateProgramRouteSearch,
} from "../../features/programs/search";
import { applySystemDefaultPageSize } from "../../features/settings/system-defaults";
import { systemSettingsQueryOptions } from "../../features/settings/system-queries";

export const Route = createFileRoute("/_authenticated/programs/")({
	validateSearch: validateProgramRouteSearch,
	loaderDeps: ({ search }) => programListLoaderDeps(search),
	loader: async ({ context, deps }) => {
		const settingsOptions = systemSettingsQueryOptions();
		await context.queryClient.prefetchQuery(settingsOptions);
		const settings = context.queryClient.getQueryData(settingsOptions.queryKey);
		const listSearch = applySystemDefaultPageSize(
			deps,
			settings?.data.defaultPageSize ?? 20,
		);
		await context.queryClient.prefetchQuery(
			programListQueryOptions(listSearch),
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
