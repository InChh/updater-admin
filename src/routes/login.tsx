import { useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, redirect, useRouter } from "@tanstack/solid-router";
import { Code2, Languages } from "lucide-solid";
import { createSignal, type JSX, Show } from "solid-js";

import { Button } from "../components/ui/button";
import { SkipLink } from "../components/ui/skip-link";
import {
	AuthenticationFlowError,
	rotatePasswordAndReplaceSession,
	signInAndLoadSession,
} from "../features/auth/auth-flow";
import {
	ChangePasswordForm,
	type ChangePasswordFormLabels,
} from "../features/auth/change-password-form";
import { LoginForm, type LoginFormLabels } from "../features/auth/login-form";
import {
	ApiProblemResponse,
	changeCurrentPassword,
} from "../features/auth/profile-api";
import { validateReturnTo } from "../features/shell/route-registry";
import { authClient } from "../lib/auth-client";
import { I18nProvider, useI18n } from "../lib/i18n/i18n";
import { sessionQueryKey, sessionQueryOptions } from "../lib/session-query";

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>) => ({
		returnTo: validateReturnTo(search.returnTo),
	}),
	beforeLoad: async ({ context, search }) => {
		const session = await context.queryClient.ensureQueryData(
			sessionQueryOptions(),
		);
		if (
			session &&
			!session.user.banned &&
			!session.metadata.mustChangePassword
		) {
			throw redirect({ href: search.returnTo });
		}
		return {
			session: session?.user.banned ? null : session,
		};
	},
	component: LoginPage,
});

function LoginPage() {
	const context = Route.useRouteContext();
	return (
		<I18nProvider locale={context().session?.metadata.locale}>
			<SkipLink />
			<LoginSurface />
		</I18nProvider>
	);
}

