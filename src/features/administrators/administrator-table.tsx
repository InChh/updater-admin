import {
	type ColumnDef,
	createSolidTable,
	flexRender,
	getCoreRowModel,
} from "@tanstack/solid-table";
import {
	ArrowDown,
	ArrowUp,
	KeyRound,
	Power,
	PowerOff,
	ShieldCheck,
	Unplug,
} from "lucide-solid";
import { createMemo, For, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/tooltip";
import { useI18n } from "../../lib/i18n/i18n";
import type {
	AdministratorDto,
	AdministratorPageSize,
	AdministratorSort,
} from "../../shared/api/administrators";

export interface AdministratorTableProps {
	readonly currentAdministratorId: string;
	readonly items: readonly AdministratorDto[];
	readonly loading?: boolean;
	readonly onResetPassword: (
		administrator: AdministratorDto,
		trigger: HTMLButtonElement,
	) => void;
	readonly onRevokeSessions: (
		administrator: AdministratorDto,
		trigger: HTMLButtonElement,
	) => void;
	readonly onSetEnabled: (
		administrator: AdministratorDto,
		trigger: HTMLButtonElement,
	) => void;
	readonly onSortChange: (sort: AdministratorSort) => void;
	readonly page: number;
	readonly pageSize: AdministratorPageSize;
	readonly sort: AdministratorSort;
	readonly total: number;
}

function nextSort(
	current: AdministratorSort,
	field: "createdAt" | "name",
): AdministratorSort {
	if (current === `${field}:asc`) return `${field}:desc`;
	return `${field}:asc`;
}

export function AdministratorTable(props: AdministratorTableProps) {
	const i18n = useI18n();
	const columns = createMemo<ColumnDef<AdministratorDto>[]>(() => [
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
			accessorKey: "name",
			cell: ({ row }) => (
				<div class="min-w-48">
					<div class="flex items-center gap-2">
						<span class="font-semibold text-ink">{row.original.name}</span>
						<Show when={row.original.id === props.currentAdministratorId}>
							<span class="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary-deep">
								{i18n.t("administrators.current")}
							</span>
						</Show>
					</div>
					<p class="m-0 mt-1 break-all text-xs text-muted">
						{row.original.email}
					</p>
				</div>
			),
			enableSorting: true,
			header: i18n.t("table.name"),
		},
		{
			cell: () => (
				<span class="inline-flex items-center gap-1.5 rounded-md border border-border bg-mist/65 px-2 py-1 text-[11px] font-semibold text-ink">
					<ShieldCheck aria-hidden="true" size={12} />
					admin
				</span>
			),
			header: i18n.t("administrators.table.role"),
			id: "role",
		},
		{
			accessorKey: "locale",
			cell: ({ getValue }) => (
				<span class="whitespace-nowrap text-muted">
					{getValue<"en" | "zh-CN">() === "zh-CN"
						? i18n.t("administrators.locale.zhCN")
						: i18n.t("administrators.locale.en")}
				</span>
			),
			header: i18n.t("common.language"),
		},
		{
			accessorKey: "lastLoginAt",
			cell: ({ getValue }) => {
				const value = getValue<string | null>();
				return (
					<span class="whitespace-nowrap text-muted">
						{value ? i18n.formatDate(value) : i18n.t("common.notAvailable")}
					</span>
				);
			},
			header: i18n.t("administrators.table.lastLogin"),
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
			accessorKey: "enabled",
			cell: ({ row }) => (
				<div class="flex min-w-24 flex-col items-start gap-1">
					<span
						class="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold"
						classList={{
							"bg-danger/8 text-danger": !row.original.enabled,
							"bg-primary-soft text-primary-deep": row.original.enabled,
						}}
					>
						<span
							aria-hidden="true"
							class="h-1.5 w-1.5 rounded-full bg-current"
						/>
						{i18n.t(
							row.original.enabled
								? "administrators.status.active"
								: "administrators.status.disabled",
						)}
					</span>
					<Show when={row.original.mustChangePassword}>
						<span class="text-[10px] font-medium text-[#9a6500]">
							{i18n.t("administrators.status.passwordChangeRequired")}
						</span>
					</Show>
				</div>
			),
			header: i18n.t("table.status"),
		},
		{
			cell: ({ row }) => {
				const self = row.original.id === props.currentAdministratorId;
				const selfDisable = row.original.enabled && self;
				return (
					<div class="flex min-w-28 items-center gap-0.5">
						<Tooltip
							content={
								selfDisable
									? i18n.t("administrators.actions.selfDisableForbidden")
									: i18n.t(
											row.original.enabled
												? "administrators.actions.disable"
												: "administrators.actions.enable",
										)
							}
						>
							<Button
								aria-label={i18n.t(
									row.original.enabled
										? "administrators.actions.disableFor"
										: "administrators.actions.enableFor",
									{ name: row.original.name },
								)}
								class="h-8 w-8"
								disabled={selfDisable}
								onClick={(event) =>
									props.onSetEnabled(row.original, event.currentTarget)
								}
								size="icon"
								type="button"
								variant="ghost"
							>
								<Show
									when={row.original.enabled}
									fallback={<Power aria-hidden="true" size={15} />}
								>
									<PowerOff aria-hidden="true" class="text-danger" size={15} />
								</Show>
							</Button>
						</Tooltip>
						<Tooltip
							content={i18n.t(
								self
									? "administrators.actions.selfResetUseProfile"
									: "administrators.actions.resetPassword",
							)}
						>
							<Button
								aria-label={i18n.t("administrators.actions.resetPasswordFor", {
									name: row.original.name,
								})}
								class="h-8 w-8"
								disabled={self}
								onClick={(event) =>
									props.onResetPassword(row.original, event.currentTarget)
								}
								size="icon"
								type="button"
								variant="ghost"
							>
								<KeyRound aria-hidden="true" size={15} />
							</Button>
						</Tooltip>
						<Tooltip
							content={i18n.t(
								self
									? "administrators.actions.selfRevokeUseAccount"
									: "administrators.actions.revokeSessions",
							)}
						>
							<Button
								aria-label={i18n.t("administrators.actions.revokeSessionsFor", {
									name: row.original.name,
								})}
								class="h-8 w-8"
								disabled={self}
								onClick={(event) =>
									props.onRevokeSessions(row.original, event.currentTarget)
								}
								size="icon"
								type="button"
								variant="ghost"
							>
								<Unplug aria-hidden="true" size={15} />
							</Button>
						</Tooltip>
					</div>
				);
			},
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
				sorting: [
					{
						desc: props.sort.endsWith(":desc"),
						id: props.sort.startsWith("name:") ? "name" : "createdAt",
					},
				],
			};
		},
	});

	const sortHeader = (field: "createdAt" | "name", label: string) => {
		const active = () => props.sort.startsWith(`${field}:`);
		const descending = () => active() && props.sort.endsWith(":desc");
		return (
			<button
				aria-label={i18n.t("administrators.sort.change", { label })}
				class="inline-flex items-center gap-1.5 rounded py-1 text-xs font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
				onClick={() => props.onSortChange(nextSort(props.sort, field))}
				type="button"
			>
				{label}
				<Show
					when={descending()}
					fallback={<ArrowUp aria-hidden="true" class="text-muted" size={13} />}
				>
					<ArrowDown aria-hidden="true" class="text-muted" size={13} />
				</Show>
			</button>
		);
	};

	return (
		<table class="w-full min-w-[1120px] border-collapse text-left text-sm">
			<caption class="sr-only">
				{i18n.t("administrators.table.caption")}
			</caption>
			<thead class="bg-mist/75 text-xs font-semibold text-ink">
				<For each={table.getHeaderGroups()}>
					{(headerGroup) => (
						<tr>
							<For each={headerGroup.headers}>
								{(header) => (
									<th
										aria-sort={
											header.column.id === "name" ||
											header.column.id === "createdAt"
												? props.sort.startsWith(`${header.column.id}:`)
													? props.sort.endsWith(":desc")
														? "descending"
														: "ascending"
													: "none"
												: undefined
										}
										class="h-11 border-b border-border px-4 font-semibold first:pl-5 last:sticky last:right-0 last:z-10 last:border-l last:bg-mist last:pr-5"
										scope="col"
									>
										{header.column.id === "name"
											? sortHeader("name", i18n.t("table.name"))
											: header.column.id === "createdAt"
												? sortHeader("createdAt", i18n.t("table.createdAt"))
												: flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)}
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
							<td class="h-40 px-5 text-center text-sm text-muted" colSpan={8}>
								{props.loading
									? i18n.t("table.loading")
									: i18n.t("administrators.empty")}
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
