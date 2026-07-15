import {
	type ColumnDef,
	createSolidTable,
	flexRender,
	getCoreRowModel,
} from "@tanstack/solid-table";
import { ArrowDown, ArrowUp, Eye } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/tooltip";
import { useI18n } from "../../lib/i18n/i18n";
import type {
	AuditEventListItemDto,
	AuditPageSize,
	AuditSort,
} from "../../shared/api/audit";
import {
	auditActionLabel,
	auditResourceLabel,
	auditResultLabel,
} from "./labels";

export interface AuditTableProps {
	readonly items: readonly AuditEventListItemDto[];
	readonly loading?: boolean;
	readonly onSortChange: (sort: AuditSort) => void;
	readonly onView: (
		event: AuditEventListItemDto,
		trigger: HTMLButtonElement,
	) => void;
	readonly page: number;
	readonly pageSize: AuditPageSize;
	readonly sort: AuditSort;
	readonly total: number;
}

export function AuditTable(props: AuditTableProps) {
	const i18n = useI18n();
	const columns = createMemo<ColumnDef<AuditEventListItemDto>[]>(() => [
		{
			cell: ({ row }) => (
				<span class="inline-grid h-5 min-w-5 place-items-center rounded-full bg-[#354b5c] px-1 text-[10px] font-semibold text-white">
					{(props.page - 1) * props.pageSize + row.index + 1}
				</span>
			),
			header: "#",
			id: "rowNumber",
		},
		{
			accessorKey: "createdAt",
			cell: ({ getValue }) => (
				<time class="whitespace-nowrap" dateTime={getValue<string>()}>
					{i18n.formatDate(getValue<string>())}
				</time>
			),
			header: i18n.t("table.createdAt"),
		},
		{
			accessorKey: "actorId",
			cell: ({ getValue }) => (
				<span
					class="block max-w-48 truncate font-mono text-xs text-muted"
					title={getValue<string | null>() ?? undefined}
				>
					{getValue<string | null>() ?? i18n.t("audit.actor.system")}
				</span>
			),
			header: i18n.t("audit.table.actor"),
		},
		{
			accessorKey: "action",
			cell: ({ getValue }) => (
				<div>
					<p class="m-0 whitespace-nowrap font-medium text-ink">
						{auditActionLabel(i18n, getValue<string>())}
					</p>
					<p class="m-0 mt-0.5 whitespace-nowrap font-mono text-[10px] text-muted">
						{getValue<string>()}
					</p>
				</div>
			),
			header: i18n.t("audit.table.action"),
		},
		{
			accessorKey: "resourceType",
			cell: ({ row }) => (
				<div class="min-w-44">
					<span class="inline-flex rounded-md border border-border bg-mist/60 px-2 py-1 text-[11px] font-semibold text-ink">
						{auditResourceLabel(i18n, row.original.resourceType)}
					</span>
					<p
						class="m-0 mt-1 max-w-52 truncate font-mono text-[10px] text-muted"
						title={row.original.resourceId}
					>
						{row.original.resourceId || i18n.t("common.notAvailable")}
					</p>
				</div>
			),
			header: i18n.t("audit.table.resource"),
		},
		{
			accessorKey: "result",
			cell: ({ getValue }) => {
				const result = getValue<"failure" | "success">();
				return (
					<span
						class="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold"
						classList={{
							"bg-danger/8 text-danger": result === "failure",
							"bg-primary-soft text-primary-deep": result === "success",
						}}
					>
						<span
							aria-hidden="true"
							class="h-1.5 w-1.5 rounded-full bg-current"
						/>
						{auditResultLabel(i18n, result)}
					</span>
				);
			},
			header: i18n.t("audit.table.result"),
		},
		{
			cell: ({ row }) => (
				<Tooltip content={i18n.t("audit.actions.viewDetail")}>
					<Button
						aria-label={i18n.t("audit.actions.viewDetailFor", {
							id: row.original.id,
						})}
						class="h-8 w-8"
						onClick={(event) => props.onView(row.original, event.currentTarget)}
						size="icon"
						type="button"
						variant="ghost"
					>
						<Eye aria-hidden="true" size={15} />
					</Button>
				</Tooltip>
			),
			header: i18n.t("table.actions"),
			id: "actions",
		},
	]);
	const table = createSolidTable({
		get columns() {
			return columns();
		},
		get data() {
			return [...props.items];
		},
		getCoreRowModel: getCoreRowModel(),
		manualPagination: true,
		manualSorting: true,
		get rowCount() {
			return props.total;
		},
		get state() {
			return {
				pagination: {
					pageIndex: props.page - 1,
					pageSize: props.pageSize,
				},
				sorting: [{ desc: props.sort === "createdAt:desc", id: "createdAt" }],
			};
		},
	});
	const nextSort = () =>
		props.onSortChange(
			props.sort === "createdAt:desc" ? "createdAt:asc" : "createdAt:desc",
		);

	return (
		<table class="w-full min-w-[980px] border-collapse text-left text-sm">
			<caption class="sr-only">{i18n.t("audit.table.caption")}</caption>
			<thead class="bg-mist/75 text-xs font-semibold text-ink">
				<For each={table.getHeaderGroups()}>
					{(headerGroup) => (
						<tr>
							<For each={headerGroup.headers}>
								{(header) => (
									<th
										aria-sort={
											header.column.id === "createdAt"
												? props.sort === "createdAt:desc"
													? "descending"
													: "ascending"
												: undefined
										}
										class="h-11 border-b border-border px-4 font-semibold first:pl-5 last:sticky last:right-0 last:z-10 last:border-l last:bg-mist last:pr-5"
										scope="col"
									>
										<Show
											when={header.column.id === "createdAt"}
											fallback={
												header.isPlaceholder
													? null
													: flexRender(
															header.column.columnDef.header,
															header.getContext(),
														)
											}
										>
											<button
												aria-label={i18n.t("audit.sort.change")}
												class="inline-flex items-center gap-1.5 rounded py-1 text-xs font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
												onClick={nextSort}
												type="button"
											>
												{i18n.t("table.createdAt")}
												<Show
													when={props.sort === "createdAt:desc"}
													fallback={
														<ArrowUp
															aria-hidden="true"
															class="text-muted"
															size={13}
														/>
													}
												>
													<ArrowDown
														aria-hidden="true"
														class="text-muted"
														size={13}
													/>
												</Show>
											</button>
										</Show>
									</th>
								)}
							</For>
						</tr>
					)}
				</For>
			</thead>
			<tbody>
				<Show
					when={!props.loading}
					fallback={
						<tr>
							<td class="h-32 px-5 text-center text-muted" colSpan={7}>
								{i18n.t("table.loading")}
							</td>
						</tr>
					}
				>
					<Show
						when={table.getRowModel().rows.length > 0}
						fallback={
							<tr>
								<td class="h-32 px-5 text-center text-muted" colSpan={7}>
									{i18n.t("audit.empty")}
								</td>
							</tr>
						}
					>
						<For each={table.getRowModel().rows}>
							{(row) => (
								<tr class="border-b border-border transition hover:bg-mist/45">
									<For each={row.getVisibleCells()}>
										{(cell) => (
											<td class="px-4 py-3 align-middle first:pl-5 last:sticky last:right-0 last:z-[1] last:border-l last:bg-white last:pr-5">
												{flexRender(
													cell.column.columnDef.cell,
													cell.getContext(),
												)}
											</td>
										)}
									</For>
								</tr>
							)}
						</For>
					</Show>
				</Show>
			</tbody>
		</table>
	);
}
