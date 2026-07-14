import { useSelector } from "@tanstack/solid-store";
import { CircleCheck, RotateCcw, Trash2, X } from "lucide-solid";
import { For, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import type {
	UploadQueueController,
	UploadQueueItem,
	UploadQueueStatus,
	UploadWorkStage,
} from "./upload-store";

export interface UploadQueueLabels {
	readonly aggregateProgress: string;
	readonly cancel: string;
	readonly clearCompleted: string;
	readonly empty: string;
	readonly files: (count: number) => string;
	readonly hideCompleted: string;
	readonly remove: string;
	readonly retry: string;
	readonly showCompleted: string;
	readonly status: Readonly<Record<UploadQueueStatus, string>>;
}

export interface UploadQueueProps {
	readonly controller: UploadQueueController;
	readonly labels?: Partial<UploadQueueLabels>;
	readonly onCancel?: (
		item: UploadQueueItem,
		stage: UploadWorkStage | null,
	) => void;
	readonly onRemove?: (item: UploadQueueItem) => void;
	readonly onRetry?: (item: UploadQueueItem, stage: UploadWorkStage) => void;
}

const DEFAULT_STATUS_LABELS: Readonly<Record<UploadQueueStatus, string>> = {
	cancelled: "已取消",
	complete: "已登记",
	failed: "失败",
	hashing: "正在计算校验值",
	queued: "等待处理",
	ready: "等待上传",
	registering: "正在登记",
	uploaded: "已上传",
	uploading: "正在上传",
};

const DEFAULT_LABELS: UploadQueueLabels = {
	aggregateProgress: "总上传进度",
	cancel: "取消",
	clearCompleted: "清除已完成",
	empty: "尚未选择程序文件夹",
	files: (count) => `${count} 个文件`,
	hideCompleted: "隐藏已完成文件",
	remove: "移除",
	retry: "重试",
	showCompleted: "显示已完成文件",
	status: DEFAULT_STATUS_LABELS,
};

function formatBytes(size: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"] as const;
	let value = size;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return `${new Intl.NumberFormat(undefined, {
		maximumFractionDigits: unitIndex === 0 ? 0 : 1,
	}).format(value)} ${units[unitIndex]}`;
}

function itemProgress(item: UploadQueueItem): number {
	if (item.status === "hashing") return item.hashProgress;
	if (
		item.status === "uploaded" ||
		item.status === "registering" ||
		item.status === "complete"
	) {
		return 1;
	}
	return item.uploadProgress;
}

function canCancel(status: UploadQueueStatus): boolean {
	return (
		status === "queued" ||
		status === "hashing" ||
		status === "ready" ||
		status === "uploading"
	);
}

function canRemove(status: UploadQueueStatus): boolean {
	return (
		status === "queued" ||
		status === "ready" ||
		status === "uploaded" ||
		status === "complete" ||
		status === "failed" ||
		status === "cancelled"
	);
}

export function UploadQueue(props: UploadQueueProps) {
	const state = useSelector(props.controller.store, (current) => current);
	const labels = (): UploadQueueLabels => ({
		...DEFAULT_LABELS,
		...props.labels,
		status: {
			...DEFAULT_STATUS_LABELS,
			...props.labels?.status,
		},
	});
	const visibleItems = () =>
		state().showCompleted
			? state().items
			: state().items.filter((item) => item.status !== "complete");
	const aggregatePercent = () => Math.round(state().aggregateProgress * 100);

	return (
		<section
			aria-label={labels().aggregateProgress}
			class="grid gap-3 rounded-lg border border-border bg-white p-4"
		>
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="min-w-48 flex-1">
					<div class="mb-1.5 flex items-center justify-between gap-3 text-xs text-muted">
						<span>{labels().files(state().items.length)}</span>
						<span aria-live="polite">{aggregatePercent()}%</span>
					</div>
					<progress
						aria-label={labels().aggregateProgress}
						class="block h-2 w-full overflow-hidden rounded-full accent-primary"
						max="1"
						value={state().aggregateProgress}
					/>
				</div>
				<Show when={state().items.some((item) => item.status === "complete")}>
					<div class="flex items-center gap-2">
						<label class="flex cursor-pointer items-center gap-2 text-xs text-muted">
							<input
								checked={state().showCompleted}
								class="h-4 w-4 accent-primary"
								onChange={(event) =>
									props.controller.setShowCompleted(event.currentTarget.checked)
								}
								type="checkbox"
							/>
							{state().showCompleted
								? labels().hideCompleted
								: labels().showCompleted}
						</label>
						<Button
							onClick={() => props.controller.clearCompleted()}
							size="sm"
							type="button"
							variant="ghost"
						>
							{labels().clearCompleted}
						</Button>
					</div>
				</Show>
			</div>

			<Show
				fallback={
					<div class="rounded-md border border-dashed border-border-strong bg-surface px-4 py-8 text-center text-sm text-muted">
						{labels().empty}
					</div>
				}
				when={visibleItems().length > 0}
			>
				<ul class="m-0 grid list-none gap-2 p-0">
					<For each={visibleItems()}>
						{(item) => {
							const percent = () => Math.round(itemProgress(item) * 100);
							return (
								<li class="grid gap-2 rounded-md border border-border px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
									<div class="min-w-0">
										<div class="flex min-w-0 items-center gap-2">
											<Show when={item.status === "complete"}>
												<CircleCheck
													aria-hidden="true"
													class="h-4 w-4 shrink-0 text-primary"
												/>
											</Show>
											<span
												class="truncate text-sm font-medium text-ink"
												title={item.path}
											>
												{item.path}
											</span>
											<span class="shrink-0 text-xs text-muted">
												{formatBytes(item.size)}
											</span>
										</div>
										<div class="mt-1 flex items-center gap-2 text-xs">
											<span
												class={
													item.status === "failed"
														? "text-danger"
														: "text-muted"
												}
											>
												{labels().status[item.status]}
											</span>
											<Show
												when={
													item.status === "hashing" ||
													item.status === "uploading"
												}
											>
												<span class="text-muted">{percent()}%</span>
											</Show>
										</div>
										<Show
											when={
												item.status === "hashing" || item.status === "uploading"
											}
										>
											<progress
												aria-label={`${item.path} ${labels().status[item.status]}`}
												class="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full accent-primary"
												max="1"
												value={itemProgress(item)}
											/>
										</Show>
										<Show when={item.error}>
											<p class="m-0 mt-1 text-xs text-danger" role="alert">
												{item.error}
											</p>
										</Show>
									</div>
									<div class="flex items-center justify-end gap-1">
										<Show when={canCancel(item.status)}>
											<Button
												aria-label={`${labels().cancel}: ${item.path}`}
												onClick={() => {
													const stage = props.controller.cancel(item.id);
													props.onCancel?.(item, stage);
												}}
												size="icon"
												title={labels().cancel}
												type="button"
												variant="ghost"
											>
												<X aria-hidden="true" class="h-4 w-4" />
											</Button>
										</Show>
										<Show
											when={
												item.status === "failed" || item.status === "cancelled"
											}
										>
											<Button
												aria-label={`${labels().retry}: ${item.path}`}
												onClick={() => {
													const stage = props.controller.prepareRetry(item.id);
													if (stage) props.onRetry?.(item, stage);
												}}
												size="icon"
												title={labels().retry}
												type="button"
												variant="ghost"
											>
												<RotateCcw aria-hidden="true" class="h-4 w-4" />
											</Button>
										</Show>
										<Show when={canRemove(item.status)}>
											<Button
												aria-label={`${labels().remove}: ${item.path}`}
												onClick={() => {
													props.controller.remove(item.id);
													props.onRemove?.(item);
												}}
												size="icon"
												title={labels().remove}
												type="button"
												variant="ghost"
											>
												<Trash2 aria-hidden="true" class="h-4 w-4" />
											</Button>
										</Show>
									</div>
								</li>
							);
						}}
					</For>
				</ul>
			</Show>
		</section>
	);
}
