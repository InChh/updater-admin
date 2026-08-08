import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { RefreshCw, Search, X } from "lucide-solid";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	For,
	on,
	Show,
} from "solid-js";

import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Pagination } from "../../components/ui/pagination";
import { TableShell } from "../../components/ui/table-shell";
import { auditQueryKeys } from "../../lib/api/query-keys";
import { useI18n } from "../../lib/i18n/i18n";
import {
	AUDIT_ACTIONS,
	AUDIT_PAGE_SIZES,
	AUDIT_RESOURCE_TYPES,
	AUDIT_RESULTS,
	type AuditAction,
	type AuditPageSize,
	type AuditResourceType,
	type AuditResult,
	type AuditSort,
} from "../../shared/api/audit";
import { AuditDetailDialog } from "./audit-detail-dialog";
import { AuditTable } from "./audit-table";
import {
	auditActionLabel,
	auditResourceLabel,
	auditResultLabel,
} from "./labels";
import { auditListQueryOptions } from "./queries";
import {
	type AuditRouteSearch,
	auditListSearch,
	closeAuditDetail,
	isCanonicalAuditEventId,
	openAuditDetail,
} from "./search";

export interface AuditSearchNavigationOptions {
	readonly replace?: boolean;
}

export interface AuditPageProps {
	readonly onSearchChange: (
		search: AuditRouteSearch,
		options?: AuditSearchNavigationOptions,
	) => void;
	readonly search: Accessor<AuditRouteSearch>;
}

function pageSizeFromNumber(value: number): AuditPageSize {
	return AUDIT_PAGE_SIZES.find((pageSize) => pageSize === value) ?? 20;
}

