import process from "node:process";
import { config } from "dotenv";

import {
	bootstrapAdministratorFromEnvironment,
	formatBootstrapFailure,
} from "../src/server/auth/bootstrap.server";
import { closeDatabaseClient } from "../src/server/db/client.server";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

try {
	const result = await bootstrapAdministratorFromEnvironment();
	console.log(
		result.status === "created"
			? "Initial administrator created."
			: "Initial administrator already exists; no changes were made.",
	);
} catch (error) {
	console.error(formatBootstrapFailure(error));
	process.exitCode = 1;
}

try {
	await closeDatabaseClient();
} catch {
	console.error("Administrator bootstrap database cleanup failed.");
	process.exitCode = 1;
}
