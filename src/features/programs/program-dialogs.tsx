import {
	createMutation,
	createQuery,
	useQueryClient,
} from "@tanstack/solid-query";
import { createEffect, createSignal, Show } from "solid-js";

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
import { useI18n } from "../../lib/i18n/i18n";
import { createProgram, deleteProgram, updateProgram } from "./api";
import {
	invalidateProgramLists,
	refreshStaleProgram,
	removeProgramDetail,
	storeProgramDetail,
} from "./cache";
import { ProgramForm, type ProgramFormValue } from "./program-form";
import { programDetailQueryOptions } from "./queries";
import type { ProgramDialog } from "./search";

const DISABLED_PROGRAM_ID = "00000000-0000-0000-0000-000000000000";

export interface ProgramDialogsProps {
	readonly dialog?: ProgramDialog;
	readonly onClose: () => void;
	readonly onDeleted: () => void;
	readonly onRestoreFocus?: () => void;
	readonly programId?: string;
}

type ProgramFieldErrors = Partial<Record<keyof ProgramFormValue, string>>;

export function ProgramDialogs(props: ProgramDialogsProps) {
	const i18n = useI18n();
	const queryClient = useQueryClient();
	const [fieldErrors, setFieldErrors] = createSignal<ProgramFieldErrors>({});
	const [submitError, setSubmitError] = createSignal("");
	const [detailRevision, setDetailRevision] = createSignal(0);
	const detailQuery = createQuery(() => ({
		...programDetailQueryOptions(props.programId ?? DISABLED_PROGRAM_ID),
		enabled: Boolean(props.programId && props.dialog !== "create"),
	}));
	const createMutationResult = createMutation(() => ({
		mutationFn: createProgram,
	}));
	const updateMutationResult = createMutation(() => ({
		mutationFn: (input: {
			readonly etag: NonNullable<typeof detailQuery.data>["etag"];
			readonly programId: string;
			readonly value: ProgramFormValue;
		}) =>
			updateProgram(
				input.programId,
				{
					description: input.value.description || null,
					name: input.value.name,
				},
				input.etag,
			),
	}));
	const deleteMutationResult = createMutation(() => ({
		mutationFn: (input: {
			readonly etag: NonNullable<typeof detailQuery.data>["etag"];
			readonly programId: string;
		}) => deleteProgram(input.programId, input.etag),
	}));
	const createPending = () => createMutationResult.isPending;
	const detailPending = () =>
		updateMutationResult.isPending || deleteMutationResult.isPending;
	const restoreFocus = (event: Event) => {
		if (!props.onRestoreFocus) return;
		event.preventDefault();
		queueMicrotask(props.onRestoreFocus);
	};

	createEffect(() => {
		props.dialog;
		props.programId;
		setDetailRevision(0);
		setFieldErrors({});
		setSubmitError("");
	});

	const formLabels = () => ({
		cancel: i18n.t("common.cancel"),
		description: i18n.t("programs.form.description"),
		descriptionTooLong: i18n.t("programs.errors.descriptionTooLong"),
		name: i18n.t("programs.form.name"),
		nameRequired: i18n.t("programs.errors.nameRequired"),
		nameTooLong: i18n.t("programs.errors.nameTooLong"),
		pending: i18n.t("common.saving"),
		submit: i18n.t("common.save"),
	});
	const clearFieldError = (field: keyof ProgramFormValue) => {
		setFieldErrors((current) => ({ ...current, [field]: undefined }));
		setSubmitError("");
	};
	const setMutationError = async (error: unknown, programId?: string) => {
		if (error instanceof ApiProblemError && error.code === "STALE_WRITE") {
			if (programId) await refreshStaleProgram(queryClient, programId);
			setDetailRevision((revision) => revision + 1);
			setSubmitError(i18n.t("programs.errors.staleRefreshed"));
			return;
		}

		const nextFieldErrors: ProgramFieldErrors = {};
		if (error instanceof ApiProblemError) {
			for (const fieldError of error.problem.fieldErrors ?? []) {
				if (fieldError.path === "name") {
					nextFieldErrors.name =
						fieldError.code === "REQUIRED"
							? i18n.t("programs.errors.nameRequired")
							: fieldError.code === "TOO_LONG"
								? i18n.t("programs.errors.nameTooLong")
								: i18n.t("errors.field.invalid");
				}
				if (fieldError.path === "description") {
					nextFieldErrors.description =
						fieldError.code === "TOO_LONG"
							? i18n.t("programs.errors.descriptionTooLong")
							: i18n.t("errors.field.invalid");
				}
			}
			if (error.code === "PROGRAM_NAME_CONFLICT") {
				nextFieldErrors.name = i18n.t("programs.errors.nameConflict");
			}
		}
		setFieldErrors(nextFieldErrors);
		setSubmitError(
			Object.keys(nextFieldErrors).length > 0 ? "" : i18n.formatApiError(error),
		);
	};

	const submitCreate = async (value: ProgramFormValue) => {
		setFieldErrors({});
		setSubmitError("");
		try {
			const created = await createMutationResult.mutateAsync({
				description: value.description || null,
				name: value.name,
			});
			storeProgramDetail(queryClient, created);
			await invalidateProgramLists(queryClient);
			notify(i18n.t("programs.notifications.created"));
			if (props.dialog === "create") props.onClose();
		} catch (error) {
			await setMutationError(error);
		}
	};
	const submitEdit = async (
		program: NonNullable<typeof detailQuery.data>,
		value: ProgramFormValue,
	) => {
		setFieldErrors({});
		setSubmitError("");
		try {
			const updated = await updateMutationResult.mutateAsync({
				etag: program.etag,
				programId: program.data.id,
				value,
			});
			storeProgramDetail(queryClient, updated);
			await invalidateProgramLists(queryClient);
			notify(i18n.t("programs.notifications.updated"));
			if (props.dialog === "edit" && props.programId === program.data.id) {
				props.onClose();
			}
		} catch (error) {
			await setMutationError(error, program.data.id);
		}
	};
	const confirmDelete = async (
		program: NonNullable<typeof detailQuery.data>,
	) => {
		setSubmitError("");
		try {
			await deleteMutationResult.mutateAsync({
				etag: program.etag,
				programId: program.data.id,
			});
			removeProgramDetail(queryClient, program.data.id);
			await invalidateProgramLists(queryClient);
			notify(i18n.t("programs.notifications.deleted"));
			if (props.dialog === "delete" && props.programId === program.data.id) {
				props.onDeleted();
			}
		} catch (error) {
			await setMutationError(error, program.data.id);
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
					closeDisabled={createPending()}
					onCloseAutoFocus={restoreFocus}
				>
					<DialogHeader>
						<DialogTitle class="text-base font-semibold text-ink">
							{i18n.t("programs.dialog.createTitle")}
						</DialogTitle>
						<DialogDescription class="text-sm text-muted">
							{i18n.t("programs.dialog.createDescription")}
						</DialogDescription>
					</DialogHeader>
					<ProgramForm
						labels={{ ...formLabels(), submit: i18n.t("common.create") }}
						onCancel={props.onClose}
						onFieldInput={clearFieldError}
						onSubmit={submitCreate}
						serverErrors={fieldErrors()}
						submitError={submitError()}
					/>
				</DialogContent>
			</DialogRoot>

			<DialogRoot
				onOpenChange={(open) => {
					if (!open && !detailPending()) props.onClose();
				}}
				open={props.dialog === "edit" || props.dialog === "delete"}
			>
				<DialogContent
					closeDisabled={detailPending()}
					onCloseAutoFocus={restoreFocus}
				>
					<DialogHeader>
						<DialogTitle class="text-base font-semibold text-ink">
							{props.dialog === "delete"
								? i18n.t("programs.dialog.deleteTitle")
								: i18n.t("programs.dialog.editTitle")}
						</DialogTitle>
						<DialogDescription class="text-sm leading-6 text-muted">
							{props.dialog === "delete" && detailQuery.data
								? i18n.t("programs.dialog.deleteDescription", {
										name: detailQuery.data.data.name,
										versionCount: i18n.formatNumber(
											detailQuery.data.data.versionCount,
										),
									})
								: props.dialog === "edit"
									? i18n.t("programs.dialog.editDescription")
									: i18n.t("programs.dialog.loadDescription")}
						</DialogDescription>
					</DialogHeader>
					<Show
						when={
							props.programId
								? `${props.programId}:${detailRevision()}`
								: undefined
						}
						keyed
					>
						{(_detailFormKey) => (
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
								{(program) => (
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
												<DeleteProgramConfirmation
													error={submitError()}
													onCancel={props.onClose}
													onConfirm={() => void confirmDelete(program())}
													pending={deleteMutationResult.isPending}
												/>
											}
										>
											<ProgramForm
												initialValue={{
													description: program().data.description ?? "",
													name: program().data.name,
												}}
												labels={formLabels()}
												onCancel={props.onClose}
												onFieldInput={clearFieldError}
												onSubmit={(value) => submitEdit(program(), value)}
												serverErrors={fieldErrors()}
												submitError={submitError()}
											/>
										</Show>
									</>
								)}
							</Show>
						)}
					</Show>
				</DialogContent>
			</DialogRoot>
		</>
	);
}

function DeleteProgramConfirmation(props: {
	readonly error: string;
	readonly onCancel: () => void;
	readonly onConfirm: () => void;
	readonly pending: boolean;
}) {
	const i18n = useI18n();
	return (
		<>
			<div class="rounded-md border border-danger/18 bg-danger/6 px-3 py-2.5 text-sm text-danger">
				{i18n.t("programs.dialog.deleteWarning")}
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
						? i18n.t("programs.deleting")
						: i18n.t("common.delete")}
				</Button>
			</DialogFooter>
		</>
	);
}
