import { createFileRoute } from "@tanstack/solid-router";

import { ProfileForm } from "../../features/settings/profile-form";

export const Route = createFileRoute("/_authenticated/settings/profile")({
	component: ProfileForm,
	ssr: false,
});
