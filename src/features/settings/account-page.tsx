import { createQuery } from "@tanstack/solid-query";
import {
	CheckCircle2,
	Clock3,
	Laptop2,
	Mail,
	ShieldCheck,
	Smartphone,
	Unplug,
	UserRound,
} from "lucide-solid";
import { createSignal, For, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { notify } from "../../components/ui/toast";
import { authClient } from "../../lib/auth-client";
import { useI18n } from "../../lib/i18n/i18n";
import type { ProfileSessionSummaryDto } from "../../shared/api/profile";
import { profileQueryOptions } from "./queries";

export interface SessionLabelFallbacks {
	readonly unknownBrowser: string;
	readonly unknownClient: string;
	readonly unknownOs: string;
}

export function sessionLabel(
	userAgent: string | null,
	fallbacks: SessionLabelFallbacks,
): string {
	if (!userAgent) return fallbacks.unknownClient;
	const browser = userAgent.includes("Firefox/")
		? "Firefox"
		: userAgent.includes("Edg/")
			? "Microsoft Edge"
			: userAgent.includes("Chrome/")
				? "Chrome"
				: userAgent.includes("Safari/")
					? "Safari"
					: fallbacks.unknownBrowser;
	const platform = userAgent.includes("Android")
		? "Android"
		: userAgent.includes("iPhone") || userAgent.includes("iPad")
			? "iOS"
			: userAgent.includes("Mac OS")
				? "macOS"
				: userAgent.includes("Windows")
					? "Windows"
					: userAgent.includes("Linux")
						? "Linux"
						: fallbacks.unknownOs;
	return `${browser} · ${platform}`;
}

function isMobileSession(session: ProfileSessionSummaryDto): boolean {
	return /Android|iPhone|iPad/u.test(session.userAgent ?? "");
}

export function AccountPage() {
	const i18n = useI18n();
	const sessionLabelFallbacks = (): SessionLabelFallbacks => ({
		unknownBrowser: i18n.t("account.sessions.unknownBrowser"),
		unknownClient: i18n.t("account.sessions.unknownClient"),
		unknownOs: i18n.t("account.sessions.unknownOs"),
	});
	const profileQuery = createQuery(profileQueryOptions);
	const [revoking, setRevoking] = createSignal(false);
	const [revokeError, setRevokeError] = createSignal("");
	const revokeOtherSessions = async () => {
		setRevoking(true);
		setRevokeError("");
		try {
			const result = await authClient.revokeOtherSessions();
			if (result.error) throw new Error("REVOKE_OTHER_SESSIONS_FAILED");
			await profileQuery.refetch();
			notify(i18n.t("account.notifications.sessionsRevoked"));
		} catch (error) {
			setRevokeError(i18n.formatApiError(error));
		} finally {
			setRevoking(false);
		}
	};

	return (
		<div class="page-enter mx-auto w-full max-w-[980px] px-5 py-7 lg:px-8 lg:py-9">
			<section
				aria-labelledby="account-page-title"
				class="panel overflow-hidden"
			>
				<header class="flex min-h-14 items-center border-b border-border px-5 py-3">
					<h1
						class="m-0 text-base font-semibold tracking-[-0.01em] text-ink"
						id="account-page-title"
					>
						{i18n.t("pages.accountSettings.title")}
					</h1>
				</header>
				<Show
					when={!profileQuery.isError || profileQuery.data}
					fallback={
						<div class="grid min-h-64 place-items-center p-8 text-center">
							<div>
								<p class="m-0 text-sm text-danger" role="alert">
									{i18n.formatApiError(profileQuery.error)}
								</p>
								<Button
									class="mt-4"
									onClick={() => void profileQuery.refetch()}
									type="button"
									variant="secondary"
								>
									{i18n.t("common.retry")}
								</Button>
							</div>
						</div>
					}
				>
					<Show
						keyed
						when={profileQuery.data}
						fallback={
							<div class="grid min-h-64 place-items-center text-sm text-muted">
								{i18n.t("common.loading")}
							</div>
						}
					>
						{(profile) => (
							<div class="grid gap-6 p-5 lg:p-6">
								<section
									aria-labelledby="account-identity-title"
									class="grid gap-5 rounded-lg border border-border p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
								>
									<span class="grid h-14 w-14 place-items-center rounded-full bg-primary-soft text-primary-deep">
										<UserRound aria-hidden="true" size={26} />
									</span>
									<div class="min-w-0">
										<h2
											class="m-0 text-base font-semibold text-ink"
											id="account-identity-title"
										>
											{profile.data.name}
										</h2>
										<p class="m-0 mt-1 flex items-center gap-1.5 break-all text-sm text-muted">
											<Mail aria-hidden="true" class="shrink-0" size={14} />
											{profile.data.email}
										</p>
									</div>
									<div class="justify-self-start rounded-md border border-primary/15 bg-primary-soft px-3 py-2 sm:justify-self-end">
										<p class="m-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary-deep/70">
											{i18n.t("account.role")}
										</p>
										<p class="m-0 mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-primary-deep">
											<ShieldCheck aria-hidden="true" size={14} />
											admin
										</p>
									</div>
								</section>

								<section
									aria-labelledby="account-sessions-title"
									class="rounded-lg border border-border"
								>
									<header class="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
										<div>
											<h2
												class="m-0 text-sm font-semibold text-ink"
												id="account-sessions-title"
											>
												{i18n.t("account.sessions.title")}
											</h2>
											<p class="m-0 mt-1 text-xs text-muted">
												{i18n.t("account.sessions.description")}
											</p>
										</div>
										<Button
											disabled={
												revoking() || profile.data.otherSessions.length === 0
											}
											onClick={() => void revokeOtherSessions()}
											size="sm"
											type="button"
											variant="secondary"
										>
											<Unplug aria-hidden="true" size={14} />
											{revoking()
												? i18n.t("account.sessions.revoking")
												: i18n.t("account.sessions.revokeOthers")}
										</Button>
									</header>
									<Show when={revokeError()}>
										<p
											class="m-0 border-b border-danger/15 bg-danger/6 px-5 py-3 text-sm text-danger"
											role="alert"
										>
											{revokeError()}
										</p>
									</Show>
									<div class="divide-y divide-border">
										<div class="flex gap-3 px-5 py-4">
											<span class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary-soft text-primary-deep">
												<Laptop2 aria-hidden="true" size={18} />
											</span>
											<div class="min-w-0 flex-1">
												<div class="flex flex-wrap items-center gap-2">
													<p class="m-0 text-sm font-semibold text-ink">
														{i18n.t("account.sessions.current")}
													</p>
													<span class="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary-deep">
														<CheckCircle2 aria-hidden="true" size={11} />
														{i18n.t("account.sessions.activeNow")}
													</span>
												</div>
												<p class="m-0 mt-1 flex items-center gap-1.5 text-xs text-muted">
													<Clock3 aria-hidden="true" size={12} />
													{i18n.t("account.sessions.started", {
														date: i18n.formatDate(
															profile.data.currentSession.createdAt,
														),
													})}
												</p>
											</div>
										</div>
										<For each={profile.data.otherSessions}>
											{(session) => (
												<div class="flex gap-3 px-5 py-4">
													<span class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-mist text-muted">
														<Show
															when={isMobileSession(session)}
															fallback={
																<Laptop2 aria-hidden="true" size={18} />
															}
														>
															<Smartphone aria-hidden="true" size={18} />
														</Show>
													</span>
													<div class="min-w-0 flex-1">
														<p class="m-0 text-sm font-medium text-ink">
															{sessionLabel(
																session.userAgent,
																sessionLabelFallbacks(),
															)}
														</p>
														<p class="m-0 mt-1 text-xs text-muted">
															{session.ipAddress ??
																i18n.t("common.notAvailable")}{" "}
															·{" "}
															{i18n.t("account.sessions.lastActive", {
																date: i18n.formatDate(session.updatedAt),
															})}
														</p>
													</div>
												</div>
											)}
										</For>
										<Show when={profile.data.otherSessions.length === 0}>
											<p class="m-0 px-5 py-6 text-center text-sm text-muted">
												{i18n.t("account.sessions.noOthers")}
											</p>
										</Show>
									</div>
								</section>
							</div>
						)}
					</Show>
				</Show>
			</section>
		</div>
	);
}
