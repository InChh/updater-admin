import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip";
import type { JSX } from "solid-js";

export interface TooltipProps {
	readonly children: JSX.Element;
	readonly content: JSX.Element;
}

export function Tooltip(props: TooltipProps) {
	return (
		<KobalteTooltip openDelay={350} closeDelay={80}>
			<KobalteTooltip.Trigger as="span" class="inline-flex">
				{props.children}
			</KobalteTooltip.Trigger>
			<KobalteTooltip.Portal>
				<KobalteTooltip.Content class="z-[70] max-w-64 rounded-md bg-ink px-2.5 py-1.5 text-xs text-white shadow-lg data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0">
					<KobalteTooltip.Arrow />
					{props.content}
				</KobalteTooltip.Content>
			</KobalteTooltip.Portal>
		</KobalteTooltip>
	);
}
