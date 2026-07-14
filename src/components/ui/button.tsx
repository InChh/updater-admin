import { type ComponentProps, splitProps } from "solid-js";

import { cn } from "../../lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "icon";

export interface ButtonProps extends ComponentProps<"button"> {
	readonly size?: ButtonSize;
	readonly variant?: ButtonVariant;
}

const variants: Readonly<Record<ButtonVariant, string>> = {
	primary:
		"border-transparent bg-primary text-white shadow-[0_1px_2px_rgba(0,89,60,0.14)] hover:bg-primary-hover",
	secondary:
		"border-border-strong bg-white text-ink hover:border-primary/45 hover:text-primary-deep",
	ghost:
		"border-transparent bg-transparent text-muted hover:bg-mist hover:text-ink",
	danger:
		"border-danger/20 bg-danger/8 text-danger hover:border-danger/35 hover:bg-danger/12",
};

const sizes: Readonly<Record<ButtonSize, string>> = {
	icon: "h-9 w-9 p-0",
	md: "h-9 px-4",
	sm: "h-8 px-3 text-xs",
};

export function Button(props: ButtonProps) {
	const [local, rest] = splitProps(props, ["class", "size", "variant"]);
	return (
		<button
			{...rest}
			class={cn(
				"inline-flex shrink-0 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
				variants[local.variant ?? "primary"],
				sizes[local.size ?? "md"],
				local.class,
			)}
		/>
	);
}
