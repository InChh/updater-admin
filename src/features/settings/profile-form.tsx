import { createForm } from "@tanstack/solid-form";
import {
	createMutation,
	createQuery,
	useQueryClient,
} from "@tanstack/solid-query";
import { useRouter } from "@tanstack/solid-router";
import { KeyRound, Languages, Save, UserRound } from "lucide-solid";
import { createSignal, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { notify } from "../../components/ui/toast";
import { ApiProblemError } from "../../lib/api/client";
import { profileQueryKeys } from "../../lib/api/query-keys";
import { useI18n } from "../../lib/i18n/i18n";
import { sessionQueryKey } from "../../lib/session-query";
import type { SafeSessionView } from "../../server/auth/session.server";
import type { WeakEntityTag } from "../../shared/api/common";
import type { ProfileDto } from "../../shared/api/profile";
import {
	ChangePasswordForm,
	type ChangePasswordFormLabels,
} from "../auth/change-password-form";
import { shellUiController } from "../shell/ui-store";
import { changeProfilePassword, updateProfile } from "./api";
import { profileQueryOptions } from "./queries";

function firstError(errors: readonly unknown[]): string | undefined {
	return errors.find((error): error is string => typeof error === "string");
}

interface ProfileDetailsFormProps {
	readonly etag: WeakEntityTag;
	readonly profile: ProfileDto;
}

function ProfileDetailsForm(props: ProfileDetailsFormProps) {
	const i18n = useI18n();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [submitError, setSubmitError] = createSignal("");
	const mutation = createMutation(() => ({
		mutationFn: (input: {
			readonly etag: WeakEntityTag;
			readonly locale: "en" | "zh-CN";
			readonly name: string;
		}) => updateProfile({ locale: input.locale, name: input.name }, input.etag),
	}));
	const form = createForm(() => ({
		defaultValues: { locale: props.profile.locale, name: props.profile.name },
		onSubmit: async ({ value }) => {
			setSubmitError("");
			try {
				const updated = await mutation.mutateAsync({
					etag: props.etag,
					locale: value.locale,
					name: value.name.trim(),
				});
				queryClient.setQueryData(profileQueryKeys.detail(), updated);
				queryClient.setQueryData<SafeSessionView | null>(
					sessionQueryKey,
					(current) =>
						current
							? {
									...current,
									metadata: {
										...current.metadata,
										etag: updated.etag,
										locale: updated.data.locale,
									},
									user: { ...current.user, name: updated.data.name },
								}
							: current,
				);
				await i18n.setLocale(updated.data.locale);
				shellUiController.setLocale(updated.data.locale);
				await router.invalidate({ sync: true });
				notify(i18n.t("profile.notifications.saved"));
			} catch (error) {
				if (error instanceof ApiProblemError && error.code === "STALE_WRITE") {
					await queryClient.invalidateQueries({
						queryKey: profileQueryKeys.detail(),
					});
					notify(i18n.t("profile.errors.staleRefreshed"), undefined, "error");
					return;
				}
				setSubmitError(i18n.formatApiError(error));
			}
		},
	}));

	return (
		<form
			aria-busy={mutation.isPending}
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
						if (!name) return i18n.t("errors.field.required");
						return [...name].length > 128
							? i18n.t("profile.errors.nameTooLong")
							: undefined;
					},
					onSubmit: ({ value }) => {
						const name = value.trim();
						if (!name) return i18n.t("errors.field.required");
						return [...name].length > 128
							? i18n.t("profile.errors.nameTooLong")
							: undefined;
					},
				}}
				children={(field) => (
					<Field
						error={firstError(field().state.meta.errors)}
						label={i18n.t("profile.form.name")}
						name="profile-name"
						required
					>
						{(controlProps) => (
							<Input
								{...controlProps}
								autocomplete="name"
								onBlur={field().handleBlur}
								onInput={(event) =>
									field().handleChange(event.currentTarget.value)
								}
								value={field().state.value}
							/>
						)}
					</Field>
				)}
			/>
			<form.Field
				name="locale"
				children={(field) => (
					<Field
						label={i18n.t("profile.form.locale")}
						name="profile-locale"
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
									onChange={(event) =>
										field().handleChange(
											event.currentTarget.value === "en" ? "en" : "zh-CN",
										)
									}
									value={field().state.value}
								>
									<option value="zh-CN">
										{i18n.t("administrators.locale.zhCN")}
									</option>
									<option value="en">
										{i18n.t("administrators.locale.en")}
									</option>
								</select>
							</div>
						)}
					</Field>
				)}
			/>
			<Show when={submitError()}>
				<p
					class="m-0 rounded-md border border-danger/20 bg-danger/6 px-3 py-2.5 text-sm text-danger"
					role="alert"
				>
					{submitError()}
				</p>
			</Show>
			<Button
				class="justify-self-end"
				disabled={mutation.isPending}
				type="submit"
			>
				<Save aria-hidden="true" size={15} />
				{mutation.isPending ? i18n.t("common.saving") : i18n.t("common.save")}
			</Button>
		</form>
	);
}

