import { Dialog as KobalteDialog } from "@kobalte/core/dialog";
import { X } from "lucide-solid";
import { type ComponentProps, splitProps } from "solid-js";
import { useI18n } from "../../lib/i18n/i18n";
import { cn } from "../../lib/utils";

export const DialogRoot = KobalteDialog;
export const DialogTrigger = KobalteDialog.Trigger;
export const DialogCloseButton = KobalteDialog.CloseButton;
export const DialogTitle = KobalteDialog.Title;
export const DialogDescription = KobalteDialog.Description;

type DialogContentProps = ComponentProps<typeof KobalteDialog.Content> & {
	readonly closeDisabled?: boolean;
};

export function DialogContent(props: DialogContentProps) {
	const i18n = useI18n();
	const [local, rest] = splitProps(props, [
		"class",
		"children",
		"closeDisabled",
	]);
	return (
		<KobalteDialog.Portal>
			<KobalteDialog.Overlay class="fixed inset-0 z-50 bg-ink/38 backdrop-blur-[1px] data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0" />
			<div class="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
				<KobalteDialog.Content
					{...rest}
					class={cn(
						"relative my-auto w-full max-w-lg rounded-lg border border-border bg-white p-5 shadow-[0_18px_56px_rgba(31,45,53,0.2)] outline-none data-[expanded]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[expanded]:fade-in-0 data-[closed]:zoom-out-95 data-[expanded]:zoom-in-95",
						local.class,
					)}
				>
					{local.children}
					<KobalteDialog.CloseButton
						aria-label={i18n.t("dialog.close")}
						class="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-md text-muted transition hover:bg-mist hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
						disabled={local.closeDisabled}
					>
						<X aria-hidden="true" size={17} />
					</KobalteDialog.CloseButton>
				</KobalteDialog.Content>
			</div>
		</KobalteDialog.Portal>
	);
}

export function DialogHeader(props: ComponentProps<"div">) {
	const [local, rest] = splitProps(props, ["class"]);
	return <div {...rest} class={cn("mb-5 grid gap-1 pr-9", local.class)} />;
}

export function DialogFooter(props: ComponentProps<"div">) {
	const [local, rest] = splitProps(props, ["class"]);
	return (
		<div {...rest} class={cn("mt-5 flex justify-end gap-2", local.class)} />
	);
}
