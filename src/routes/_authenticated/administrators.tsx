import { createFileRoute, useNavigate } from "@tanstack/solid-router";

import { AdministratorsPage } from "../../features/administrators/administrators-page";
import { administratorListQueryOptions } from "../../features/administrators/queries";
import {
	administratorListLoaderDeps,
	validateAdministratorRouteSearch,
} from "../../features/administrators/search";
import { applySystemDefaultPageSize } from "../../features/settings/system-defaults";
import { systemSettingsQueryOptions } from "../../features/settings/system-queries";

export const Route = createFileRoute("/_authenticated/administrators")({
	validateSearch: validateAdministratorRouteSearch,
	loaderDeps: ({ search }) => administratorListLoaderDeps(search),
	loader: async ({ context, deps }) => {
		const settingsOptions = systemSettingsQueryOptions();
		await context.queryClient.prefetchQuery(settingsOptions);
		const settings = context.queryClient.getQueryData(settingsOptions.queryKey);
		const listSearch = applySystemDefaultPageSize(
			deps,
			settings?.data.defaultPageSize ?? 20,
		);
		await context.queryClient.prefetchQuery(
			administratorListQueryOptions(listSearch),
		);
		return { pageSize: listSearch.pageSize };
	},
	component: AdministratorsRoute,
	ssr: false,
});

function AdministratorsRoute() {
	const context = Route.useRouteContext();
	const data = Route.useLoaderData();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	return (
		<AdministratorsPage
			currentAdministratorId={context().session.user.id}
			onSearchChange={(nextSearch, options) => {
				void navigate({ replace: options?.replace, search: nextSearch });
			}}
			search={() => ({ ...search(), pageSize: data().pageSize })}
		/>
	);
}
