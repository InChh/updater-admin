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
	PROGRAM_PAGE_SIZES,
	type ProgramPageSize,
	type ProgramSort,
} from "../../shared/api/programs";
import { ProgramDialogs } from "./program-dialogs";
import { ProgramTable } from "./program-table";
import { programListQueryOptions } from "./queries";
import {
	closeProgramDialog,
	openCreateProgramDialog,
	openProgramDialog,
	type ProgramRouteSearch,
	programListSearch,
	programSearchAfterDelete,
} from "./search";

export interface ProgramSearchNavigationOptions {
	readonly replace?: boolean;
}

export interface ProgramsPageProps {
	readonly onSearchChange: (
		search: ProgramRouteSearch,
		options?: ProgramSearchNavigationOptions,
	) => void;
	readonly search: Accessor<ProgramRouteSearch>;
}

function pageSizeFromNumber(value: number): ProgramPageSize {
	return PROGRAM_PAGE_SIZES.find((pageSize) => pageSize === value) ?? 20;
}

export function ProgramsPage(props: ProgramsPageProps) {
	const i18n = useI18n();
	const listSearch = createMemo(() => programListSearch(props.search()));
	const programsQuery = createQuery(() =>
		programListQueryOptions(listSearch()),
	);
	const programsData = () =>
		programsQuery.isPending ? undefined : programsQuery.data;
	const [filterName, setFilterName] = createSignal(props.search().name ?? "");
	const [dialogReturnFocus, setDialogReturnFocus] = createSignal<HTMLElement>();
	const [deleteCompletionSearch, setDeleteCompletionSearch] =
		createSignal<ProgramRouteSearch>();
	let createButton: HTMLButtonElement | undefined;
	createEffect(() => setFilterName(props.search().name ?? ""));
	createEffect(
		on(
			() => props.search().dialog,
			(dialog) => {
				setDeleteCompletionSearch(
					dialog === "delete"
						? programSearchAfterDelete(
								props.search(),
								programsData()?.items.length ?? 0,
							)
						: undefined,
				);
			},
		),
	);

	const pageCount = () =>
		Math.max(
			1,
			Math.ceil((programsData()?.total ?? 0) / props.search().pageSize),
		);
	createEffect(() => {
		if (
			programsData() &&
			props.search().dialog !== "delete" &&
			props.search().page > pageCount() &&
			!programsQuery.isFetching
		) {
			props.onSearchChange(
				{ ...props.search(), page: pageCount() },
				{ replace: true },
			);
		}
	});

	const updateListSearch = (
		patch: Partial<{
			name: string | null;
			page: number;
			pageSize: ProgramPageSize;
			sort: ProgramSort;
		}>,
	) => {
		const current = programListSearch(props.search());
		const name =
			patch.name === undefined ? current.name : (patch.name ?? undefined);
		props.onSearchChange({
			...(name ? { name } : {}),
			page: patch.page ?? current.page,
			pageSize: patch.pageSize ?? current.pageSize,
			sort: patch.sort ?? current.sort,
		});
	};
	const submitFilter = () => {
		const name = filterName().trim();
		updateListSearch({ name: name || null, page: 1 });
	};
	const resetFilter = () => {
		setFilterName("");
		updateListSearch({ name: null, page: 1 });
	};
	const closeDialog = () =>
		props.onSearchChange(closeProgramDialog(props.search()), { replace: true });
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
	const afterDelete = () => {
		const nextSearch =
			deleteCompletionSearch() ??
			programSearchAfterDelete(
				props.search(),
				programsData()?.items.length ?? 0,
			);
		setDeleteCompletionSearch(undefined);
		props.onSearchChange(nextSearch, { replace: true });
	};
	const rangeStart = () => {
		const total = programsData()?.total ?? 0;
		return total === 0
			? 0
			: (props.search().page - 1) * props.search().pageSize + 1;
	};
	const rangeEnd = () =>
		Math.min(
			props.search().page * props.search().pageSize,
			programsData()?.total ?? 0,
		);

	return (
		<div class="page-enter mx-auto w-full max-w-[1180px] px-5 py-7 lg:px-8 lg:py-9">
			<section
				aria-labelledby="programs-page-title"
				class="panel overflow-hidden"
			>
				<header class="flex min-h-14 items-center border-b border-border px-5 py-3">
					<h1
						class="m-0 text-base font-semibold tracking-[-0.01em] text-ink"
						id="programs-page-title"
					>
						{i18n.t("pages.programs.title")}
					</h1>
				</header>
				<div class="border-b border-border px-5 py-4">
					<form
						aria-label={i18n.t("programs.filters.title")}
						class="flex flex-col gap-3 sm:flex-row sm:items-end"
						onSubmit={(event) => {
							event.preventDefault();
							submitFilter();
						}}
					>
						<Field
							class="w-full sm:max-w-sm"
							label={i18n.t("programs.filters.name")}
							name="program-name-filter"
						>
							{(controlProps) => (
								<Input
									{...controlProps}
									onInput={(event) => setFilterName(event.currentTarget.value)}
									placeholder={i18n.t("programs.filters.namePlaceholder")}
									value={filterName()}
								/>
							)}
						</Field>
						<div class="flex gap-2 sm:ml-auto">
							<Button type="button" variant="secondary" onClick={resetFilter}>
								<X aria-hidden="true" size={15} />
								{i18n.t("programs.filters.reset")}
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
					description={i18n.t("programs.table.description", {
						total: i18n.formatNumber(programsData()?.total ?? 0),
					})}
					footer={
						!programsQuery.isError || programsData() ? (
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
								pageSizeOptions={PROGRAM_PAGE_SIZES}
								previousLabel={i18n.t("pagination.previous")}
								summary={i18n.t("pagination.rangeSummary", {
									from: i18n.formatNumber(rangeStart()),
									to: i18n.formatNumber(rangeEnd()),
									total: i18n.formatNumber(programsData()?.total ?? 0),
								})}
							/>
						) : undefined
					}
					title={i18n.t("programs.table.title")}
					toolbar={
						<div class="flex items-center gap-1">
							<Button
								onClick={(event) => {
									setDialogReturnFocus(event.currentTarget);
									props.onSearchChange(openCreateProgramDialog(props.search()));
								}}
								ref={createButton}
								size="sm"
								type="button"
							>
								<Plus aria-hidden="true" size={15} />
								{i18n.t("common.create")}
							</Button>
							<Button
								aria-label={i18n.t("programs.actions.refresh")}
								class="h-8 w-8"
								onClick={() => void programsQuery.refetch()}
								size="icon"
								type="button"
								variant="ghost"
							>
								<RefreshCw
									aria-hidden="true"
									classList={{ "animate-spin": programsQuery.isFetching }}
									size={15}
								/>
							</Button>
						</div>
					}
				>
					<Show
						when={!programsQuery.isError || programsData()}
						fallback={
							<div class="grid min-h-56 place-items-center px-6 py-10 text-center">
								<div>
									<p class="m-0 text-sm text-danger" role="alert">
										{i18n.formatApiError(programsQuery.error)}
									</p>
									<Button
										class="mt-4"
										onClick={() => void programsQuery.refetch()}
										type="button"
										variant="secondary"
									>
										{i18n.t("common.retry")}
									</Button>
								</div>
							</div>
						}
					>
						<Show when={programsQuery.isError && programsData()}>
							<div
								class="flex flex-wrap items-center justify-between gap-3 border-b border-danger/15 bg-danger/6 px-5 py-3 text-sm text-danger"
								role="alert"
							>
								<span>{i18n.formatApiError(programsQuery.error)}</span>
								<Button
									onClick={() => void programsQuery.refetch()}
									size="sm"
									type="button"
									variant="secondary"
								>
									{i18n.t("common.retry")}
								</Button>
							</div>
						</Show>
						<ProgramTable
							items={programsData()?.items ?? []}
							loading={programsQuery.isPending}
							onDelete={(program, trigger) => {
								setDialogReturnFocus(trigger);
								setDeleteCompletionSearch(
									programSearchAfterDelete(
										props.search(),
										programsData()?.items.length ?? 0,
									),
								);
								props.onSearchChange(
									openProgramDialog(props.search(), "delete", program.id),
								);
							}}
							onEdit={(program, trigger) => {
								setDialogReturnFocus(trigger);
								props.onSearchChange(
									openProgramDialog(props.search(), "edit", program.id),
								);
							}}
							onSortChange={(sort) => updateListSearch({ page: 1, sort })}
							page={props.search().page}
							pageSize={props.search().pageSize}
							sort={props.search().sort}
							total={programsData()?.total ?? 0}
						/>
					</Show>
				</TableShell>
			</section>

			<ProgramDialogs
				dialog={props.search().dialog}
				onClose={closeDialog}
				onDeleted={afterDelete}
				onRestoreFocus={restoreDialogFocus}
				programId={props.search().programId}
			/>
		</div>
	);
}
