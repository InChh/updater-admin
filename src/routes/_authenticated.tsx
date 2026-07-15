import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";
import { createEffect, createSignal } from "solid-js";
import { SkipLink } from "../components/ui/skip-link";
import { updateProfile } from "../features/settings/api";
import { AppShell } from "../features/shell/app-shell";
import { validateReturnTo } from "../features/shell/route-registry";
import { shellUiController } from "../features/shell/ui-store";
import { profileQueryKeys } from "../lib/api/query-keys";
import { I18nProvider } from "../lib/i18n/i18n";
import { sessionQueryKey, sessionQueryOptions } from "../lib/session-query";
import type { SafeSessionView } from "../server/auth/session.server";

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
	const queryClient = useQueryClient();
	const [locale, setLocale] = createSignal(context().session.metadata.locale);
	createEffect(() => setLocale(context().session.metadata.locale));
	const setActiveLocale = async (nextLocale: "zh-CN" | "en") => {
		const cachedSession = queryClient.getQueryData<SafeSessionView | null>(
			sessionQueryKey,
		);
		if (cachedSession?.metadata.locale !== nextLocale) {
			const profile = await updateProfile(
				{ locale: nextLocale },
				cachedSession?.metadata.etag ?? context().session.metadata.etag,
			);
			queryClient.setQueryData(profileQueryKeys.detail(), profile);
			queryClient.setQueryData<SafeSessionView | null>(
				sessionQueryKey,
				(current) =>
					current
						? {
								...current,
								metadata: {
									...current.metadata,
									etag: profile.etag,
									locale: profile.data.locale,
								},
								user: { ...current.user, name: profile.data.name },
							}
						: current,
			);
		}
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
