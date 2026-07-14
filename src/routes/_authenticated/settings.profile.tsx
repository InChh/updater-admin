import { createFileRoute } from "@tanstack/solid-router";

import { PlaceholderPage } from "../../features/shell/placeholder-page";

export const Route = createFileRoute("/_authenticated/settings/profile")({
	component: () => <PlaceholderPage routeId="profileSettings" />,
	ssr: false,
});
