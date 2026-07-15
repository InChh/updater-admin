import { createFileRoute, useNavigate } from "@tanstack/solid-router";

import { AuditPage } from "../../features/monitoring/audit-page";
import { auditListQueryOptions } from "../../features/monitoring/queries";
import {
	auditListLoaderDeps,
	validateAuditRouteSearch,
} from "../../features/monitoring/search";
import { applySystemDefaultPageSize } from "../../features/settings/system-defaults";
import { systemSettingsQueryOptions } from "../../features/settings/system-queries";

export const Route = createFileRoute("/_authenticated/monitoring/audit")({
	validateSearch: validateAuditRouteSearch,
	loaderDeps: ({ search }) => auditListLoaderDeps(search),
	loader: async ({ context, deps }) => {
		const settingsOptions = systemSettingsQueryOptions();
		await context.queryClient.prefetchQuery(settingsOptions);
		const settings = context.queryClient.getQueryData(settingsOptions.queryKey);
		const listSearch = applySystemDefaultPageSize(
			deps,
			settings?.data.defaultPageSize ?? 20,
		);
		await context.queryClient.prefetchQuery(auditListQueryOptions(listSearch));
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
