import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

describe("test configuration", () => {
	it("renders Solid components in the browser-like test environment", () => {
		render(() => <main>Updater Admin smoke marker</main>);

		expect(screen.getByText("Updater Admin smoke marker").tagName).toBe("MAIN");
	});

	it("loads the shared setup and cleans rendered DOM between tests", () => {
		expect(screen.queryByText("Updater Admin smoke marker")).toBeNull();
	});
});
