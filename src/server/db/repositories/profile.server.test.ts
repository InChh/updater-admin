import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "../client.server";
import {
	createProfileRepository,
	ProfileStaleWriteRepositoryError,
} from "./profile.server";

type ProfileDatabase = Pick<Database, "transaction" | "update">;

interface TransactionHarnessOptions {
	readonly lockedRows?: readonly Record<string, unknown>[];
	readonly updatedRows: readonly Record<string, unknown>[];
}

function createTransactionHarness({
	lockedRows = [],
	updatedRows,
}: TransactionHarnessOptions) {
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
	const forUpdate = vi.fn(async () => lockedRows);
	const select = vi.fn(() => ({
		from: () => ({
			innerJoin: () => ({
				where: () => ({
					limit: () => ({ for: forUpdate }),
				}),
			}),
		}),
	}));
	const transaction = vi.fn(async (operation: (value: unknown) => unknown) =>
		operation({ insert, select, update }),
	);
	return {
		auditValues: () => auditValues,
		database: { transaction, update } as unknown as ProfileDatabase,
		forUpdate,
		insert,
		transaction,
		updateValues: () => updateValues,
	};
}

function expectRowVersionIncrement(value: unknown): void {
	const query = new PgDialect().sqlToQuery(
		value as Parameters<PgDialect["sqlToQuery"]>[0],
	);
	expect(query.sql).toContain('"row_version" + 1');
}

describe("profile repository", () => {
	it("marks the account forced and increments its concurrency token", async () => {
		const harness = createTransactionHarness({
			updatedRows: [{ userId: "user-id" }],
		});
		const repository = createProfileRepository(harness.database);

		await repository.beginPasswordChange({ actorId: "user-id" });

		expect(harness.updateValues()[0]).toMatchObject({
			mustChangePassword: true,
		});
		expectRowVersionIncrement(harness.updateValues()[0]?.rowVersion);
		expect(harness.transaction).not.toHaveBeenCalled();
		expect(harness.insert).not.toHaveBeenCalled();
	});

	it("atomically clears the forced-password gate, increments its token, and audits", async () => {
		const harness = createTransactionHarness({
			updatedRows: [{ userId: "user-id" }],
		});
		const repository = createProfileRepository(harness.database);

		await repository.completePasswordChange({
			actorId: "user-id",
			ip: "203.0.113.8",
			previousMustChangePassword: true,
			requestId: "req_test",
			userAgent: "test",
		});

		expect(harness.transaction).toHaveBeenCalledOnce();
		expect(harness.updateValues()[0]).toMatchObject({
			mustChangePassword: false,
		});
		expectRowVersionIncrement(harness.updateValues()[0]?.rowVersion);
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
		const harness = createTransactionHarness({ updatedRows: [] });
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
		const harness = createTransactionHarness({ updatedRows: [] });
		const repository = createProfileRepository(harness.database);

		await expect(
			repository.beginPasswordChange({ actorId: "missing-user" }),
		).rejects.toThrow("Administrator metadata was not updated.");
		expect(harness.transaction).not.toHaveBeenCalled();
		expect(harness.insert).not.toHaveBeenCalled();
	});

	it("locks the profile, applies the expected row version, and audits the locked before state", async () => {
		const harness = createTransactionHarness({
			lockedRows: [{ locale: "zh-CN", name: "Before", rowVersion: 3n }],
			updatedRows: [{ locale: "en", rowVersion: 4n }],
		});
		const updateUser = vi.fn(async () => ({ status: true }));
		const repository = createProfileRepository(harness.database, {
			createAuthApi: () => ({ updateUser }) as never,
		});
		const headers = new Headers({ cookie: "server-only" });

		const result = await repository.updateProfile({
			actorId: "user-id",
			expectedRowVersion: 3n,
			headers,
			ip: "203.0.113.8",
			locale: "en",
			name: "After",
			requestId: "req_test",
			userAgent: "test",
		});

		expect(result).toEqual({ locale: "en", name: "After", rowVersion: 4n });
		expect(harness.forUpdate).toHaveBeenCalledOnce();
		expect(updateUser).toHaveBeenCalledWith({
			body: { name: "After" },
			headers,
		});
		expect(harness.updateValues()[0]).toMatchObject({ locale: "en" });
		expectRowVersionIncrement(harness.updateValues()[0]?.rowVersion);
		expect(harness.auditValues()).toMatchObject({
			action: "profile.updated",
			afterJson: { locale: "en", name: "After", rowVersion: "4" },
			beforeJson: { locale: "zh-CN", name: "Before", rowVersion: "3" },
			resourceId: "user-id",
		});
	});

	it("rejects a stale profile before invoking Better Auth or writing audit", async () => {
		const harness = createTransactionHarness({
			lockedRows: [{ locale: "zh-CN", name: "Before", rowVersion: 4n }],
			updatedRows: [{ locale: "en", rowVersion: 5n }],
		});
		const updateUser = vi.fn(async () => ({ status: true }));
		const repository = createProfileRepository(harness.database, {
			createAuthApi: () => ({ updateUser }) as never,
		});

		await expect(
			repository.updateProfile({
				actorId: "user-id",
				expectedRowVersion: 3n,
				headers: new Headers(),
				ip: null,
				locale: "en",
				name: "After",
				requestId: "req_test",
				userAgent: null,
			}),
		).rejects.toBeInstanceOf(ProfileStaleWriteRepositoryError);
		expect(updateUser).not.toHaveBeenCalled();
		expect(harness.updateValues()).toHaveLength(0);
		expect(harness.insert).not.toHaveBeenCalled();
	});
});
