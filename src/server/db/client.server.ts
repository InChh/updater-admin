import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import type { EnvironmentSource } from "../env.server";
import { readDatabaseEnvironment } from "../env.server";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

const POOL_MAX = 4;
const POOL_IDLE_TIMEOUT_MS = 30_000;
const POOL_CONNECTION_TIMEOUT_MS = 10_000;

type PoolOptions = ConstructorParameters<typeof Pool>[0];

export interface DatabaseClientDependencies {
	readonly databaseUrl?: string;
	readonly environment?: EnvironmentSource;
	readonly poolFactory?: (options: PoolOptions) => Pool;
}

function createDrizzleClient(pool: Pool) {
	return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createDrizzleClient>;

export interface ManagedDatabaseClient {
	readonly db: Database;
	readonly pool: Pool;
	close(): Promise<void>;
}

export function createDatabaseClient(
	dependencies: DatabaseClientDependencies = {},
): ManagedDatabaseClient {
	const environment = dependencies.databaseUrl
		? { DATABASE_URL: dependencies.databaseUrl }
		: dependencies.environment;
	const databaseUrl = environment
		? readDatabaseEnvironment(environment).databaseUrl
		: readDatabaseEnvironment().databaseUrl;
	const poolFactory =
		dependencies.poolFactory ?? ((options) => new Pool(options));
	const pool = poolFactory({
		connectionString: databaseUrl,
		connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
		idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
		max: POOL_MAX,
	});
	const db = createDrizzleClient(pool);
	let closed = false;

	return {
		db,
		pool,
		async close() {
			if (closed) return;
			closed = true;
			await pool.end();
		},
	};
}

let singleton: ManagedDatabaseClient | undefined;

export function getDatabaseClient(
	dependencies: DatabaseClientDependencies = {},
): ManagedDatabaseClient {
	singleton ??= createDatabaseClient(dependencies);
	return singleton;
}

export function getDatabase(
	dependencies: DatabaseClientDependencies = {},
): Database {
	return getDatabaseClient(dependencies).db;
}

export async function closeDatabaseClient(): Promise<void> {
	const client = singleton;
	singleton = undefined;
	await client?.close();
}

export async function resetDatabaseClientForTests(
	dependencies?: DatabaseClientDependencies,
): Promise<ManagedDatabaseClient | undefined> {
	await closeDatabaseClient();
	if (!dependencies) return undefined;
	singleton = createDatabaseClient(dependencies);
	return singleton;
}
