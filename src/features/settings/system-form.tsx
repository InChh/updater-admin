import { createForm } from "@tanstack/solid-form";
import { Languages, Link2, Rows3, Save, Type } from "lucide-solid";
import { createSignal, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { isWellFormedUnicode } from "../../shared/api/common";
import {
	SYSTEM_SETTINGS_PAGE_SIZES,
	type SystemSettingsDto,
	type SystemSettingsPageSize,
	type UpdateSystemSettingsInput,
} from "../../shared/api/settings";

export interface SystemSettingsFormLabels {
	readonly defaultLocale: string;
	readonly defaultLocaleDescription: string;
	readonly defaultPageSize: string;
	readonly defaultPageSizeDescription: string;
	readonly localeEnglish: string;
	readonly localeSimplifiedChinese: string;
	readonly repositoryUrl: string;
	readonly repositoryUrlDescription: string;
	readonly repositoryUrlInvalid: string;
	readonly repositoryUrlTooLong: string;
	readonly saving: string;
	readonly submit: string;
	readonly systemName: string;
	readonly systemNameDescription: string;
	readonly systemNameRequired: string;
	readonly systemNameTooLong: string;
}

export type SystemSettingsFormField = keyof UpdateSystemSettingsInput;

export interface SystemSettingsFormProps {
	readonly initialValue: SystemSettingsDto;
	readonly labels: SystemSettingsFormLabels;
	readonly onFieldInput?: (field: SystemSettingsFormField) => void;
	readonly onSubmit: (value: UpdateSystemSettingsInput) => Promise<void>;
	readonly serverErrors?: Partial<Record<SystemSettingsFormField, string>>;
	readonly submitError?: string;
}

function firstError(errors: readonly unknown[]): string | undefined {
	return errors.find((error): error is string => typeof error === "string");
}

function codePointLength(value: string): number {
	return [...value].length;
}

function repositoryUrlError(
	value: string,
	labels: SystemSettingsFormLabels,
): string | undefined {
	const normalized = value.trim();
	if (!normalized) return undefined;
	if (!isWellFormedUnicode(normalized) || codePointLength(normalized) > 2048) {
		return labels.repositoryUrlTooLong;
	}
	try {
		const parsed = new URL(normalized);
		if (
			parsed.protocol !== "https:" ||
			!parsed.hostname ||
			parsed.username ||
			parsed.password
		) {
			return labels.repositoryUrlInvalid;
		}
	} catch {
		return labels.repositoryUrlInvalid;
	}
	return undefined;
}

function pageSize(value: string): SystemSettingsPageSize {
	const parsed = Number(value);
	return (
		SYSTEM_SETTINGS_PAGE_SIZES.find((candidate) => candidate === parsed) ?? 20
	);
}

export function SystemSettingsForm(props: SystemSettingsFormProps) {
	const [submitting, setSubmitting] = createSignal(false);
	const form = createForm(() => ({
		defaultValues: {
			defaultLocale: props.initialValue.defaultLocale,
			defaultPageSize: props.initialValue.defaultPageSize,
			repositoryUrl: props.initialValue.repositoryUrl ?? "",
			systemName: props.initialValue.systemName,
		},
		onSubmit: async ({ value }) => {
			setSubmitting(true);
			try {
				await props.onSubmit({
					defaultLocale: value.defaultLocale,
					defaultPageSize: value.defaultPageSize,
					repositoryUrl: value.repositoryUrl.trim() || null,
					systemName: value.systemName.trim(),
				});
			} finally {
				setSubmitting(false);
			}
		},
	}));

	return (
		<form
			aria-busy={submitting()}
			class="grid gap-5"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field
				name="systemName"
				validators={{
					onBlur: ({ value }) => {
						const normalized = value.trim();
						if (!normalized) return props.labels.systemNameRequired;
						return codePointLength(normalized) > 128
							? props.labels.systemNameTooLong
							: undefined;
					},
					onSubmit: ({ value }) => {
						const normalized = value.trim();
						if (!normalized) return props.labels.systemNameRequired;
						return codePointLength(normalized) > 128
							? props.labels.systemNameTooLong
							: undefined;
					},
				}}
				children={(field) => (
					<Field
						description={props.labels.systemNameDescription}
						error={
							props.serverErrors?.systemName ??
							firstError(field().state.meta.errors)
						}
						label={props.labels.systemName}
						name="system-settings-name"
						required
					>
						{(controlProps) => (
							<div class="relative">
								<Type
									aria-hidden="true"
									class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
									size={16}
								/>
								<Input
									{...controlProps}
									class="pl-9"
									autocomplete="organization"
									onBlur={field().handleBlur}
									onInput={(event) => {
										field().handleChange(event.currentTarget.value);
										props.onFieldInput?.("systemName");
									}}
									value={field().state.value}
								/>
							</div>
						)}
					</Field>
				)}
			/>

			<div class="grid gap-5 sm:grid-cols-2">
				<form.Field
					name="defaultLocale"
					children={(field) => (
						<Field
							description={props.labels.defaultLocaleDescription}
							error={props.serverErrors?.defaultLocale}
							label={props.labels.defaultLocale}
							name="system-settings-default-locale"
							required
						>
							{(controlProps) => (
								<div class="relative">
									<Languages
										aria-hidden="true"
										class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
										size={16}
									/>
									<select
										{...controlProps}
										class="h-9 w-full rounded-md border border-border-strong bg-white pl-9 pr-3 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/14"
										onChange={(event) => {
											field().handleChange(
												event.currentTarget.value === "en" ? "en" : "zh-CN",
											);
											props.onFieldInput?.("defaultLocale");
										}}
										value={field().state.value}
									>
										<option value="zh-CN">
											{props.labels.localeSimplifiedChinese}
										</option>
										<option value="en">{props.labels.localeEnglish}</option>
									</select>
								</div>
							)}
						</Field>
					)}
				/>
				<form.Field
					name="defaultPageSize"
					children={(field) => (
						<Field
							description={props.labels.defaultPageSizeDescription}
							error={props.serverErrors?.defaultPageSize}
							label={props.labels.defaultPageSize}
							name="system-settings-default-page-size"
							required
						>
							{(controlProps) => (
								<div class="relative">
									<Rows3
										aria-hidden="true"
										class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
										size={16}
									/>
									<select
										{...controlProps}
										class="h-9 w-full rounded-md border border-border-strong bg-white pl-9 pr-3 text-sm text-ink outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/14"
										onChange={(event) => {
											field().handleChange(pageSize(event.currentTarget.value));
											props.onFieldInput?.("defaultPageSize");
										}}
										value={String(field().state.value)}
									>
										{SYSTEM_SETTINGS_PAGE_SIZES.map((value) => (
											<option value={value}>{value}</option>
										))}
									</select>
								</div>
							)}
						</Field>
					)}
				/>
			</div>

			<form.Field
				name="repositoryUrl"
				validators={{
					onBlur: ({ value }) => repositoryUrlError(value, props.labels),
					onSubmit: ({ value }) => repositoryUrlError(value, props.labels),
				}}
				children={(field) => (
					<Field
						description={props.labels.repositoryUrlDescription}
						error={
							props.serverErrors?.repositoryUrl ??
							firstError(field().state.meta.errors)
						}
						label={props.labels.repositoryUrl}
						name="system-settings-repository-url"
					>
						{(controlProps) => (
							<div class="relative">
								<Link2
									aria-hidden="true"
									class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
									size={16}
								/>
								<Input
									{...controlProps}
									class="pl-9"
									autocomplete="url"
									inputmode="url"
									onBlur={field().handleBlur}
									onInput={(event) => {
										field().handleChange(event.currentTarget.value);
										props.onFieldInput?.("repositoryUrl");
									}}
									placeholder="https://github.com/example/project"
									value={field().state.value}
								/>
							</div>
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
			<Button class="justify-self-end" disabled={submitting()} type="submit">
				<Save aria-hidden="true" size={15} />
				{submitting() ? props.labels.saving : props.labels.submit}
			</Button>
		</form>
	);
}
