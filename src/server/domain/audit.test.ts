import { describe, expect, it, vi } from "vitest";

import type { AuditListSearch } from "../../shared/api/audit";
import type {
	AuditEventRecord,
	AuditQueryRepository,
} from "../db/repositories/audit.server";
import { REDACTION_MARKER } from "../security/redact";
import {
	AuditEventNotFoundError,
	AuditValidationError,
	createAuditService,
} from "./audit.server";

const EVENT_ID = "00000000-0000-4000-8000-000000000010";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";

const record: AuditEventRecord = {
	action: "program.updated",
	actorId: ACTOR_ID,
	after: { name: "Updated", securityToken: "must-not-leak" },
	before: { name: "Before" },
	createdAt: new Date("2026-07-14T12:00:00.000Z"),
	id: EVENT_ID,
	ip: "203.0.113.8",
	requestId: "req_audit",
	resourceId: "00000000-0000-4000-8000-000000000020",
	resourceType: "program",
	result: "success",
	userAgent: "test-agent",
};

function repository(
	overrides: Partial<AuditQueryRepository> = {},
): AuditQueryRepository {
	return {
		append: vi.fn(async () => ({ createdAt: record.createdAt, id: EVENT_ID })),
		findById: vi.fn(async () => record),
		list: vi.fn(async () => ({ items: [record], total: 1 })),
		...overrides,
	};
}

const search: AuditListSearch = {
	action: "program.updated",
	actorId: ACTOR_ID,
	from: "2026-07-01",
	page: 2,
	pageSize: 50,
	resourceType: "program",
	result: "success",
	sort: "createdAt:asc",
	to: "2026-07-14",
};

describe("audit service", () => {
	it("normalizes inclusive UTC date filters and maps a stable page", async () => {
		const list = vi.fn(async () => ({ items: [record], total: 51 }));
		const service = createAuditService({ repository: repository({ list }) });

		await expect(service.list(search)).resolves.toEqual({
			items: [
				{
					action: "program.updated",
					actorId: ACTOR_ID,
					createdAt: "2026-07-14T12:00:00.000Z",
					id: EVENT_ID,
					resourceId: "00000000-0000-4000-8000-000000000020",
					resourceType: "program",
					result: "success",
				},
			],
			page: 2,
			pageSize: 50,
			total: 51,
		});
		expect(list).toHaveBeenCalledWith({
			action: "program.updated",
			actorId: ACTOR_ID,
			createdAtFrom: new Date("2026-07-01T00:00:00.000Z"),
			createdAtToExclusive: new Date("2026-07-15T00:00:00.000Z"),
			page: 2,
			pageSize: 50,
			resourceType: "program",
			result: "success",
			sort: "createdAt:asc",
		});
	});

	it("rejects non-whitelisted filters and impossible UTC dates", async () => {
		const list = vi.fn();
		const service = createAuditService({ repository: repository({ list }) });
		const invalid = [
			{ ...search, action: "database.dump" },
			{ ...search, actorId: "not-a-uuid" },
			{ ...search, from: "2026-02-30" },
			{ ...search, from: "2026-07-15", to: "2026-07-14" },
			{ ...search, pageSize: 25 },
		] as unknown as AuditListSearch[];

		for (const input of invalid) {
			await expect(service.list(input)).rejects.toBeInstanceOf(
				AuditValidationError,
			);
		}
		expect(list).not.toHaveBeenCalled();
	});

	it("returns a defensively redacted detail and maps missing IDs", async () => {
		const findById = vi
			.fn<AuditQueryRepository["findById"]>()
			.mockResolvedValueOnce(record)
			.mockResolvedValueOnce(null);
		const service = createAuditService({
			repository: repository({ findById }),
		});

		const detail = await service.getById(EVENT_ID);
		expect(detail).toMatchObject({
			after: { name: "Updated", securityToken: REDACTION_MARKER },
			before: { name: "Before" },
			ip: "203.0.113.8",
			requestId: "req_audit",
			userAgent: "test-agent",
		});
		await expect(service.getById(EVENT_ID)).rejects.toBeInstanceOf(
			AuditEventNotFoundError,
		);
		await expect(service.getById("invalid")).rejects.toBeInstanceOf(
			AuditValidationError,
		);
	});
});
