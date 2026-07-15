import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

import {
	AdministratorForm,
	type AdministratorFormLabels,
	TemporaryPasswordForm,
} from "./administrator-form";

const labels: AdministratorFormLabels = {
	cancel: "Cancel",
	email: "Email",
	emailInvalid: "Invalid email",
	name: "Name",
	nameRequired: "Name required",
	nameTooLong: "Name too long",
	password: "Temporary password",
	passwordPolicy: "Password policy",
	pending: "Creating",
	role: "Administrator access",
	roleDescription: "Full access",
	submit: "Create",
};

function passwordInput(id: string): HTMLInputElement {
	const input = document.getElementById(id);
	if (!(input instanceof HTMLInputElement)) {
		throw new Error(`Password input ${id} was not rendered.`);
	}
	return input;
}

describe("AdministratorForm", () => {
	it("validates email and the temporary-password policy before submit", async () => {
		const onSubmit = vi.fn(async () => {});
		render(() => (
			<AdministratorForm
				labels={labels}
				onCancel={() => {}}
				onSubmit={onSubmit}
			/>
		));

		fireEvent.input(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Release Admin" },
		});
		fireEvent.input(screen.getByRole("textbox", { name: "Email" }), {
			target: { value: "not-an-email" },
		});
		fireEvent.input(passwordInput("administrator-temporary-password"), {
			target: { value: "aaaaaaaaaaaa" },
		});
		const form = screen.getByRole("button", { name: "Create" }).closest("form");
		if (!form) throw new Error("Administrator form not found.");
		fireEvent.submit(form);

		await waitFor(() => {
			expect(screen.getByText("Invalid email")).toBeTruthy();
			expect(screen.getByText("Password policy")).toBeTruthy();
		});
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("submits normalized identity fields without exposing a role selector", async () => {
		const onSubmit = vi.fn(async () => {});
		render(() => (
			<AdministratorForm
				labels={labels}
				onCancel={() => {}}
				onSubmit={onSubmit}
			/>
		));

		fireEvent.input(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "  Release Admin  " },
		});
		fireEvent.input(screen.getByRole("textbox", { name: "Email" }), {
			target: { value: "  ADMIN@example.com  " },
		});
		fireEvent.input(passwordInput("administrator-temporary-password"), {
			target: { value: "T3mp-Release!2026" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Create" }));

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith({
				email: "admin@example.com",
				name: "Release Admin",
				temporaryPassword: "T3mp-Release!2026",
			}),
		);
		expect(screen.queryByRole("combobox", { name: /role/i })).toBeNull();
		expect(screen.getByText("admin")).toBeTruthy();
	});
});

describe("TemporaryPasswordForm", () => {
	it("requires the same strong password policy for resets", async () => {
		const onSubmit = vi.fn(async () => {});
		render(() => (
			<TemporaryPasswordForm
				cancelLabel="Cancel"
				onCancel={() => {}}
				onSubmit={onSubmit}
				passwordLabel="Temporary password"
				passwordPolicy="Password policy"
				pendingLabel="Resetting"
				submitLabel="Reset password"
			/>
		));

		fireEvent.input(passwordInput("administrator-reset-temporary-password"), {
			target: { value: "too-short" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
		await waitFor(() =>
			expect(screen.getByText("Password policy")).toBeTruthy(),
		);
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
