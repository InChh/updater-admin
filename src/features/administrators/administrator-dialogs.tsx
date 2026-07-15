import { createMutation, useQueryClient } from "@tanstack/solid-query";
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
import { administratorQueryKeys } from "../../lib/api/query-keys";
import { useI18n } from "../../lib/i18n/i18n";
import type { AdministratorDto } from "../../shared/api/administrators";
import {
	AdministratorForm,
	type AdministratorFormValue,
	TemporaryPasswordForm,
} from "./administrator-form";
import {
	createAdministrator,
	resetAdministratorPassword,
	revokeAdministratorSessions,
	updateAdministrator,
} from "./api";
import type { AdministratorDialog } from "./search";

export interface AdministratorDialogsProps {
	readonly administrator?: AdministratorDto;
	readonly dialog?: AdministratorDialog;
	readonly onClose: () => void;
	readonly onRestoreFocus?: () => void;
}

type AdministratorFieldErrors = Partial<
	Record<keyof AdministratorFormValue, string>
>;

export function AdministratorDialogs(props: AdministratorDialogsProps) {
	const i18n = useI18n();
	const queryClient = useQueryClient();
	const [fieldErrors, setFieldErrors] = createSignal<AdministratorFieldErrors>(
		{},
	);
	const [submitError, setSubmitError] = createSignal("");
	const createMutationResult = createMutation(() => ({
		mutationFn: createAdministrator,
	}));
	const statusMutation = createMutation(() => ({
		mutationFn: (input: {
			readonly administrator: AdministratorDto;
			readonly enabled: boolean;
		}) =>
			updateAdministrator(
				input.administrator.id,
				{ enabled: input.enabled },
				input.administrator.etag,
			),
	}));
	const resetMutation = createMutation(() => ({
		mutationFn: (input: {
			readonly id: string;
			readonly temporaryPassword: string;
		}) =>
			resetAdministratorPassword(input.id, {
				temporaryPassword: input.temporaryPassword,
			}),
	}));
	const revokeMutation = createMutation(() => ({
		mutationFn: revokeAdministratorSessions,
	}));
	const pending = () =>
		createMutationResult.isPending ||
		statusMutation.isPending ||
		resetMutation.isPending ||
		revokeMutation.isPending;

	createEffect(() => {
		props.dialog;
		props.administrator?.id;
		setFieldErrors({});
		setSubmitError("");
	});

	const restoreFocus = (event: Event) => {
		if (!props.onRestoreFocus) return;
		event.preventDefault();
		queueMicrotask(props.onRestoreFocus);
	};
	const refreshLists = () =>
		queryClient.invalidateQueries({ queryKey: administratorQueryKeys.lists() });
	const clearFieldError = (field: keyof AdministratorFormValue) => {
		setFieldErrors((current) => ({ ...current, [field]: undefined }));
		setSubmitError("");
	};
	const setProblem = (error: unknown) => {
		const next: AdministratorFieldErrors = {};
		if (error instanceof ApiProblemError) {
			for (const fieldError of error.problem.fieldErrors ?? []) {
				if (fieldError.path === "name") {
					next.name =
						fieldError.code === "REQUIRED"
							? i18n.t("administrators.errors.nameRequired")
							: fieldError.code === "TOO_LONG"
								? i18n.t("administrators.errors.nameTooLong")
								: i18n.t("errors.field.invalid");
				}
				if (fieldError.path === "email") {
					next.email =
						error.code === "ADMINISTRATOR_EMAIL_CONFLICT" ||
						fieldError.code === "NOT_UNIQUE"
							? i18n.t("administrators.errors.emailConflict")
							: i18n.t("errors.field.email");
				}
				if (fieldError.path === "temporaryPassword") {
					next.temporaryPassword = i18n.t(
						"administrators.errors.passwordPolicy",
					);
				}
			}
			if (error.code === "ADMINISTRATOR_EMAIL_CONFLICT") {
				next.email = i18n.t("administrators.errors.emailConflict");
			}
		}
		setFieldErrors(next);
		setSubmitError(
			Object.values(next).some(Boolean) ? "" : i18n.formatApiError(error),
		);
	};
	const submitCreate = async (value: AdministratorFormValue) => {
		setFieldErrors({});
		setSubmitError("");
		try {
			await createMutationResult.mutateAsync(value);
			await refreshLists();
			notify(i18n.t("administrators.notifications.created"));
			props.onClose();
		} catch (error) {
			setProblem(error);
		}
	};
	const submitStatus = async () => {
		const administrator = props.administrator;
		if (!administrator) return;
		setSubmitError("");
		try {
			await statusMutation.mutateAsync({
				administrator,
				enabled: !administrator.enabled,
			});
			await refreshLists();
			notify(
				i18n.t(
					administrator.enabled
						? "administrators.notifications.disabled"
						: "administrators.notifications.enabled",
				),
			);
			props.onClose();
		} catch (error) {
			if (error instanceof ApiProblemError && error.code === "STALE_WRITE") {
				await refreshLists();
				setSubmitError(i18n.t("administrators.errors.staleRefreshed"));
				return;
			}
			setProblem(error);
		}
	};
	const submitReset = async (temporaryPassword: string) => {
		const administrator = props.administrator;
		if (!administrator) return;
		setSubmitError("");
		try {
			await resetMutation.mutateAsync({
				id: administrator.id,
				temporaryPassword,
			});
			await refreshLists();
			notify(i18n.t("administrators.notifications.passwordReset"));
			props.onClose();
		} catch (error) {
			if (
				error instanceof ApiProblemError &&
				error.problem.fieldErrors?.some(
					(fieldError) => fieldError.path === "temporaryPassword",
				)
			) {
				setSubmitError(i18n.t("administrators.errors.passwordPolicy"));
				return;
			}
			setProblem(error);
		}
	};
	const submitRevoke = async () => {
		const administrator = props.administrator;
		if (!administrator) return;
		setSubmitError("");
		try {
			await revokeMutation.mutateAsync(administrator.id);
			notify(i18n.t("administrators.notifications.sessionsRevoked"));
			props.onClose();
		} catch (error) {
			setProblem(error);
		}
	};

	const formLabels = () => ({
		cancel: i18n.t("common.cancel"),
		email: i18n.t("administrators.form.email"),
		emailInvalid: i18n.t("errors.field.email"),
		name: i18n.t("administrators.form.name"),
		nameRequired: i18n.t("administrators.errors.nameRequired"),
		nameTooLong: i18n.t("administrators.errors.nameTooLong"),
		password: i18n.t("administrators.form.temporaryPassword"),
		passwordPolicy: i18n.t("administrators.errors.passwordPolicy"),
		pending: i18n.t("administrators.creating"),
		role: i18n.t("administrators.form.role"),
		roleDescription: i18n.t("administrators.form.roleDescription"),
		submit: i18n.t("common.create"),
	});

	return (
		<>
			<DialogRoot
				onOpenChange={(open) => {
					if (!open && !pending()) props.onClose();
				}}
				open={props.dialog === "create"}
			>
				<DialogContent
					closeDisabled={pending()}
					onCloseAutoFocus={restoreFocus}
				>
					<DialogHeader>
						<DialogTitle>
							{i18n.t("administrators.dialog.createTitle")}
						</DialogTitle>
						<DialogDescription>
							{i18n.t("administrators.dialog.createDescription")}
						</DialogDescription>
					</DialogHeader>
					<AdministratorForm
						labels={formLabels()}
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
					if (!open && !pending()) props.onClose();
				}}
				open={props.dialog === "reset"}
			>
				<DialogContent
					closeDisabled={pending()}
					onCloseAutoFocus={restoreFocus}
				>
					<DialogHeader>
						<DialogTitle>
							{i18n.t("administrators.dialog.resetTitle")}
						</DialogTitle>
						<DialogDescription>
							{i18n.t("administrators.dialog.resetDescription", {
								name: props.administrator?.name ?? "",
							})}
						</DialogDescription>
					</DialogHeader>
					<TemporaryPasswordForm
						cancelLabel={i18n.t("common.cancel")}
						onCancel={props.onClose}
						onSubmit={submitReset}
						passwordLabel={i18n.t("administrators.form.temporaryPassword")}
						passwordPolicy={i18n.t("administrators.errors.passwordPolicy")}
						pendingLabel={i18n.t("administrators.resetting")}
						submitError={submitError()}
						submitLabel={i18n.t("administrators.actions.resetPassword")}
					/>
				</DialogContent>
			</DialogRoot>

			<DialogRoot
				onOpenChange={(open) => {
					if (!open && !pending()) props.onClose();
				}}
				open={
					props.dialog === "disable" ||
					props.dialog === "enable" ||
					props.dialog === "revoke"
				}
			>
				<DialogContent
					closeDisabled={pending()}
					onCloseAutoFocus={restoreFocus}
				>
					<DialogHeader>
						<DialogTitle>
							{i18n.t(
								props.dialog === "disable"
									? "administrators.dialog.disableTitle"
									: props.dialog === "enable"
										? "administrators.dialog.enableTitle"
										: "administrators.dialog.revokeTitle",
							)}
						</DialogTitle>
						<DialogDescription>
							{i18n.t(
								props.dialog === "disable"
									? "administrators.dialog.disableDescription"
									: props.dialog === "enable"
										? "administrators.dialog.enableDescription"
										: "administrators.dialog.revokeDescription",
								{ name: props.administrator?.name ?? "" },
							)}
						</DialogDescription>
					</DialogHeader>
					<Show when={submitError()}>
						<p
							class="m-0 rounded-md border border-danger/20 bg-danger/6 px-3 py-2.5 text-sm text-danger"
							role="alert"
						>
							{submitError()}
						</p>
					</Show>
					<DialogFooter>
						<Button
							disabled={pending()}
							onClick={props.onClose}
							type="button"
							variant="secondary"
						>
							{i18n.t("common.cancel")}
						</Button>
						<Button
							disabled={pending() || !props.administrator}
							onClick={() =>
								void (props.dialog === "revoke"
									? submitRevoke()
									: submitStatus())
							}
							type="button"
							variant={props.dialog === "disable" ? "danger" : "primary"}
						>
							{pending()
								? i18n.t("common.saving")
								: i18n.t(
										props.dialog === "disable"
											? "administrators.actions.disable"
											: props.dialog === "enable"
												? "administrators.actions.enable"
												: "administrators.actions.revokeSessions",
									)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</DialogRoot>
		</>
	);
}
