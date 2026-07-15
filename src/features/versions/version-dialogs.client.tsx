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
	completeUploads,
	createVersion,
	deleteVersion,
	requestUploadCredentials,
	updateVersion,
} from "./api";
import { invalidateVersionDetails } from "./cache";
import { versionDetailQueryOptions } from "./queries";
import type { VersionDialog } from "./search";
import { formatUploadBytes } from "./upload-queue";
import { createUploadQueueController } from "./upload-store";
import {
	createUploadWorkflow,
	type UploadWorkflow,
} from "./upload-workflow.client";
import {
	VersionForm,
	type VersionFormField,
	type VersionFormLabels,
	type VersionFormValue,
} from "./version-form";

const DISABLED_VERSION_ID = "00000000-0000-0000-0000-000000000000";

export interface VersionUploadSession {
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

export function createDefaultVersionUploadSession(): VersionUploadSession {
	const queue = createUploadQueueController();
	return {
		queue,
		workflow: createUploadWorkflow(queue, {
			completeUploads,
			requestCredentials: requestUploadCredentials,
		}),
	};
}

function VersionFormSession(props: {
	readonly factory: VersionUploadSessionFactory;
	readonly initialRevision?: string;
	readonly initialValue?: Pick<
		VersionFormValue,
		"description" | "versionNumber"
	>;
	readonly labels: VersionFormLabels;
	readonly mode: "create" | "edit";
	readonly onCancel: () => void;
	readonly onFieldInput: (field: VersionFormField) => void;
	readonly onSubmit: (value: VersionFormValue) => Promise<void>;
	readonly serverErrors: VersionFieldErrors;
	readonly submitError: string;
}) {
	const session = props.factory();
	onCleanup(() => {
		session.workflow.dispose();
		session.queue.dispose();
	});
	return (
		<VersionForm
			initialRevision={props.initialRevision}
			initialValue={props.initialValue}
			labels={props.labels}
			mode={props.mode}
			onCancel={props.onCancel}
			onFieldInput={props.onFieldInput}
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
		mutationFn: (value: VersionFormValue) => {
			if (!value.fileIds || value.fileIds.length === 0) {
				throw new TypeError(
					"Create version requires uploaded file metadata IDs.",
				);
			}
			return createVersion(props.programId, {
				description: value.description,
				fileIds: value.fileIds,
				versionNumber: value.versionNumber,
			});
		},
	}));
	const updateMutationResult = createMutation(() => ({
		mutationFn: (input: {
			readonly current: EntityResult<VersionDetailDto>;
			readonly value: VersionFormValue;
		}) => {
			const update: UpdateVersionInput = {
				description: input.value.description,
				...(input.value.fileIds === undefined
					? {}
					: { fileIds: input.value.fileIds }),
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
	const createPending = () => createMutationResult.isPending;
	const detailPending = () =>
		updateMutationResult.isPending || deleteMutationResult.isPending;
	const sessionFactory = () =>
		props.uploadSessionFactory ?? createDefaultVersionUploadSession;
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
		confirm: i18n.t("common.confirm"),
		description: i18n.t("versions.form.description"),
		descriptionTooLong: i18n.t("versions.errors.descriptionTooLong"),
		filesRequired: i18n.t("versions.errors.filesRequired"),
		folder: i18n.t("versions.form.folder"),
		folderPicker: {
			choose: i18n.t("versions.upload.choose"),
			description: i18n.t("versions.upload.description"),
			errors: {
				FILE_TOO_LARGE: i18n.t("versions.upload.error.fileTooLarge"),
				INVALID_PATH: i18n.t("versions.upload.error.invalidPath"),
				TOO_MANY_FILES: i18n.t("versions.upload.error.tooManyFiles"),
			},
			selected: (count) =>
				i18n.t("versions.upload.selected", {
					count: i18n.formatNumber(count),
				}),
		},
		pending: i18n.t("common.saving"),
		preserveFiles: i18n.t("versions.form.preserveFiles"),
		removeAllFiles: i18n.t("versions.form.removeAllFiles"),
		removeAllFilesConfirm: i18n.t("versions.form.removeAllFilesConfirm"),
		replaceFiles: i18n.t("versions.form.replaceFiles"),
		retry: i18n.t("common.retry"),
		submit: i18n.t("common.save"),
		startUpload: i18n.t("versions.upload.start"),
		uploadFailed: i18n.t("versions.errors.uploadFailed"),
		uploadIncomplete: i18n.t("versions.errors.uploadIncomplete"),
		uploadQueue: {
			aggregateProgress: i18n.t("versions.upload.progress"),
			cancel: i18n.t("versions.upload.cancel"),
			clearCompleted: i18n.t("versions.upload.clearCompleted"),
			empty: i18n.t("versions.upload.empty"),
			files: (count) =>
				i18n.t("versions.upload.files", {
					count: i18n.formatNumber(count),
				}),
			hideCompleted: i18n.t("versions.upload.hideCompleted"),
			remove: i18n.t("versions.upload.remove"),
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
				uploaded: i18n.t("versions.upload.status.uploaded"),
				uploading: i18n.t("versions.upload.status.uploading"),
			},
			totalSize: (bytes) =>
				i18n.t("versions.upload.totalSize", {
					size: formatUploadBytes(bytes),
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
		queryClient.invalidateQueries({
			exact: true,
			queryKey: programQueryKeys.detail(props.programId),
		});
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
				if (
					fieldError.path === "fileIds" ||
					fieldError.path.startsWith("fileIds.")
				) {
					nextFieldErrors.fileIds = i18n.t("versions.errors.filesRequired");
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
		}
		setFieldErrors(nextFieldErrors);
		setSubmitError(
			Object.keys(nextFieldErrors).length > 0 ? "" : i18n.formatApiError(error),
		);
	};

	const submitCreate = async (value: VersionFormValue) => {
		setFieldErrors({});
		setSubmitError("");
		try {
			const created = await createMutationResult.mutateAsync(value);
			storeVersion(created);
			await Promise.all([
				invalidateVersionLists(),
				invalidateProgramVersionCount(),
			]);
			notify(i18n.t("versions.notifications.created"));
			if (props.dialog === "create") props.onClose();
		} catch (error) {
			await setMutationError(error);
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
					if (!open && !createPending()) props.onClose();
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
							factory={sessionFactory()}
							labels={{ ...formLabels(), submit: i18n.t("common.create") }}
							mode="create"
							onCancel={props.onClose}
							onFieldInput={clearFieldError}
							onSubmit={submitCreate}
							serverErrors={fieldErrors()}
							submitError={submitError()}
						/>
					</Show>
				</DialogContent>
			</DialogRoot>

			<DialogRoot
				onOpenChange={(open) => {
					if (!open && !detailPending()) props.onClose();
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
								: i18n.t("versions.dialog.editTitle")}
						</DialogTitle>
						<DialogDescription class="text-sm leading-6 text-muted">
							{props.dialog === "delete" && detailQuery.data
								? i18n.t("versions.dialog.deleteDescription", {
										version: detailQuery.data.data.versionNumber,
									})
								: props.dialog === "edit"
									? i18n.t("versions.dialog.editDescription")
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
											onCancel={props.onClose}
											onConfirm={() => void confirmDelete(version())}
											pending={deleteMutationResult.isPending}
										/>
									}
								>
									<Show keyed when={`${version().data.id}:${version().etag}`}>
										{(_versionKey) => (
											<VersionFormSession
												factory={sessionFactory()}
												initialRevision={version().etag}
												initialValue={{
													description: version().data.description,
													versionNumber: version().data.versionNumber,
												}}
												labels={formLabels()}
												mode="edit"
												onCancel={props.onClose}
												onFieldInput={clearFieldError}
												onSubmit={(value) => submitEdit(version(), value)}
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
