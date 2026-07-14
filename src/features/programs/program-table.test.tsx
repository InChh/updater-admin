import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../lib/i18n/i18n";
import type { ProgramListItemDto } from "../../shared/api/programs";
import { ProgramTable } from "./program-table";

interface LinkStubProps {
	readonly "aria-label"?: string;
	readonly children?: JSX.Element;
	readonly params: Readonly<{ programId: string }>;
}

vi.mock("@tanstack/solid-router", () => ({
	Link: (props: LinkStubProps) => (
		<a
			aria-label={props["aria-label"]}
			href={`/programs/${props.params.programId}/versions`}
		>
			{props.children}
		</a>
	),
}));
vi.mock("../../components/ui/toast", () => ({ notify: vi.fn() }));

const PROGRAM_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const PROGRAM: ProgramListItemDto = {
	createdAt: "2026-07-15T00:00:00.000Z",
	description: null,
	etag: 'W/"1"',
	id: PROGRAM_ID,
	name: "Release service",
	updatedAt: "2026-07-15T00:00:00.000Z",
};

const originalClipboard = navigator.clipboard;

afterEach(() => {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: originalClipboard,
	});
});

describe("ProgramTable", () => {
	it("exposes server sort state, row numbering, navigation, and copy feedback", async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		const onDelete = vi.fn();
		const onEdit = vi.fn();
		const onSortChange = vi.fn();
		render(() => (
			<I18nProvider locale="en">
				<ProgramTable
					items={[PROGRAM]}
					onDelete={onDelete}
					onEdit={onEdit}
					onSortChange={onSortChange}
					page={2}
					pageSize={20}
					sort="createdAt:desc"
					total={21}
				/>
			</I18nProvider>
		));

		expect(screen.getByRole("table", { name: "Programs" })).toBeTruthy();
		expect(screen.getByRole("cell", { name: "21" })).toBeTruthy();
		const createdHeader = screen.getByRole("columnheader", {
			name: "Created",
		});
		expect(createdHeader.getAttribute("aria-sort")).toBe("descending");

		fireEvent.click(
			screen.getByRole("button", {
				name: "Created time, switch to ascending",
			}),
		);
		expect(onSortChange).toHaveBeenCalledWith("createdAt:asc");

		const versionLink = screen.getByRole("link", {
			name: "View versions for Release service",
		});
		expect(versionLink.getAttribute("href")).toBe(
			`/programs/${PROGRAM_ID}/versions`,
		);

		fireEvent.click(
			screen.getByRole("button", { name: `Copy program ID ${PROGRAM_ID}` }),
		);
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledWith(PROGRAM_ID);
			expect(
				screen.getByRole("button", {
					name: `Copied program ID ${PROGRAM_ID}`,
				}),
			).toBeTruthy();
		});

		const editButton = screen.getByRole("button", {
			name: "Edit program Release service",
		});
		const deleteButton = screen.getByRole("button", {
			name: "Delete program Release service",
		});
		fireEvent.click(editButton);
		fireEvent.click(deleteButton);
		expect(onEdit).toHaveBeenCalledWith(PROGRAM, editButton);
		expect(onDelete).toHaveBeenCalledWith(PROGRAM, deleteButton);
	});
});
