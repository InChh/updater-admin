import { createForm } from "@tanstack/solid-form";
import { ShieldCheck } from "lucide-solid";
import { createSignal, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";

export interface AdministratorFormValue {
	readonly email: string;
	readonly name: string;
	readonly temporaryPassword: string;
}

export interface AdministratorFormLabels {
	readonly cancel: string;
	readonly email: string;
	readonly emailInvalid: string;
	readonly name: string;
	readonly nameRequired: string;
	readonly nameTooLong: string;
	readonly password: string;
	readonly passwordPolicy: string;
	readonly pending: string;
	readonly role: string;
	readonly roleDescription: string;
	readonly submit: string;
}

export interface AdministratorFormProps {
	readonly labels: AdministratorFormLabels;
	readonly onCancel: () => void;
	readonly onFieldInput?: (field: keyof AdministratorFormValue) => void;
	readonly onSubmit: (value: AdministratorFormValue) => Promise<void>;
	readonly serverErrors?: Partial<Record<keyof AdministratorFormValue, string>>;
	readonly submitError?: string;
}

export interface TemporaryPasswordFormProps {
	readonly cancelLabel: string;
	readonly onCancel: () => void;
	readonly onSubmit: (temporaryPassword: string) => Promise<void>;
	readonly passwordLabel: string;
	readonly passwordPolicy: string;
	readonly pendingLabel: string;
	readonly submitError?: string;
	readonly submitLabel: string;
}

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function firstError(errors: readonly unknown[]): string | undefined {
	return errors.find((error): error is string => typeof error === "string");
}

function passwordMeetsPolicy(value: string): boolean {
	return (
		value.length >= 12 &&
		value.length <= 128 &&
		value.trim() === value &&
		new Set(value).size >= 8
	);
}

export function AdministratorForm(props: AdministratorFormProps) {
	const [submitting, setSubmitting] = createSignal(false);
	const form = createForm(() => ({
		defaultValues: { email: "", name: "", temporaryPassword: "" },
		onSubmit: async ({ value }) => {
			setSubmitting(true);
			try {
				await props.onSubmit({
					email: value.email.trim().toLowerCase(),
					name: value.name.trim(),
					temporaryPassword: value.temporaryPassword,
				});
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
				name="name"
				validators={{
					onBlur: ({ value }) => {
						const name = value.trim();
						if (!name) return props.labels.nameRequired;
						return [...name].length > 128
							? props.labels.nameTooLong
							: undefined;
					},
					onSubmit: ({ value }) => {
						const name = value.trim();
						if (!name) return props.labels.nameRequired;
						return [...name].length > 128
							? props.labels.nameTooLong
							: undefined;
					},
				}}
				children={(field) => (
					<Field
						error={
							props.serverErrors?.name ?? firstError(field().state.meta.errors)
						}
						label={props.labels.name}
						name="administrator-name"
						required
					>
						{(controlProps) => (
							<Input
								{...controlProps}
								autocomplete="name"
								onBlur={field().handleBlur}
								onInput={(event) => {
									field().handleChange(event.currentTarget.value);
									props.onFieldInput?.("name");
								}}
								value={field().state.value}
							/>
						)}
					</Field>
				)}
			/>
			<form.Field
				name="email"
				validators={{
					onBlur: ({ value }) =>
						SIMPLE_EMAIL_PATTERN.test(value.trim()) &&
						value.trim().length <= 320
							? undefined
							: props.labels.emailInvalid,
					onSubmit: ({ value }) =>
						SIMPLE_EMAIL_PATTERN.test(value.trim()) &&
						value.trim().length <= 320
							? undefined
							: props.labels.emailInvalid,
				}}
				children={(field) => (
					<Field
						error={
							props.serverErrors?.email ?? firstError(field().state.meta.errors)
						}
						label={props.labels.email}
						name="administrator-email"
						required
					>
						{(controlProps) => (
							<Input
								{...controlProps}
								autocapitalize="none"
								autocomplete="email"
								onBlur={field().handleBlur}
								onInput={(event) => {
									field().handleChange(event.currentTarget.value);
									props.onFieldInput?.("email");
								}}
								type="email"
								value={field().state.value}
							/>
						)}
					</Field>
				)}
			/>
			<form.Field
				name="temporaryPassword"
				validators={{
					onBlur: ({ value }) =>
						passwordMeetsPolicy(value)
							? undefined
							: props.labels.passwordPolicy,
					onSubmit: ({ value }) =>
						passwordMeetsPolicy(value)
							? undefined
							: props.labels.passwordPolicy,
				}}
				children={(field) => (
					<Field
						error={
							props.serverErrors?.temporaryPassword ??
							firstError(field().state.meta.errors)
						}
						label={props.labels.password}
						name="administrator-temporary-password"
						required
					>
						{(controlProps) => (
							<Input
								{...controlProps}
								autocomplete="new-password"
								maxLength={128}
								minLength={12}
								onBlur={field().handleBlur}
								onInput={(event) => {
									field().handleChange(event.currentTarget.value);
									props.onFieldInput?.("temporaryPassword");
								}}
								type="password"
								value={field().state.value}
							/>
						)}
					</Field>
				)}
			/>

			<div class="flex items-center justify-between gap-4 rounded-lg border border-primary/15 bg-primary-soft/60 px-3.5 py-3">
				<div class="flex min-w-0 items-center gap-2.5">
					<span class="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white text-primary-deep shadow-sm">
						<ShieldCheck aria-hidden="true" size={17} />
					</span>
					<div class="min-w-0">
						<p class="m-0 text-sm font-semibold text-ink">
							{props.labels.role}
						</p>
						<p class="m-0 mt-0.5 text-xs text-muted">
							{props.labels.roleDescription}
						</p>
					</div>
				</div>
				<span class="rounded-full border border-primary/20 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-primary-deep">
					admin
				</span>
			</div>

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
				<Button disabled={submitting()} type="submit">
					{submitting() ? props.labels.pending : props.labels.submit}
				</Button>
			</div>
		</form>
	);
}

export function TemporaryPasswordForm(props: TemporaryPasswordFormProps) {
	const [submitting, setSubmitting] = createSignal(false);
	const form = createForm(() => ({
		defaultValues: { temporaryPassword: "" },
		onSubmit: async ({ value }) => {
			setSubmitting(true);
			try {
				await props.onSubmit(value.temporaryPassword);
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
				name="temporaryPassword"
				validators={{
					onBlur: ({ value }) =>
						passwordMeetsPolicy(value) ? undefined : props.passwordPolicy,
					onSubmit: ({ value }) =>
						passwordMeetsPolicy(value) ? undefined : props.passwordPolicy,
				}}
				children={(field) => (
					<Field
						error={firstError(field().state.meta.errors)}
						label={props.passwordLabel}
						name="administrator-reset-temporary-password"
						required
					>
						{(controlProps) => (
							<Input
								{...controlProps}
								autocomplete="new-password"
								maxLength={128}
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
			<Show when={props.submitError}>
				<p
					class="m-0 rounded-md border border-danger/20 bg-danger/6 px-3 py-2.5 text-sm text-danger"
					role="alert"
				>
					{props.submitError}
				</p>
			</Show>
			<div class="flex justify-end gap-2">
				<Button
					disabled={submitting()}
					onClick={props.onCancel}
					type="button"
					variant="secondary"
				>
					{props.cancelLabel}
				</Button>
				<Button disabled={submitting()} type="submit">
					{submitting() ? props.pendingLabel : props.submitLabel}
				</Button>
			</div>
		</form>
	);
}
