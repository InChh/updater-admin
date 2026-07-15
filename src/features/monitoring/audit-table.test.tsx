import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../lib/i18n/i18n";
import type { AuditEventListItemDto } from "../../shared/api/audit";
import { AuditTable } from "./audit-table";

const EVENT: AuditEventListItemDto = {
	action: "program.updated",
	actorId: "00000000-0000-4000-8000-000000000001",
	createdAt: "2026-07-15T00:00:00.000Z",
	id: "00000000-0000-4000-8000-000000000010",
	resourceId: "00000000-0000-4000-8000-000000000020",
	resourceType: "program",
	result: "success",
};

describe("AuditTable", () => {
	it("exposes URL-owned sort and a keyboard-accessible detail action", () => {
		const onSortChange = vi.fn();
		const onView = vi.fn();
		render(() => (
			<I18nProvider locale="en">
				<AuditTable
					items={[EVENT]}
					onSortChange={onSortChange}
					onView={onView}
					page={2}
					pageSize={20}
					sort="createdAt:desc"
					total={21}
				/>
			</I18nProvider>
		));

		expect(screen.getByRole("table", { name: "Audit events" })).toBeTruthy();
		expect(screen.getByRole("cell", { name: "21" })).toBeTruthy();
		expect(
			screen
				.getByRole("columnheader", { name: "Created" })
				.getAttribute("aria-sort"),
		).toBe("descending");
		fireEvent.click(
			screen.getByRole("button", { name: "Change creation time sort" }),
		);
		expect(onSortChange).toHaveBeenCalledWith("createdAt:asc");

		const view = screen.getByRole("button", {
			name: `View details for audit event ${EVENT.id}`,
		});
		fireEvent.click(view);
		expect(onView).toHaveBeenCalledWith(EVENT, view);
	});
});
