import { describe, expect, it, vi } from "vitest";

import {
	calculateFixedWindow,
	createRateLimitRepository,
} from "./rate-limit.server";

describe("rate-limit repository", () => {
	it("calculates stable UTC epoch-aligned fixed windows", () => {
		expect(
			calculateFixedWindow(new Date("2026-07-14T01:07:13.999Z"), 15 * 60),
		).toEqual({
			expiresAt: new Date("2026-07-14T01:15:00.000Z"),
			windowStartedAt: new Date("2026-07-14T01:00:00.000Z"),
		});
	});

	it("returns a bounded denial from the atomic upsert result", async () => {
		const returning = vi.fn(async () => [{ count: 6 }]);
		const onConflictDoUpdate = vi.fn(() => ({ returning }));
		const values = vi.fn(() => ({ onConflictDoUpdate }));
		const insert = vi.fn(() => ({ values }));
		const where = vi.fn(async () => {});
		const deleteRow = vi.fn(() => ({ where }));
		const repository = createRateLimitRepository({
			delete: deleteRow,
			insert,
		} as never);

		const decision = await repository.consume({
			endpoint: "profile.change-password",
			limit: 5,
			now: new Date("2026-07-14T01:07:13.999Z"),
			subjectKey: "user-id",
			windowSeconds: 15 * 60,
		});

		expect(decision).toEqual({
			allowed: false,
			count: 6,
			limit: 5,
			remaining: 0,
			resetAt: new Date("2026-07-14T01:15:00.000Z"),
			retryAfterSeconds: 467,
		});
		expect(onConflictDoUpdate).toHaveBeenCalledOnce();
	});

	it("atomically consumes a weighted token cost", async () => {
		const returning = vi.fn(async () => [{ count: 7 }]);
		const onConflictDoUpdate = vi.fn(() => ({ returning }));
		const values = vi.fn(() => ({ onConflictDoUpdate }));
		const insert = vi.fn(() => ({ values }));
		const where = vi.fn(async () => {});
		const deleteRow = vi.fn(() => ({ where }));
		const repository = createRateLimitRepository({
			delete: deleteRow,
			insert,
		} as never);

		const decision = await repository.consume({
			cost: 3,
			endpoint: "uploads.complete.files",
			limit: 10,
			now: new Date("2026-07-14T01:07:13.999Z"),
			subjectKey: "user-id",
			windowSeconds: 15 * 60,
		});

		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({
				count: 3,
				endpoint: "uploads.complete.files",
				subjectKey: "user-id",
			}),
		);
		expect(decision).toEqual({
			allowed: true,
			count: 7,
			limit: 10,
			remaining: 3,
			resetAt: new Date("2026-07-14T01:15:00.000Z"),
			retryAfterSeconds: 467,
		});
	});

	it("rejects invalid policies before touching the database", async () => {
		const insert = vi.fn();
		const deleteRow = vi.fn();
		const repository = createRateLimitRepository({
			delete: deleteRow,
			insert,
		} as never);

		await expect(
			repository.consume({
				endpoint: "",
				limit: 0,
				now: new Date("invalid"),
				subjectKey: "",
				windowSeconds: 0,
			}),
		).rejects.toThrow(RangeError);
		expect(insert).not.toHaveBeenCalled();
		expect(deleteRow).not.toHaveBeenCalled();

		for (const cost of [0, 6]) {
			await expect(
				repository.consume({
					cost,
					endpoint: "uploads.complete.files",
					limit: 5,
					now: new Date("2026-07-14T01:00:00.000Z"),
					subjectKey: "user-id",
					windowSeconds: 60,
				}),
			).rejects.toThrow(RangeError);
		}
		expect(insert).not.toHaveBeenCalled();
		expect(deleteRow).not.toHaveBeenCalled();
	});
});
