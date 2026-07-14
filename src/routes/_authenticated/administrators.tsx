import { createFileRoute } from "@tanstack/solid-router";

import { PlaceholderPage } from "../../features/shell/placeholder-page";

export const Route = createFileRoute("/_authenticated/administrators")({
	component: () => <PlaceholderPage routeId="administrators" />,
	ssr: false,
});
