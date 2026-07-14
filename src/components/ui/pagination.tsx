import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-solid";
import { For, Show } from "solid-js";

import { Button } from "./button";

export type PaginationItem = "ellipsis" | number;

export interface PaginationProps {
	readonly label: string;
	readonly nextLabel: string;
	readonly onPageChange: (page: number) => void;
	readonly onPageSizeChange: (pageSize: number) => void;
	readonly page: number;
	readonly pageCount: number;
	readonly pageLabel: (page: number) => string;
	readonly pageSize: number;
	readonly pageSizeLabel: string;
	readonly pageSizeOptions: readonly number[];
	readonly previousLabel: string;
	readonly summary: string;
}

export function paginationItems(
	page: number,
	pageCount: number,
	maximumVisiblePages = 5,
): readonly PaginationItem[] {
	const count = Math.max(1, Math.floor(pageCount));
	const current = Math.min(Math.max(1, Math.floor(page)), count);
	const visible = Math.max(3, Math.floor(maximumVisiblePages));
	if (count <= visible + 2) {
		return Array.from({ length: count }, (_, index) => index + 1);
	}

	const innerSlots = visible - 2;
	let start = Math.max(2, current - Math.floor(innerSlots / 2));
	const end = Math.min(count - 1, start + innerSlots - 1);
	start = Math.max(2, end - innerSlots + 1);

	const items: PaginationItem[] = [1];
	if (start > 2) items.push("ellipsis");
	for (let value = start; value <= end; value += 1) items.push(value);
	if (end < count - 1) items.push("ellipsis");
	items.push(count);
	return items;
}

export function Pagination(props: PaginationProps) {
	const safePageCount = () => Math.max(1, props.pageCount);
	const safePage = () => Math.min(Math.max(1, props.page), safePageCount());
	return (
		<nav
			aria-label={props.label}
			class="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5"
		>
			<div class="flex flex-wrap items-center gap-3 text-xs text-muted">
				<span>{props.summary}</span>
				<label class="flex items-center gap-1.5">
					<span>{props.pageSizeLabel}</span>
					<select
						aria-label={props.pageSizeLabel}
						class="h-8 rounded-md border border-border-strong bg-white px-2 text-xs text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/14"
						onChange={(event) =>
							props.onPageSizeChange(Number(event.currentTarget.value))
						}
						value={props.pageSize}
					>
						<For each={props.pageSizeOptions}>
							{(pageSize) => <option value={pageSize}>{pageSize}</option>}
						</For>
					</select>
				</label>
			</div>

			<div class="flex max-w-full items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
				<Button
					aria-label={props.previousLabel}
					class="h-8 w-8"
					disabled={safePage() <= 1}
					onClick={() => props.onPageChange(safePage() - 1)}
					size="icon"
					type="button"
					variant="ghost"
				>
					<ChevronLeft aria-hidden="true" size={15} />
				</Button>
				<For each={paginationItems(safePage(), safePageCount())}>
					{(item) => (
						<Show
							when={item !== "ellipsis" && item}
							fallback={
								<span
									aria-hidden="true"
									class="grid h-8 w-7 place-items-center text-muted"
								>
									<MoreHorizontal size={14} />
								</span>
							}
						>
							{(pageNumber) => (
								<button
									aria-current={
										pageNumber() === safePage() ? "page" : undefined
									}
									aria-label={props.pageLabel(pageNumber())}
									class="grid h-8 min-w-8 place-items-center rounded-md border px-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep focus-visible:ring-offset-1"
									classList={{
										"border-border bg-white text-muted hover:border-primary/40 hover:text-primary-deep":
											pageNumber() !== safePage(),
										"border-primary bg-primary-soft text-primary-deep":
											pageNumber() === safePage(),
									}}
									onClick={() => props.onPageChange(pageNumber())}
									type="button"
								>
									{pageNumber()}
								</button>
							)}
						</Show>
					)}
				</For>
				<Button
					aria-label={props.nextLabel}
					class="h-8 w-8"
					disabled={safePage() >= safePageCount()}
					onClick={() => props.onPageChange(safePage() + 1)}
					size="icon"
					type="button"
					variant="ghost"
				>
					<ChevronRight aria-hidden="true" size={15} />
				</Button>
			</div>
		</nav>
	);
}
