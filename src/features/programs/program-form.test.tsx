import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

import { ProgramForm, type ProgramFormLabels } from "./program-form";

const labels: ProgramFormLabels = {
	cancel: "Cancel",
	description: "Description",
	descriptionTooLong: "Description is too long",
	name: "Name",
	nameRequired: "Name is required",
	nameTooLong: "Name is too long",
	pending: "Saving",
	submit: "Save",
};

describe("ProgramForm", () => {
	it("validates the name on blur before submitting", async () => {
		render(() => (
			<ProgramForm labels={labels} onCancel={() => {}} onSubmit={vi.fn()} />
		));

		fireEvent.blur(screen.getByRole("textbox", { name: "Name" }));
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toBe("Name is required"),
		);
	});

	it("renders server field errors and submits normalized values", async () => {
		const onSubmit = vi.fn(async () => {});
		render(() => (
			<ProgramForm
				labels={labels}
				onCancel={() => {}}
				onSubmit={onSubmit}
				serverErrors={{ description: "Server rejected description" }}
			/>
		));

		fireEvent.input(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "  Release service  " },
		});
		fireEvent.input(screen.getByRole("textbox", { name: "Description" }), {
			target: { value: "  Stable channel  " },
		});
		expect(screen.getByText("Server rejected description")).toBeTruthy();
		const form = screen.getByRole("button", { name: "Save" }).closest("form");
		if (!form) throw new Error("Program form not found.");
		fireEvent.submit(form);

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith({
				description: "Stable channel",
				name: "Release service",
			}),
		);
	});

	it("counts Unicode code points for client length validation", async () => {
		const onSubmit = vi.fn(async () => {});
		const firstForm = render(() => (
			<ProgramForm labels={labels} onCancel={() => {}} onSubmit={onSubmit} />
		));
		fireEvent.input(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "🚀".repeat(128) },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
		firstForm.unmount();

		render(() => (
			<ProgramForm labels={labels} onCancel={() => {}} onSubmit={vi.fn()} />
		));
		const tooLongName = screen.getByRole("textbox", { name: "Name" });
		fireEvent.input(tooLongName, { target: { value: "🚀".repeat(129) } });
		fireEvent.blur(tooLongName);
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toBe("Name is too long"),
		);
	});
});
