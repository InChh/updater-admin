import {
	createMutation,
	createQuery,
	useQueryClient,
} from "@tanstack/solid-query";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import {
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogRoot,
	DialogTitle,
} from "../../components/ui/dialog";
import { notify } from "../../components/ui/toast";
import { ApiProblemError } from "../../lib/api/client";
import { programQueryKeys, versionQueryKeys } from "../../lib/api/query-keys";
import { useI18n } from "../../lib/i18n/i18n";
import type { EntityResult } from "../../shared/api/common";
import type {
	UpdateVersionInput,
	VersionDetailDto,
} from "../../shared/api/versions";
import {
	completeDraftFiles,
	createVersion,
	deleteVersion,
	finalizeDraftVersion,
	requestUploadCredentials,
	resolveDraftFiles,
	updateVersion,
} from "./api";
import { invalidateVersionDetails } from "./cache";
import { versionDetailQueryOptions } from "./queries";
import type { VersionDialog } from "./search";
import {
	createUploadExclusionConfig,
	type UploadExclusionConfig,
} from "./upload-exclusions";
import { formatUploadBytes } from "./upload-queue";
import { createUploadQueueController } from "./upload-store";
import {
	createUploadWorkflow,
	type UploadWorkflow,
} from "./upload-workflow.client";
import {
	VersionForm,
	type VersionFormDraft,
	type VersionFormField,
	type VersionFormLabels,
	type VersionFormValue,
} from "./version-form";

const DISABLED_VERSION_ID = "00000000-0000-0000-0000-000000000000";

export interface VersionUploadSession {
	readonly exclusionConfig: UploadExclusionConfig;
	readonly queue: ReturnType<typeof createUploadQueueController>;
	readonly workflow: UploadWorkflow;
}

export type VersionUploadSessionFactory = () => VersionUploadSession;

export interface VersionDialogsProps {
	readonly dialog?: VersionDialog;
	readonly onClose: () => void;
	readonly onDeleted: () => void;
	readonly onRestoreFocus?: () => void;
	readonly programId: string;
	readonly uploadSessionFactory?: VersionUploadSessionFactory;
	readonly versionId?: string;
}

type VersionFieldErrors = Partial<Record<VersionFormField, string>>;

function formDraft(
	version: EntityResult<VersionDetailDto>,
): VersionFormDraft | undefined {
	if (
		version.data.lifecycleStatus !== "draft" ||
		version.data.expectedFileCount === null
	) {
		return undefined;
	}
	return {
		etag: version.etag,
		expectedFileCount: version.data.expectedFileCount,
		programId: version.data.programId,
		versionId: version.data.id,
	};
}

export function createDefaultVersionUploadSession(): VersionUploadSession {
	const queue = createUploadQueueController();
	return {
		exclusionConfig: createUploadExclusionConfig(),
		queue,
		workflow: createUploadWorkflow(queue, {
			completeUploads: (input, signal, draft) => {
				if (!draft)
					throw new Error("Draft context is required for completion.");
				return completeDraftFiles(
					draft.programId,
					draft.versionId,
					input,
					signal,
				);
			},
			requestCredentials: requestUploadCredentials,
			resolveFiles: (input, signal, draft) => {
				if (!draft)
					throw new Error("Draft context is required for resolution.");
				return resolveDraftFiles(
					draft.programId,
					draft.versionId,
					input,
					signal,
				);
			},
		}),
	};
}

function VersionFormSession(props: {
	readonly factory: VersionUploadSessionFactory;
	readonly initialDraft?: VersionFormDraft;
	readonly initialRevision?: string;
	readonly initialValue?: Pick<
		VersionFormValue,
		"description" | "versionNumber"
	>;
	readonly labels: VersionFormLabels;
	readonly mode: "create" | "edit" | "resume";
	readonly onCancel: () => void;
	readonly onFieldInput: (field: VersionFormField) => void;
	readonly onPrepareDraft?: (
		value: VersionFormValue,
		expectedFileCount: number,
	) => Promise<VersionFormDraft>;
	readonly onSubmit: (
		value: VersionFormValue,
		draft?: VersionFormDraft,
	) => Promise<void>;
	readonly serverErrors: VersionFieldErrors;
	readonly submitError: string;
}) {
	const session = props.factory();
	return (
		<VersionForm
			exclusionConfig={session.exclusionConfig}
			initialDraft={props.initialDraft}
			initialRevision={props.initialRevision}
			initialValue={props.initialValue}
			labels={props.labels}
			mode={props.mode}
			onCancel={props.onCancel}
			onFieldInput={props.onFieldInput}
			onPrepareDraft={props.onPrepareDraft}
			onSubmit={props.onSubmit}
			queue={session.queue}
			serverErrors={props.serverErrors}
			submitError={props.submitError}
			workflow={session.workflow}
		/>
	);
}

