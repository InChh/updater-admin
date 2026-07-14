import { Link } from "@tanstack/solid-router";
import {
	type ColumnDef,
	createSolidTable,
	flexRender,
	getCoreRowModel,
} from "@tanstack/solid-table";
import {
	ArrowDown,
	ArrowUp,
	Check,
	Copy,
	Layers3,
	Pencil,
	Trash2,
} from "lucide-solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { notify } from "../../components/ui/toast";
import { Tooltip } from "../../components/ui/tooltip";
import { useI18n } from "../../lib/i18n/i18n";
import type {
	ProgramListItemDto,
	ProgramPageSize,
	ProgramSort,
} from "../../shared/api/programs";

export interface ProgramTableProps {
	readonly items: readonly ProgramListItemDto[];
	readonly loading?: boolean;
	readonly onDelete: (
		program: ProgramListItemDto,
		trigger: HTMLButtonElement,
	) => void;
	readonly onEdit: (
		program: ProgramListItemDto,
		trigger: HTMLButtonElement,
	) => void;
	readonly onSortChange: (sort: ProgramSort) => void;
	readonly page: number;
	readonly pageSize: ProgramPageSize;
	readonly sort: ProgramSort;
	readonly total: number;
}

async function writeClipboard(value: string): Promise<void> {
	if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
	await navigator.clipboard.writeText(value);
}

export function ProgramTable(props: ProgramTableProps) {
	const i18n = useI18n();
	const [copiedId, setCopiedId] = createSignal<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => {
		if (copyTimer) clearTimeout(copyTimer);
	});
	const copyId = async (programId: string) => {
		try {
			await writeClipboard(programId);
			setCopiedId(programId);
			notify(i18n.t("programs.copy.success"));
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => setCopiedId(null), 1_800);
		} catch {
			notify(i18n.t("programs.copy.error"), undefined, "error");
		}
	};

	const columns = createMemo<ColumnDef<ProgramListItemDto>[]>(() => [
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
			accessorKey: "id",
			cell: ({ row }) => (
				<div class="flex min-w-[19rem] items-center gap-1.5">
					<span class="data-text text-xs text-ink">{row.original.id}</span>
					<Tooltip
						content={
							copiedId() === row.original.id
								? i18n.t("programs.copy.copied")
								: i18n.t("programs.copy.action")
						}
					>
						<button
							aria-label={i18n.t(
								copiedId() === row.original.id
									? "programs.copy.copiedWithId"
									: "programs.copy.actionWithId",
								{ id: row.original.id },
							)}
							class="grid h-7 w-7 place-items-center rounded text-[#17a8c3] transition hover:bg-[#e9f8fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
							onClick={() => void copyId(row.original.id)}
							type="button"
						>
							<Show
								when={copiedId() === row.original.id}
								fallback={<Copy aria-hidden="true" size={13} />}
							>
								<Check aria-hidden="true" size={14} />
							</Show>
						</button>
					</Tooltip>
				</div>
			),
			header: i18n.t("table.id"),
		},
		{
			accessorKey: "name",
			cell: ({ getValue }) => (
				<span class="block min-w-36 max-w-56 whitespace-normal font-medium text-ink">
					{getValue<string>()}
				</span>
			),
			header: i18n.t("table.name"),
		},
		{
			accessorKey: "description",
			cell: ({ getValue }) => (
				<span class="block min-w-32 max-w-72 whitespace-normal text-muted">
					{getValue<string | null>() || i18n.t("common.notAvailable")}
				</span>
			),
			header: i18n.t("table.description"),
		},
		{
			accessorKey: "createdAt",
			cell: ({ getValue }) => (
				<span class="whitespace-nowrap">
					{i18n.formatDate(getValue<string>())}
				</span>
			),
			enableSorting: true,
			header: i18n.t("table.createdAt"),
		},
		{
			cell: ({ row }) => (
				<div class="flex min-w-32 items-center gap-0.5">
					<Tooltip content={i18n.t("programs.actions.versions")}>
						<Link
							aria-label={i18n.t("programs.actions.versionsFor", {
								name: row.original.name,
							})}
							class="grid h-8 w-8 place-items-center rounded-md text-muted no-underline transition hover:bg-primary-soft hover:text-primary-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
							params={{ programId: row.original.id }}
							to="/programs/$programId/versions"
						>
							<Layers3 aria-hidden="true" size={15} />
						</Link>
					</Tooltip>
					<Tooltip content={i18n.t("common.edit")}>
						<Button
							aria-label={i18n.t("programs.actions.edit", {
								name: row.original.name,
							})}
							class="h-8 w-8"
							onClick={(event) =>
								props.onEdit(row.original, event.currentTarget)
							}
							size="icon"
							type="button"
							variant="ghost"
						>
							<Pencil aria-hidden="true" size={15} />
						</Button>
					</Tooltip>
					<Tooltip content={i18n.t("common.delete")}>
						<Button
							aria-label={i18n.t("programs.actions.delete", {
								name: row.original.name,
							})}
							class="h-8 w-8"
							onClick={(event) =>
								props.onDelete(row.original, event.currentTarget)
							}
							size="icon"
							type="button"
							variant="ghost"
						>
							<Trash2 aria-hidden="true" class="text-danger" size={15} />
						</Button>
					</Tooltip>
				</div>
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
				sorting: [{ id: "createdAt", desc: props.sort === "createdAt:desc" }],
			};
		},
	});

	return (
		<table class="w-full min-w-[920px] border-collapse text-left text-sm">
			<caption class="sr-only">{i18n.t("programs.table.caption")}</caption>
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
											fallback={flexRender(
												header.column.columnDef.header,
												header.getContext(),
											)}
										>
											<button
												aria-label={i18n.t("programs.sort.createdAt", {
													direction:
														props.sort === "createdAt:desc"
															? i18n.t("programs.sort.ascending")
															: i18n.t("programs.sort.descending"),
												})}
												class="inline-flex items-center gap-1.5 rounded py-1 text-xs font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
												onClick={() =>
													props.onSortChange(
														props.sort === "createdAt:desc"
															? "createdAt:asc"
															: "createdAt:desc",
													)
												}
												type="button"
											>
												{i18n.t("table.createdAt")}
												<Show
													when={props.sort === "createdAt:desc"}
													fallback={<ArrowUp aria-hidden="true" size={13} />}
												>
													<ArrowDown aria-hidden="true" size={13} />
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
					when={!props.loading && table.getRowModel().rows.length > 0}
					fallback={
						<tr>
							<td class="h-40 px-5 text-center text-sm text-muted" colSpan={6}>
								{props.loading
									? i18n.t("table.loading")
									: i18n.t("programs.empty")}
							</td>
						</tr>
					}
				>
					<For each={table.getRowModel().rows}>
						{(row) => (
							<tr class="group border-b border-border/80 transition-colors last:border-b-0 hover:bg-mist/45">
								<For each={row.getVisibleCells()}>
									{(cell) => (
										<td class="px-4 py-3.5 align-middle text-xs text-ink first:pl-5 last:sticky last:right-0 last:z-[1] last:border-l last:border-border last:bg-white last:pr-5 group-hover:last:bg-[#f7faf9]">
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
			</tbody>
		</table>
	);
}
