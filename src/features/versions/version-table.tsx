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
	LoaderCircle,
	Pencil,
	Trash2,
} from "lucide-solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { notify } from "../../components/ui/toast";
import { Tooltip } from "../../components/ui/tooltip";
import { useI18n } from "../../lib/i18n/i18n";
import type {
	VersionListItemDto,
	VersionPageSize,
	VersionSort,
} from "../../shared/api/versions";

export interface VersionTableProps {
	readonly isActivationDisabled?: (version: VersionListItemDto) => boolean;
	readonly isActivationPending?: (version: VersionListItemDto) => boolean;
	readonly items: readonly VersionListItemDto[];
	readonly loading?: boolean;
	readonly onActivation: (
		version: VersionListItemDto,
		nextActive: boolean,
	) => void;
	readonly onDelete: (
		version: VersionListItemDto,
		trigger: HTMLButtonElement,
	) => void;
	readonly onEdit: (
		version: VersionListItemDto,
		trigger: HTMLButtonElement,
	) => void;
	readonly onSortChange: (sort: VersionSort) => void;
	readonly page: number;
	readonly pageSize: VersionPageSize;
	readonly sort: VersionSort;
	readonly total: number;
}

async function writeClipboard(value: string): Promise<void> {
	if (!navigator.clipboard?.writeText) throw new Error("CLIPBOARD_UNAVAILABLE");
	await navigator.clipboard.writeText(value);
}

export function VersionTable(props: VersionTableProps) {
	const i18n = useI18n();
	const [copiedId, setCopiedId] = createSignal<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => {
		if (copyTimer) clearTimeout(copyTimer);
	});
	const copyId = async (versionId: string) => {
		try {
			await writeClipboard(versionId);
			setCopiedId(versionId);
			notify(i18n.t("versions.copy.success"));
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => setCopiedId(null), 1_800);
		} catch {
			notify(i18n.t("versions.copy.error"), undefined, "error");
		}
	};

	const columns = createMemo<ColumnDef<VersionListItemDto>[]>(() => [
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
								? i18n.t("versions.copy.copied")
								: i18n.t("versions.copy.action")
						}
					>
						<button
							aria-label={
								copiedId() === row.original.id
									? i18n.t("versions.copy.copiedWithId", {
											id: row.original.id,
										})
									: i18n.t("versions.copy.actionWithId", {
											id: row.original.id,
										})
							}
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
			accessorKey: "versionNumber",
			cell: ({ row }) => (
				<div class="flex min-w-28 items-center gap-2">
					<span class="data-text font-semibold text-ink">
						{row.original.versionNumber}
					</span>
					<Show when={row.original.isLatest}>
						<span class="inline-flex rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary-deep">
							{i18n.t("versions.latest")}
						</span>
					</Show>
				</div>
			),
			header: i18n.t("versions.form.versionNumber"),
		},
		{
			accessorKey: "description",
			cell: ({ getValue }) => (
				<span class="block min-w-40 max-w-80 whitespace-pre-line text-muted">
					{getValue<string>() || i18n.t("common.notAvailable")}
				</span>
			),
			header: i18n.t("table.description"),
		},
		{
			accessorKey: "isActive",
			cell: ({ row }) => {
				const pending = () =>
					props.isActivationPending?.(row.original) ?? false;
				const disabled = () =>
					Boolean(
						props.loading ||
							pending() ||
							props.isActivationDisabled?.(row.original),
					);
				const activationLabel = () =>
					i18n.t(
						row.original.isActive
							? "versions.actions.disable"
							: "versions.actions.enable",
						{ version: row.original.versionNumber },
					);
				const activationId = () => `version-activation-${row.original.id}`;
				return (
					<div class="flex min-w-24 items-center gap-2">
						<Switch
							checked={row.original.isActive}
							disabled={disabled()}
							id={activationId()}
							onChange={(nextActive: boolean) =>
								props.onActivation(row.original, nextActive)
							}
						/>
						<label class="sr-only" for={`${activationId()}-input`}>
							{activationLabel()}
						</label>
						<Show when={pending()}>
							<span class="inline-flex items-center text-muted">
								<LoaderCircle
									aria-hidden="true"
									class="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
								/>
								<span class="sr-only">{i18n.t("table.loading")}</span>
							</span>
						</Show>
					</div>
				);
			},
			header: i18n.t("table.status"),
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
				<div class="flex min-w-20 items-center gap-0.5">
					<Tooltip content={i18n.t("common.edit")}>
						<Button
							aria-label={i18n.t("versions.actions.edit", {
								version: row.original.versionNumber,
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
							aria-label={i18n.t("versions.actions.delete", {
								version: row.original.versionNumber,
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
		<table class="w-full min-w-[1080px] border-collapse text-left text-sm">
			<caption class="sr-only">{i18n.t("versions.table.caption")}</caption>
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
												aria-label={i18n.t("versions.sort.createdAt", {
													direction:
														props.sort === "createdAt:desc"
															? i18n.t("versions.sort.ascending")
															: i18n.t("versions.sort.descending"),
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
							<td class="h-40 px-5 text-center text-sm text-muted" colSpan={7}>
								{props.loading
									? i18n.t("table.loading")
									: i18n.t("versions.empty")}
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
