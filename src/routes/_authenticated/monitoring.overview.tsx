import { createFileRoute, useNavigate } from "@tanstack/solid-router";

import { MonitoringOverviewPage } from "../../features/monitoring/monitoring-overview-page";
import {
	monitoringStatusQueryOptions,
	releaseSeriesQueryOptions,
} from "../../features/monitoring/queries";
import { validateMonitoringRouteSearch } from "../../features/monitoring/search";

export const Route = createFileRoute("/_authenticated/monitoring/overview")({
	validateSearch: validateMonitoringRouteSearch,
	loaderDeps: ({ search }) => ({ days: search.days }),
	loader: ({ context, deps }) =>
		Promise.all([
			context.queryClient.prefetchQuery(monitoringStatusQueryOptions()),
			context.queryClient.prefetchQuery(releaseSeriesQueryOptions(deps.days)),
		]),
	component: MonitoringOverviewRoute,
	ssr: false,
});

function MonitoringOverviewRoute() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	return (
		<MonitoringOverviewPage
			onSearchChange={(nextSearch) => {
				void navigate({ search: nextSearch });
			}}
			search={search}
		/>
	);
}
