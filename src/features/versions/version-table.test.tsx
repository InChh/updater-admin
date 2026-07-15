import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../lib/i18n/i18n";
import type { VersionListItemDto } from "../../shared/api/versions";
import { VersionTable } from "./version-table";

const FIRST_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const SECOND_ID = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df502";

function version(
	id: string,
	versionNumber: string,
	overrides: Partial<VersionListItemDto> = {},
): VersionListItemDto {
	return {
		createdAt: "2026-07-15T00:00:00.000Z",
		description: `${versionNumber} release`,
		etag: 'W/"1"',
		fileCount: 1,
		id,
		isActive: true,
		isLatest: false,
		programId: "ca6f79db-c7c4-4a34-9ab5-2a85ca9df500",
		updatedAt: "2026-07-15T00:00:00.000Z",
		versionNumber,
		...overrides,
	};
}

const VERSIONS = [
	version(FIRST_ID, "1.9.99"),
	version(SECOND_ID, "1.10.0", { isLatest: true }),
] as const;

const originalClipboard = navigator.clipboard;

afterEach(() => {
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: originalClipboard,
	});
});

function renderTable(
	overrides: Partial<Parameters<typeof VersionTable>[0]> = {},
) {
	const callbacks = {
		onActivation: vi.fn(),
		onDelete: vi.fn(),
		onEdit: vi.fn(),
		onSortChange: vi.fn(),
	};
	render(() => (
		<I18nProvider locale="zh-CN">
			<VersionTable
				items={VERSIONS}
				onActivation={callbacks.onActivation}
				onDelete={callbacks.onDelete}
				onEdit={callbacks.onEdit}
				onSortChange={callbacks.onSortChange}
				page={3}
				pageSize={20}
				sort="createdAt:desc"
				total={42}
				{...overrides}
			/>
		</I18nProvider>
	));
	return callbacks;
}

describe("VersionTable", () => {
	it("shows the server-selected numeric latest badge and page-relative sequence", () => {
		renderTable();

		expect(screen.getByRole("table", { name: "版本列表" })).toBeTruthy();
		expect(screen.getByRole("cell", { name: "41" })).toBeTruthy();
		expect(screen.getByRole("cell", { name: "42" })).toBeTruthy();
		const olderRow = screen.getByRole("row", { name: /1\.9\.99/ });
		const newestRow = screen.getByRole("row", { name: /1\.10\.0/ });
		expect(within(olderRow).queryByText("最新")).toBeNull();
		expect(within(newestRow).getByText("最新")).toBeTruthy();
	});

	it("isolates activation, edit, delete, and accessible sort callbacks by row", () => {
		const callbacks = renderTable({
			isActivationDisabled: (item) => item.id === FIRST_ID,
			isActivationPending: (item) => item.id === FIRST_ID,
		});

		const firstSwitch = screen.getByRole("switch", {
			name: "停用版本 1.9.99",
		});
		const secondSwitch = screen.getByRole("switch", {
			name: "停用版本 1.10.0",
		});
		expect((firstSwitch as HTMLInputElement).disabled).toBe(true);
		expect(firstSwitch.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(secondSwitch);
		expect(callbacks.onActivation).toHaveBeenCalledWith(VERSIONS[1], false);

		const editButton = screen.getByRole("button", { name: "编辑版本 1.10.0" });
		const deleteButton = screen.getByRole("button", {
			name: "删除版本 1.9.99",
		});
		fireEvent.click(editButton);
		fireEvent.click(deleteButton);
		expect(callbacks.onEdit).toHaveBeenCalledWith(VERSIONS[1], editButton);
		expect(callbacks.onDelete).toHaveBeenCalledWith(VERSIONS[0], deleteButton);

		const createdHeader = screen.getByRole("columnheader", {
			name: "创建时间",
		});
		expect(createdHeader.getAttribute("aria-sort")).toBe("descending");
		fireEvent.click(
			screen.getByRole("button", { name: "创建时间，切换为升序" }),
		);
		expect(callbacks.onSortChange).toHaveBeenCalledWith("createdAt:asc");
	});

	it("exposes the complete version ID to copy controls and confirms success", async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		renderTable();

		fireEvent.click(
			screen.getByRole("button", { name: `复制版本 ID ${SECOND_ID}` }),
		);
		await waitFor(() => {
			expect(writeText).toHaveBeenCalledWith(SECOND_ID);
			expect(
				screen.getByRole("button", { name: `已复制版本 ID ${SECOND_ID}` }),
			).toBeTruthy();
		});
	});
});
