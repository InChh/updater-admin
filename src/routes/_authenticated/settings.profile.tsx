import { createFileRoute } from "@tanstack/solid-router";

import { ProfileForm } from "../../features/settings/profile-form";
import { profileQueryOptions } from "../../features/settings/queries";

export const Route = createFileRoute("/_authenticated/settings/profile")({
	loader: ({ context }) =>
		context.queryClient.prefetchQuery(profileQueryOptions()),
	component: ProfileForm,
	ssr: false,
});
