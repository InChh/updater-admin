import { Switch as KobalteSwitch } from "@kobalte/core/switch";
import { type ComponentProps, type JSX, splitProps } from "solid-js";

import { cn } from "../../lib/utils";

export interface SwitchProps
	extends Omit<ComponentProps<typeof KobalteSwitch>, "children"> {
	readonly children?: JSX.Element;
}

export function Switch(props: SwitchProps) {
	const [local, rest] = splitProps(props, ["class", "children"]);
	return (
		<KobalteSwitch
			{...rest}
			class={cn("inline-flex items-center gap-2", local.class)}
		>
			<KobalteSwitch.Input class="peer" />
			<KobalteSwitch.Control class="relative inline-flex h-5 w-9 shrink-0 rounded-full bg-border-strong p-0.5 outline-none transition-colors duration-150 data-[checked]:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary-deep peer-focus-visible:ring-offset-2">
				<KobalteSwitch.Thumb class="block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 data-[checked]:translate-x-4" />
			</KobalteSwitch.Control>
			{local.children}
		</KobalteSwitch>
	);
}
