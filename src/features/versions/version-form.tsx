import { createForm } from "@tanstack/solid-form";
import { useSelector } from "@tanstack/solid-store";
import { createEffect, createSignal, on, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { FolderPicker, type FolderPickerLabels } from "./folder-picker";
import { UploadQueue, type UploadQueueLabels } from "./upload-queue";
import type {
	UploadFileSelection,
	UploadQueueController,
	UploadQueueStatus,
} from "./upload-store";
import type { UploadWorkflow } from "./upload-workflow.client";

const CANONICAL_VERSION_NUMBER_PATTERN =
	/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export type VersionFormMode = "create" | "edit";

export interface VersionFormValue {
	readonly description: string;
	/** Omitted preserves existing relations; [] explicitly removes every relation. */
	readonly fileIds?: readonly string[];
	readonly versionNumber: string;
}

export type VersionFormField = keyof VersionFormValue;

export interface VersionFormLabels {
	readonly cancel: string;
	readonly clearFolder: string;
	readonly confirm: string;
	readonly description: string;
	readonly descriptionTooLong: string;
	readonly filesRequired: string;
	readonly folder: string;
	readonly folderPicker: FolderPickerLabels;
	readonly pending: string;
	readonly preserveFiles: string;
	readonly removeAllFiles: string;
	readonly removeAllFilesConfirm: string;
	readonly replaceFiles: string;
	readonly retry: string;
	readonly submit: string;
	readonly startUpload: string;
	readonly uploadFailed: string;
	readonly uploadIncomplete: string;
	readonly uploadQueue: UploadQueueLabels;
	readonly versionNumber: string;
	readonly versionNumberInvalid: string;
}

export interface VersionFormProps {
	readonly initialRevision?: string;
	readonly initialValue?: Pick<
		VersionFormValue,
		"description" | "versionNumber"
	>;
	readonly labels: VersionFormLabels;
	readonly mode: VersionFormMode;
	readonly onCancel: () => void;
	readonly onFieldInput?: (field: VersionFormField) => void;
	readonly onSubmit: (value: VersionFormValue) => Promise<void>;
	readonly queue: UploadQueueController;
	readonly serverErrors?: Partial<Record<VersionFormField, string>>;
	readonly submitError?: string;
	readonly workflow: UploadWorkflow;
}

type FileReplacementMode = "empty" | "folder" | "preserve";

function firstError(errors: readonly unknown[]): string | undefined {
	return errors.find((error): error is string => typeof error === "string");
}

function codePointLength(value: string): number {
	return [...value].length;
}

function defaultValue(
	value?: VersionFormProps["initialValue"],
): Pick<VersionFormValue, "description" | "versionNumber"> {
	return value ?? { description: "", versionNumber: "" };
}

function isQueueBusy(status: UploadQueueStatus): boolean {
	return (
		status === "hashing" || status === "uploading" || status === "registering"
	);
}

export function VersionForm(props: VersionFormProps) {
	const queueState = useSelector(props.queue.store, (state) => state);
	const initialFields = defaultValue(props.initialValue);
	const [submitting, setSubmitting] = createSignal(false);
	const [uploadError, setUploadError] = createSignal("");
	const [versionNumberError, setVersionNumberError] = createSignal<string>();
	const [descriptionError, setDescriptionError] = createSignal<string>();
	const [removeAllConfirmation, setRemoveAllConfirmation] = createSignal(false);
	const [replacementMode, setReplacementMode] =
		createSignal<FileReplacementMode>(
			props.mode === "create" ? "folder" : "preserve",
		);
	const [pickerRevision, setPickerRevision] = createSignal(1);
	const [versionNumberValue, setVersionNumberValue] = createSignal(
		initialFields.versionNumber,
	);
	const [descriptionValue, setDescriptionValue] = createSignal(
		initialFields.description,
	);
	let removeAllConfirmButton: HTMLButtonElement | undefined;
	const validateVersionNumber = (value: string) => {
		const error = CANONICAL_VERSION_NUMBER_PATTERN.test(value.trim())
			? undefined
			: props.labels.versionNumberInvalid;
		setVersionNumberError(error);
		return error;
	};
	const validateDescription = (value: string) => {
		const error =
			codePointLength(value.trim()) > 1024
				? props.labels.descriptionTooLong
				: undefined;
		setDescriptionError(error);
		return error;
	};

	const form = createForm(() => ({
		defaultValues: defaultValue(props.initialValue),
		onSubmit: async ({ value }) => {
			const fileIds =
				replacementMode() === "empty"
					? []
					: replacementMode() === "folder" || props.mode === "create"
						? props.workflow.getCompletedFileMetadataIds()
						: undefined;
			if (
				(props.mode === "create" || replacementMode() === "folder") &&
				(!fileIds || fileIds.length === 0)
			) {
				setUploadError(props.labels.filesRequired);
				return;
			}

			setSubmitting(true);
			try {
				await props.onSubmit({
					description: value.description.trim(),
					...(fileIds == null ? {} : { fileIds: [...fileIds] }),
					versionNumber: value.versionNumber.trim(),
				});
			} finally {
				setSubmitting(false);
			}
		},
	}));

	const queueBusy = () =>
		queueState().items.some((item) => isQueueBusy(item.status));
	const queueComplete = () => {
		const items = queueState().items;
		return (
			items.length > 0 &&
			items.every(
				(item) => item.status === "complete" && Boolean(item.fileMetadataId),
			)
		);
	};
	const queueFailed = () =>
		queueState().items.some(
			(item) => item.status === "failed" || item.status === "cancelled",
		);
	const filesReady = () => {
		if (props.mode === "create") return queueComplete();
		if (replacementMode() === "folder") return queueComplete();
		return true;
	};
	const formFieldsValid = () =>
		CANONICAL_VERSION_NUMBER_PATTERN.test(versionNumberValue().trim()) &&
		codePointLength(descriptionValue().trim()) <= 1024;
	const canStartUpload = () => {
		const items = queueState().items;
		return (
			items.length > 0 &&
			items.some(({ status }) => status !== "complete") &&
			items.every(
				({ status }) =>
					status === "queued" ||
					status === "ready" ||
					status === "uploaded" ||
					status === "complete",
			) &&
			formFieldsValid() &&
			!submitting() &&
			!queueBusy() &&
			!props.workflow.isRunning()
		);
	};
	const canSubmit = () =>
		!submitting() && filesReady() && !queueBusy() && formFieldsValid();

	const clearQueue = () => {
		for (const item of props.queue.getState().items) {
			void props.workflow.discard(item.id);
		}
	};
	const clearSelectedFolder = () => {
		if (queueBusy() || submitting()) return;
		clearQueue();
		setUploadError("");
		setReplacementMode(props.mode === "edit" ? "preserve" : "folder");
		setPickerRevision((revision) => revision + 1);
		props.onFieldInput?.("fileIds");
	};
	const runUploadWorkflow = async () => {
		setUploadError("");
		try {
			await props.workflow.start();
		} catch {
			setUploadError(props.labels.uploadFailed);
		}
	};
	const selectFiles = (files: readonly UploadFileSelection[]) => {
		if (queueBusy() || submitting()) return;
		clearQueue();
		props.queue.addFiles(files);
		setReplacementMode("folder");
		setRemoveAllConfirmation(false);
		setUploadError("");
		props.onFieldInput?.("fileIds");
	};
	const rejectFiles = () => {
		if (queueBusy() || submitting()) return;
		clearQueue();
		setReplacementMode(props.mode === "edit" ? "preserve" : "folder");
		setRemoveAllConfirmation(false);
		setUploadError("");
		props.onFieldInput?.("fileIds");
	};
	const confirmRemoveAll = () => {
		clearQueue();
		setReplacementMode("empty");
		setRemoveAllConfirmation(false);
		setUploadError("");
		props.onFieldInput?.("fileIds");
	};
	const preserveExistingFiles = () => {
		setReplacementMode("preserve");
		setRemoveAllConfirmation(false);
		setUploadError("");
		props.onFieldInput?.("fileIds");
	};

	createEffect(
		on(
			() => props.initialRevision,
			() => {
				form.reset(defaultValue(props.initialValue));
				clearQueue();
				setReplacementMode(props.mode === "create" ? "folder" : "preserve");
				setRemoveAllConfirmation(false);
				setUploadError("");
				setVersionNumberError(undefined);
				setDescriptionError(undefined);
				const nextFields = defaultValue(props.initialValue);
				setVersionNumberValue(nextFields.versionNumber);
				setDescriptionValue(nextFields.description);
				setPickerRevision((revision) => revision + 1);
			},
			{ defer: true },
		),
	);

	return (
		<form
			aria-busy={submitting() || queueBusy()}
			class="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				if (!filesReady()) {
					setUploadError(
						queueState().items.length === 0
							? props.labels.filesRequired
							: props.labels.uploadIncomplete,
					);
					return;
				}
				void form.handleSubmit();
			}}
		>
			<form.Field
				name="versionNumber"
				validators={{
					onSubmit: ({ value }) => validateVersionNumber(value),
				}}
				children={(field) => (
					<Field
						error={
							props.serverErrors?.versionNumber ??
							versionNumberError() ??
							firstError(field().state.meta.errors)
						}
						label={props.labels.versionNumber}
						name="version-number"
						required
					>
						{(controlProps) => (
							<Input
								{...controlProps}
								autocomplete="off"
								disabled={submitting()}
								inputmode="numeric"
								maxlength={20}
								onBlur={(event) => {
									field().handleBlur();
									validateVersionNumber(event.currentTarget.value);
								}}
								onInput={(event) => {
									const value = event.currentTarget.value;
									field().handleChange(value);
									setVersionNumberValue(value);
									if (CANONICAL_VERSION_NUMBER_PATTERN.test(value.trim())) {
										setVersionNumberError(undefined);
									}
									props.onFieldInput?.("versionNumber");
								}}
								value={field().state.value}
							/>
						)}
					</Field>
				)}
			/>

			<form.Field
				name="description"
				validators={{
					onSubmit: ({ value }) => validateDescription(value),
				}}
				children={(field) => (
					<Field
						error={
							props.serverErrors?.description ??
							descriptionError() ??
							firstError(field().state.meta.errors)
						}
						label={props.labels.description}
						name="version-description"
					>
						{(controlProps) => (
							<Textarea
								{...controlProps}
								disabled={submitting()}
								onBlur={(event) => {
									field().handleBlur();
									validateDescription(event.currentTarget.value);
								}}
								onInput={(event) => {
									const value = event.currentTarget.value;
									field().handleChange(value);
									setDescriptionValue(value);
									if (codePointLength(value.trim()) <= 1024) {
										setDescriptionError(undefined);
									}
									props.onFieldInput?.("description");
								}}
								rows={4}
								value={field().state.value}
							/>
						)}
					</Field>
				)}
			/>

			<fieldset class="grid gap-3 rounded-lg border border-border p-3.5">
				<legend class="px-1 text-sm font-medium text-ink">
					{props.labels.folder}
				</legend>
				<Show when={props.mode === "edit" && replacementMode() === "preserve"}>
					<div class="flex flex-col gap-3 rounded-md bg-mist px-3 py-2.5 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
						<span>{props.labels.preserveFiles}</span>
						<Button
							disabled={submitting()}
							onClick={() => {
								setRemoveAllConfirmation(true);
								queueMicrotask(() => removeAllConfirmButton?.focus());
							}}
							size="sm"
							type="button"
							variant="danger"
						>
							{props.labels.removeAllFiles}
						</Button>
					</div>
				</Show>
				<Show when={props.mode === "edit" && replacementMode() === "empty"}>
					<div class="flex flex-col gap-3 rounded-md border border-danger/20 bg-danger/6 px-3 py-2.5 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
						<span>{props.labels.removeAllFilesConfirm}</span>
						<Button
							disabled={submitting()}
							onClick={preserveExistingFiles}
							size="sm"
							type="button"
							variant="secondary"
						>
							{props.labels.preserveFiles}
						</Button>
					</div>
				</Show>
				<Show when={removeAllConfirmation()}>
					<div
						aria-describedby="remove-all-files-description"
						aria-labelledby="remove-all-files-title"
						class="rounded-md border border-danger/25 bg-danger/6 p-3"
						role="alertdialog"
					>
						<p
							class="m-0 text-sm font-semibold text-danger"
							id="remove-all-files-title"
						>
							{props.labels.removeAllFiles}
						</p>
						<p
							class="mb-0 mt-1 text-sm text-danger"
							id="remove-all-files-description"
						>
							{props.labels.removeAllFilesConfirm}
						</p>
						<div class="mt-3 flex justify-end gap-2">
							<Button
								onClick={() => setRemoveAllConfirmation(false)}
								size="sm"
								type="button"
								variant="secondary"
							>
								{props.labels.cancel}
							</Button>
							<Button
								onClick={confirmRemoveAll}
								ref={removeAllConfirmButton}
								size="sm"
								type="button"
								variant="danger"
							>
								{props.labels.confirm}
							</Button>
						</div>
					</div>
				</Show>

				<Show keyed when={`picker-${pickerRevision()}`}>
					{(_revision) => (
						<FolderPicker
							disabled={submitting() || queueBusy()}
							id="version-release-folder"
							labels={props.labels.folderPicker}
							onError={rejectFiles}
							onFiles={selectFiles}
						/>
					)}
				</Show>
				<Show when={queueState().items.length > 0}>
					<div class="flex items-center justify-between gap-3">
						<span class="text-xs text-muted">
							{replacementMode() === "folder"
								? props.labels.replaceFiles
								: props.labels.preserveFiles}
						</span>
						<Button
							disabled={submitting() || queueBusy()}
							onClick={clearSelectedFolder}
							size="sm"
							type="button"
							variant="ghost"
						>
							{props.labels.clearFolder}
						</Button>
					</div>
					<UploadQueue
						controller={props.queue}
						labels={props.labels.uploadQueue}
						onCancel={(item) => props.workflow.cancel(item.id)}
						onRemove={(item) => void props.workflow.discard(item.id)}
						onRetry={(item) => {
							setUploadError("");
							void props.workflow.retry(item.id).catch(() => {
								setUploadError(props.labels.uploadFailed);
							});
						}}
					/>
					<div class="flex justify-end">
						<Button
							disabled={!canStartUpload()}
							onClick={() => void runUploadWorkflow()}
							type="button"
						>
							{props.labels.startUpload}
						</Button>
					</div>
				</Show>
				<Show when={queueState().items.length > 0 && !queueComplete()}>
					<p class="m-0 text-xs text-muted" aria-live="polite">
						{queueFailed()
							? props.labels.uploadFailed
							: props.labels.uploadIncomplete}
					</p>
				</Show>
				<Show when={props.serverErrors?.fileIds || uploadError()}>
					<div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/20 bg-danger/6 px-3 py-2.5">
						<p class="m-0 text-sm text-danger" role="alert">
							{props.serverErrors?.fileIds || uploadError()}
						</p>
						<Show
							when={
								uploadError() &&
								queueState().items.length > 0 &&
								!queueBusy() &&
								!queueFailed()
							}
						>
							<Button
								onClick={() => void runUploadWorkflow()}
								size="sm"
								type="button"
								variant="secondary"
							>
								{props.labels.retry}
							</Button>
						</Show>
					</div>
				</Show>
			</fieldset>

			<Show when={props.submitError}>
				<p
					class="m-0 rounded-md border border-danger/20 bg-danger/6 px-3 py-2.5 text-sm text-danger"
					role="alert"
				>
					{props.submitError}
				</p>
			</Show>
			<div class="mt-1 flex justify-end gap-2">
				<Button
					disabled={submitting()}
					onClick={props.onCancel}
					type="button"
					variant="secondary"
				>
					{props.labels.cancel}
				</Button>
				<Button disabled={!canSubmit()} type="submit">
					{submitting() ? props.labels.pending : props.labels.submit}
				</Button>
			</div>
		</form>
	);
}
