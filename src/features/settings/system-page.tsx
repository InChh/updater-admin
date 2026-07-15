import {
	createMutation,
	createQuery,
	useQueryClient,
} from "@tanstack/solid-query";
import { Settings2 } from "lucide-solid";
import { createSignal, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { notify } from "../../components/ui/toast";
import { ApiProblemError } from "../../lib/api/client";
import { useI18n } from "../../lib/i18n/i18n";
import type { WeakEntityTag } from "../../shared/api/common";
import type { UpdateSystemSettingsInput } from "../../shared/api/settings";
import { updateSystemSettings } from "./system-api";
import {
	markSystemSettingsStale,
	refreshStaleSystemSettings,
	storeSystemSettings,
} from "./system-cache";
import {
	SystemSettingsForm,
	type SystemSettingsFormField,
} from "./system-form";
import { systemSettingsQueryOptions } from "./system-queries";

type ServerErrors = Partial<Record<SystemSettingsFormField, string>>;

export function SystemSettingsPage() {
	const i18n = useI18n();
	const queryClient = useQueryClient();
	const settingsQuery = createQuery(systemSettingsQueryOptions);
	const [serverErrors, setServerErrors] = createSignal<ServerErrors>({});
	const [submitError, setSubmitError] = createSignal("");
	const mutation = createMutation(() => ({
		mutationFn: (input: {
			readonly etag: WeakEntityTag;
			readonly value: UpdateSystemSettingsInput;
		}) => updateSystemSettings(input.value, input.etag),
	}));
	const labels = () => ({
		defaultLocale: i18n.t("systemSettings.form.defaultLocale"),
		defaultLocaleDescription: i18n.t(
			"systemSettings.form.defaultLocaleDescription",
		),
		defaultPageSize: i18n.t("systemSettings.form.defaultPageSize"),
		defaultPageSizeDescription: i18n.t(
			"systemSettings.form.defaultPageSizeDescription",
		),
		localeEnglish: i18n.t("systemSettings.locale.en"),
		localeSimplifiedChinese: i18n.t("systemSettings.locale.zhCN"),
		repositoryUrl: i18n.t("systemSettings.form.repositoryUrl"),
		repositoryUrlDescription: i18n.t(
			"systemSettings.form.repositoryUrlDescription",
		),
		repositoryUrlInvalid: i18n.t("systemSettings.errors.repositoryUrlInvalid"),
		repositoryUrlTooLong: i18n.t("systemSettings.errors.repositoryUrlTooLong"),
		saving: i18n.t("common.saving"),
		submit: i18n.t("common.save"),
		systemName: i18n.t("systemSettings.form.systemName"),
		systemNameDescription: i18n.t("systemSettings.form.systemNameDescription"),
		systemNameRequired: i18n.t("systemSettings.errors.systemNameRequired"),
		systemNameTooLong: i18n.t("systemSettings.errors.systemNameTooLong"),
	});

	const mapFieldErrors = (error: ApiProblemError): ServerErrors => {
		const mapped: Partial<Record<SystemSettingsFormField, string>> = {};
		for (const fieldError of error.problem.fieldErrors ?? []) {
			switch (fieldError.path) {
				case "systemName":
					mapped.systemName =
						fieldError.code === "REQUIRED"
							? i18n.t("systemSettings.errors.systemNameRequired")
							: i18n.t("systemSettings.errors.systemNameTooLong");
					break;
				case "repositoryUrl":
					mapped.repositoryUrl =
						fieldError.code === "TOO_LONG"
							? i18n.t("systemSettings.errors.repositoryUrlTooLong")
							: i18n.t("systemSettings.errors.repositoryUrlInvalid");
					break;
				case "defaultLocale":
					mapped.defaultLocale = i18n.t("errors.field.invalid");
					break;
				case "defaultPageSize":
					mapped.defaultPageSize = i18n.t("errors.field.invalid");
					break;
			}
		}
		return mapped;
	};

	return (
		<div class="page-enter mx-auto w-full max-w-[980px] px-5 py-7 lg:px-8 lg:py-9">
			<section
				aria-labelledby="system-settings-page-title"
				class="panel overflow-hidden"
			>
				<header class="flex min-h-14 items-center border-b border-border px-5 py-3">
					<h1
						class="m-0 text-base font-semibold tracking-[-0.01em] text-ink"
						id="system-settings-page-title"
					>
						{i18n.t("pages.systemSettings.title")}
					</h1>
				</header>
				<Show
					when={!settingsQuery.isError || settingsQuery.data}
					fallback={
						<div class="grid min-h-64 place-items-center p-8 text-center">
							<div>
								<p class="m-0 text-sm text-danger" role="alert">
									{i18n.formatApiError(settingsQuery.error)}
								</p>
								<Button
									class="mt-4"
									onClick={() => void settingsQuery.refetch()}
									type="button"
									variant="secondary"
								>
									{i18n.t("common.retry")}
								</Button>
							</div>
						</div>
					}
				>
					<Show
						keyed
						when={settingsQuery.data}
						fallback={
							<div class="grid min-h-64 place-items-center text-sm text-muted">
								{i18n.t("common.loading")}
							</div>
						}
					>
						{(settings) => (
							<div class="p-5 lg:p-6">
								<div class="mb-5 flex items-center gap-3 border-b border-border pb-4">
									<span class="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-deep">
										<Settings2 aria-hidden="true" size={21} />
									</span>
									<div>
										<h2 class="m-0 text-sm font-semibold text-ink">
											{i18n.t("systemSettings.section.title")}
										</h2>
										<p class="m-0 mt-1 text-xs text-muted">
											{i18n.t("systemSettings.section.description")}
										</p>
									</div>
								</div>
								<SystemSettingsForm
									initialValue={settings.data}
									labels={labels()}
									onFieldInput={(field) => {
										setServerErrors((current) => ({
											...current,
											[field]: undefined,
										}));
										setSubmitError("");
									}}
									onSubmit={async (value) => {
										setServerErrors({});
										setSubmitError("");
										try {
											const updated = await mutation.mutateAsync({
												etag: settings.etag,
												value,
											});
											storeSystemSettings(queryClient, updated);
											await markSystemSettingsStale(queryClient);
											notify(i18n.t("systemSettings.notifications.saved"));
										} catch (error) {
											if (
												error instanceof ApiProblemError &&
												error.code === "STALE_WRITE"
											) {
												await refreshStaleSystemSettings(queryClient);
												notify(
													i18n.t("systemSettings.errors.staleRefreshed"),
													undefined,
													"error",
												);
												return;
											}
											if (error instanceof ApiProblemError) {
												const fields = mapFieldErrors(error);
												if (Object.keys(fields).length > 0) {
													setServerErrors(fields);
													return;
												}
											}
											setSubmitError(i18n.formatApiError(error));
										}
									}}
									serverErrors={serverErrors()}
									submitError={submitError()}
								/>
							</div>
						)}
					</Show>
				</Show>
			</section>
		</div>
	);
}
