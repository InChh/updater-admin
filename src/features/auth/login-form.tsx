import { createForm } from "@tanstack/solid-form";
import { LogIn } from "lucide-solid";
import { createSignal, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";

export interface LoginCredentials {
	readonly email: string;
	readonly password: string;
}

export interface LoginFormLabels {
	readonly email: string;
	readonly emailInvalid: string;
	readonly emailRequired: string;
	readonly genericError: string;
	readonly password: string;
	readonly passwordRequired: string;
	readonly pending: string;
	readonly submit: string;
}

export interface LoginFormProps {
	readonly initialEmail?: string;
	readonly labels: LoginFormLabels;
	readonly onSubmit: (credentials: LoginCredentials) => Promise<void>;
}

function firstError(errors: readonly unknown[]): string | undefined {
	return errors.find((error): error is string => typeof error === "string");
}

export function LoginForm(props: LoginFormProps) {
	const [submitError, setSubmitError] = createSignal("");
	const [submitting, setSubmitting] = createSignal(false);
	const form = createForm(() => ({
		defaultValues: { email: props.initialEmail ?? "", password: "" },
		onSubmit: async ({ value }) => {
			setSubmitError("");
			setSubmitting(true);
			try {
				await props.onSubmit(value);
			} catch {
				setSubmitError(props.labels.genericError);
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
				name="email"
				validators={{
					onBlur: ({ value }) => {
						if (!value.trim()) return props.labels.emailRequired;
						if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
							return props.labels.emailInvalid;
						}
						return undefined;
					},
					onSubmit: ({ value }) =>
						value.trim() ? undefined : props.labels.emailRequired,
				}}
				children={(field) => (
					<Field
						error={firstError(field().state.meta.errors)}
						label={props.labels.email}
						name="login-email"
						required
					>
						{(controlProps) => (
							<Input
								{...controlProps}
								autocomplete="username"
								name="email"
								onBlur={field().handleBlur}
								onInput={(event) =>
									field().handleChange(event.currentTarget.value)
								}
								type="email"
								value={field().state.value}
							/>
						)}
					</Field>
				)}
			/>
			<form.Field
				name="password"
				validators={{
					onSubmit: ({ value }) =>
						value ? undefined : props.labels.passwordRequired,
				}}
				children={(field) => (
					<Field
						error={firstError(field().state.meta.errors)}
						label={props.labels.password}
						name="login-password"
						required
					>
						{(controlProps) => (
							<Input
								{...controlProps}
								autocomplete="current-password"
								name="password"
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
			<Show when={submitError()}>
				<div
					class="rounded-md border border-danger/20 bg-danger/6 px-3 py-2.5 text-sm text-danger"
					role="alert"
				>
					{submitError()}
				</div>
			</Show>
			<Button class="mt-1 w-full" disabled={submitting()} type="submit">
				<LogIn aria-hidden="true" size={16} />
				{submitting() ? props.labels.pending : props.labels.submit}
			</Button>
		</form>
	);
}
