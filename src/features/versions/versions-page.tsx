import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Plus, RefreshCw } from "lucide-solid";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	on,
	Show,
} from "solid-js";

import { Button } from "../../components/ui/button";
import { Pagination } from "../../components/ui/pagination";
import { TableShell } from "../../components/ui/table-shell";
import { notify } from "../../components/ui/toast";
import { ApiProblemError } from "../../lib/api/client";
import { versionQueryKeys } from "../../lib/api/query-keys";
import { useI18n } from "../../lib/i18n/i18n";
import type { EntityResult } from "../../shared/api/common";
import type { ProgramDetailDto } from "../../shared/api/programs";
import {
	VERSION_PAGE_SIZES,
	type VersionListItemDto,
	type VersionPageSize,
	type VersionSort,
} from "../../shared/api/versions";
import { setVersionActivation } from "./api";
import {
	invalidateProgramVersions,
	patchVersionActivation,
	reconcileVersionActivation,
	refreshStaleVersion,
	rollbackVersionLists,
} from "./cache";
import { versionListQueryOptions } from "./queries";
import {
	closeVersionDialog,
	openCreateVersionDialog,
	openVersionDialog,
	type VersionRouteSearch,
	versionListSearch,
	versionSearchAfterDelete,
} from "./search";
import { VersionDialogs } from "./version-dialogs";
import { VersionTable } from "./version-table";

export interface VersionSearchNavigationOptions {
	readonly replace?: boolean;
}

export interface VersionsPageProps {
	readonly onSearchChange: (
		search: VersionRouteSearch,
		options?: VersionSearchNavigationOptions,
	) => void;
	readonly program: Accessor<EntityResult<ProgramDetailDto>>;
	readonly search: Accessor<VersionRouteSearch>;
}

function pageSizeFromNumber(value: number): VersionPageSize {
	return VERSION_PAGE_SIZES.find((pageSize) => pageSize === value) ?? 20;
}

