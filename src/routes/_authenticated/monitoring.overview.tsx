import { createFileRoute, useNavigate } from "@tanstack/solid-router";

import { MonitoringOverviewPage } from "../../features/monitoring/monitoring-overview-page";
import { validateMonitoringRouteSearch } from "../../features/monitoring/search";

export const Route = createFileRoute("/_authenticated/monitoring/overview")({
	validateSearch: validateMonitoringRouteSearch,
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
