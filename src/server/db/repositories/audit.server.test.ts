import { describe, expect, it, vi } from "vitest";

import { REDACTION_MARKER } from "../../security/redact";
import {
	type AuditDatabase,
	type AuditInsertDatabase,
	createAuditRepository,
} from "./audit.server";

describe("audit repository", () => {
	it("offers append-only persistence and redacts before and after JSON", async () => {
		const createdAt = new Date("2026-07-14T01:00:00.000Z");
		let inserted: Record<string, unknown> | undefined;
		const returning = vi.fn(async () => [
			{ createdAt, id: "00000000-0000-4000-8000-000000000010" },
		]);
		const values = vi.fn((value: Record<string, unknown>) => {
			inserted = value;
			return { returning };
		});
		const insert = vi.fn(() => ({ values }));
		const repository = createAuditRepository({
			insert,
		} as unknown as AuditInsertDatabase);

		const result = await repository.append({
			action: "profile.password.changed",
			actorId: "00000000-0000-4000-8000-000000000001",
			after: {
				credentials: { securityToken: "temporary-token" },
				uploadUrl:
					"https://bucket.example/object?OSSAccessKeyId=key&Signature=signed",
			},
			before: { nested: [{ currentPassword: "private" }] },
			ip: "203.0.113.8",
			requestId: "req_test",
			resourceId: "00000000-0000-4000-8000-000000000001",
			resourceType: "administrator",
			result: "success",
			userAgent: "test",
		});

		expect(result).toEqual({
			createdAt,
			id: "00000000-0000-4000-8000-000000000010",
		});
		expect(inserted?.beforeJson).toEqual({
			nested: [{ currentPassword: REDACTION_MARKER }],
		});
		expect(inserted?.afterJson).toEqual({
			credentials: REDACTION_MARKER,
			uploadUrl: REDACTION_MARKER,
		});
		expect("update" in repository).toBe(false);
		expect("delete" in repository).toBe(false);
	});

	it("paginates stable audit rows and redacts legacy JSON again on read", async () => {
		const offset = vi.fn(async () => [
			{
				action: "program.updated",
				actorId: "00000000-0000-4000-8000-000000000001",
				afterJson: { password: "legacy-secret", value: "safe" },
				beforeJson: null,
				createdAt: new Date("2026-07-14T01:00:00.000Z"),
				id: "00000000-0000-4000-8000-000000000010",
				ip: null,
				requestId: "req_test",
				resourceId: "00000000-0000-4000-8000-000000000020",
				resourceType: "program",
				result: "success",
				userAgent: null,
			},
		]);
		const rowsWhere = vi.fn(() => ({
			orderBy: vi.fn(() => ({
				limit: vi.fn(() => ({ offset })),
			})),
		}));
		const totalWhere = vi.fn(async () => [{ value: 21 }]);
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: vi.fn(() => ({ where: rowsWhere })),
			})
			.mockReturnValueOnce({
				from: vi.fn(() => ({ where: totalWhere })),
			});
		const repository = createAuditRepository({
			insert: vi.fn(),
			select,
		} as unknown as AuditDatabase);

		await expect(
			repository.list({
				action: "program.updated",
				actorId: "00000000-0000-4000-8000-000000000001",
				createdAtFrom: new Date("2026-07-01T00:00:00.000Z"),
				createdAtToExclusive: new Date("2026-07-15T00:00:00.000Z"),
				page: 2,
				pageSize: 20,
				resourceType: "program",
				result: "success",
				sort: "createdAt:desc",
			}),
		).resolves.toMatchObject({
			items: [
				{
					after: { password: REDACTION_MARKER, value: "safe" },
					before: null,
					result: "success",
				},
			],
			total: 21,
		});
		expect(offset).toHaveBeenCalledWith(20);
		expect(rowsWhere).toHaveBeenCalledOnce();
		expect(totalWhere).toHaveBeenCalledOnce();
	});

	it("reads one append-only detail by ID", async () => {
		const limit = vi.fn(async () => []);
		const select = vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({ limit })),
			})),
		}));
		const repository = createAuditRepository({
			insert: vi.fn(),
			select,
		} as unknown as AuditDatabase);

		await expect(
			repository.findById("00000000-0000-4000-8000-000000000010"),
		).resolves.toBeNull();
		expect(limit).toHaveBeenCalledWith(1);
	});
});
