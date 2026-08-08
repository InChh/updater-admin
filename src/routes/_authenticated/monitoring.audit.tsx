import { createFileRoute, useNavigate } from "@tanstack/solid-router";

import { AuditPage } from "../../features/monitoring/audit-page";
import {
	auditListLoaderDeps,
	validateAuditRouteSearch,
} from "../../features/monitoring/search";
import {
	applySystemDefaultPageSize,
	resolveSystemDefaultPageSize,
} from "../../features/settings/system-defaults";

export const Route = createFileRoute("/_authenticated/monitoring/audit")({
	validateSearch: validateAuditRouteSearch,
	loaderDeps: ({ search }) => auditListLoaderDeps(search),
	loader: ({ context, deps }) => {
		const listSearch = applySystemDefaultPageSize(
			deps,
			resolveSystemDefaultPageSize(context.queryClient),
		);
		return { pageSize: listSearch.pageSize };
	},
	component: MonitoringAuditRoute,
	ssr: false,
});

function MonitoringAuditRoute() {
	const data = Route.useLoaderData();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	return (
		<AuditPage
			onSearchChange={(nextSearch, options) => {
				void navigate({ replace: options?.replace, search: nextSearch });
			}}
			search={() => ({ ...search(), pageSize: data().pageSize })}
		/>
	);
}
