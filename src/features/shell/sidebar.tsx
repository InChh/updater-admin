import { Dialog } from "@kobalte/core/dialog";
import { Link } from "@tanstack/solid-router";
import {
	Activity,
	BookOpenCheck,
	Boxes,
	Code2,
	Settings,
	ShieldCheck,
	UserRoundCog,
	X,
} from "lucide-solid";
import { For, type JSX, Show } from "solid-js";

import { type MessageKey, useI18n } from "../../lib/i18n/i18n";

interface SidebarNavItem {
	readonly icon: (props: { class?: string; size?: number }) => JSX.Element;
	readonly labelKey: MessageKey;
	readonly to:
		| "/administrators"
		| "/monitoring/audit"
		| "/monitoring/overview"
		| "/programs"
		| "/settings/account"
		| "/settings/profile"
		| "/settings/system";
}

const primaryItems: readonly SidebarNavItem[] = [
	{ icon: Boxes, labelKey: "nav.programs", to: "/programs" },
];

const managementItems: readonly SidebarNavItem[] = [
	{
		icon: ShieldCheck,
		labelKey: "nav.administrators",
		to: "/administrators",
	},
	{
		icon: Activity,
		labelKey: "nav.monitoring",
		to: "/monitoring/overview",
	},
	{ icon: BookOpenCheck, labelKey: "nav.audit", to: "/monitoring/audit" },
	{
		icon: UserRoundCog,
		labelKey: "nav.profileSettings",
		to: "/settings/profile",
	},
	{
		icon: Settings,
		labelKey: "nav.systemSettings",
		to: "/settings/system",
	},
];

export interface SidebarProps {
	readonly collapsed: boolean;
	readonly mobileOpen: boolean;
	readonly onMobileOpenChange: (open: boolean) => void;
}

interface SidebarBodyProps {
	readonly collapsed: boolean;
	readonly onNavigate?: () => void;
}

function SidebarBody(props: SidebarBodyProps) {
	const i18n = useI18n();
	const item = (navItem: SidebarNavItem) => (
		<Link
			activeProps={{
				class:
					"bg-primary-soft text-primary-deep before:absolute before:bottom-2 before:left-0 before:top-2 before:w-[3px] before:rounded-r before:bg-primary",
			}}
			aria-label={props.collapsed ? i18n.t(navItem.labelKey) : undefined}
			class="relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted no-underline transition-colors hover:bg-mist hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep focus-visible:ring-inset"
			onClick={props.onNavigate}
			title={props.collapsed ? i18n.t(navItem.labelKey) : undefined}
			to={navItem.to}
		>
			<navItem.icon class="shrink-0" size={18} />
			<Show when={!props.collapsed}>
				<span class="truncate">{i18n.t(navItem.labelKey)}</span>
			</Show>
		</Link>
	);
	return (
		<div class="flex h-full min-h-0 flex-col bg-white">
			<div class="flex h-14 shrink-0 items-center gap-3 px-3">
				<div class="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] bg-primary text-white shadow-[0_4px_14px_rgba(0,168,112,0.2)]">
					<Code2 aria-hidden="true" size={22} stroke-width={2.4} />
				</div>
				<Show when={!props.collapsed}>
					<span class="truncate text-[16px] font-semibold tracking-[-0.01em] text-primary-deep">
						{i18n.t("common.appName")}
					</span>
				</Show>
			</div>
			<nav
				aria-label={i18n.t("nav.management")}
				class="min-h-0 flex-1 overflow-y-auto px-2 py-2"
			>
				<div class="grid gap-1">
					<For each={primaryItems}>{item}</For>
				</div>
				<Show when={!props.collapsed}>
					<p class="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted/65">
						{i18n.t("nav.management")}
					</p>
				</Show>
				<div class="grid gap-1">
					<For each={managementItems}>{item}</For>
				</div>
			</nav>
		</div>
	);
}

export function Sidebar(props: SidebarProps) {
	const i18n = useI18n();
	return (
		<>
			<aside
				class="hidden h-dvh shrink-0 border-r border-border bg-white transition-[width] duration-150 lg:block"
				style={{ width: props.collapsed ? "64px" : "232px" }}
			>
				<SidebarBody collapsed={props.collapsed} />
			</aside>
			<Dialog open={props.mobileOpen} onOpenChange={props.onMobileOpenChange}>
				<Dialog.Portal>
					<Dialog.Overlay class="fixed inset-0 z-50 bg-ink/35 data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 lg:hidden" />
					<Dialog.Content class="fixed inset-y-0 left-0 z-50 w-[min(86vw,280px)] border-r border-border bg-white shadow-[12px_0_38px_rgba(31,45,53,0.16)] outline-none data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:slide-out-to-left data-[expanded]:slide-in-from-left lg:hidden">
						<Dialog.Title class="sr-only">
							{i18n.t("nav.management")}
						</Dialog.Title>
						<Dialog.CloseButton
							aria-label={i18n.t("a11y.closeNavigation")}
							class="absolute right-2 top-2 z-10 grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-mist hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
						>
							<X aria-hidden="true" size={18} />
						</Dialog.CloseButton>
						<SidebarBody
							collapsed={false}
							onNavigate={() => props.onMobileOpenChange(false)}
						/>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog>
		</>
	);
}
