import { Link } from "@tanstack/solid-router";
import {
	GitFork,
	Languages,
	Menu,
	PanelLeftClose,
	PanelLeftOpen,
	Settings,
	UserRound,
} from "lucide-solid";
import { createSignal, Show } from "solid-js";

import {
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuRoot,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { notify } from "../../components/ui/toast";
import { Tooltip } from "../../components/ui/tooltip";
import { useI18n } from "../../lib/i18n/i18n";

export interface TopbarUser {
	readonly email: string;
	readonly image: string | null;
	readonly name: string;
}

export interface TopbarProps {
	readonly collapsed: boolean;
	readonly onNavigate: (href: string) => void;
	readonly onOpenMobileNavigation: () => void;
	readonly onSignOut: () => Promise<void> | void;
	readonly onToggleSidebar: () => void;
	readonly repositoryUrl: string | null;
	readonly user: TopbarUser;
}

export async function runSignOut(
	onSignOut: () => Promise<void> | void,
	onError: (error: unknown) => void,
): Promise<void> {
	try {
		await onSignOut();
	} catch (error) {
		onError(error);
	}
}

/**
 * Treat the settings response as untrusted browser input before exposing an
 * external navigation target. The server applies the same HTTPS/no-userinfo
 * policy, while this boundary fails closed for malformed cached responses.
 */
export function safeExternalRepositoryUrl(value: unknown): string | null {
	if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
		return null;
	}
	try {
		const parsed = new URL(value);
		if (
			parsed.protocol !== "https:" ||
			!parsed.hostname ||
			parsed.username ||
			parsed.password
		) {
			return null;
		}
		return parsed.href;
	} catch {
		return null;
	}
}

function IconButton(props: {
	readonly children: import("solid-js").JSX.Element;
	readonly label: string;
	readonly onClick?: () => void;
}) {
	return (
		<Tooltip content={props.label}>
			<button
				aria-label={props.label}
				class="grid h-9 w-9 place-items-center rounded-md border-0 bg-transparent text-muted transition hover:bg-mist hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
				onClick={props.onClick}
				type="button"
			>
				{props.children}
			</button>
		</Tooltip>
	);
}

export function Topbar(props: TopbarProps) {
	const i18n = useI18n();
	const repositoryUrl = () => safeExternalRepositoryUrl(props.repositoryUrl);
	const [signingOut, setSigningOut] = createSignal(false);
	const signOut = async () => {
		if (signingOut()) return;
		setSigningOut(true);
		try {
			await runSignOut(props.onSignOut, () => {
				notify(i18n.t("auth.signOut.failed"), undefined, "error");
			});
		} finally {
			setSigningOut(false);
		}
	};
	return (
		<header class="flex h-14 shrink-0 items-center justify-between border-b border-border bg-white px-3 sm:px-4">
			<div class="flex items-center gap-1">
				<div class="lg:hidden">
					<IconButton
						label={i18n.t("a11y.openNavigation")}
						onClick={props.onOpenMobileNavigation}
					>
						<Menu aria-hidden="true" size={19} />
					</IconButton>
				</div>
				<div class="hidden lg:block">
					<IconButton
						label={i18n.t(
							props.collapsed ? "a11y.expandSidebar" : "a11y.collapseSidebar",
						)}
						onClick={props.onToggleSidebar}
					>
						<Show
							when={props.collapsed}
							fallback={<PanelLeftClose aria-hidden="true" size={18} />}
						>
							<PanelLeftOpen aria-hidden="true" size={18} />
						</Show>
					</IconButton>
				</div>
			</div>

			<div class="flex items-center gap-1">
				<Show keyed when={repositoryUrl()}>
					{(href) => (
						<Tooltip content={i18n.t("common.repository")}>
							<a
								aria-label={i18n.t("a11y.openRepository")}
								class="grid h-9 w-9 place-items-center rounded-md text-muted no-underline transition hover:bg-mist hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
								href={href}
								referrerpolicy="no-referrer"
								rel="noopener noreferrer"
								target="_blank"
							>
								<GitFork aria-hidden="true" size={18} />
							</a>
						</Tooltip>
					)}
				</Show>
				<DropdownMenuRoot placement="bottom-end">
					<DropdownMenuTrigger
						aria-label={i18n.t("a11y.languageMenu")}
						class="grid h-9 min-w-9 place-items-center rounded-md border-0 bg-transparent px-2 text-muted transition hover:bg-mist hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
					>
						<span class="flex items-center gap-1.5">
							<Languages aria-hidden="true" size={18} />
							<span class="hidden text-xs font-semibold sm:inline">
								{i18n.locale() === "zh-CN" ? "中" : "EN"}
							</span>
						</span>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuRadioGroup
							onChange={(locale) => {
								void i18n
									.setLocale(locale === "en" ? "en" : "zh-CN")
									.catch((error) =>
										notify(i18n.formatApiError(error), undefined, "error"),
									);
							}}
							value={i18n.locale()}
						>
							<DropdownMenuRadioItem value="zh-CN">
								<span aria-hidden="true">🇨🇳</span>
								<span>中文</span>
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="en">
								<span aria-hidden="true">🇬🇧</span>
								<span>English</span>
							</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenuRoot>

				<Tooltip content={i18n.t("common.settings")}>
					<Link
						aria-label={i18n.t("common.settings")}
						class="grid h-9 w-9 place-items-center rounded-md text-muted no-underline transition hover:bg-mist hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
						to="/settings/system"
					>
						<Settings aria-hidden="true" size={18} />
					</Link>
				</Tooltip>

				<DropdownMenuRoot placement="bottom-end">
					<DropdownMenuTrigger
						aria-label={i18n.t("a11y.accountMenu")}
						class="ml-1 grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-border bg-mist text-ink transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
					>
						<Show
							when={props.user.image}
							fallback={<UserRound aria-hidden="true" size={18} />}
						>
							{(image) => (
								<img alt="" class="h-full w-full object-cover" src={image()} />
							)}
						</Show>
					</DropdownMenuTrigger>
					<DropdownMenuContent class="w-56">
						<div class="px-2.5 py-2">
							<p class="m-0 truncate text-sm font-semibold text-ink">
								{props.user.name}
							</p>
							<p class="m-0 mt-0.5 truncate text-xs text-muted">
								{props.user.email}
							</p>
						</div>
						<DropdownMenuSeparator class="my-1 h-px bg-border" />
						<DropdownMenuItem
							onSelect={() => props.onNavigate("/settings/profile")}
						>
							{i18n.t("nav.profileSettings")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => props.onNavigate("/settings/account")}
						>
							{i18n.t("common.account")}
						</DropdownMenuItem>
						<DropdownMenuSeparator class="my-1 h-px bg-border" />
						<DropdownMenuItem
							class="text-danger data-[highlighted]:bg-danger/8 data-[highlighted]:text-danger"
							disabled={signingOut()}
							onSelect={() => void signOut()}
						>
							{i18n.t(
								signingOut() ? "auth.signOut.submitting" : "common.signOut",
							)}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenuRoot>
			</div>
		</header>
	);
}