export function VersionDialogs(props: VersionDialogsProps) {
	const i18n = useI18n();
	const queryClient = useQueryClient();
	const [fieldErrors, setFieldErrors] = createSignal<VersionFieldErrors>({});
	const [submitError, setSubmitError] = createSignal("");
	const uploadSessions = new Map<string, VersionUploadSession>();
	const createSession = () =>
		(props.uploadSessionFactory ?? createDefaultVersionUploadSession)();
	const versionSessionKey = (versionId: string) => `version:${versionId}`;
	const currentSessionKey = () =>
		props.dialog === "create"
			? "create"
			: props.versionId
				? versionSessionKey(props.versionId)
				: "create";
	const getUploadSession = (key: string) => {
		const existing = uploadSessions.get(key);
		if (existing) return existing;
		const created = createSession();
		uploadSessions.set(key, created);
		return created;
	};
	const currentSessionFactory = (): VersionUploadSessionFactory => {
		const key = currentSessionKey();
		return () => getUploadSession(key);
	};
	const disposeSession = (key: string) => {
		const session = uploadSessions.get(key);
		if (!session) return;
		uploadSessions.delete(key);
		if ([...uploadSessions.values()].includes(session)) return;
		session.workflow.dispose();
		session.queue.dispose();
	};
	const promoteCreateSession = (versionId: string) => {
		const session = uploadSessions.get("create");
		if (!session) return;
		uploadSessions.delete("create");
		const key = versionSessionKey(versionId);
		const replaced = uploadSessions.get(key);
		if (replaced && replaced !== session) {
			replaced.workflow.dispose();
			replaced.queue.dispose();
		}
		uploadSessions.set(key, session);
	};
	onCleanup(() => {
		for (const session of new Set(uploadSessions.values())) {
			session.workflow.dispose();
			session.queue.dispose();
		}
		uploadSessions.clear();
	});
	const detailQuery = createQuery(() => ({
		...versionDetailQueryOptions(
			props.programId,
			props.versionId ?? DISABLED_VERSION_ID,
		),
		enabled: Boolean(
			props.versionId && (props.dialog === "edit" || props.dialog === "delete"),
		),
	}));
	const createMutationResult = createMutation(() => ({
		mutationFn: (input: {
			readonly expectedFileCount: number;
			readonly value: VersionFormValue;
		}) => {
			return createVersion(props.programId, {
				description: input.value.description,
				expectedFileCount: input.expectedFileCount,
				versionNumber: input.value.versionNumber,
			});
		},
	}));
	const finalizeMutationResult = createMutation(() => ({
		mutationFn: (draft: VersionFormDraft) =>
			finalizeDraftVersion(draft.programId, draft.versionId, draft.etag),
	}));
	const updateMutationResult = createMutation(() => ({
		mutationFn: (input: {
			readonly current: EntityResult<VersionDetailDto>;
			readonly value: VersionFormValue;
		}) => {
			const update: UpdateVersionInput = {
				description: input.value.description,
				...(input.value.versionNumber === input.current.data.versionNumber
					? {}
					: { versionNumber: input.value.versionNumber }),
			};
			return updateVersion(
				props.programId,
				input.current.data.id,
				update,
				input.current.etag,
			);
		},
	}));
	const deleteMutationResult = createMutation(() => ({
		mutationFn: (version: EntityResult<VersionDetailDto>) =>
			deleteVersion(props.programId, version.data.id, version.etag),
	}));
	const createPending = () =>
		createMutationResult.isPending || finalizeMutationResult.isPending;
	const detailPending = () =>
		updateMutationResult.isPending ||
		finalizeMutationResult.isPending ||
		deleteMutationResult.isPending;
	const closeCreateDialog = () => {
		const session = uploadSessions.get("create");
		if (session && !session.workflow.getDraft()) disposeSession("create");
		props.onClose();
	};
	const closeDetailDialog = () => {
		if (props.versionId && detailQuery.data?.data.lifecycleStatus !== "draft") {
			disposeSession(versionSessionKey(props.versionId));
		}
		props.onClose();
	};
	const restoreFocus = (event: Event) => {
		if (!props.onRestoreFocus) return;
		event.preventDefault();
		queueMicrotask(props.onRestoreFocus);
	};

	createEffect(() => {
		props.dialog;
		props.versionId;
		setFieldErrors({});
		setSubmitError("");
	});

	const formLabels = (): VersionFormLabels => ({
		cancel: i18n.t("common.cancel"),
		clearFolder: i18n.t("versions.form.clearFolder"),
		description: i18n.t("versions.form.description"),
		descriptionTooLong: i18n.t("versions.errors.descriptionTooLong"),
		draftReady: i18n.t("versions.upload.draftReady"),
		exclusions: i18n.t("versions.upload.exclusions.label"),
		exclusionsDescription: i18n.t("versions.upload.exclusions.description"),
		exclusionsInvalid: i18n.t("versions.upload.exclusions.invalid"),
		filesExpected: i18n.t("versions.errors.filesExpected"),
		filesRequired: i18n.t("versions.errors.filesRequired"),
		finalizedFilesImmutable: i18n.t("versions.form.finalizedFilesImmutable"),
		folder: i18n.t("versions.form.folder"),
		folderPicker: {
			choose: i18n.t("versions.upload.choose"),
			description: i18n.t("versions.upload.description"),
			errors: {
				ALL_FILES_EXCLUDED: i18n.t("versions.upload.error.allFilesExcluded"),
				FILE_TOO_LARGE: i18n.t("versions.upload.error.fileTooLarge"),
				INVALID_PATH: i18n.t("versions.upload.error.invalidPath"),
			},
			selected: (count, excludedCount) =>
				excludedCount > 0
					? i18n.t("versions.upload.selectedWithExcluded", {
							count: i18n.formatNumber(count),
							excluded: i18n.formatNumber(excludedCount),
						})
					: i18n.t("versions.upload.selected", {
							count: i18n.formatNumber(count),
						}),
		},
		pending: i18n.t("common.saving"),
		retry: i18n.t("common.retry"),
		submit: i18n.t("common.save"),
		startUpload: i18n.t("versions.upload.start"),
		uploadFailed: i18n.t("versions.errors.uploadFailed"),
		uploadIncomplete: i18n.t("versions.errors.uploadIncomplete"),
		uploadQueue: {
			associatedCount: (count) =>
				i18n.t("versions.upload.count.associated", {
					count: i18n.formatNumber(count),
				}),
			aggregateProgress: i18n.t("versions.upload.progress"),
			cancel: i18n.t("versions.upload.cancel"),
			clearCompleted: i18n.t("versions.upload.clearCompleted"),
			empty: i18n.t("versions.upload.empty"),
			files: (count) =>
				i18n.t("versions.upload.files", {
					count: i18n.formatNumber(count),
				}),
			hideCompleted: i18n.t("versions.upload.hideCompleted"),
			hashedCount: (count) =>
				i18n.t("versions.upload.count.hashed", {
					count: i18n.formatNumber(count),
				}),
			nextFiles: i18n.t("versions.upload.window.next"),
			previousFiles: i18n.t("versions.upload.window.previous"),
			remove: i18n.t("versions.upload.remove"),
			reusedCount: (count) =>
				i18n.t("versions.upload.count.reused", {
					count: i18n.formatNumber(count),
				}),
			retry: i18n.t("versions.upload.retry"),
			showCompleted: i18n.t("versions.upload.showCompleted"),
			status: {
				cancelled: i18n.t("versions.upload.status.cancelled"),
				complete: i18n.t("versions.upload.status.complete"),
				failed: i18n.t("versions.upload.status.failed"),
				hashing: i18n.t("versions.upload.status.hashing"),
				queued: i18n.t("versions.upload.status.queued"),
				ready: i18n.t("versions.upload.status.ready"),
				registering: i18n.t("versions.upload.status.registering"),
				resolving: i18n.t("versions.upload.status.resolving"),
				uploaded: i18n.t("versions.upload.status.uploaded"),
				uploading: i18n.t("versions.upload.status.uploading"),
			},
			totalSize: (bytes) =>
				i18n.t("versions.upload.totalSize", {
					size: formatUploadBytes(bytes),
				}),
			uploadRequiredCount: (count) =>
				i18n.t("versions.upload.count.uploadRequired", {
					count: i18n.formatNumber(count),
				}),
			uploadedCount: (count) =>
				i18n.t("versions.upload.count.uploaded", {
					count: i18n.formatNumber(count),
				}),
			failedCount: (count) =>
				i18n.t("versions.upload.count.failed", {
					count: i18n.formatNumber(count),
				}),
			visibleRange: (from, to, total) =>
				i18n.t("versions.upload.window.summary", {
					from: i18n.formatNumber(from),
					to: i18n.formatNumber(to),
					total: i18n.formatNumber(total),
				}),
		},
		versionNumber: i18n.t("versions.form.versionNumber"),
		versionNumberInvalid: i18n.t("versions.errors.versionNumberInvalid"),
	});

	const clearFieldError = (field: VersionFormField) => {
		setFieldErrors((current) => ({ ...current, [field]: undefined }));
		setSubmitError("");
	};
	const invalidateVersionLists = () =>
		queryClient.invalidateQueries({
			queryKey: versionQueryKeys.lists(props.programId),
		});
	const invalidateProgramVersionCount = () =>
		Promise.all([
			queryClient.invalidateQueries({
				exact: true,
				queryKey: programQueryKeys.detail(props.programId),
			}),
			queryClient.invalidateQueries({
				queryKey: programQueryKeys.lists(),
			}),
		]);
	const storeVersion = (version: EntityResult<VersionDetailDto>) => {
		queryClient.setQueryData(
			versionQueryKeys.detail(props.programId, version.data.id),
			version,
		);
	};
	const setMutationError = async (error: unknown, versionId?: string) => {
		if (error instanceof ApiProblemError && error.code === "STALE_WRITE") {
			if (versionId) {
				await Promise.all([
					queryClient.invalidateQueries({
						exact: true,
						queryKey: versionQueryKeys.detail(props.programId, versionId),
					}),
					invalidateVersionLists(),
				]);
			}
			setSubmitError(i18n.t("versions.errors.staleRefreshed"));
			return;
		}

		const nextFieldErrors: VersionFieldErrors = {};
		if (error instanceof ApiProblemError) {
			for (const fieldError of error.problem.fieldErrors ?? []) {
				if (fieldError.path === "versionNumber") {
					nextFieldErrors.versionNumber =
						fieldError.code === "VERSION_NUMBER_CONFLICT"
							? i18n.t("versions.errors.versionConflict")
							: fieldError.code === "VERSION_NOT_GREATER"
								? i18n.t("versions.errors.versionNotGreater")
								: i18n.t("versions.errors.versionNumberInvalid");
				}
				if (fieldError.path === "description") {
					nextFieldErrors.description =
						fieldError.code === "TOO_LONG"
							? i18n.t("versions.errors.descriptionTooLong")
							: i18n.t("errors.field.invalid");
				}
			}
			if (error.code === "VERSION_NUMBER_CONFLICT") {
				nextFieldErrors.versionNumber = i18n.t(
					"versions.errors.versionConflict",
				);
			}
			if (error.code === "VERSION_NOT_GREATER") {
				nextFieldErrors.versionNumber = i18n.t(
					"versions.errors.versionNotGreater",
				);
			}
			if (
				error.code === "DRAFT_INCOMPLETE" ||
				error.code === "DRAFT_FILE_COUNT_CONFLICT"
			) {
				setSubmitError(i18n.t("versions.errors.uploadIncomplete"));
				return;
			}
		}
		setFieldErrors(nextFieldErrors);
		setSubmitError(
			Object.keys(nextFieldErrors).length > 0 ? "" : i18n.formatApiError(error),
		);
	};

	const prepareDraft = async (
		value: VersionFormValue,
		expectedFileCount: number,
	): Promise<VersionFormDraft> => {
		setFieldErrors({});
		setSubmitError("");
		try {
			const created = await createMutationResult.mutateAsync({
				expectedFileCount,
				value,
			});
			promoteCreateSession(created.data.id);
			storeVersion(created);
			// Updating the parent program detail while the browser owns File and
			// Worker state remounts the nested versions route and disposes the live
			// upload session. Defer the parent count refresh until finalization; a
			// durable draft is still discoverable from the invalidated version list.
			await invalidateVersionLists();
			return {
				etag: created.etag,
				expectedFileCount,
				programId: created.data.programId,
				versionId: created.data.id,
			};
		} catch (error) {
			await setMutationError(error);
			throw error;
		}
	};
	const submitFinalize = async (
		_value: VersionFormValue,
		draft?: VersionFormDraft,
	) => {
		if (!draft) throw new TypeError("Draft finalization requires a draft.");
		setFieldErrors({});
		setSubmitError("");
		try {
			const finalized = await finalizeMutationResult.mutateAsync(draft);
			disposeSession(versionSessionKey(draft.versionId));
			storeVersion(finalized);
			await Promise.all([
				invalidateVersionLists(),
				invalidateVersionDetails(queryClient, props.programId),
				invalidateProgramVersionCount(),
			]);
			notify(i18n.t("versions.notifications.finalized"));
			if (
				props.dialog === "create" ||
				(props.dialog === "edit" && props.versionId === draft.versionId)
			) {
				props.onClose();
			}
		} catch (error) {
			await setMutationError(error, draft.versionId);
		}
	};
	const submitEdit = async (
		version: EntityResult<VersionDetailDto>,
		value: VersionFormValue,
	) => {
		setFieldErrors({});
		setSubmitError("");
		try {
			const updated = await updateMutationResult.mutateAsync({
				current: version,
				value,
			});
			disposeSession(versionSessionKey(version.data.id));
			storeVersion(updated);
			await Promise.all([
				invalidateVersionLists(),
				invalidateVersionDetails(queryClient, props.programId),
			]);
			notify(i18n.t("versions.notifications.updated"));
			if (props.dialog === "edit" && props.versionId === version.data.id) {
				props.onClose();
			}
		} catch (error) {
			await setMutationError(error, version.data.id);
		}
	};
	const confirmDelete = async (version: EntityResult<VersionDetailDto>) => {
		setSubmitError("");
		try {
			await deleteMutationResult.mutateAsync(version);
			disposeSession(versionSessionKey(version.data.id));
			queryClient.removeQueries({
				exact: true,
				queryKey: versionQueryKeys.detail(props.programId, version.data.id),
			});
			await Promise.all([
				invalidateVersionLists(),
				invalidateVersionDetails(queryClient, props.programId),
				invalidateProgramVersionCount(),
			]);
			notify(i18n.t("versions.notifications.deleted"));
			if (props.dialog === "delete" && props.versionId === version.data.id) {
				props.onDeleted();
			}
		} catch (error) {
			await setMutationError(error, version.data.id);
		}
	};

	return (
		<>
			<DialogRoot
				onOpenChange={(open) => {
					if (!open && !createPending()) closeCreateDialog();
				}}
				open={props.dialog === "create"}
			>
				<DialogContent
					class="max-w-3xl"
					closeDisabled={createPending()}
					onCloseAutoFocus={restoreFocus}
				>
					<DialogHeader>
						<DialogTitle class="text-base font-semibold text-ink">
							{i18n.t("versions.dialog.createTitle")}
						</DialogTitle>
						<DialogDescription class="text-sm text-muted">
							{i18n.t("versions.dialog.createDescription")}
						</DialogDescription>
					</DialogHeader>
					<Show when={props.dialog === "create"}>
						<VersionFormSession
							factory={currentSessionFactory()}
							labels={{
								...formLabels(),
								submit: i18n.t("versions.actions.finalize"),
							}}
							mode="create"
							onCancel={closeCreateDialog}
							onFieldInput={clearFieldError}
							onPrepareDraft={prepareDraft}
							onSubmit={submitFinalize}
							serverErrors={fieldErrors()}
							submitError={submitError()}
						/>
					</Show>
				</DialogContent>
			</DialogRoot>

			<DialogRoot
				onOpenChange={(open) => {
					if (!open && !detailPending()) closeDetailDialog();
				}}
				open={props.dialog === "edit" || props.dialog === "delete"}
			>
				<DialogContent
					class={props.dialog === "edit" ? "max-w-3xl" : undefined}
					closeDisabled={detailPending()}
					onCloseAutoFocus={restoreFocus}
				>
					<DialogHeader>
						<DialogTitle class="text-base font-semibold text-ink">
							{props.dialog === "delete"
								? i18n.t("versions.dialog.deleteTitle")
								: detailQuery.data?.data.lifecycleStatus === "draft"
									? i18n.t("versions.dialog.resumeTitle")
									: i18n.t("versions.dialog.editTitle")}
						</DialogTitle>
						<DialogDescription class="text-sm leading-6 text-muted">
							{props.dialog === "delete" && detailQuery.data
								? i18n.t("versions.dialog.deleteDescription", {
										version: detailQuery.data.data.versionNumber,
									})
								: props.dialog === "edit"
									? i18n.t(
											detailQuery.data?.data.lifecycleStatus === "draft"
												? "versions.dialog.resumeDescription"
												: "versions.dialog.editDescription",
										)
									: i18n.t("versions.dialog.loadDescription")}
						</DialogDescription>
					</DialogHeader>
					<Show
						when={detailQuery.data}
						fallback={
							detailQuery.isError ? (
								<div class="grid gap-3 py-8 text-center">
									<p class="m-0 text-sm text-danger" role="alert">
										{i18n.formatApiError(detailQuery.error)}
									</p>
									<Button
										class="mx-auto"
										onClick={() => void detailQuery.refetch()}
										type="button"
										variant="secondary"
									>
										{i18n.t("common.retry")}
									</Button>
								</div>
							) : (
								<output class="grid min-h-44 place-items-center text-sm text-muted">
									{i18n.t("common.loading")}
								</output>
							)
						}
					>
						{(version) => (
							<>
								<Show when={detailQuery.isError}>
									<p
										class="mb-4 rounded-md border border-danger/20 bg-danger/6 px-3 py-2.5 text-sm text-danger"
										role="alert"
									>
										{i18n.formatApiError(detailQuery.error)}
									</p>
								</Show>
								<Show
									when={props.dialog === "edit"}
									fallback={
										<DeleteVersionConfirmation
											error={submitError()}
											onCancel={closeDetailDialog}
											onConfirm={() => void confirmDelete(version())}
											pending={deleteMutationResult.isPending}
										/>
									}
								>
									<Show keyed when={`${version().data.id}:${version().etag}`}>
										{(_versionKey) => (
											<VersionFormSession
												factory={currentSessionFactory()}
												initialDraft={formDraft(version())}
												initialRevision={version().etag}
												initialValue={{
													description: version().data.description,
													versionNumber: version().data.versionNumber,
												}}
												labels={{
													...formLabels(),
													submit:
														version().data.lifecycleStatus === "draft"
															? i18n.t("versions.actions.finalize")
															: i18n.t("common.save"),
												}}
												mode={
													version().data.lifecycleStatus === "draft"
														? "resume"
														: "edit"
												}
												onCancel={closeDetailDialog}
												onFieldInput={clearFieldError}
												onSubmit={(value, draft) =>
													version().data.lifecycleStatus === "draft"
														? submitFinalize(value, draft)
														: submitEdit(version(), value)
												}
												serverErrors={fieldErrors()}
												submitError={submitError()}
											/>
										)}
									</Show>
								</Show>
							</>
						)}
					</Show>
				</DialogContent>
			</DialogRoot>
		</>
	);
}

export default VersionDialogs;

function DeleteVersionConfirmation(props: {
	readonly error: string;
	readonly onCancel: () => void;
	readonly onConfirm: () => void;
	readonly pending: boolean;
}) {
	const i18n = useI18n();
	return (
		<>
			<div class="rounded-md border border-danger/18 bg-danger/6 px-3 py-2.5 text-sm text-danger">
				{i18n.t("versions.dialog.deleteWarning")}
			</div>
			<Show when={props.error}>
				<p class="mb-0 mt-3 text-sm text-danger" role="alert">
					{props.error}
				</p>
			</Show>
			<DialogFooter>
				<Button
					disabled={props.pending}
					onClick={props.onCancel}
					type="button"
					variant="secondary"
				>
					{i18n.t("common.cancel")}
				</Button>
				<Button
					disabled={props.pending}
					onClick={props.onConfirm}
					type="button"
					variant="danger"
				>
					{props.pending
						? i18n.t("versions.deleting")
						: i18n.t("common.delete")}
				</Button>
			</DialogFooter>
		</>
	);
}
