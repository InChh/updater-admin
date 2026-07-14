import { describe, expect, it, vi } from "vitest";

import { REDACTION_MARKER } from "../../security/redact";
import {
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
});
