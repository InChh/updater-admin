import process from "node:process";

import { config as loadEnvironment } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadEnvironment({ path: [".env.local", ".env"], quiet: true });

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
	dialect: "postgresql",
	out: "./drizzle",
	schema: "./src/server/db/schema/index.ts",
	strict: true,
	verbose: true,
	...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
});
