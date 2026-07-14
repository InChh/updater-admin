import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";
import { createSignal } from "solid-js";
import { SkipLink } from "../components/ui/skip-link";
import { AppShell } from "../features/shell/app-shell";
import { validateReturnTo } from "../features/shell/route-registry";
import { shellUiController } from "../features/shell/ui-store";
import { I18nProvider } from "../lib/i18n/i18n";
import { sessionQueryKey, sessionQueryOptions } from "../lib/session-query";

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async ({ context, location }) => {
		const session = await context.queryClient.ensureQueryData(
			sessionQueryOptions(),
		);
		const returnTo = validateReturnTo(location.href);
		if (!session || session.user.banned) {
			if (session?.user.banned) {
				context.queryClient.setQueryData(sessionQueryKey, null);
			}
			throw redirect({
				search: { returnTo },
				to: "/login",
			});
		}
		if (session.metadata.mustChangePassword) {
			throw redirect({
				search: { returnTo },
				to: "/login",
			});
		}
		return { session };
	},
	component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
	const context = Route.useRouteContext();
	const [locale, setLocale] = createSignal(context().session.metadata.locale);
	const setActiveLocale = (nextLocale: "zh-CN" | "en") => {
		setLocale(nextLocale);
		shellUiController.setLocale(nextLocale);
	};
	return (
		<I18nProvider locale={locale()} onLocaleChange={setActiveLocale}>
			<SkipLink />
			<AppShell session={context().session}>
				<Outlet />
			</AppShell>
		</I18nProvider>
	);
}
