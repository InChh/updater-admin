import { type ComponentProps, splitProps } from "solid-js";

import { cn } from "../../lib/utils";

export function Input(props: ComponentProps<"input">) {
	const [local, rest] = splitProps(props, ["class"]);
	return (
		<input
			{...rest}
			class={cn(
				"h-9 w-full rounded-md border border-border-strong bg-white px-3 text-sm text-ink shadow-[inset_0_1px_1px_rgba(31,45,53,0.02)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted/65 focus:border-primary focus:ring-2 focus:ring-primary/14 disabled:bg-mist disabled:text-muted",
				local.class,
			)}
		/>
	);
}
