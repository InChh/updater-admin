import { createForm } from "@tanstack/solid-form";
import { KeyRound } from "lucide-solid";
import { createSignal, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import type { ChangePasswordInput } from "../../shared/api/profile";

export interface ChangePasswordFormLabels {
	readonly confirmPassword: string;
	readonly currentPassword: string;
	readonly genericError: string;
	readonly mismatch: string;
	readonly newPassword: string;
	readonly passwordRequired: string;
	readonly passwordTooShort: string;
	readonly pending: string;
	readonly submit: string;
}

export interface ChangePasswordFormProps {
	readonly formatError?: (error: unknown) => string;
	readonly labels: ChangePasswordFormLabels;
	readonly onSubmit: (input: ChangePasswordInput) => Promise<void>;
}

function firstError(errors: readonly unknown[]): string | undefined {
	return errors.find((error): error is string => typeof error === "string");
}

export function ChangePasswordForm(props: ChangePasswordFormProps) {
	const [submitError, setSubmitError] = createSignal("");
	const [confirmError, setConfirmError] = createSignal("");
	const [submitting, setSubmitting] = createSignal(false);
	const form = createForm(() => ({
		defaultValues: {
			confirmPassword: "",
			currentPassword: "",
			newPassword: "",
		},
		onSubmit: async ({ value }) => {
			setSubmitError("");
			if (value.newPassword !== value.confirmPassword) {
				setConfirmError(props.labels.mismatch);
				return;
			}
			setConfirmError("");
			setSubmitting(true);
			try {
				await props.onSubmit({
					currentPassword: value.currentPassword,
					newPassword: value.newPassword,
				});
			} catch (error) {
				setSubmitError(props.formatError?.(error) ?? props.labels.genericError);
			} finally {
				setSubmitting(false);
			}
		},
	}));

	return (
		<form
			aria-busy={submitting()}
			class="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field
				name="currentPassword"
				validators={{
					onSubmit: ({ value }) =>
						value ? undefined : props.labels.passwordRequired,
				}}
				children={(field) => (
					<Field
						error={firstError(field().state.meta.errors)}
						label={props.labels.currentPassword}
						name="current-password"
						required
					>
						{(controlProps) => (
							<Input
								{...controlProps}
								autocomplete="current-password"
								onInput={(event) =>
									field().handleChange(event.currentTarget.value)
								}
								type="password"
								value={field().state.value}
							/>
						)}
					</Field>
				)}
			/>
			<form.Field
				name="newPassword"
				validators={{
					onBlur: ({ value }) =>
						value.length >= 12 ? undefined : props.labels.passwordTooShort,
					onSubmit: ({ value }) => {
						if (!value) return props.labels.passwordRequired;
						return value.length >= 12
							? undefined
							: props.labels.passwordTooShort;
					},
				}}
				children={(field) => (
					<Field
						error={firstError(field().state.meta.errors)}
						label={props.labels.newPassword}
						name="new-password"
						required
					>
						{(controlProps) => (
							<Input
								{...controlProps}
								autocomplete="new-password"
								minLength={12}
								onBlur={field().handleBlur}
								onInput={(event) =>
									field().handleChange(event.currentTarget.value)
								}
								type="password"
								value={field().state.value}
							/>
						)}
					</Field>
				)}
			/>
			<form.Field
				name="confirmPassword"
				validators={{
					onSubmit: ({ value }) =>
						value ? undefined : props.labels.passwordRequired,
				}}
				children={(field) => (
					<Field
						error={confirmError() || firstError(field().state.meta.errors)}
						label={props.labels.confirmPassword}
						name="confirm-password"
						required
					>
						{(controlProps) => (
							<Input
								{...controlProps}
								autocomplete="new-password"
								onInput={(event) => {
									setConfirmError("");
									field().handleChange(event.currentTarget.value);
								}}
								type="password"
								value={field().state.value}
							/>
						)}
					</Field>
				)}
			/>
			<Show when={submitError()}>
				<div
					class="rounded-md border border-danger/20 bg-danger/6 px-3 py-2.5 text-sm text-danger"
					role="alert"
				>
					{submitError()}
				</div>
			</Show>
			<Button class="mt-1 w-full" disabled={submitting()} type="submit">
				<KeyRound aria-hidden="true" size={16} />
				{submitting() ? props.labels.pending : props.labels.submit}
			</Button>
		</form>
	);
}