export function ProfileForm() {
	const i18n = useI18n();
	const queryClient = useQueryClient();
	const router = useRouter();
	const profileQuery = createQuery(profileQueryOptions);
	const passwordLabels = (): ChangePasswordFormLabels => ({
		confirmPassword: i18n.t("auth.changePassword.confirmPassword"),
		currentPassword: i18n.t("auth.changePassword.currentPassword"),
		genericError: i18n.t("errors.api.generic"),
		mismatch: i18n.t("errors.field.passwordMismatch"),
		newPassword: i18n.t("auth.changePassword.newPassword"),
		passwordRequired: i18n.t("errors.field.required"),
		passwordTooShort: i18n.t("errors.field.passwordLength"),
		pending: i18n.t("auth.changePassword.submitting"),
		submit: i18n.t("profile.password.submit"),
	});
	const changePassword = async (input: {
		readonly currentPassword: string;
		readonly newPassword: string;
	}) => {
		await changeProfilePassword(input);
		notify(i18n.t("profile.notifications.passwordChanged"));
		queryClient.removeQueries({ queryKey: sessionQueryKey });
		queryClient.removeQueries({ queryKey: profileQueryKeys.all });
		shellUiController.logout();
		await router.invalidate({ sync: true });
		await router.navigate({
			search: { returnTo: "/settings/profile" },
			to: "/login",
		});
	};
	const formatPasswordError = (error: unknown) => {
		if (
			error instanceof ApiProblemError &&
			error.problem.fieldErrors?.some(
				(field) =>
					field.path === "currentPassword" && field.code === "INVALID_PASSWORD",
			)
		) {
			return i18n.t("errors.field.currentPassword");
		}
		return i18n.formatApiError(error);
	};

	return (
		<div class="page-enter mx-auto w-full max-w-[980px] px-5 py-7 lg:px-8 lg:py-9">
			<section
				aria-labelledby="profile-page-title"
				class="panel overflow-hidden"
			>
				<header class="flex min-h-14 items-center border-b border-border px-5 py-3">
					<h1
						class="m-0 text-base font-semibold tracking-[-0.01em] text-ink"
						id="profile-page-title"
					>
						{i18n.t("pages.profileSettings.title")}
					</h1>
				</header>
				<Show
					when={!profileQuery.isError || profileQuery.data}
					fallback={
						<div class="grid min-h-64 place-items-center p-8 text-center">
							<div>
								<p class="m-0 text-sm text-danger" role="alert">
									{i18n.formatApiError(profileQuery.error)}
								</p>
								<Button
									class="mt-4"
									onClick={() => void profileQuery.refetch()}
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
						when={profileQuery.data}
						fallback={
							<div class="grid min-h-64 place-items-center text-sm text-muted">
								{i18n.t("common.loading")}
							</div>
						}
					>
						{(profile) => (
							<div class="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:p-6">
								<section
									aria-labelledby="profile-details-title"
									class="rounded-lg border border-border p-5"
								>
									<div class="mb-5 flex items-center gap-3 border-b border-border pb-4">
										<span class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-deep">
											<UserRound aria-hidden="true" size={21} />
										</span>
										<div class="min-w-0">
											<h2
												class="m-0 text-sm font-semibold text-ink"
												id="profile-details-title"
											>
												{i18n.t("profile.details.title")}
											</h2>
											<p class="m-0 mt-1 truncate text-xs text-muted">
												{profile.data.email}
											</p>
										</div>
									</div>
									<ProfileDetailsForm
										etag={profile.etag}
										profile={profile.data}
									/>
								</section>
								<section
									aria-labelledby="profile-password-title"
									class="rounded-lg border border-border p-5"
								>
									<div class="mb-5 flex items-center gap-3 border-b border-border pb-4">
										<span class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-mist text-muted">
											<KeyRound aria-hidden="true" size={19} />
										</span>
										<div>
											<h2
												class="m-0 text-sm font-semibold text-ink"
												id="profile-password-title"
											>
												{i18n.t("profile.password.title")}
											</h2>
											<p class="m-0 mt-1 text-xs leading-5 text-muted">
												{i18n.t("profile.password.description")}
											</p>
										</div>
									</div>
									<ChangePasswordForm
										formatError={formatPasswordError}
										labels={passwordLabels()}
										onSubmit={changePassword}
									/>
								</section>
							</div>
						)}
					</Show>
				</Show>
			</section>
		</div>
	);
}
