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
	});
});
