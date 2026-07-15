import { createQuery } from "@tanstack/solid-query";
import { Show } from "solid-js";

import { Button } from "../../components/ui/button";
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogRoot,
	DialogTitle,
} from "../../components/ui/dialog";
import { useI18n } from "../../lib/i18n/i18n";
import type { AuditJsonValue } from "../../shared/api/audit";
import {
	auditActionLabel,
	auditResourceLabel,
	auditResultLabel,
} from "./labels";
import { auditDetailQueryOptions } from "./queries";

export interface AuditDetailDialogProps {
	readonly auditEventId?: string;
	readonly onClose: () => void;
}

function formattedJson(value: AuditJsonValue | null): string | null {
	return value === null ? null : JSON.stringify(value, null, 2);
}

export function AuditDetailDialog(props: AuditDetailDialogProps) {
	const i18n = useI18n();
	const detailQuery = createQuery(() => ({
		...auditDetailQueryOptions(props.auditEventId ?? ""),
		enabled: Boolean(props.auditEventId),
	}));

	return (
		<DialogRoot
			onOpenChange={(open) => {
				if (!open) props.onClose();
			}}
			open={Boolean(props.auditEventId)}
		>
			<DialogContent class="max-w-3xl">
				<DialogHeader>
					<DialogTitle class="text-base font-semibold text-ink">
						{i18n.t("audit.detail.title")}
					</DialogTitle>
					<DialogDescription class="text-sm text-muted">
						{i18n.t("audit.detail.description")}
					</DialogDescription>
				</DialogHeader>

				<Show
					when={!detailQuery.isError || detailQuery.data}
					fallback={
						<div class="rounded-lg border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
							<p class="m-0">{i18n.formatApiError(detailQuery.error)}</p>
							<Button
								class="mt-3"
								onClick={() => void detailQuery.refetch()}
								size="sm"
								type="button"
								variant="secondary"
							>
								{i18n.t("common.retry")}
							</Button>
						</div>
					}
				>
					<Show
						when={detailQuery.data}
						fallback={
							<div aria-busy="true" class="grid gap-3">
								<span class="sr-only">{i18n.t("a11y.loading")}</span>
								<div class="h-24 animate-pulse rounded-lg bg-mist" />
								<div class="h-40 animate-pulse rounded-lg bg-mist" />
							</div>
						}
					>
						{(detail) => (
							<div class="grid gap-4">
								<dl class="grid gap-x-5 gap-y-3 rounded-lg border border-border bg-mist/35 p-4 text-sm sm:grid-cols-2">
									<div>
										<dt class="text-xs font-medium text-muted">
											{i18n.t("audit.table.action")}
										</dt>
										<dd class="m-0 mt-1 font-medium text-ink">
											{auditActionLabel(i18n, detail().action)}
										</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-muted">
											{i18n.t("audit.table.result")}
										</dt>
										<dd
											class="m-0 mt-1 font-medium"
											classList={{
												"text-danger": detail().result === "failure",
												"text-primary-deep": detail().result === "success",
											}}
										>
											{auditResultLabel(i18n, detail().result)}
										</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-muted">
											{i18n.t("audit.table.actor")}
										</dt>
										<dd class="m-0 mt-1 break-all font-mono text-xs text-ink">
											{detail().actorId ?? i18n.t("audit.actor.system")}
										</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-muted">
											{i18n.t("table.createdAt")}
										</dt>
										<dd class="m-0 mt-1 text-ink">
											{i18n.formatDate(detail().createdAt)}
										</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-muted">
											{i18n.t("audit.table.resource")}
										</dt>
										<dd class="m-0 mt-1 text-ink">
											{auditResourceLabel(i18n, detail().resourceType)}
										</dd>
										<dd class="m-0 mt-0.5 break-all font-mono text-[11px] text-muted">
											{detail().resourceId || i18n.t("common.notAvailable")}
										</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-muted">
											{i18n.t("audit.detail.requestId")}
										</dt>
										<dd class="m-0 mt-1 break-all font-mono text-xs text-ink">
											{detail().requestId}
										</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-muted">
											{i18n.t("audit.detail.ip")}
										</dt>
										<dd class="m-0 mt-1 break-all text-ink">
											{detail().ip ?? i18n.t("common.notAvailable")}
										</dd>
									</div>
									<div>
										<dt class="text-xs font-medium text-muted">
											{i18n.t("audit.detail.userAgent")}
										</dt>
										<dd class="m-0 mt-1 break-words text-xs text-ink">
											{detail().userAgent ?? i18n.t("common.notAvailable")}
										</dd>
									</div>
								</dl>

								<div class="grid gap-4 lg:grid-cols-2">
									<section aria-labelledby="audit-before-title">
										<h3
											class="m-0 mb-2 text-sm font-semibold text-ink"
											id="audit-before-title"
										>
											{i18n.t("audit.detail.before")}
										</h3>
										<pre class="m-0 max-h-72 min-h-28 overflow-auto rounded-lg border border-border bg-[#f7faf9] p-3 text-xs leading-5 text-ink">
											<Show
												when={formattedJson(detail().before)}
												fallback={i18n.t("audit.detail.noSnapshot")}
											>
												{(value) => value()}
											</Show>
										</pre>
									</section>
									<section aria-labelledby="audit-after-title">
										<h3
											class="m-0 mb-2 text-sm font-semibold text-ink"
											id="audit-after-title"
										>
											{i18n.t("audit.detail.after")}
										</h3>
										<pre class="m-0 max-h-72 min-h-28 overflow-auto rounded-lg border border-border bg-[#f7faf9] p-3 text-xs leading-5 text-ink">
											<Show
												when={formattedJson(detail().after)}
												fallback={i18n.t("audit.detail.noSnapshot")}
											>
												{(value) => value()}
											</Show>
										</pre>
									</section>
								</div>
							</div>
						)}
					</Show>
				</Show>

				<DialogFooter>
					<Button onClick={props.onClose} type="button" variant="secondary">
						{i18n.t("common.close")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</DialogRoot>
	);
}
