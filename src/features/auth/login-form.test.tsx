import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

import { LoginForm, type LoginFormLabels } from "./login-form";

const labels: LoginFormLabels = {
	email: "Email",
	emailInvalid: "Email is invalid",
	emailRequired: "Email is required",
	genericError: "Sign-in failed",
	password: "Password",
	passwordRequired: "Password is required",
	pending: "Signing in",
	submit: "Sign in",
};

async function submitValidCredentials() {
	fireEvent.input(screen.getByLabelText(/Email/), {
		target: { value: "admin@example.com" },
	});
	fireEvent.input(screen.getByLabelText(/Password/), {
		target: { value: "incorrect-password" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginForm", () => {
	it("uses a POST fallback before client hydration", () => {
		render(() => (
			<LoginForm labels={labels} onSubmit={async () => undefined} />
		));

		expect(
			screen
				.getByRole("button", { name: "Sign in" })
				.closest("form")
				?.getAttribute("method"),
		).toBe("post");
	});

	it("keeps each input mounted and focused while its value changes", () => {
		render(() => (
			<LoginForm labels={labels} onSubmit={async () => undefined} />
		));

		const email = screen.getByLabelText(/Email/);
		email.focus();
		fireEvent.input(email, { target: { value: "a" } });
		expect(screen.getByLabelText(/Email/)).toBe(email);
		expect(document.activeElement).toBe(email);

		const password = screen.getByLabelText(/Password/);
		password.focus();
		fireEvent.input(password, { target: { value: "1" } });
		expect(screen.getByLabelText(/Password/)).toBe(password);
		expect(document.activeElement).toBe(password);
	});

	it("renders a caller-formatted authentication error", async () => {
		const failure = new Error("INVALID_CREDENTIALS");
		const formatError = vi.fn(() => "The email or password is incorrect.");
		render(() => (
			<LoginForm
				formatError={formatError}
				labels={labels}
				onSubmit={async () => {
					throw failure;
				}}
			/>
		));

		await submitValidCredentials();

		await waitFor(() => {
			expect(screen.getByRole("alert").textContent).toBe(
				"The email or password is incorrect.",
			);
		});
		expect(formatError).toHaveBeenCalledWith(failure);
	});

	it("falls back to the generic error when no formatter is provided", async () => {
		render(() => (
			<LoginForm
				labels={labels}
				onSubmit={async () => {
					throw new Error("request failed");
				}}
			/>
		));

		await submitValidCredentials();

		await waitFor(() => {
			expect(screen.getByRole("alert").textContent).toBe("Sign-in failed");
		});
	});
});
