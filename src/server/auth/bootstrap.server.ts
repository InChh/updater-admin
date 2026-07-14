import { eq, sql } from "drizzle-orm";

import { type Database, getDatabase } from "../db/client.server";
import { adminMetadata, user } from "../db/schema";
import type { EnvironmentSource } from "../env.server";
import {
	EnvironmentValidationError,
	readAuthEnvironment,
	readBootstrapAdminEnvironment,
} from "../env.server";
import { type AuthDatabase, createAuth } from "./auth.server";

const BOOTSTRAP_ADVISORY_LOCK = 752_943_112;

export interface BootstrapAdminInput {
	readonly email: string;
	readonly name: string;
	readonly password: string;
}

export interface CreateBootstrapAdminInput extends BootstrapAdminInput {
	readonly role: "admin";
}

export interface BootstrapAdminState {
	readonly banned: boolean | null;
	readonly email: string;
	readonly id: string;
	readonly mustChangePassword: boolean | null;
	readonly role: string | null;
}

export interface BootstrapRepository {
	createAdmin(input: CreateBootstrapAdminInput): Promise<{ id: string }>;
	createMetadata(values: AdministratorMetadataValues): Promise<void>;
	listAdminState(): Promise<readonly BootstrapAdminState[]>;
}

export interface BootstrapDependencies {
	runExclusive<T>(
		operation: (repository: BootstrapRepository) => Promise<T>,
	): Promise<T>;
}

export interface AdministratorMetadataValues {
	readonly locale: "zh-CN";
	readonly mustChangePassword: boolean;
	readonly userId: string;
}

export interface BootstrapResult {
	readonly status: "already-exists" | "created";
	readonly userId: string;
}

export class BootstrapStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BootstrapStateError";
	}
}

export function createAdministratorMetadataValues(
	userId: string,
	temporaryPassword: boolean,
): AdministratorMetadataValues {
	return {
		locale: "zh-CN",
		mustChangePassword: temporaryPassword,
		userId,
	};
}

function validateBootstrapInput(
	input: BootstrapAdminInput,
): BootstrapAdminInput {
	const validated = readBootstrapAdminEnvironment({
		BOOTSTRAP_ADMIN_EMAIL: input.email,
		BOOTSTRAP_ADMIN_NAME: input.name,
		BOOTSTRAP_ADMIN_PASSWORD: input.password,
	});

	return {
		email: validated.email.trim().toLowerCase(),
		name: validated.name.trim(),
		password: validated.password,
	};
}

export async function bootstrapAdministrator(
	input: BootstrapAdminInput,
	dependencies: BootstrapDependencies,
): Promise<BootstrapResult> {
	const validated = validateBootstrapInput(input);

	return dependencies.runExclusive(async (repository) => {
		const existing = await repository.listAdminState();
		if (existing.length > 1) {
			throw new BootstrapStateError(
				"Initial administrator bootstrap requires an empty account store.",
			);
		}

		const current = existing[0];
		if (current) {
			const isMatchingBootstrapAdmin =
				current.email.toLowerCase() === validated.email &&
				current.role === "admin" &&
				current.banned !== true &&
				current.mustChangePassword === false;
			if (!isMatchingBootstrapAdmin) {
				throw new BootstrapStateError(
					"Initial administrator bootstrap found incompatible account state.",
				);
			}

			return { status: "already-exists", userId: current.id };
		}

		const created = await repository.createAdmin({
			...validated,
			role: "admin",
		});
		await repository.createMetadata(
			createAdministratorMetadataValues(created.id, false),
		);
		return { status: "created", userId: created.id };
	});
}

type DatabaseTransaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];

function createBootstrapRepository(
	transaction: DatabaseTransaction,
	environment?: EnvironmentSource,
): BootstrapRepository {
	const auth = createAuth({
		database: transaction as AuthDatabase,
		databaseTransaction: false,
		environment,
		updateLastLogin: async () => {},
	});

	return {
		async createAdmin(input) {
			const result = await auth.api.createUser({
				body: {
					email: input.email,
					name: input.name,
					password: input.password,
					role: input.role,
				},
			});
			return { id: result.user.id };
		},
		async createMetadata(values) {
			await transaction.insert(adminMetadata).values(values);
		},
		async listAdminState() {
			return transaction
				.select({
					banned: user.banned,
					email: user.email,
					id: user.id,
					mustChangePassword: adminMetadata.mustChangePassword,
					role: user.role,
				})
				.from(user)
				.leftJoin(adminMetadata, eq(adminMetadata.userId, user.id))
				.limit(2);
		},
	};
}

export interface BootstrapFromEnvironmentDependencies {
	readonly database?: Database;
	readonly environment?: EnvironmentSource;
}

export async function bootstrapAdministratorFromEnvironment(
	dependencies: BootstrapFromEnvironmentDependencies = {},
): Promise<BootstrapResult> {
	const input = readBootstrapAdminEnvironment(dependencies.environment);
	// Validate all authentication secrets before opening a database transaction.
	readAuthEnvironment(dependencies.environment);
	const database = dependencies.database ?? getDatabase();

	return bootstrapAdministrator(input, {
		runExclusive: (operation) =>
			database.transaction(async (transaction) => {
				await transaction.execute(
					sql`select pg_advisory_xact_lock(${BOOTSTRAP_ADVISORY_LOCK})`,
				);
				return operation(
					createBootstrapRepository(transaction, dependencies.environment),
				);
			}),
	});
}

export function formatBootstrapFailure(error: unknown): string {
	if (
		error instanceof EnvironmentValidationError ||
		error instanceof BootstrapStateError
	) {
		return error.message;
	}
	return "Administrator bootstrap failed due to an unexpected server error.";
}
