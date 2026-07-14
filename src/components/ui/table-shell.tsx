import type { JSX } from "solid-js";

import { cn } from "../../lib/utils";

export interface TableShellProps {
	readonly children: JSX.Element;
	readonly class?: string;
	readonly description?: string;
	readonly footer?: JSX.Element;
	readonly title?: string;
	readonly toolbar?: JSX.Element;
}

export function TableShell(props: TableShellProps) {
	return (
		<section class={cn("panel overflow-hidden", props.class)}>
			{(props.title || props.toolbar) && (
				<header class="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
					<div>
						{props.title && (
							<h2 class="m-0 text-sm font-semibold text-ink">{props.title}</h2>
						)}
						{props.description && (
							<p class="m-0 mt-1 text-xs text-muted">{props.description}</p>
						)}
					</div>
					{props.toolbar}
				</header>
			)}
			<div class="overflow-x-auto">{props.children}</div>
			{props.footer && <footer class="bg-white">{props.footer}</footer>}
		</section>
	);
}
