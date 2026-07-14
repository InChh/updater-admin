import { Toast, toaster } from "@kobalte/core/toast";
import { CheckCircle2, CircleAlert, X } from "lucide-solid";
import { Show } from "solid-js";

import { useI18n } from "../../lib/i18n/i18n";

export type ToastTone = "success" | "error";

export function notify(
	title: string,
	description?: string,
	tone: ToastTone = "success",
) {
	return toaster.show((toast) => (
		<ToastItem
			description={description}
			toastId={toast.toastId}
			title={title}
			tone={tone}
		/>
	));
}

function ToastItem(props: {
	readonly description?: string;
	readonly title: string;
	readonly toastId: number;
	readonly tone: ToastTone;
}) {
	const i18n = useI18n();
	return (
		<Toast
			toastId={props.toastId}
			class="pointer-events-auto flex w-[min(22rem,calc(100vw-2rem))] gap-3 rounded-lg border border-border bg-white p-3.5 shadow-[0_12px_38px_rgba(31,45,53,0.18)] data-[opened]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[opened]:slide-in-from-right-3"
		>
			<Show
				when={props.tone === "success"}
				fallback={<CircleAlert class="mt-0.5 text-danger" size={18} />}
			>
				<CheckCircle2 class="mt-0.5 text-primary" size={18} />
			</Show>
			<div class="min-w-0 flex-1">
				<Toast.Title class="text-sm font-semibold text-ink">
					{props.title}
				</Toast.Title>
				<Show when={props.description}>
					<Toast.Description class="mt-1 text-xs leading-5 text-muted">
						{props.description}
					</Toast.Description>
				</Show>
			</div>
			<Toast.CloseButton
				aria-label={i18n.t("dialog.close")}
				class="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-mist hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep"
			>
				<X aria-hidden="true" size={15} />
			</Toast.CloseButton>
		</Toast>
	);
}

export function ToastRegion() {
	return (
		<Toast.Region>
			<Toast.List class="pointer-events-none fixed right-4 top-4 z-[100] flex flex-col gap-2 outline-none" />
		</Toast.Region>
	);
}
