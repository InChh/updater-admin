import { createFileRoute, useNavigate } from "@tanstack/solid-router";

import { AdministratorsPage } from "../../features/administrators/administrators-page";
import {
	administratorListLoaderDeps,
	validateAdministratorRouteSearch,
} from "../../features/administrators/search";
import {
	applySystemDefaultPageSize,
	resolveSystemDefaultPageSize,
} from "../../features/settings/system-defaults";

export const Route = createFileRoute("/_authenticated/administrators")({
	validateSearch: validateAdministratorRouteSearch,
	loaderDeps: ({ search }) => administratorListLoaderDeps(search),
	loader: ({ context, deps }) => {
		const listSearch = applySystemDefaultPageSize(
			deps,
			resolveSystemDefaultPageSize(context.queryClient),
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
