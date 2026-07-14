import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
import { authClient } from "../lib/auth-client";
import { sessionQueryKey, sessionQueryOptions } from "../lib/session-query";

export const Route = createFileRoute("/demo/better-auth")({
	component: BetterAuthDemo,
});

function BetterAuthDemo() {
	const session = createQuery(sessionQueryOptions);
	const queryClient = useQueryClient();
	const [email, setEmail] = createSignal("");
	const [password, setPassword] = createSignal("");
	const [error, setError] = createSignal("");
	const [loading, setLoading] = createSignal(false);

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		setError("");
		setLoading(true);

		try {
			const result = await authClient.signIn.email({
				email: email(),
				password: password(),
			});
			if (result.error) {
				setError(result.error.message || "Sign in failed");
			} else {
				await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
			}
		} catch (_err) {
			setError("An unexpected error occurred");
		} finally {
			setLoading(false);
		}
	};

	return (
		<Show
			when={!session.isPending}
			fallback={
				<main class="demo-page demo-center">
					<div class="h-5 w-5 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-900 dark:border-neutral-800 dark:border-t-neutral-100" />
				</main>
			}
		>
			<Show
				when={session.data?.user}
				fallback={
					<main class="demo-page demo-center">
						<section class="demo-panel w-full max-w-md">
							<p class="island-kicker mb-2">Better Auth</p>
							<h1 class="demo-title">Sign in</h1>
							<p class="demo-muted mt-2 mb-6 text-sm">
								Enter your administrator email and password
							</p>

							<form onSubmit={handleSubmit} class="grid gap-4">
								<div class="grid gap-2">
									<label for="email" class="text-sm font-medium leading-none">
										Email
									</label>
									<input
										id="email"
										type="email"
										value={email()}
										onInput={(e) => setEmail(e.currentTarget.value)}
										class="demo-input"
										required
									/>
								</div>

								<div class="grid gap-2">
									<label
										for="password"
										class="text-sm font-medium leading-none"
									>
										Password
									</label>
									<input
										id="password"
										type="password"
										value={password()}
										onInput={(e) => setPassword(e.currentTarget.value)}
										class="demo-input"
										required
										minLength={12}
									/>
								</div>

								<Show when={error()}>
									<div class="demo-alert demo-alert-danger">
										<p class="text-sm text-red-600">{error()}</p>
									</div>
								</Show>

								<button
									type="submit"
									disabled={loading()}
									class="demo-button w-full"
								>
									<Show
										when={!loading()}
										fallback={
											<span class="flex items-center justify-center gap-2">
												<span class="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-white dark:border-neutral-600 dark:border-t-neutral-900" />
												<span>Please wait</span>
											</span>
										}
									>
										Sign in
									</Show>
								</button>
							</form>

							<p class="demo-muted mt-6 text-center text-xs">
								Built with{" "}
								<a
									href="https://better-auth.com"
									target="_blank"
									rel="noopener noreferrer"
									class="font-medium"
								>
									BETTER-AUTH
								</a>
								.
							</p>
						</section>
					</main>
				}
			>
				{(user) => (
					<main class="demo-page demo-center">
						<section class="demo-panel w-full max-w-md space-y-6">
							<div class="space-y-1.5">
								<p class="island-kicker mb-2">Better Auth</p>
								<h1 class="demo-title">Welcome back</h1>
								<p class="demo-muted text-sm">
									You're signed in as {user().email}
								</p>
							</div>

							<div class="flex items-center gap-3">
								<Show
									when={user().image}
									fallback={
										<div class="h-10 w-10 bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center">
											<span class="text-sm font-medium text-neutral-600 dark:text-neutral-400">
												{user().name?.charAt(0).toUpperCase() || "U"}
											</span>
										</div>
									}
								>
									{(image) => <img src={image()} alt="" class="h-10 w-10" />}
								</Show>
								<div class="flex-1 min-w-0">
									<p class="text-sm font-medium truncate">{user().name}</p>
									<p class="text-xs text-neutral-500 dark:text-neutral-400 truncate">
										{user().email}
									</p>
								</div>
							</div>

							<button
								type="button"
								onClick={() => {
									void authClient.signOut().then(() =>
										queryClient.invalidateQueries({
											queryKey: sessionQueryKey,
										}),
									);
								}}
								class="demo-button demo-button-secondary w-full"
							>
								Sign out
							</button>

							<p class="demo-muted text-center text-xs">
								Built with{" "}
								<a
									href="https://better-auth.com"
									target="_blank"
									rel="noopener noreferrer"
									class="font-medium"
								>
									BETTER-AUTH
								</a>
								.
							</p>
						</section>
					</main>
				)}
			</Show>
		</Show>
	);
}
