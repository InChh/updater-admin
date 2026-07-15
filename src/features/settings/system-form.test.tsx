import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

import {
	SystemSettingsForm,
	type SystemSettingsFormLabels,
} from "./system-form";

const labels: SystemSettingsFormLabels = {
	defaultLocale: "Default language",
	defaultLocaleDescription: "Language description",
	defaultPageSize: "Default rows per page",
	defaultPageSizeDescription: "Page size description",
	localeEnglish: "English",
	localeSimplifiedChinese: "Simplified Chinese",
	repositoryUrl: "Source repository URL",
	repositoryUrlDescription: "HTTPS only",
	repositoryUrlInvalid: "Repository URL is invalid",
	repositoryUrlTooLong: "Repository URL is too long",
	saving: "Saving",
	submit: "Save",
	systemName: "System name",
	systemNameDescription: "Displayed in the shell",
	systemNameRequired: "System name is required",
	systemNameTooLong: "System name is too long",
};

const initialValue = {
	defaultLocale: "zh-CN" as const,
	defaultPageSize: 20 as const,
	repositoryUrl: null,
	systemName: "Version Management System",
};

describe("SystemSettingsForm", () => {
	it("rejects insecure and credential-bearing repository URLs", async () => {
		const onSubmit = vi.fn(async () => {});
		render(() => (
			<SystemSettingsForm
				initialValue={initialValue}
				labels={labels}
				onSubmit={onSubmit}
			/>
		));
		const repository = screen.getByRole("textbox", {
			name: "Source repository URL",
		});

		for (const invalid of [
			"http://example.com/repo",
			"https://user:secret@example.com/repo",
		]) {
			fireEvent.input(repository, { target: { value: invalid } });
			fireEvent.blur(repository);
			await waitFor(() =>
				expect(screen.getByRole("alert").textContent).toBe(
					"Repository URL is invalid",
				),
			);
		}
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("normalizes and submits all approved singleton fields", async () => {
		const onSubmit = vi.fn(async () => {});
		render(() => (
			<SystemSettingsForm
				initialValue={initialValue}
				labels={labels}
				onSubmit={onSubmit}
			/>
		));

		fireEvent.input(screen.getByRole("textbox", { name: "System name" }), {
			target: { value: "  Updater Admin  " },
		});
		fireEvent.change(
			screen.getByRole("combobox", { name: "Default language" }),
			{
				target: { value: "en" },
			},
		);
		fireEvent.change(
			screen.getByRole("combobox", { name: "Default rows per page" }),
			{ target: { value: "50" } },
		);
		fireEvent.input(
			screen.getByRole("textbox", { name: "Source repository URL" }),
			{ target: { value: "  https://github.com/example/updater  " } },
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith({
				defaultLocale: "en",
				defaultPageSize: 50,
				repositoryUrl: "https://github.com/example/updater",
				systemName: "Updater Admin",
			}),
		);
	});

	it("counts Unicode code points for the system-name limit", async () => {
		render(() => (
			<SystemSettingsForm
				initialValue={initialValue}
				labels={labels}
				onSubmit={vi.fn(async () => {})}
			/>
		));
		const name = screen.getByRole("textbox", { name: "System name" });
		fireEvent.input(name, { target: { value: "🚀".repeat(129) } });
		fireEvent.blur(name);
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toBe(
				"System name is too long",
			),
		);
	});
});