function LoginSurface() {
	const context = Route.useRouteContext();
	const search = Route.useSearch();
	const i18n = useI18n();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [passwordRotationCompleted, setPasswordRotationCompleted] =
		createSignal(false);
	const refreshSession = async () => {
		queryClient.removeQueries({ queryKey: sessionQueryKey });
		return queryClient.fetchQuery(sessionQueryOptions());
	};
	const loginLabels = (): LoginFormLabels => ({
		email: i18n.t("auth.email"),
		emailInvalid: i18n.t("errors.field.email"),
		emailRequired: i18n.t("errors.field.required"),
		genericError: i18n.t("errors.api.generic"),
		password: i18n.t("auth.password"),
		passwordRequired: i18n.t("errors.field.required"),
		pending: i18n.t("auth.signIn.submitting"),
		submit: i18n.t("auth.signIn.submit"),
	});
	const changeLabels = (): ChangePasswordFormLabels => ({
		confirmPassword: i18n.t("auth.changePassword.confirmPassword"),
		currentPassword: i18n.t("auth.changePassword.currentPassword"),
		genericError: i18n.t("errors.api.generic"),
		mismatch: i18n.t("errors.field.passwordMismatch"),
		newPassword: i18n.t("auth.changePassword.newPassword"),
		passwordRequired: i18n.t("errors.field.required"),
		passwordTooShort: i18n.t("errors.field.passwordLength"),
		pending: i18n.t("auth.changePassword.submitting"),
		submit: i18n.t("auth.changePassword.submit"),
	});
	const formatLoginError = (error: unknown) => {
		if (error instanceof AuthenticationFlowError) {
			if (error.code === "INVALID_CREDENTIALS") {
				return i18n.t("auth.signIn.invalidCredentials");
			}
			if (error.code === "RATE_LIMITED") {
				return i18n.t("errors.api.rateLimited");
			}
		}
		return i18n.t("errors.api.generic");
	};
	const signIn = (credentials: {
		readonly email: string;
		readonly password: string;
	}) => authClient.signIn.email(credentials);

	const submitLogin = async (credentials: {
		readonly email: string;
		readonly password: string;
	}) => {
		const session = await signInAndLoadSession(credentials, {
			loadSession: refreshSession,
			signIn,
		});
		if (session.metadata.mustChangePassword) {
			await router.invalidate({ sync: true });
			return;
		}
		await router.navigate({ href: search().returnTo });
	};
	const submitPasswordChange = async (input: {
		readonly currentPassword: string;
		readonly newPassword: string;
	}) => {
		const forcedSession = context().session;
		if (!forcedSession) throw new Error("FORCED_SESSION_REQUIRED");
		let replacement: NonNullable<Awaited<ReturnType<typeof refreshSession>>>;
		try {
			replacement = await rotatePasswordAndReplaceSession(
				{
					...input,
					email: forcedSession.user.email,
				},
				{
					changePassword: changeCurrentPassword,
					clearSessionCache: () =>
						queryClient.removeQueries({ queryKey: sessionQueryKey }),
					loadSession: () => queryClient.fetchQuery(sessionQueryOptions()),
					signIn,
				},
			);
		} catch (error) {
			if (error instanceof AuthenticationFlowError) {
				queryClient.removeQueries({ queryKey: sessionQueryKey });
				setPasswordRotationCompleted(true);
				return;
			}
			throw error;
		}
		if (replacement.metadata.mustChangePassword) {
			throw new Error("PASSWORD_POLICY_NOT_CLEARED");
		}
		await router.navigate({ href: search().returnTo });
	};
	const formatPasswordError = (error: unknown) => {
		if (
			error instanceof ApiProblemResponse &&
			error.problem.fieldErrors?.some(
				(field) =>
					field.path === "currentPassword" && field.code === "INVALID_PASSWORD",
			)
		) {
			return i18n.t("errors.field.currentPassword");
		}
		return i18n.formatApiError(error);
	};
	const forced = () =>
		Boolean(context().session?.metadata.mustChangePassword) &&
		!passwordRotationCompleted();

	return (
		<main
			class="relative grid min-h-dvh place-items-center overflow-hidden bg-mist px-4 py-10"
			id="main-content"
		>
			<div class="absolute right-4 top-4 sm:right-6 sm:top-5">
				<Button
					aria-label={i18n.t("a11y.languageMenu")}
					onClick={() =>
						void i18n.setLocale(i18n.locale() === "zh-CN" ? "en" : "zh-CN")
					}
					size="sm"
					type="button"
					variant="ghost"
				>
					<Languages aria-hidden="true" size={16} />
					{i18n.locale() === "zh-CN" ? "English" : "中文"}
				</Button>
			</div>
			<section class="w-full max-w-[420px] rounded-xl border border-border bg-white px-6 py-7 shadow-[0_18px_60px_rgba(31,45,53,0.09)] sm:px-8 sm:py-8">
				<div class="mb-7 text-center">
					<div class="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-[10px] bg-primary text-white shadow-[0_5px_18px_rgba(0,168,112,0.22)]">
						<Code2 aria-hidden="true" size={25} stroke-width={2.4} />
					</div>
					<p class="m-0 text-sm font-semibold text-primary-deep">
						{i18n.t("common.appName")}
					</p>
					<h1 class="mb-0 mt-5 text-2xl font-semibold tracking-[-0.02em] text-ink">
						{forced()
							? i18n.t("auth.changePassword.title")
							: i18n.t("auth.signIn.title")}
					</h1>
					<p class="mb-0 mt-2 text-sm leading-6 text-muted">
						{forced()
							? i18n.t("auth.changePassword.description")
							: i18n.t("auth.signIn.description")}
					</p>
				</div>
				<Show
					when={forced()}
					fallback={
						<>
							<Show when={passwordRotationCompleted()}>
								<output class="mb-4 block rounded-md border border-primary/20 bg-primary-soft px-3 py-2.5 text-sm text-primary-deep">
									{i18n.t("auth.passwordChangedSignInAgain")}
								</output>
							</Show>
							<LoginForm
								formatError={formatLoginError}
								initialEmail={
									passwordRotationCompleted()
										? context().session?.user.email
										: undefined
								}
								labels={loginLabels()}
								onSubmit={submitLogin}
							/>
						</>
					}
				>
					<ChangePasswordForm
						formatError={formatPasswordError}
						labels={changeLabels()}
						onSubmit={submitPasswordChange}
					/>
				</Show>
			</section>
		</main>
	);
}

export type LoginPageElement = JSX.Element;
