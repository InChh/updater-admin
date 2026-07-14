import { DropdownMenu as KobalteDropdownMenu } from "@kobalte/core/dropdown-menu";
import { Check } from "lucide-solid";
import { type ComponentProps, splitProps } from "solid-js";

import { cn } from "../../lib/utils";

export const DropdownMenuRoot = KobalteDropdownMenu;
export const DropdownMenuTrigger = KobalteDropdownMenu.Trigger;
export const DropdownMenuSeparator = KobalteDropdownMenu.Separator;
export const DropdownMenuRadioGroup = KobalteDropdownMenu.RadioGroup;

export function DropdownMenuContent(
	props: ComponentProps<typeof KobalteDropdownMenu.Content>,
) {
	const [local, rest] = splitProps(props, ["class"]);
	return (
		<KobalteDropdownMenu.Portal>
			<KobalteDropdownMenu.Content
				{...rest}
				class={cn(
					"z-50 min-w-40 rounded-lg border border-border bg-white p-1.5 text-sm text-ink shadow-[0_12px_36px_rgba(31,45,53,0.16)] outline-none data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95",
					local.class,
				)}
			/>
		</KobalteDropdownMenu.Portal>
	);
}

export type DropdownMenuItemProps = ComponentProps<
	typeof KobalteDropdownMenu.Item
>;

export function DropdownMenuItem(props: DropdownMenuItemProps) {
	const [local, rest] = splitProps(props, ["class", "children"]);
	return (
		<KobalteDropdownMenu.Item
			{...rest}
			class={cn(
				"flex min-h-9 cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-primary-soft data-[highlighted]:text-primary-deep",
				local.class,
			)}
		>
			{local.children}
		</KobalteDropdownMenu.Item>
	);
}

export function DropdownMenuRadioItem(
	props: ComponentProps<typeof KobalteDropdownMenu.RadioItem>,
) {
	const [local, rest] = splitProps(props, ["class", "children"]);
	return (
		<KobalteDropdownMenu.RadioItem
			{...rest}
			closeOnSelect
			class={cn(
				"flex min-h-9 cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-primary-soft data-[highlighted]:text-primary-deep",
				local.class,
			)}
		>
			<span class="grid h-4 w-4 place-items-center">
				<KobalteDropdownMenu.ItemIndicator>
					<Check aria-hidden="true" size={14} />
				</KobalteDropdownMenu.ItemIndicator>
			</span>
			{local.children}
		</KobalteDropdownMenu.RadioItem>
	);
}
