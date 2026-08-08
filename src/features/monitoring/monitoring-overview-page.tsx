import { createQuery, useQueryClient } from "@tanstack/solid-query";
import {
	Activity,
	Box,
	CheckCircle2,
	CircleAlert,
	Database,
	FileArchive,
	Gauge,
	History,
	Layers3,
	PackageOpen,
	RefreshCw,
	ServerCog,
} from "lucide-solid";
import { type Accessor, createMemo, For, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { monitoringQueryKeys } from "../../lib/api/query-keys";
import { useI18n } from "../../lib/i18n/i18n";
import { auditActionLabel, auditResultLabel } from "./labels";
import {
	monitoringStatusQueryOptions,
	releaseSeriesQueryOptions,
} from "./queries";
import { ReleaseTrendChart } from "./release-trend-chart";
import type { MonitoringRouteSearch } from "./search";

export interface MonitoringOverviewPageProps {
	readonly onSearchChange: (search: MonitoringRouteSearch) => void;
	readonly search: Accessor<MonitoringRouteSearch>;
}

function StatusBadge(props: { readonly status: "degraded" | "ready" }) {
	const i18n = useI18n();
	return (
		<span
			class="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold"
			classList={{
				"bg-danger/8 text-danger": props.status === "degraded",
				"bg-primary-soft text-primary-deep": props.status === "ready",
			}}
		>
			<Show
				when={props.status === "ready"}
				fallback={<CircleAlert aria-hidden="true" size={12} />}
			>
				<CheckCircle2 aria-hidden="true" size={12} />
			</Show>
			{i18n.t(
				props.status === "ready"
					? "monitoring.status.ready"
					: "monitoring.status.degraded",
			)}
		</span>
	);
}

export function MonitoringOverviewPage(props: MonitoringOverviewPageProps) {
	const i18n = useI18n();
	const queryClient = useQueryClient();
	const statusQuery = createQuery(() => monitoringStatusQueryOptions());
	const seriesQuery = createQuery(() =>
		releaseSeriesQueryOptions(props.search().days),
	);
	const statusData = () =>
		statusQuery.isPending ? undefined : statusQuery.data;
	const seriesData = () =>
		seriesQuery.isPending ? undefined : seriesQuery.data;
	const refreshing = () => statusQuery.isFetching || seriesQuery.isFetching;
	const refresh = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				exact: true,
				queryKey: monitoringQueryKeys.status(),
			}),
			queryClient.invalidateQueries({
				exact: true,
				queryKey: monitoringQueryKeys.releaseSeries(props.search().days),
			}),
		]);
	};
	const metrics = createMemo(() => statusData()?.metrics);
	const metricCards = createMemo(() => [
		{
			icon: Box,
			label: i18n.t("monitoring.metrics.programs"),
			value: metrics()?.programs,
		},
		{
			icon: Layers3,
			label: i18n.t("monitoring.metrics.versions"),
			value: metrics()?.versions,
		},
		{
			icon: Activity,
			label: i18n.t("monitoring.metrics.activeVersions"),
			value: metrics()?.activeVersions,
		},
		{
			icon: FileArchive,
			label: i18n.t("monitoring.metrics.files"),
			value: metrics()?.files,
		},
	]);
	const storageValue = () => {
		const value = metrics()?.totalBytes;
		return value === null || value === undefined
			? i18n.t("common.notAvailable")
			: i18n.formatBytes(Number(value));
	};

	return (
		<div class="page-enter mx-auto w-full max-w-[1280px] px-5 py-7 lg:px-8 lg:py-9">
			<section
				aria-labelledby="monitoring-page-title"
				class="panel overflow-hidden"
			>
				<header class="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
					<div class="flex items-center gap-3">
						<div class="grid h-9 w-9 place-items-center rounded-lg bg-primary-soft text-primary-deep">
							<Gauge aria-hidden="true" size={18} />
						</div>
						<div>
							<h1
								class="m-0 text-base font-semibold tracking-[-0.01em] text-ink"
								id="monitoring-page-title"
							>
								{i18n.t("pages.monitoringOverview.title")}
							</h1>
							<Show when={statusData()}>
								{(status) => (
									<p class="m-0 mt-0.5 text-xs text-muted">
										{i18n.t("monitoring.checkedAt", {
											date: i18n.formatDate(status().checkedAt),
										})}
									</p>
								)}
							</Show>
						</div>
					</div>
					<div class="flex items-center gap-2">
						<Show when={statusData()}>
							{(status) => <StatusBadge status={status().status} />}
						</Show>
						<Button
							aria-label={i18n.t("monitoring.actions.refresh")}
							disabled={refreshing()}
							onClick={() => void refresh()}
							size="sm"
							type="button"
							variant="secondary"
						>
							<RefreshCw
								aria-hidden="true"
								class={refreshing() ? "animate-spin" : undefined}
								size={15}
							/>
							{i18n.t("monitoring.actions.refresh")}
						</Button>
					</div>
				</header>

				<Show
					when={!statusQuery.isError || statusData()}
					fallback={
						<div class="m-5 rounded-lg border border-danger/20 bg-danger/5 px-4 py-5 text-sm text-danger">
							<p class="m-0">{i18n.formatApiError(statusQuery.error)}</p>
							<Button
								class="mt-3"
								onClick={() => void statusQuery.refetch()}
								size="sm"
								type="button"
								variant="secondary"
							>
								{i18n.t("common.retry")}
							</Button>
						</div>
					}
				>
					<Show
						when={statusData()}
						fallback={
							<div class="grid gap-4 p-5 md:grid-cols-2" aria-busy="true">
								<For each={[0, 1, 2, 3]}>
									{() => <div class="h-28 animate-pulse rounded-lg bg-mist" />}
								</For>
							</div>
						}
					>
						{(status) => (
							<div class="space-y-5 p-5">
								<section
									aria-labelledby="monitoring-application-title"
									class="overflow-hidden rounded-lg border border-primary/15 bg-primary-soft/35"
								>
									<header class="flex items-center gap-2.5 border-b border-primary/10 px-4 py-3">
										<PackageOpen
											aria-hidden="true"
											class="text-primary-deep"
											size={17}
										/>
										<h2
											class="m-0 text-sm font-semibold text-ink"
											id="monitoring-application-title"
										>
											{i18n.t("monitoring.application.title")}
										</h2>
									</header>
									<dl class="m-0 grid gap-px bg-primary/10 sm:grid-cols-2 xl:grid-cols-5">
										<For
											each={[
												{
													label: i18n.t("monitoring.application.name"),
													value: status().application.name,
												},
												{
													label: i18n.t("monitoring.application.version"),
													value: status().application.version,
												},
												{
													label: i18n.t("monitoring.application.environment"),
													value: status().application.environment,
												},
												{
													label: i18n.t("monitoring.application.commitRef"),
													value: status().application.commitRef,
												},
												{
													label: i18n.t("monitoring.application.buildId"),
													value: status().application.buildId,
												},
											]}
										>
											{(item) => (
												<div class="min-w-0 bg-white/85 px-4 py-3">
													<dt class="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
														{item.label}
													</dt>
													<dd class="m-0 mt-1 truncate font-mono text-xs font-semibold text-ink">
														{item.value ?? i18n.t("common.notAvailable")}
													</dd>
												</div>
											)}
										</For>
									</dl>
								</section>

								<div class="grid gap-3 lg:grid-cols-2">
									<For
										each={[
											{
												check: status().dependencies.neon,
												icon: Database,
												label: i18n.t("monitoring.dependencies.neon"),
											},
											{
												check: status().dependencies.ossSts,
												icon: ServerCog,
												label: i18n.t("monitoring.dependencies.ossSts"),
											},
										]}
									>
										{(dependency) => (
											<article class="relative overflow-hidden rounded-lg border border-border bg-white p-4">
												<div
													class="absolute inset-y-0 left-0 w-1 bg-primary"
													classList={{
														"bg-danger": dependency.check.status === "degraded",
													}}
												/>
												<div class="flex items-start justify-between gap-3 pl-1">
													<div class="flex items-center gap-2.5">
														<dependency.icon
															aria-hidden="true"
															class="text-muted"
															size={18}
														/>
														<h2 class="m-0 text-sm font-semibold text-ink">
															{dependency.label}
														</h2>
													</div>
													<StatusBadge status={dependency.check.status} />
												</div>
												<div class="mt-4 flex flex-wrap gap-x-6 gap-y-2 pl-1 text-xs text-muted">
													<span>
														{i18n.t("monitoring.latency", {
															latency: i18n.formatNumber(
																dependency.check.latencyMs,
															),
														})}
													</span>
													<span>
														{i18n.formatDate(dependency.check.checkedAt)}
													</span>
												</div>
											</article>
										)}
									</For>
								</div>

								<section aria-labelledby="monitoring-metrics-title">
									<div class="mb-3 flex items-center justify-between gap-3">
										<h2
											class="m-0 text-sm font-semibold text-ink"
											id="monitoring-metrics-title"
										>
											{i18n.t("monitoring.metrics.title")}
										</h2>
										<StatusBadge status={status().metrics.status} />
									</div>
									<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
										<For each={metricCards()}>
											{(metric) => (
												<article class="rounded-lg border border-border bg-mist/32 p-4">
													<metric.icon
														aria-hidden="true"
														class="text-primary-deep"
														size={17}
													/>
													<p class="m-0 mt-5 text-2xl font-semibold tabular-nums tracking-[-0.03em] text-ink">
														{metric.value === null || metric.value === undefined
															? i18n.t("common.notAvailable")
															: i18n.formatNumber(metric.value)}
													</p>
													<p class="m-0 mt-1 text-xs text-muted">
														{metric.label}
													</p>
												</article>
											)}
										</For>
										<article class="rounded-lg border border-border bg-mist/32 p-4">
											<FileArchive
												aria-hidden="true"
												class="text-primary-deep"
												size={17}
											/>
											<p class="m-0 mt-5 text-2xl font-semibold tabular-nums tracking-[-0.03em] text-ink">
												{storageValue()}
											</p>
											<p class="m-0 mt-1 text-xs text-muted">
												{i18n.t("monitoring.metrics.storage")}
											</p>
										</article>
									</div>
								</section>
							</div>
						)}
					</Show>
				</Show>

				<section
					aria-labelledby="release-series-title"
					class="border-t border-border px-5 py-5"
				>
					<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2
								class="m-0 text-sm font-semibold text-ink"
								id="release-series-title"
							>
								{i18n.t("monitoring.chart.title")}
							</h2>
							<p class="m-0 mt-1 text-xs text-muted">
								{i18n.t("monitoring.chart.subtitle")}
							</p>
						</div>
						<fieldset class="inline-flex rounded-md border border-border bg-mist/50 p-1">
							<legend class="sr-only">
								{i18n.t("monitoring.chart.windowLabel")}
							</legend>
							<For each={[7, 30, 90] as const}>
								{(days) => (
									<button
										aria-pressed={props.search().days === days}
										class="h-8 rounded px-3 text-xs font-semibold text-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
										classList={{
											"bg-white text-primary-deep shadow-sm":
												props.search().days === days,
										}}
										onClick={() => props.onSearchChange({ days })}
										type="button"
									>
										{i18n.t("monitoring.chart.days", { days })}
									</button>
								)}
							</For>
						</fieldset>
					</div>
					<Show
						when={!seriesQuery.isError || seriesData()}
						fallback={
							<div class="rounded-lg border border-danger/20 bg-danger/5 px-4 py-5 text-sm text-danger">
								<p class="m-0">{i18n.formatApiError(seriesQuery.error)}</p>
								<Button
									class="mt-3"
									onClick={() => void seriesQuery.refetch()}
									size="sm"
									type="button"
									variant="secondary"
								>
									{i18n.t("common.retry")}
								</Button>
							</div>
						}
					>
						<Show
							when={seriesData()}
							fallback={
								<div
									class="h-72 animate-pulse rounded-lg bg-mist"
									aria-busy="true"
								/>
							}
						>
							{(series) => <ReleaseTrendChart series={series()} />}
						</Show>
					</Show>
				</section>

				<Show when={statusData()}>
					{(status) => (
						<section
							aria-labelledby="recent-operations-title"
							class="border-t border-border px-5 py-5"
						>
							<div class="mb-3 flex items-center justify-between gap-3">
								<h2
									class="m-0 flex items-center gap-2 text-sm font-semibold text-ink"
									id="recent-operations-title"
								>
									<History aria-hidden="true" size={16} />
									{i18n.t("monitoring.recent.title")}
								</h2>
								<StatusBadge status={status().recentOperations.status} />
							</div>
							<Show
								when={status().recentOperations.items.length > 0}
								fallback={
									<p class="m-0 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
										{i18n.t("monitoring.recent.empty")}
									</p>
								}
							>
								<ul class="m-0 divide-y divide-border rounded-lg border border-border p-0">
									<For each={status().recentOperations.items}>
										{(event) => (
											<li class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
												<div class="min-w-0">
													<p class="m-0 truncate font-medium text-ink">
														{auditActionLabel(i18n, event.action)}
													</p>
													<p class="m-0 mt-0.5 truncate text-xs text-muted">
														{event.resourceId}
													</p>
												</div>
												<div class="flex items-center gap-3">
													<span
														classList={{
															"text-danger": event.result === "failure",
															"text-primary-deep": event.result === "success",
														}}
														class="text-xs font-semibold"
													>
														{auditResultLabel(i18n, event.result)}
													</span>
													<time
														class="whitespace-nowrap text-xs text-muted"
														dateTime={event.createdAt}
													>
														{i18n.formatDate(event.createdAt)}
													</time>
												</div>
											</li>
										)}
									</For>
								</ul>
							</Show>
						</section>
					)}
				</Show>
			</section>
		</div>
	);
}
