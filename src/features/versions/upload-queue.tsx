import { useSelector } from "@tanstack/solid-store";
import { CircleCheck, RotateCcw, Trash2, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import type {
	UploadQueueController,
	UploadQueueItem,
	UploadQueueStatus,
} from "./upload-store";

export interface UploadQueueLabels {
	readonly associatedCount: (count: number) => string;
	readonly aggregateProgress: string;
	readonly cancel: string;
	readonly clearCompleted: string;
	readonly empty: string;
	readonly files: (count: number) => string;
	readonly hideCompleted: string;
	readonly hashedCount: (count: number) => string;
	readonly nextFiles: string;
	readonly previousFiles: string;
	readonly remove: string;
	readonly reusedCount: (count: number) => string;
	readonly retry: string;
	readonly showCompleted: string;
	readonly status: Readonly<Record<UploadQueueStatus, string>>;
	readonly totalSize: (bytes: number) => string;
	readonly uploadRequiredCount: (count: number) => string;
	readonly uploadedCount: (count: number) => string;
	readonly failedCount: (count: number) => string;
	readonly visibleRange: (from: number, to: number, total: number) => string;
}

export interface UploadQueueProps {
	readonly controller: UploadQueueController;
	readonly labels?: Partial<UploadQueueLabels>;
	/** The workflow owns cancellation so it can stop the active worker/client. */
	readonly onCancel?: (item: UploadQueueItem) => void;
	readonly onRemove?: (item: UploadQueueItem) => void;
	/** The workflow owns retry state transitions when this callback is provided. */
	readonly onRetry?: (item: UploadQueueItem) => void;
}

const DEFAULT_STATUS_LABELS: Readonly<Record<UploadQueueStatus, string>> = {
	cancelled: "已取消",
	complete: "已登记",
	failed: "失败",
	hashing: "正在计算校验值",
	resolving: "正在检查是否可复用",
	queued: "等待处理",
	ready: "等待上传",
	registering: "正在登记",
	uploaded: "已上传",
	uploading: "正在上传",
};

export const UPLOAD_QUEUE_RENDER_WINDOW_SIZE = 100;

const DEFAULT_LABELS: UploadQueueLabels = {
	associatedCount: (count) => `已关联 ${count}`,
	aggregateProgress: "总上传进度",
	cancel: "取消",
	clearCompleted: "清除已完成",
	empty: "尚未选择程序文件夹",
	files: (count) => `${count} 个文件`,
	hideCompleted: "隐藏已完成文件",
	hashedCount: (count) => `已哈希 ${count}`,
	nextFiles: "下一批文件",
	previousFiles: "上一批文件",
	remove: "移除",
	reusedCount: (count) => `已复用 ${count}`,
	retry: "重试",
	showCompleted: "显示已完成文件",
	status: DEFAULT_STATUS_LABELS,
	totalSize: (bytes) => `总计 ${formatUploadBytes(bytes)}`,
	uploadRequiredCount: (count) => `需上传 ${count}`,
	uploadedCount: (count) => `已上传 ${count}`,
	failedCount: (count) => `失败 ${count}`,
	visibleRange: (from, to, total) => `显示第 ${from}–${to} 个，共 ${total} 个`,
};

export function formatUploadBytes(size: number): string {
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
		status === "resolving" ||
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
	const [windowStart, setWindowStart] = createSignal(0);
	const labels = (): UploadQueueLabels => ({
		...DEFAULT_LABELS,
		...props.labels,
		status: {
			...DEFAULT_STATUS_LABELS,
			...props.labels?.status,
		},
	});
	const visibleItems = createMemo(() =>
		state().items.filter(
			(item) =>
				!item.dismissed &&
				(state().showCompleted || item.status !== "complete"),
		),
	);
	const maximumWindowStart = () => {
		const count = visibleItems().length;
		return count === 0
			? 0
			: Math.floor((count - 1) / UPLOAD_QUEUE_RENDER_WINDOW_SIZE) *
					UPLOAD_QUEUE_RENDER_WINDOW_SIZE;
	};
	createEffect(() => {
		const maximum = maximumWindowStart();
		if (windowStart() > maximum) setWindowStart(maximum);
	});
	const renderedItems = () =>
		visibleItems().slice(
			windowStart(),
			windowStart() + UPLOAD_QUEUE_RENDER_WINDOW_SIZE,
		);
	const visibleRangeEnd = () =>
		Math.min(
			windowStart() + UPLOAD_QUEUE_RENDER_WINDOW_SIZE,
			visibleItems().length,
		);
	const hasClearableCompletedItems = () =>
		state().items.some((item) => item.status === "complete" && !item.dismissed);
	const aggregatePercent = () => Math.round(state().aggregateProgress * 100);
	const totalSize = () =>
		state().items.reduce((total, item) => total + item.size, 0);
	const counts = () => {
		const items = state().items;
		return {
			associated: items.filter(({ status }) => status === "complete").length,
			failed: items.filter(
				({ status }) => status === "failed" || status === "cancelled",
			).length,
			hashed: items.filter(({ sha256 }) => sha256 !== null).length,
			reused: items.filter(
				({ resolutionStatus }) => resolutionStatus === "reused",
			).length,
			uploadRequired: items.filter(
				({ resolutionStatus }) => resolutionStatus === "uploadRequired",
			).length,
			uploaded: items.filter(
				({ resolutionStatus, status }) =>
					resolutionStatus === "uploadRequired" &&
					(status === "uploaded" ||
						status === "registering" ||
						status === "complete"),
			).length,
		};
	};

	return (
		<section
			aria-label={labels().aggregateProgress}
			class="grid gap-3 rounded-lg border border-border bg-white p-4"
		>
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="min-w-48 flex-1">
					<div class="mb-1.5 flex items-center justify-between gap-3 text-xs text-muted">
						<span>
							{labels().files(state().items.length)} ·{" "}
							{labels().totalSize(totalSize())}
						</span>
						<span aria-live="polite">{aggregatePercent()}%</span>
					</div>
					<progress
						aria-label={labels().aggregateProgress}
						class="block h-2 w-full overflow-hidden rounded-full accent-primary"
						max="1"
						value={state().aggregateProgress}
					/>
				</div>
				<Show when={hasClearableCompletedItems()}>
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
			<div
				class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted"
				aria-live="polite"
			>
				<span>{labels().hashedCount(counts().hashed)}</span>
				<span>{labels().reusedCount(counts().reused)}</span>
				<span>{labels().uploadRequiredCount(counts().uploadRequired)}</span>
				<span>{labels().uploadedCount(counts().uploaded)}</span>
				<span>{labels().associatedCount(counts().associated)}</span>
				<span>{labels().failedCount(counts().failed)}</span>
			</div>
			<Show when={visibleItems().length > UPLOAD_QUEUE_RENDER_WINDOW_SIZE}>
				<div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
					<span>
						{labels().visibleRange(
							windowStart() + 1,
							visibleRangeEnd(),
							visibleItems().length,
						)}
					</span>
					<div class="flex items-center gap-2">
						<Button
							disabled={windowStart() === 0}
							onClick={() =>
								setWindowStart((current) =>
									Math.max(0, current - UPLOAD_QUEUE_RENDER_WINDOW_SIZE),
								)
							}
							size="sm"
							type="button"
							variant="secondary"
						>
							{labels().previousFiles}
						</Button>
						<Button
							disabled={visibleRangeEnd() >= visibleItems().length}
							onClick={() =>
								setWindowStart((current) =>
									Math.min(
										maximumWindowStart(),
										current + UPLOAD_QUEUE_RENDER_WINDOW_SIZE,
									),
								)
							}
							size="sm"
							type="button"
							variant="secondary"
						>
							{labels().nextFiles}
						</Button>
					</div>
				</div>
			</Show>

			<Show
				fallback={
					<div class="rounded-md border border-dashed border-border-strong bg-surface px-4 py-8 text-center text-sm text-muted">
						{labels().empty}
					</div>
				}
				when={renderedItems().length > 0}
			>
				<ul class="m-0 grid max-h-[min(40vh,24rem)] list-none gap-2 overflow-y-auto p-0 pr-1">
					<For each={renderedItems()}>
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
												{formatUploadBytes(item.size)}
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
													if (props.onCancel) props.onCancel(item);
													else props.controller.cancel(item.id);
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
													if (props.onRetry) props.onRetry(item);
													else props.controller.prepareRetry(item.id);
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
													if (props.onRemove) props.onRemove(item);
													else props.controller.remove(item.id);
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
