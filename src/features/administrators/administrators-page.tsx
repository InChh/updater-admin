import { createQuery } from "@tanstack/solid-query";
import { Plus, RefreshCw, Search, X } from "lucide-solid";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	on,
	Show,
} from "solid-js";

import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Pagination } from "../../components/ui/pagination";
import { TableShell } from "../../components/ui/table-shell";
import { useI18n } from "../../lib/i18n/i18n";
import {
	ADMINISTRATOR_PAGE_SIZES,
	type AdministratorPageSize,
	type AdministratorSort,
	type AdministratorStatus,
} from "../../shared/api/administrators";
import { AdministratorDialogs } from "./administrator-dialogs";
import { AdministratorTable } from "./administrator-table";
import { administratorListQueryOptions } from "./queries";
import {
	type AdministratorRouteSearch,
	administratorListSearch,
	closeAdministratorDialog,
	openAdministratorDialog,
	openCreateAdministratorDialog,
} from "./search";

export interface AdministratorSearchNavigationOptions {
	readonly replace?: boolean;
}

export interface AdministratorsPageProps {
	readonly currentAdministratorId: string;
	readonly onSearchChange: (
		search: AdministratorRouteSearch,
		options?: AdministratorSearchNavigationOptions,
	) => void;
	readonly search: Accessor<AdministratorRouteSearch>;
}

function pageSizeFromNumber(value: number): AdministratorPageSize {
	return ADMINISTRATOR_PAGE_SIZES.find((pageSize) => pageSize === value) ?? 20;
}

