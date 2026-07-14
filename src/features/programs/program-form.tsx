import { createForm } from "@tanstack/solid-form";
import { createSignal, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";

export interface ProgramFormValue {
	readonly description: string;
	readonly name: string;
}

export interface ProgramFormLabels {
	readonly cancel: string;
	readonly description: string;
	readonly descriptionTooLong: string;
	readonly name: string;
	readonly nameRequired: string;
	readonly nameTooLong: string;
	readonly pending: string;
	readonly submit: string;
}

export interface ProgramFormProps {
	readonly initialValue?: ProgramFormValue;
	readonly labels: ProgramFormLabels;
	readonly onCancel: () => void;
	readonly onFieldInput?: (field: keyof ProgramFormValue) => void;
	readonly onSubmit: (value: ProgramFormValue) => Promise<void>;
	readonly serverErrors?: Partial<Record<keyof ProgramFormValue, string>>;
	readonly submitError?: string;
}

function firstError(errors: readonly unknown[]): string | undefined {
	return errors.find((error): error is string => typeof error === "string");
}

function codePointLength(value: string): number {
	return [...value].length;
}

export function ProgramForm(props: ProgramFormProps) {
	const [submitting, setSubmitting] = createSignal(false);
	const form = createForm(() => ({
		defaultValues: props.initialValue ?? { description: "", name: "" },
		onSubmit: async ({ value }) => {
			setSubmitting(true);
			try {
				await props.onSubmit({
					description: value.description.trim(),
					name: value.name.trim(),
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
						const trimmed = value.trim();
						if (!trimmed) return props.labels.nameRequired;
						if (codePointLength(trimmed) > 128) return props.labels.nameTooLong;
						return undefined;
					},
					onSubmit: ({ value }) => {
						const trimmed = value.trim();
						if (!trimmed) return props.labels.nameRequired;
						if (codePointLength(trimmed) > 128) return props.labels.nameTooLong;
						return undefined;
					},
				}}
				children={(field) => (
					<Field
						error={
							props.serverErrors?.name ?? firstError(field().state.meta.errors)
						}
						label={props.labels.name}
						name="program-name"
						required
					>
						{(controlProps) => (
							<Input
								{...controlProps}
								autocomplete="off"
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
				name="description"
				validators={{
					onBlur: ({ value }) =>
						codePointLength(value.trim()) > 512
							? props.labels.descriptionTooLong
							: undefined,
					onSubmit: ({ value }) =>
						codePointLength(value.trim()) > 512
							? props.labels.descriptionTooLong
							: undefined,
				}}
				children={(field) => (
					<Field
						error={
							props.serverErrors?.description ??
							firstError(field().state.meta.errors)
						}
						label={props.labels.description}
						name="program-description"
					>
						{(controlProps) => (
							<Textarea
								{...controlProps}
								onBlur={field().handleBlur}
								onInput={(event) => {
									field().handleChange(event.currentTarget.value);
									props.onFieldInput?.("description");
								}}
								rows={4}
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