export function VersionsPage(props: VersionsPageProps) {
	const i18n = useI18n();
	const queryClient = useQueryClient();
	const programId = () => props.program().data.id;
	const listSearch = createMemo(() => versionListSearch(props.search()));
	const versionsQuery = createQuery(() =>
		versionListQueryOptions(programId(), listSearch()),
	);
	const [dialogReturnFocus, setDialogReturnFocus] = createSignal<HTMLElement>();
	const [deleteCompletionSearch, setDeleteCompletionSearch] =
		createSignal<VersionRouteSearch>();
	const [pendingActivationIds, setPendingActivationIds] = createSignal(
		new Set<string>(),
	);
	const activationTasks = new Map<string, Promise<void>>();
	let createButton: HTMLButtonElement | undefined;

	createEffect(
		on(
			() => props.search().dialog,
			(dialog) => {
				setDeleteCompletionSearch(
					dialog === "delete"
						? versionSearchAfterDelete(
								props.search(),
								versionsQuery.data?.items.length ?? 0,
							)
						: undefined,
				);
			},
		),
	);

	const pageCount = () =>
		Math.max(
			1,
			Math.ceil((versionsQuery.data?.total ?? 0) / props.search().pageSize),
		);
	createEffect(() => {
		if (
			versionsQuery.data &&
			props.search().dialog !== "delete" &&
			props.search().page > pageCount() &&
			!versionsQuery.isFetching
		) {
			props.onSearchChange(
				{ ...props.search(), page: pageCount() },
				{ replace: true },
			);
		}
	});

	const updateListSearch = (
		patch: Partial<{
			page: number;
			pageSize: VersionPageSize;
			sort: VersionSort;
		}>,
	) => {
		const current = versionListSearch(props.search());
		props.onSearchChange({
			page: patch.page ?? current.page,
			pageSize: patch.pageSize ?? current.pageSize,
			sort: patch.sort ?? current.sort,
		});
	};
	const closeDialog = () =>
		props.onSearchChange(closeVersionDialog(props.search()), { replace: true });
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
			versionSearchAfterDelete(
				props.search(),
				versionsQuery.data?.items.length ?? 0,
			);
		setDeleteCompletionSearch(undefined);
		props.onSearchChange(nextSearch, { replace: true });
	};
	const rangeStart = () => {
		const total = versionsQuery.data?.total ?? 0;
		return total === 0
			? 0
			: (props.search().page - 1) * props.search().pageSize + 1;
	};
	const rangeEnd = () =>
		Math.min(
			props.search().page * props.search().pageSize,
			versionsQuery.data?.total ?? 0,
		);

	const markActivationPending = (versionId: string, pending: boolean) => {
		setPendingActivationIds((current) => {
			const next = new Set(current);
			if (pending) next.add(versionId);
			else next.delete(versionId);
			return next;
		});
	};
	const runActivation = async (
		version: VersionListItemDto,
		nextActive: boolean,
	) => {
		const currentProgramId = version.programId;
		await queryClient.cancelQueries({
			queryKey: versionQueryKeys.lists(currentProgramId),
		});
		const snapshot = patchVersionActivation(
			queryClient,
			currentProgramId,
			version.id,
			nextActive,
		);
		try {
			const updated = await setVersionActivation(
				currentProgramId,
				version.id,
				{ isActive: nextActive },
				version.etag,
			);
			reconcileVersionActivation(queryClient, updated);
			await invalidateProgramVersions(queryClient, currentProgramId);
			notify(
				i18n.t(
					nextActive
						? "versions.notifications.enabled"
						: "versions.notifications.disabled",
				),
			);
		} catch (error) {
			rollbackVersionLists(queryClient, snapshot);
			await refreshStaleVersion(queryClient, currentProgramId, version.id);
			if (error instanceof ApiProblemError && error.code === "STALE_WRITE") {
				notify(
					i18n.t("versions.notifications.activationFailed"),
					i18n.t("versions.errors.staleRefreshed"),
					"error",
				);
			} else {
				notify(
					i18n.t("versions.notifications.activationFailed"),
					i18n.formatApiError(error),
					"error",
				);
			}
		}
	};
	const setActivation = (version: VersionListItemDto, nextActive: boolean) => {
		if (activationTasks.has(version.id)) return;
		markActivationPending(version.id, true);
		const task = runActivation(version, nextActive).finally(() => {
			markActivationPending(version.id, false);
			activationTasks.delete(version.id);
		});
		activationTasks.set(version.id, task);
	};

	return (
		<div class="page-enter mx-auto w-full max-w-[1180px] px-5 py-7 lg:px-8 lg:py-9">
			<section
				aria-labelledby="versions-page-title"
				class="panel overflow-hidden"
			>
				<header class="flex min-h-14 items-center border-b border-border px-5 py-3">
					<h1
						class="m-0 text-base font-semibold tracking-[-0.01em] text-ink"
						id="versions-page-title"
					>
						{i18n.t("versions.table.title")}
					</h1>
				</header>

				<TableShell
					class="rounded-none border-0 shadow-none"
					description={i18n.t("versions.table.description", {
						program: props.program().data.name,
						total: i18n.formatNumber(versionsQuery.data?.total ?? 0),
					})}
					footer={
						!versionsQuery.isError || versionsQuery.data ? (
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
								pageSizeOptions={VERSION_PAGE_SIZES}
								previousLabel={i18n.t("pagination.previous")}
								summary={i18n.t("pagination.rangeSummary", {
									from: i18n.formatNumber(rangeStart()),
									to: i18n.formatNumber(rangeEnd()),
									total: i18n.formatNumber(versionsQuery.data?.total ?? 0),
								})}
							/>
						) : undefined
					}
					title={props.program().data.name}
					toolbar={
						<div class="flex items-center gap-1">
							<Button
								onClick={(event) => {
									setDialogReturnFocus(event.currentTarget);
									props.onSearchChange(openCreateVersionDialog(props.search()));
								}}
								ref={createButton}
								size="sm"
								type="button"
							>
								<Plus aria-hidden="true" size={15} />
								{i18n.t("common.create")}
							</Button>
							<Button
								aria-label={i18n.t("versions.actions.refresh")}
								class="h-8 w-8"
								onClick={() => void versionsQuery.refetch()}
								size="icon"
								type="button"
								variant="ghost"
							>
								<RefreshCw
									aria-hidden="true"
									classList={{ "animate-spin": versionsQuery.isFetching }}
									size={15}
								/>
							</Button>
						</div>
					}
				>
					<Show
						when={!versionsQuery.isError || versionsQuery.data}
						fallback={
							<div class="grid min-h-56 place-items-center px-6 py-10 text-center">
								<div>
									<p class="m-0 text-sm text-danger" role="alert">
										{i18n.formatApiError(versionsQuery.error)}
									</p>
									<Button
										class="mt-4"
										onClick={() => void versionsQuery.refetch()}
										type="button"
										variant="secondary"
									>
										{i18n.t("common.retry")}
									</Button>
								</div>
							</div>
						}
					>
						<Show when={versionsQuery.isError && versionsQuery.data}>
							<div
								class="flex flex-wrap items-center justify-between gap-3 border-b border-danger/15 bg-danger/6 px-5 py-3 text-sm text-danger"
								role="alert"
							>
								<span>{i18n.formatApiError(versionsQuery.error)}</span>
								<Button
									onClick={() => void versionsQuery.refetch()}
									size="sm"
									type="button"
									variant="secondary"
								>
									{i18n.t("common.retry")}
								</Button>
							</div>
						</Show>
						<VersionTable
							isActivationDisabled={(version) =>
								version.lifecycleStatus === "draft"
							}
							isActivationPending={(version) =>
								pendingActivationIds().has(version.id)
							}
							items={versionsQuery.data?.items ?? []}
							loading={versionsQuery.isPending}
							onActivation={setActivation}
							onDelete={(version, trigger) => {
								setDialogReturnFocus(trigger);
								setDeleteCompletionSearch(
									versionSearchAfterDelete(
										props.search(),
										versionsQuery.data?.items.length ?? 0,
									),
								);
								props.onSearchChange(
									openVersionDialog(props.search(), "delete", version.id),
								);
							}}
							onEdit={(version, trigger) => {
								setDialogReturnFocus(trigger);
								props.onSearchChange(
									openVersionDialog(props.search(), "edit", version.id),
								);
							}}
							onSortChange={(sort) => updateListSearch({ page: 1, sort })}
							page={props.search().page}
							pageSize={props.search().pageSize}
							sort={props.search().sort}
							total={versionsQuery.data?.total ?? 0}
						/>
					</Show>
				</TableShell>
			</section>

			<VersionDialogs
				dialog={props.search().dialog}
				onClose={closeDialog}
				onDeleted={afterDelete}
				onRestoreFocus={restoreDialogFocus}
				programId={programId()}
				versionId={props.search().versionId}
			/>
		</div>
	);
}
