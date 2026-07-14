import { ChevronLeft, ChevronRight } from "lucide-solid";

import { Button } from "./button";

export interface PaginationProps {
	readonly label: string;
	readonly nextLabel: string;
	readonly onPageChange: (page: number) => void;
	readonly page: number;
	readonly pageCount: number;
	readonly previousLabel: string;
}

export function Pagination(props: PaginationProps) {
	return (
		<nav
			aria-label={props.label}
			class="flex items-center justify-end gap-2 border-t border-border px-5 py-3"
		>
			<Button
				aria-label={props.previousLabel}
				disabled={props.page <= 1}
				onClick={() => props.onPageChange(props.page - 1)}
				size="icon"
				type="button"
				variant="ghost"
			>
				<ChevronLeft aria-hidden="true" size={16} />
			</Button>
			<span class="grid h-8 min-w-8 place-items-center rounded-md border border-primary bg-primary-soft px-2 text-xs font-semibold text-primary-deep">
				{props.page}
			</span>
			<span class="text-xs text-muted">/ {Math.max(props.pageCount, 1)}</span>
			<Button
				aria-label={props.nextLabel}
				disabled={props.page >= props.pageCount}
				onClick={() => props.onPageChange(props.page + 1)}
				size="icon"
				type="button"
				variant="ghost"
			>
				<ChevronRight aria-hidden="true" size={16} />
			</Button>
		</nav>
	);
}