export function AdministratorsPage(props: AdministratorsPageProps) {
	const i18n = useI18n();
	const listSearch = createMemo(() => administratorListSearch(props.search()));
	const administratorsQuery = createQuery(() =>
		administratorListQueryOptions(listSearch()),
	);
	const administratorsData = () =>
		administratorsQuery.isPending ? undefined : administratorsQuery.data;
	const [filterQuery, setFilterQuery] = createSignal(
		props.search().query ?? "",
	);
	const [dialogReturnFocus, setDialogReturnFocus] = createSignal<HTMLElement>();
	let createButton: HTMLButtonElement | undefined;

	createEffect(() => setFilterQuery(props.search().query ?? ""));
	const pageCount = () =>
		Math.max(
			1,
			Math.ceil((administratorsData()?.total ?? 0) / props.search().pageSize),
		);
	createEffect(() => {
		if (
			administratorsData() &&
			!props.search().dialog &&
			props.search().page > pageCount() &&
			!administratorsQuery.isFetching
		) {
			props.onSearchChange(
				{ ...administratorListSearch(props.search()), page: pageCount() },
				{ replace: true },
			);
		}
	});

	const updateListSearch = (
		patch: Partial<{
			page: number;
			pageSize: AdministratorPageSize;
			query: null | string;
			sort: AdministratorSort;
			status: AdministratorStatus | null;
		}>,
	) => {
		const current = administratorListSearch(props.search());
		const query =
			patch.query === undefined ? current.query : (patch.query ?? undefined);
		const status =
			patch.status === undefined ? current.status : (patch.status ?? undefined);
		props.onSearchChange({
			page: patch.page ?? current.page,
			pageSize: patch.pageSize ?? current.pageSize,
			...(query ? { query } : {}),
			sort: patch.sort ?? current.sort,
			...(status ? { status } : {}),
		});
	};
	const submitFilter = () => {
		const query = filterQuery().trim();
		updateListSearch({ page: 1, query: query || null });
	};
	const resetFilter = () => {
		setFilterQuery("");
		updateListSearch({ page: 1, query: null, status: null });
	};
	const closeDialog = () =>
		props.onSearchChange(closeAdministratorDialog(props.search()), {
			replace: true,
		});
	const restoreDialogFocus = () => {
		const preferred = dialogReturnFocus();
		const target = preferred?.isConnected ? preferred : createButton;
		target?.focus({ preventScroll: true });
		setDialogReturnFocus(undefined);
	};
	createEffect(
		on(
			() => props.search().dialog,
			(dialog, previousDialog) => {
				if (previousDialog && !dialog) queueMicrotask(restoreDialogFocus);
			},
			{ defer: true },
		),
	);
	const selectedAdministrator = createMemo(() =>
		administratorsData()?.items.find(
			(administrator) => administrator.id === props.search().administratorId,
		),
	);
	const rangeStart = () => {
		const total = administratorsData()?.total ?? 0;
		return total === 0
			? 0
			: (props.search().page - 1) * props.search().pageSize + 1;
	};
	const rangeEnd = () =>
		Math.min(
			props.search().page * props.search().pageSize,
			administratorsData()?.total ?? 0,
		);

	return (
		<div class="page-enter mx-auto w-full max-w-[1280px] px-5 py-7 lg:px-8 lg:py-9">
			<section
				aria-labelledby="administrators-page-title"
				class="panel overflow-hidden"
			>
				<header class="flex min-h-14 items-center border-b border-border px-5 py-3">
					<h1
						class="m-0 text-base font-semibold tracking-[-0.01em] text-ink"
						id="administrators-page-title"
					>
						{i18n.t("pages.administrators.title")}
					</h1>
				</header>
				<div class="border-b border-border px-5 py-4">
					<form
						aria-label={i18n.t("administrators.filters.title")}
						class="flex flex-col gap-3 md:flex-row md:items-end"
						onSubmit={(event) => {
							event.preventDefault();
							submitFilter();
						}}
					>
						<Field
							class="w-full md:max-w-sm"
							label={i18n.t("administrators.filters.query")}
							name="administrator-query-filter"
						>
							{(controlProps) => (
								<Input
									{...controlProps}
									onInput={(event) => setFilterQuery(event.currentTarget.value)}
									placeholder={i18n.t(
										"administrators.filters.queryPlaceholder",
									)}
									value={filterQuery()}
								/>
							)}
						</Field>
						<Field
							class="w-full md:w-44"
							label={i18n.t("table.status")}
							name="administrator-status-filter"
						>
							{(controlProps) => (
								<select
									{...controlProps}
									class="h-9 w-full rounded-md border border-border-strong bg-white px-3 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/14"
									onChange={(event) =>
										updateListSearch({
											page: 1,
											status:
												event.currentTarget.value === "active" ||
												event.currentTarget.value === "disabled"
													? event.currentTarget.value
													: null,
										})
									}
									value={props.search().status ?? ""}
								>
									<option value="">
										{i18n.t("administrators.filters.all")}
									</option>
									<option value="active">
										{i18n.t("administrators.status.active")}
									</option>
									<option value="disabled">
										{i18n.t("administrators.status.disabled")}
									</option>
								</select>
							)}
						</Field>
						<div class="flex gap-2 md:ml-auto">
							<Button type="button" variant="secondary" onClick={resetFilter}>
								<X aria-hidden="true" size={15} />
								{i18n.t("administrators.filters.reset")}
							</Button>
							<Button type="submit">
								<Search aria-hidden="true" size={15} />
								{i18n.t("common.search")}
							</Button>
						</div>
					</form>
				</div>

				<TableShell
					class="rounded-none border-0 shadow-none"
					description={i18n.t("administrators.table.description", {
						total: i18n.formatNumber(administratorsData()?.total ?? 0),
					})}
					footer={
						!administratorsQuery.isError || administratorsData() ? (
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
								pageSizeOptions={ADMINISTRATOR_PAGE_SIZES}
								previousLabel={i18n.t("pagination.previous")}
								summary={i18n.t("pagination.rangeSummary", {
									from: i18n.formatNumber(rangeStart()),
									to: i18n.formatNumber(rangeEnd()),
									total: i18n.formatNumber(administratorsData()?.total ?? 0),
								})}
							/>
						) : undefined
					}
					title={i18n.t("administrators.table.title")}
					toolbar={
						<div class="flex items-center gap-1">
							<Button
								onClick={(event) => {
									setDialogReturnFocus(event.currentTarget);
									props.onSearchChange(
										openCreateAdministratorDialog(props.search()),
									);
								}}
								ref={createButton}
								size="sm"
								type="button"
							>
								<Plus aria-hidden="true" size={15} />
								{i18n.t("common.create")}
							</Button>
							<Button
								aria-label={i18n.t("administrators.actions.refresh")}
								class="h-8 w-8"
								onClick={() => void administratorsQuery.refetch()}
								size="icon"
								type="button"
								variant="ghost"
							>
								<RefreshCw
									aria-hidden="true"
									classList={{ "animate-spin": administratorsQuery.isFetching }}
									size={15}
								/>
							</Button>
						</div>
					}
				>
					<Show
						when={!administratorsQuery.isError || administratorsData()}
						fallback={
							<div class="grid min-h-56 place-items-center px-6 py-10 text-center">
								<div>
									<p class="m-0 text-sm text-danger" role="alert">
										{i18n.formatApiError(administratorsQuery.error)}
									</p>
									<Button
										class="mt-4"
										onClick={() => void administratorsQuery.refetch()}
										type="button"
										variant="secondary"
									>
										{i18n.t("common.retry")}
									</Button>
								</div>
							</div>
						}
					>
						<AdministratorTable
							currentAdministratorId={props.currentAdministratorId}
							items={administratorsData()?.items ?? []}
							loading={administratorsQuery.isPending}
							onResetPassword={(administrator, trigger) => {
								setDialogReturnFocus(trigger);
								props.onSearchChange(
									openAdministratorDialog(
										props.search(),
										"reset",
										administrator.id,
									),
								);
							}}
							onRevokeSessions={(administrator, trigger) => {
								setDialogReturnFocus(trigger);
								props.onSearchChange(
									openAdministratorDialog(
										props.search(),
										"revoke",
										administrator.id,
									),
								);
							}}
							onSetEnabled={(administrator, trigger) => {
								setDialogReturnFocus(trigger);
								props.onSearchChange(
									openAdministratorDialog(
										props.search(),
										administrator.enabled ? "disable" : "enable",
										administrator.id,
									),
								);
							}}
							onSortChange={(sort) => updateListSearch({ page: 1, sort })}
							page={props.search().page}
							pageSize={props.search().pageSize}
							sort={props.search().sort}
							total={administratorsData()?.total ?? 0}
						/>
					</Show>
				</TableShell>
			</section>

			<AdministratorDialogs
				administrator={selectedAdministrator()}
				dialog={props.search().dialog}
				onClose={closeDialog}
				onRestoreFocus={restoreDialogFocus}
			/>
		</div>
	);
}