export function AuditPage(props: AuditPageProps) {
	const i18n = useI18n();
	const queryClient = useQueryClient();
	const listSearch = createMemo(() => auditListSearch(props.search()));
	const auditQuery = createQuery(() => auditListQueryOptions(listSearch()));
	const auditData = () => (auditQuery.isPending ? undefined : auditQuery.data);
	const [actorId, setActorId] = createSignal(props.search().actorId ?? "");
	const [from, setFrom] = createSignal(props.search().from ?? "");
	const [to, setTo] = createSignal(props.search().to ?? "");
	const [filterError, setFilterError] = createSignal<"actor" | "range">();
	const [dialogReturnFocus, setDialogReturnFocus] = createSignal<HTMLElement>();

	createEffect(() => {
		setActorId(props.search().actorId ?? "");
		setFrom(props.search().from ?? "");
		setTo(props.search().to ?? "");
	});
	createEffect(
		on(
			() => props.search().auditEventId,
			(eventId, previousEventId) => {
				if (previousEventId && !eventId) {
					queueMicrotask(() =>
						dialogReturnFocus()?.focus({ preventScroll: true }),
					);
				}
			},
			{ defer: true },
		),
	);
	const pageCount = () =>
		Math.max(1, Math.ceil((auditData()?.total ?? 0) / props.search().pageSize));
	createEffect(() => {
		if (
			auditData() &&
			!props.search().auditEventId &&
			props.search().page > pageCount() &&
			!auditQuery.isFetching
		) {
			props.onSearchChange(
				{ ...listSearch(), page: pageCount() },
				{ replace: true },
			);
		}
	});

	const updateListSearch = (
		patch: Partial<{
			action: AuditAction | null;
			actorId: null | string;
			from: null | string;
			page: number;
			pageSize: AuditPageSize;
			resourceType: AuditResourceType | null;
			result: AuditResult | null;
			sort: AuditSort;
			to: null | string;
		}>,
	) => {
		const current = listSearch();
		const action =
			patch.action === undefined ? current.action : (patch.action ?? undefined);
		const nextActorId =
			patch.actorId === undefined
				? current.actorId
				: (patch.actorId ?? undefined);
		const nextFrom =
			patch.from === undefined ? current.from : (patch.from ?? undefined);
		const resourceType =
			patch.resourceType === undefined
				? current.resourceType
				: (patch.resourceType ?? undefined);
		const result =
			patch.result === undefined ? current.result : (patch.result ?? undefined);
		const nextTo =
			patch.to === undefined ? current.to : (patch.to ?? undefined);
		props.onSearchChange({
			...(action ? { action } : {}),
			...(nextActorId ? { actorId: nextActorId } : {}),
			...(nextFrom ? { from: nextFrom } : {}),
			page: patch.page ?? current.page,
			pageSize: patch.pageSize ?? current.pageSize,
			...(resourceType ? { resourceType } : {}),
			...(result ? { result } : {}),
			sort: patch.sort ?? current.sort,
			...(nextTo ? { to: nextTo } : {}),
		});
	};
	const submitFilters = () => {
		const nextActorId = actorId().trim();
		if (nextActorId && !isCanonicalAuditEventId(nextActorId)) {
			setFilterError("actor");
			return;
		}
		if (from() && to() && from() > to()) {
			setFilterError("range");
			return;
		}
		setFilterError(undefined);
		updateListSearch({
			actorId: nextActorId || null,
			from: from() || null,
			page: 1,
			to: to() || null,
		});
	};
	const resetFilters = () => {
		setActorId("");
		setFrom("");
		setTo("");
		setFilterError(undefined);
		props.onSearchChange({
			page: 1,
			pageSize: props.search().pageSize,
			sort: "createdAt:desc",
		});
	};
	const refreshList = () =>
		queryClient.invalidateQueries({
			exact: true,
			queryKey: auditQueryKeys.list(listSearch()),
		});
	const rangeStart = () => {
		const total = auditData()?.total ?? 0;
		return total === 0
			? 0
			: (props.search().page - 1) * props.search().pageSize + 1;
	};
	const rangeEnd = () =>
		Math.min(
			props.search().page * props.search().pageSize,
			auditData()?.total ?? 0,
		);

	return (
		<div class="page-enter mx-auto w-full max-w-[1380px] px-5 py-7 lg:px-8 lg:py-9">
			<section aria-labelledby="audit-page-title" class="panel overflow-hidden">
				<header class="flex min-h-14 items-center border-b border-border px-5 py-3">
					<h1
						class="m-0 text-base font-semibold tracking-[-0.01em] text-ink"
						id="audit-page-title"
					>
						{i18n.t("pages.monitoringAudit.title")}
					</h1>
				</header>
				<div class="border-b border-border px-5 py-4">
					<form
						aria-label={i18n.t("audit.filters.title")}
						class="grid gap-3 md:grid-cols-2 xl:grid-cols-6 xl:items-end"
						onSubmit={(event) => {
							event.preventDefault();
							submitFilters();
						}}
					>
						<Field
							label={i18n.t("audit.filters.actor")}
							name="audit-actor-filter"
						>
							{(controlProps) => (
								<Input
									{...controlProps}
									aria-invalid={filterError() === "actor"}
									onInput={(event) => setActorId(event.currentTarget.value)}
									placeholder={i18n.t("audit.filters.actorPlaceholder")}
									value={actorId()}
								/>
							)}
						</Field>
						<Field
							label={i18n.t("audit.filters.action")}
							name="audit-action-filter"
						>
							{(controlProps) => (
								<select
									{...controlProps}
									class="h-9 w-full rounded-md border border-border-strong bg-white px-3 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/14"
									onChange={(event) =>
										updateListSearch({
											action:
												AUDIT_ACTIONS.find(
													(value) => value === event.currentTarget.value,
												) ?? null,
											page: 1,
										})
									}
								>
									<option selected={!props.search().action} value="">
										{i18n.t("audit.filters.all")}
									</option>
									<For each={AUDIT_ACTIONS}>
										{(action) => (
											<option
												selected={props.search().action === action}
												value={action}
											>
												{auditActionLabel(i18n, action)}
											</option>
										)}
									</For>
								</select>
							)}
						</Field>
						<Field
							label={i18n.t("audit.filters.resource")}
							name="audit-resource-filter"
						>
							{(controlProps) => (
								<select
									{...controlProps}
									class="h-9 w-full rounded-md border border-border-strong bg-white px-3 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/14"
									onChange={(event) =>
										updateListSearch({
											page: 1,
											resourceType:
												AUDIT_RESOURCE_TYPES.find(
													(value) => value === event.currentTarget.value,
												) ?? null,
										})
									}
								>
									<option selected={!props.search().resourceType} value="">
										{i18n.t("audit.filters.all")}
									</option>
									<For each={AUDIT_RESOURCE_TYPES}>
										{(resource) => (
											<option
												selected={props.search().resourceType === resource}
												value={resource}
											>
												{auditResourceLabel(i18n, resource)}
											</option>
										)}
									</For>
								</select>
							)}
						</Field>
						<Field
							label={i18n.t("audit.filters.result")}
							name="audit-result-filter"
						>
							{(controlProps) => (
								<select
									{...controlProps}
									class="h-9 w-full rounded-md border border-border-strong bg-white px-3 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/14"
									onChange={(event) =>
										updateListSearch({
											page: 1,
											result:
												AUDIT_RESULTS.find(
													(value) => value === event.currentTarget.value,
												) ?? null,
										})
									}
								>
									<option selected={!props.search().result} value="">
										{i18n.t("audit.filters.all")}
									</option>
									<For each={AUDIT_RESULTS}>
										{(result) => (
											<option
												selected={props.search().result === result}
												value={result}
											>
												{auditResultLabel(i18n, result)}
											</option>
										)}
									</For>
								</select>
							)}
						</Field>
						<Field
							label={i18n.t("audit.filters.from")}
							name="audit-from-filter"
						>
							{(controlProps) => (
								<Input
									{...controlProps}
									onInput={(event) => setFrom(event.currentTarget.value)}
									type="date"
									value={from()}
								/>
							)}
						</Field>
						<Field label={i18n.t("audit.filters.to")} name="audit-to-filter">
							{(controlProps) => (
								<Input
									{...controlProps}
									onInput={(event) => setTo(event.currentTarget.value)}
									type="date"
									value={to()}
								/>
							)}
						</Field>
						<div class="flex flex-wrap gap-2 md:col-span-2 xl:col-span-6 xl:justify-end">
							<Button type="button" variant="secondary" onClick={resetFilters}>
								<X aria-hidden="true" size={15} />
								{i18n.t("audit.filters.reset")}
							</Button>
							<Button type="submit">
								<Search aria-hidden="true" size={15} />
								{i18n.t("common.search")}
							</Button>
						</div>
						<Show when={filterError()}>
							{(error) => (
								<p
									class="m-0 text-xs text-danger md:col-span-2 xl:col-span-6"
									role="alert"
								>
									{i18n.t(
										error() === "actor"
											? "audit.filters.actorInvalid"
											: "audit.filters.rangeInvalid",
									)}
								</p>
							)}
						</Show>
					</form>
				</div>

				<TableShell
					class="rounded-none border-0 shadow-none"
					description={i18n.t("audit.table.description", {
						total: i18n.formatNumber(auditData()?.total ?? 0),
					})}
					footer={
						!auditQuery.isError || auditData() ? (
							<Pagination
								label={i18n.t("a11y.pagination")}
								nextLabel={i18n.t("pagination.next")}
								onPageChange={(page) => updateListSearch({ page })}
								onPageSizeChange={(pageSize) =>
									updateListSearch({
										page: 1,
										pageSize: pageSizeFromNumber(pageSize),
									})
								}
								page={props.search().page}
								pageCount={pageCount()}
								pageLabel={(page) => i18n.t("pagination.page", { page })}
								pageSize={props.search().pageSize}
								pageSizeLabel={i18n.t("pagination.pageSizeLabel")}
								pageSizeOptions={AUDIT_PAGE_SIZES}
								previousLabel={i18n.t("pagination.previous")}
								summary={i18n.t("pagination.rangeSummary", {
									from: i18n.formatNumber(rangeStart()),
									to: i18n.formatNumber(rangeEnd()),
									total: i18n.formatNumber(auditData()?.total ?? 0),
								})}
							/>
						) : undefined
					}
					title={i18n.t("audit.table.title")}
					toolbar={
						<Button
							aria-label={i18n.t("audit.actions.refresh")}
							class="h-8 w-8"
							disabled={auditQuery.isFetching}
							onClick={() => void refreshList()}
							size="icon"
							type="button"
							variant="ghost"
						>
							<RefreshCw
								aria-hidden="true"
								class={auditQuery.isFetching ? "animate-spin" : undefined}
								size={16}
							/>
						</Button>
					}
				>
					<Show
						when={!auditQuery.isError || auditData()}
						fallback={
							<div class="px-5 py-10 text-center text-sm text-danger">
								<p class="m-0">{i18n.formatApiError(auditQuery.error)}</p>
								<Button
									class="mt-3"
									onClick={() => void auditQuery.refetch()}
									size="sm"
									type="button"
									variant="secondary"
								>
									{i18n.t("common.retry")}
								</Button>
							</div>
						}
					>
						<AuditTable
							items={auditData()?.items ?? []}
							loading={auditQuery.isPending && !auditData()}
							onSortChange={(sort) => updateListSearch({ page: 1, sort })}
							onView={(event, trigger) => {
								setDialogReturnFocus(trigger);
								props.onSearchChange(openAuditDetail(props.search(), event.id));
							}}
							page={props.search().page}
							pageSize={props.search().pageSize}
							sort={props.search().sort}
							total={auditData()?.total ?? 0}
						/>
					</Show>
				</TableShell>
			</section>

			<AuditDetailDialog
				auditEventId={props.search().auditEventId}
				onClose={() =>
					props.onSearchChange(closeAuditDetail(props.search()), {
						replace: true,
					})
				}
			/>
		</div>
	);
}
