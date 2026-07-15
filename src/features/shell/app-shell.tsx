import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { useRouter, useRouterState } from "@tanstack/solid-router";
import { createEffect, type JSX, onCleanup, onMount } from "solid-js";

import { authClient } from "../../lib/auth-client";
import { useI18n } from "../../lib/i18n/i18n";
import { setBrowserSentryActor } from "../../lib/sentry";
import { sessionQueryKey } from "../../lib/session-query";
import type { SafeSessionView } from "../../server/auth/session.server";
import { systemSettingsQueryOptions } from "../settings/system-queries";
import { resolveProtectedRoute } from "./route-registry";
import { Sidebar } from "./sidebar";
import { OPENED_TAB_PANEL_ID, OpenedTabs, openedTabDomId } from "./tabs";
import { Topbar } from "./topbar";
import { shellUiController, useShellUiSelector } from "./ui-store";

export interface AppShellProps {
	readonly children: JSX.Element;
	readonly session: SafeSessionView;
}

export function AppShell(props: AppShellProps) {
	const i18n = useI18n();
	const queryClient = useQueryClient();
	const router = useRouter();
	const href = useRouterState({ select: (state) => state.location.href });
	const settingsQuery = createQuery(systemSettingsQueryOptions);
	const activeTabKey = useShellUiSelector((state) => state.activeTabKey);
	const collapsed = useShellUiSelector((state) => state.sidebarCollapsed);
	const mobileOpen = useShellUiSelector((state) => state.mobileNavigationOpen);
	const tabs = useShellUiSelector((state) => state.openedTabs);

	const currentTabInput = () => {
		const match = resolveProtectedRoute(href());
		if (!match) return null;
		return {
			href: match.href,
			routeId: match.routeId,
			title: match.programId?.slice(0, 8) ?? match.fallbackTitle,
		};
	};

	onMount(() => {
		setBrowserSentryActor(props.session.user.id);
		onCleanup(() => setBrowserSentryActor(null));
		shellUiController.hydrateForAccount({
			accountId: props.session.user.id,
			currentTab: currentTabInput() ?? undefined,
			locale: props.session.metadata.locale,
		});
		createEffect(() => {
			const tab = currentTabInput();
			if (tab) shellUiController.openOrActivateTab(tab);
		});
	});

	const navigateTo = (target: string) => {
		void router.navigate({ href: target });
	};
	const signOut = async () => {
		const result = await authClient.signOut();
		if (result.error) throw new Error("SIGN_OUT_FAILED");
		setBrowserSentryActor(null);
		queryClient.removeQueries({ queryKey: sessionQueryKey });
		shellUiController.logout();
		await router.invalidate({ sync: true });
		await router.navigate({ to: "/login", search: { returnTo: "/programs" } });
	};

	return (
		<div class="flex h-dvh min-h-[480px] w-full overflow-hidden bg-white">
			<Sidebar
				collapsed={collapsed()}
				mobileOpen={mobileOpen()}
				onMobileOpenChange={shellUiController.setMobileNavigationOpen}
				systemName={
					settingsQuery.data?.data.systemName ?? i18n.t("common.appName")
				}
			/>
			<div class="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
				<Topbar
					collapsed={collapsed()}
					onNavigate={navigateTo}
					onOpenMobileNavigation={() =>
						shellUiController.setMobileNavigationOpen(true)
					}
					onSignOut={signOut}
					onToggleSidebar={shellUiController.toggleSidebar}
					repositoryUrl={settingsQuery.data?.data.repositoryUrl ?? null}
					user={props.session.user}
				/>
				<OpenedTabs
					activeKey={activeTabKey()}
					onActivate={(tab) => navigateTo(tab.href)}
					onClose={(tab) => {
						const result = shellUiController.closeTab(tab.key);
						if (result.navigateTo) navigateTo(result.navigateTo);
					}}
					tabs={tabs()}
				/>
				<main
					aria-labelledby={openedTabDomId(activeTabKey())}
					class="min-h-0 flex-1 overflow-y-auto bg-white"
					id={OPENED_TAB_PANEL_ID}
					role="tabpanel"
				>
					{props.children}
				</main>
				<span class="sr-only" aria-live="polite">
					{i18n.t("routes.programs.tabTitle")}
				</span>
			</div>
		</div>
	);
}
