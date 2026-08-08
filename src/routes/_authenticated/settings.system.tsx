import { createFileRoute } from "@tanstack/solid-router";

import { SystemSettingsPage } from "../../features/settings/system-page";

export const Route = createFileRoute("/_authenticated/settings/system")({
	component: SystemSettingsPage,
	ssr: false,
});
