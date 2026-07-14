import { createFileRoute } from "@tanstack/solid-router";

import { PlaceholderPage } from "../../features/shell/placeholder-page";

export const Route = createFileRoute("/_authenticated/monitoring/audit")({
	component: () => <PlaceholderPage routeId="monitoringAudit" />,
	ssr: false,
});
