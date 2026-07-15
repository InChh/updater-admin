import { createFileRoute } from "@tanstack/solid-router";

import { SystemSettingsPage } from "../../features/settings/system-page";
import { systemSettingsQueryOptions } from "../../features/settings/system-queries";

export const Route = createFileRoute("/_authenticated/settings/system")({
	loader: ({ context }) =>
		context.queryClient.prefetchQuery(systemSettingsQueryOptions()),
	component: SystemSettingsPage,
	ssr: false,
});
