import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import { Field } from "./field";
import { Input } from "./input";

describe("Field", () => {
	it("associates required and error semantics with its control", () => {
		render(() => (
			<Field error="Required" label="Name" name="name" required>
				{(controlProps) => <Input {...controlProps} />}
			</Field>
		));

		const input = screen.getByLabelText(/Name/);
		expect(input.getAttribute("aria-required")).toBe("true");
		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(input.getAttribute("aria-describedby")).toBe("name-error");
		expect(screen.getByRole("alert").id).toBe("name-error");
	});

	it("associates help text when the control has no error", () => {
		render(() => (
			<Field description="Public display name" label="Name" name="name">
				{(controlProps) => <Input {...controlProps} />}
			</Field>
		));

		expect(screen.getByLabelText("Name").getAttribute("aria-describedby")).toBe(
			"name-description",
		);
	});
});
