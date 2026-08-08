import { createFileRoute } from "@tanstack/solid-router";

import { AccountPage } from "../../features/settings/account-page";

export const Route = createFileRoute("/_authenticated/settings/account")({
	component: AccountPage,
	ssr: false,
});
