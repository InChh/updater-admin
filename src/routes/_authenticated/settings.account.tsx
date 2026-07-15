import { createFileRoute } from "@tanstack/solid-router";

import { AccountPage } from "../../features/settings/account-page";
import { profileQueryOptions } from "../../features/settings/queries";

export const Route = createFileRoute("/_authenticated/settings/account")({
	loader: ({ context }) =>
		context.queryClient.prefetchQuery(profileQueryOptions()),
	component: AccountPage,
	ssr: false,
});
