import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

import { Pagination, paginationItems } from "./pagination";

describe("pagination", () => {
	it("builds compact numbered ranges around the active page", () => {
		expect(paginationItems(1, 3)).toEqual([1, 2, 3]);
		expect(paginationItems(6, 12)).toEqual([
			1,
			"ellipsis",
			5,
			6,
			7,
			"ellipsis",
			12,
		]);
		expect(paginationItems(12, 12)).toEqual([1, "ellipsis", 9, 10, 11, 12]);
	});

	it("announces the current page, summary, and page-size control", () => {
		const onPageChange = vi.fn();
		const onPageSizeChange = vi.fn();
		render(() => (
			<Pagination
				label="Pagination"
				nextLabel="Next"
				onPageChange={onPageChange}
				onPageSizeChange={onPageSizeChange}
				page={2}
				pageCount={4}
				pageLabel={(page) => `Page ${page}`}
				pageSize={20}
				pageSizeLabel="Rows per page"
				pageSizeOptions={[20, 50, 100]}
				previousLabel="Previous"
				summary="21–40 of 74"
			/>
		));

		expect(screen.getByText("21–40 of 74")).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "Page 2" })
				.getAttribute("aria-current"),
		).toBe("page");
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(onPageChange).toHaveBeenCalledWith(3);
		fireEvent.change(screen.getByRole("combobox"), {
			target: { value: "50" },
		});
		expect(onPageSizeChange).toHaveBeenCalledWith(50);
	});
});
