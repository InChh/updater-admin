import { createFileRoute } from "@tanstack/solid-router";

import { PlaceholderPage } from "../../features/shell/placeholder-page";

export const Route = createFileRoute("/_authenticated/settings/system")({
	component: () => <PlaceholderPage routeId="systemSettings" />,
	ssr: false,
});
