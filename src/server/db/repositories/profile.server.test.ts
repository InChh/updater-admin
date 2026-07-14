import { describe, expect, it, vi } from "vitest";

import type { Database } from "../client.server";
import { createProfileRepository } from "./profile.server";

type ProfileDatabase = Pick<Database, "transaction" | "update">;

function createTransactionHarness(updatedRows: readonly { userId: string }[]) {
	let auditValues: Record<string, unknown> | undefined;
	const updateValues: Record<string, unknown>[] = [];
	const auditReturning = vi.fn(async () => [
		{
			createdAt: new Date("2026-07-14T01:00:00.000Z"),
			id: "00000000-0000-4000-8000-000000000010",
		},
	]);
	const insert = vi.fn(() => ({
		values: (values: Record<string, unknown>) => {
			auditValues = values;
			return { returning: auditReturning };
		},
	}));
	const updateReturning = vi.fn(async () => updatedRows);
	const update = vi.fn(() => ({
		set: (values: Record<string, unknown>) => {
			updateValues.push(values);
			return {
				where: () => ({ returning: updateReturning }),
			};
		},
	}));
	const transaction = vi.fn(async (operation: (value: unknown) => unknown) =>
		operation({ insert, update }),
	);
	return {
		auditValues: () => auditValues,
		database: { transaction, update } as unknown as ProfileDatabase,
		insert,
		transaction,
		updateValues: () => updateValues,
	};
}

describe("profile repository", () => {
	it("marks the account forced before session revocation", async () => {
		const harness = createTransactionHarness([{ userId: "user-id" }]);
		const repository = createProfileRepository(harness.database);

		await repository.beginPasswordChange({ actorId: "user-id" });

		expect(harness.updateValues()).toEqual([{ mustChangePassword: true }]);
		expect(harness.transaction).not.toHaveBeenCalled();
		expect(harness.insert).not.toHaveBeenCalled();
	});

	it("atomically clears the forced-password gate and appends an audit event", async () => {
		const harness = createTransactionHarness([{ userId: "user-id" }]);
		const repository = createProfileRepository(harness.database);

		await repository.completePasswordChange({
			actorId: "user-id",
			ip: "203.0.113.8",
			previousMustChangePassword: true,
			requestId: "req_test",
			userAgent: "test",
		});

		expect(harness.transaction).toHaveBeenCalledOnce();
		expect(harness.updateValues()).toEqual([{ mustChangePassword: false }]);
		expect(harness.insert).toHaveBeenCalledOnce();
		expect(harness.auditValues()).toMatchObject({
			action: "profile.password.changed",
			afterJson: { mustChangePassword: false },
			beforeJson: { mustChangePassword: true },
			requestId: "req_test",
			result: "success",
		});
	});

	it("fails closed when administrator metadata is missing", async () => {
		const harness = createTransactionHarness([]);
		const repository = createProfileRepository(harness.database);

		await expect(
			repository.completePasswordChange({
				actorId: "missing-user",
				ip: null,
				previousMustChangePassword: true,
				requestId: "req_test",
				userAgent: null,
			}),
		).rejects.toThrow("Administrator metadata was not updated.");
		expect(harness.insert).not.toHaveBeenCalled();
	});

	it("rejects a missing metadata row while beginning password change", async () => {
		const harness = createTransactionHarness([]);
		const repository = createProfileRepository(harness.database);

		await expect(
			repository.beginPasswordChange({ actorId: "missing-user" }),
		).rejects.toThrow("Administrator metadata was not updated.");
		expect(harness.transaction).not.toHaveBeenCalled();
		expect(harness.insert).not.toHaveBeenCalled();
	});
});
