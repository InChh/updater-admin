import { type ComponentProps, splitProps } from "solid-js";

import { cn } from "../../lib/utils";

export function Textarea(props: ComponentProps<"textarea">) {
	const [local, rest] = splitProps(props, ["class"]);
	return (
		<textarea
			{...rest}
			class={cn(
				"min-h-24 w-full resize-y rounded-md border border-border-strong bg-white px-3 py-2 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted/65 focus:border-primary focus:ring-2 focus:ring-primary/14 disabled:bg-mist disabled:text-muted",
				local.class,
			)}
		/>
	);
}
