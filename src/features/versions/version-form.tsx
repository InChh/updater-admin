import { createForm } from "@tanstack/solid-form";
import { useSelector } from "@tanstack/solid-store";
import { createEffect, createMemo, createSignal, on, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import type { WeakEntityTag } from "../../shared/api/common";
import { FolderPicker, type FolderPickerLabels } from "./folder-picker";
import {
	createUploadExclusionConfig,
	parseUploadExclusions,
	type UploadExclusionConfig,
	type UploadExclusionMatcher,
} from "./upload-exclusions";
import { UploadQueue, type UploadQueueLabels } from "./upload-queue";
import type {
	UploadFileSelection,
	UploadQueueController,
	UploadQueueStatus,
} from "./upload-store";
import type {
	UploadDraftContext,
	UploadWorkflow,
} from "./upload-workflow.client";

const CANONICAL_VERSION_NUMBER_PATTERN =
	/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export type VersionFormMode = "create" | "edit" | "resume";

export interface VersionFormValue {
	readonly description: string;
	readonly versionNumber: string;
}

export type VersionFormField = keyof VersionFormValue;

export interface VersionFormDraft extends UploadDraftContext {
	readonly etag: WeakEntityTag;
	readonly expectedFileCount: number;
}

export interface VersionFormLabels {
	readonly cancel: string;
	readonly clearFolder: string;
	readonly description: string;
	readonly descriptionTooLong: string;
	readonly draftReady: string;
	readonly exclusions: string;
	readonly exclusionsDescription: string;
	readonly exclusionsInvalid: string;
	readonly filesExpected: string;
	readonly filesRequired: string;
	readonly finalizedFilesImmutable: string;
	readonly folder: string;
	readonly folderPicker: FolderPickerLabels;
	readonly pending: string;
	readonly retry: string;
	readonly startUpload: string;
	readonly submit: string;
	readonly uploadFailed: string;
	readonly uploadIncomplete: string;
	readonly uploadQueue: UploadQueueLabels;
	readonly versionNumber: string;
	readonly versionNumberInvalid: string;
}

export interface VersionFormProps {
	readonly exclusionConfig?: UploadExclusionConfig;
	readonly initialDraft?: VersionFormDraft;
	readonly initialRevision?: string;
	readonly initialValue?: Pick<
		VersionFormValue,
		"description" | "versionNumber"
	>;
	readonly labels: VersionFormLabels;
	readonly mode: VersionFormMode;
	readonly onCancel: () => void;
	readonly onFieldInput?: (field: VersionFormField) => void;
	readonly onPrepareDraft?: (
		value: VersionFormValue,
		expectedFileCount: number,
	) => Promise<VersionFormDraft>;
	readonly onSubmit: (
		value: VersionFormValue,
		draft?: VersionFormDraft,
	) => Promise<void>;
	readonly queue: UploadQueueController;
	readonly serverErrors?: Partial<Record<VersionFormField, string>>;
	readonly submitError?: string;
	readonly workflow: UploadWorkflow;
}

function firstError(errors: readonly unknown[]): string | undefined {
	return errors.find((error): error is string => typeof error === "string");
}

function codePointLength(value: string): number {
	return [...value].length;
}

function defaultValue(
	value?: VersionFormProps["initialValue"],
): VersionFormValue {
	return value ?? { description: "", versionNumber: "" };
}

function isQueueBusy(status: UploadQueueStatus): boolean {
	return (
		status === "hashing" ||
		status === "resolving" ||
		status === "uploading" ||
		status === "registering"
	);
}

const NO_UPLOAD_EXCLUSIONS = parseUploadExclusions("");

export function VersionForm(props: VersionFormProps) {
	const queueState = useSelector(props.queue.store, (state) => state);
	const initialFields = defaultValue(props.initialValue);
	const exclusionConfig =
		props.exclusionConfig ?? createUploadExclusionConfig();
	const [exclusionValue, setExclusionValue] = createSignal(
		exclusionConfig.getValue(),
	);
	const exclusionState = createMemo<{
		readonly error?: string;
		readonly matcher: UploadExclusionMatcher;
	}>(() => {
		try {
			return { matcher: parseUploadExclusions(exclusionValue()) };
		} catch {
			return {
				error: props.labels.exclusionsInvalid,
				matcher: NO_UPLOAD_EXCLUSIONS,
			};
		}
	});
	const [draft, setDraft] = createSignal<VersionFormDraft | undefined>(
		props.initialDraft,
	);
	const [submitting, setSubmitting] = createSignal(false);
	const [preparing, setPreparing] = createSignal(false);
	const [uploadError, setUploadError] = createSignal("");
	const [versionNumberError, setVersionNumberError] = createSignal<string>();
	const [descriptionError, setDescriptionError] = createSignal<string>();
	const [pickerRevision, setPickerRevision] = createSignal(1);
	const [versionNumberValue, setVersionNumberValue] = createSignal(
		initialFields.versionNumber,
	);
	const [descriptionValue, setDescriptionValue] = createSignal(
		initialFields.description,
	);
	const uploadMode = () => props.mode !== "edit";

	if (props.initialDraft) {
		props.workflow.setDraft(props.initialDraft);
	}

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
	const currentValue = (): VersionFormValue => ({
		description: descriptionValue().trim(),
		versionNumber: versionNumberValue().trim(),
	});
	const formFieldsValid = () =>
		CANONICAL_VERSION_NUMBER_PATTERN.test(versionNumberValue().trim()) &&
		codePointLength(descriptionValue().trim()) <= 1024 &&
		!exclusionState().error;

	const form = createForm(() => ({
		defaultValues: defaultValue(props.initialValue),
		onSubmit: async ({ value }) => {
			if (uploadMode()) {
				const currentDraft = draft();
				const items = queueState().items;
				if (!currentDraft || items.length === 0) {
					setUploadError(props.labels.filesRequired);
					return;
				}
				if (!items.every(({ status }) => status === "complete")) {
					setUploadError(props.labels.uploadIncomplete);
					return;
				}
			}

			setSubmitting(true);
			try {
				await props.onSubmit(
					{
						description: value.description.trim(),
						versionNumber: value.versionNumber.trim(),
					},
					draft(),
				);
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
			items.length > 0 && items.every(({ status }) => status === "complete")
		);
	};
	const queueFailed = () =>
		queueState().items.some(
			(item) => item.status === "failed" || item.status === "cancelled",
		);
	const selectionLocked = () =>
		Boolean(
			draft() &&
				queueState().items.some(
					({ resolutionStatus }) => resolutionStatus !== null,
				),
		);
	const exclusionLocked = () =>
		queueState().items.length > 0 || selectionLocked();
	const canStartUpload = () => {
		const items = queueState().items;
		return (
			uploadMode() &&
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
			!preparing() &&
			!queueBusy() &&
			!props.workflow.isRunning()
		);
	};
	const canSubmit = () =>
		!submitting() &&
		!preparing() &&
		!queueBusy() &&
		formFieldsValid() &&
		(!uploadMode() || queueComplete());

	const clearQueue = () => {
		for (const item of props.queue.getState().items) {
			void props.workflow.discard(item.id);
		}
	};
	const clearSelectedFolder = () => {
		if (queueBusy() || submitting() || selectionLocked()) return;
		clearQueue();
		setUploadError("");
		setPickerRevision((revision) => revision + 1);
	};
	const runUploadWorkflow = async () => {
		setUploadError("");
		if (validateVersionNumber(versionNumberValue())) return;
		if (validateDescription(descriptionValue())) return;
		const items = queueState().items;
		if (items.length === 0) {
			setUploadError(props.labels.filesRequired);
			return;
		}

		let currentDraft = draft();
		if (currentDraft && currentDraft.expectedFileCount !== items.length) {
			setUploadError(props.labels.filesExpected);
			return;
		}
		try {
			if (!currentDraft) {
				if (!props.onPrepareDraft) {
					throw new Error("Draft creation is unavailable.");
				}
				setPreparing(true);
				try {
					currentDraft = await props.onPrepareDraft(
						currentValue(),
						items.length,
					);
					setDraft(currentDraft);
					props.workflow.setDraft(currentDraft);
				} finally {
					setPreparing(false);
				}
			}
			await props.workflow.start();
		} catch {
			setUploadError(props.labels.uploadFailed);
		}
	};
	const selectFiles = (files: readonly UploadFileSelection[]) => {
		if (queueBusy() || submitting() || selectionLocked()) return;
		clearQueue();
		if (draft() && draft()?.expectedFileCount !== files.length) {
			setPickerRevision((revision) => revision + 1);
			setUploadError(props.labels.filesExpected);
			return;
		}
		props.queue.addFiles(files);
		setUploadError("");
	};
	const rejectFiles = () => {
		if (queueBusy() || submitting() || selectionLocked()) return;
		clearQueue();
		setUploadError("");
	};

	createEffect(
		on(
			() => props.initialRevision,
			() => {
				form.reset(defaultValue(props.initialValue));
				clearQueue();
				setDraft(props.initialDraft);
				if (props.initialDraft) props.workflow.setDraft(props.initialDraft);
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
			aria-busy={submitting() || preparing() || queueBusy()}
			class="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				if (uploadMode() && !queueComplete()) {
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
				validators={{ onSubmit: ({ value }) => validateVersionNumber(value) }}
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
								disabled={submitting() || preparing() || Boolean(draft())}
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
				validators={{ onSubmit: ({ value }) => validateDescription(value) }}
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
								disabled={submitting() || preparing() || Boolean(draft())}
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

			<Show
				when={uploadMode()}
				fallback={
					<p class="m-0 rounded-md bg-mist px-3 py-2.5 text-sm text-muted">
						{props.labels.finalizedFilesImmutable}
					</p>
				}
			>
				<fieldset class="grid gap-3 rounded-lg border border-border p-3.5">
					<legend class="px-1 text-sm font-medium text-ink">
						{props.labels.folder}
					</legend>
					<Show when={draft()}>
						<p class="m-0 rounded-md bg-primary-soft px-3 py-2 text-xs text-primary-deep">
							{props.labels.draftReady}
						</p>
					</Show>
					<Field
						description={props.labels.exclusionsDescription}
						error={exclusionState().error}
						label={props.labels.exclusions}
						name="version-upload-exclusions"
					>
						{(controlProps) => (
							<Textarea
								{...controlProps}
								disabled={
									submitting() ||
									preparing() ||
									queueBusy() ||
									exclusionLocked()
								}
								onInput={(event) => {
									const value = event.currentTarget.value;
									setExclusionValue(value);
									exclusionConfig.setValue(value);
								}}
								rows={6}
								value={exclusionValue()}
							/>
						)}
					</Field>
					<Show keyed when={pickerRevision()}>
						{(revision) => (
							<FolderPicker
								disabled={
									submitting() ||
									queueBusy() ||
									selectionLocked() ||
									Boolean(exclusionState().error)
								}
								exclusions={exclusionState().matcher}
								id={`version-release-folder-${revision}`}
								labels={props.labels.folderPicker}
								onError={rejectFiles}
								onFiles={selectFiles}
							/>
						)}
					</Show>
					<Show when={queueState().items.length > 0}>
						<div class="flex justify-end">
							<Button
								disabled={submitting() || queueBusy() || selectionLocked()}
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
								{preparing() ? props.labels.pending : props.labels.startUpload}
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
					<Show when={uploadError()}>
						<div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/20 bg-danger/6 px-3 py-2.5">
							<p class="m-0 text-sm text-danger" role="alert">
								{uploadError()}
							</p>
							<Show
								when={
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
			</Show>

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
					disabled={submitting() || preparing()}
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
