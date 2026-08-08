import { Show } from "solid-js";

import { useI18n } from "../../lib/i18n/i18n";
import { resolveProtectedRoute } from "./route-registry";

export interface NavigationStartedEvent {
	readonly pathChanged: boolean;
	readonly toHref: string;
}

export function pathnameFromHref(href: string): string {
	return href.split(/[?#]/, 1)[0] ?? href;
}

export function beginPathNavigation(
	currentHref: string | null,
	event: NavigationStartedEvent,
): string | null {
	return event.pathChanged ? event.toHref : currentHref;
}

export function completePathNavigation(
	currentHref: string | null,
	completedHref: string,
): string | null {
	return currentHref !== null &&
		pathnameFromHref(currentHref) === pathnameFromHref(completedHref)
		? null
		: currentHref;
}

export interface NavigationPendingPageProps {
	readonly href: string;
}

export function NavigationPendingPage(props: NavigationPendingPageProps) {
	const i18n = useI18n();
	const route = () => resolveProtectedRoute(props.href);
	const title = () => {
		const match = route();
		return match
			? i18n.t(match.pageTitleKey)
			: i18n.t("routes.programs.pageTitle");
	};

	return (
		<div
			aria-busy="true"
			class="page-enter mx-auto w-full max-w-[1280px] px-5 py-7 lg:px-8 lg:py-9"
			data-testid="navigation-pending-page"
		>
			<section
				aria-labelledby="navigation-pending-title"
				class="panel overflow-hidden"
			>
				<header class="flex min-h-14 items-center border-b border-border px-5 py-3">
					<h1
						class="m-0 text-base font-semibold tracking-[-0.01em] text-ink"
						id="navigation-pending-title"
					>
						{title()}
					</h1>
				</header>
				<div class="grid min-h-56 place-items-center px-6 py-10 text-sm text-muted">
					<output>{i18n.t("common.loading")}</output>
				</div>
			</section>
			<Show when={route()?.routeId === "programVersions"}>
				<span class="sr-only">{i18n.t("routes.programVersions.tabTitle")}</span>
			</Show>
		</div>
	);
}
