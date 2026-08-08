import { type ComponentProps, type JSX, splitProps } from "solid-js";

import { cn } from "../../lib/utils";

export interface SwitchProps
	extends Omit<
		ComponentProps<"button">,
		"aria-checked" | "children" | "onChange" | "onClick" | "role" | "type"
	> {
	readonly checked?: boolean;
	readonly children?: JSX.Element;
	readonly onChange?: (checked: boolean) => void;
}

export function Switch(props: SwitchProps) {
	const [local, rest] = splitProps(props, [
		"checked",
		"children",
		"class",
		"disabled",
		"onChange",
	]);
	const checked = () => Boolean(local.checked);
	return (
		<button
			{...rest}
			aria-checked={checked()}
			class={cn(
				"relative inline-flex h-5 w-9 shrink-0 rounded-full bg-border-strong p-0.5 outline-none transition-colors duration-150 data-[checked]:bg-primary focus-visible:ring-2 focus-visible:ring-primary-deep focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
				local.class,
			)}
			data-checked={checked() ? "" : undefined}
			disabled={local.disabled}
			onClick={() => local.onChange?.(!checked())}
			role="switch"
			type="button"
		>
			<span
				aria-hidden="true"
				class="block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 data-[checked]:translate-x-4"
				data-checked={checked() ? "" : undefined}
			/>
			{local.children}
		</button>
	);
}
