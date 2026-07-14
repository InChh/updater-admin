import { createFileRoute } from "@tanstack/solid-router";

import { PlaceholderPage } from "../../features/shell/placeholder-page";

export const Route = createFileRoute("/_authenticated/programs")({
	component: () => <PlaceholderPage routeId="programs" />,
	ssr: false,
});
