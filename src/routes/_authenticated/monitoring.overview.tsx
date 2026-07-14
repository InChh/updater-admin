import { createFileRoute } from "@tanstack/solid-router";

import { PlaceholderPage } from "../../features/shell/placeholder-page";

export const Route = createFileRoute("/_authenticated/monitoring/overview")({
	component: () => <PlaceholderPage routeId="monitoringOverview" />,
	ssr: false,
});
