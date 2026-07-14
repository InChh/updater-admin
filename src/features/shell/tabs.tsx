import { X } from "lucide-solid";
import { For, Show } from "solid-js";

import { useI18n } from "../../lib/i18n/i18n";
import { PROTECTED_ROUTE_REGISTRY } from "./route-registry";
import type { OpenedTab } from "./ui-store";

export interface OpenedTabsProps {
	readonly activeKey: string;
	readonly onActivate: (tab: OpenedTab) => void;
	readonly onClose: (tab: OpenedTab) => void;
	readonly tabs: readonly OpenedTab[];
}

export const OPENED_TAB_PANEL_ID = "main-content";

export function openedTabDomId(key: string): string {
	return `opened-tab-${key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function focusTab(
	event: KeyboardEvent,
	index: number,
	tabCount: number,
): number | null {
	let nextIndex: number | null = null;
	switch (event.key) {
		case "ArrowLeft":
			nextIndex = (index - 1 + tabCount) % tabCount;
			break;
		case "ArrowRight":
			nextIndex = (index + 1) % tabCount;
			break;
		case "Home":
			nextIndex = 0;
			break;
		case "End":
			nextIndex = tabCount - 1;
			break;
		default:
			return null;
	}
	event.preventDefault();
	const tabList = (event.currentTarget as HTMLElement).closest(
		'[role="tablist"]',
	);
	const tabs = tabList?.querySelectorAll<HTMLElement>('[role="tab"]');
	tabs?.[nextIndex]?.focus();
	return nextIndex;
}

export function OpenedTabs(props: OpenedTabsProps) {
	const i18n = useI18n();
	const title = (tab: OpenedTab) => {
		const definition = PROTECTED_ROUTE_REGISTRY[tab.routeId];
		const translated = i18n.t(definition.tabTitleKey);
		return tab.routeId === "programVersions"
			? `${translated} · ${tab.title}`
			: translated;
	};
	const plainNavigation = (event: MouseEvent) =>
		event.button === 0 &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.shiftKey;
	const closeAndRestoreFocus = (tab: OpenedTab, index: number) => {
		const activeFallback = props.tabs.find(
			(candidate) =>
				candidate.key === props.activeKey && candidate.key !== tab.key,
		);
		const fallback =
			activeFallback ?? props.tabs[index - 1] ?? props.tabs[index + 1];
		props.onClose(tab);
		if (!fallback) return;
		queueMicrotask(() => {
			document.getElementById(openedTabDomId(fallback.key))?.focus();
		});
	};

	return (
		<div class="h-[42px] shrink-0 overflow-hidden border-b border-border bg-white">
			<div
				aria-label={i18n.t("nav.management")}
				class="flex h-full items-end gap-1 overflow-x-auto px-2 pt-1 [scrollbar-width:thin] sm:px-3"
				role="tablist"
			>
				<For each={props.tabs}>
					{(tab, index) => {
						const active = () => tab.key === props.activeKey;
						return (
							<div
								class="group flex h-9 min-w-max items-center rounded-t-md border border-b-0 px-1 transition-colors"
								classList={{
									"border-border bg-white text-primary-deep": active(),
									"border-transparent bg-mist/70 text-muted hover:bg-mist hover:text-ink":
										!active(),
								}}
							>
								<a
									aria-controls={OPENED_TAB_PANEL_ID}
									aria-selected={active()}
									class="relative flex h-full max-w-56 items-center px-2.5 text-xs font-medium no-underline outline-none after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t after:bg-primary after:opacity-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-deep"
									classList={{ "after:opacity-100": active() }}
									href={tab.href}
									id={openedTabDomId(tab.key)}
									onClick={(event) => {
										if (!plainNavigation(event)) return;
										event.preventDefault();
										props.onActivate(tab);
									}}
									onKeyDown={(event) => {
										if (event.key === "Delete" && tab.closable) {
											event.preventDefault();
											closeAndRestoreFocus(tab, index());
											return;
										}
										const nextIndex = focusTab(
											event,
											index(),
											props.tabs.length,
										);
										if (nextIndex !== null) {
											props.onActivate(props.tabs[nextIndex]);
										}
									}}
									role="tab"
									tabIndex={active() ? 0 : -1}
									title={title(tab)}
								>
									<span class="truncate">{title(tab)}</span>
								</a>
								<Show when={tab.closable}>
									<button
										aria-label={i18n.t("a11y.closeTab", { title: title(tab) })}
										class="grid h-7 w-7 place-items-center rounded text-muted/75 opacity-70 transition hover:bg-border hover:text-ink hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep group-hover:opacity-100"
										onClick={() => closeAndRestoreFocus(tab, index())}
										type="button"
									>
										<X aria-hidden="true" size={13} />
									</button>
								</Show>
							</div>
						);
					}}
				</For>
			</div>
		</div>
	);
}
