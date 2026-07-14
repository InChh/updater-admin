import type { Pool } from "@neondatabase/serverless";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	closeDatabaseClient,
	createDatabaseClient,
	getDatabaseClient,
} from "./client.server";

const databaseUrl = "postgresql://test:test@localhost:5432/updater_admin_test";

function fakePool() {
	const end = vi.fn(async () => {});
	return {
		end,
		pool: { end } as unknown as Pool,
	};
}

afterEach(async () => {
	await closeDatabaseClient();
});

describe("database client lifecycle", () => {
	it("creates the bounded pool lazily and closes it only once", async () => {
		const fake = fakePool();
		const poolFactory = vi.fn(() => fake.pool);
		const client = createDatabaseClient({ databaseUrl, poolFactory });

		expect(poolFactory).toHaveBeenCalledOnce();
		expect(poolFactory).toHaveBeenCalledWith({
			connectionString: databaseUrl,
			connectionTimeoutMillis: 10_000,
			idleTimeoutMillis: 30_000,
			max: 4,
		});
		expect(client.pool).toBe(fake.pool);

		await client.close();
		await client.close();
		expect(fake.end).toHaveBeenCalledOnce();
	});

	it("reuses one singleton until it is explicitly closed", async () => {
		const first = fakePool();
		const second = fakePool();
		const firstFactory = vi.fn(() => first.pool);
		const secondFactory = vi.fn(() => second.pool);

		const firstClient = getDatabaseClient({
			databaseUrl,
			poolFactory: firstFactory,
		});
		expect(getDatabaseClient({ databaseUrl, poolFactory: secondFactory })).toBe(
			firstClient,
		);
		expect(firstFactory).toHaveBeenCalledOnce();
		expect(secondFactory).not.toHaveBeenCalled();

		await closeDatabaseClient();
		expect(first.end).toHaveBeenCalledOnce();

		const secondClient = getDatabaseClient({
			databaseUrl,
			poolFactory: secondFactory,
		});
		expect(secondClient).not.toBe(firstClient);
		expect(secondFactory).toHaveBeenCalledOnce();
	});
});
