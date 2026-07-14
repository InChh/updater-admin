import { eq } from "drizzle-orm";

import { type Database, getDatabase } from "../db/client.server";
import { adminMetadata } from "../db/schema";
import type { EnvironmentSource } from "../env.server";
import {
	isStrongAdministratorPassword,
	readAuthEnvironment,
} from "../env.server";
import { type AppAuth, type AuthDatabase, createAuth } from "./auth.server";
import { createAdministratorMetadataValues } from "./bootstrap.server";

type DatabaseTransaction = Parameters<
	Parameters<Database["transaction"]>[0]
>[0];

export type AdministratorCredentialErrorCode =
	| "ADMINISTRATOR_CREATE_FAILED"
	| "ADMINISTRATOR_RESET_FAILED"
	| "INVALID_TEMPORARY_PASSWORD";

export class AdministratorCredentialError extends Error {
	readonly code: AdministratorCredentialErrorCode;

	constructor(code: AdministratorCredentialErrorCode, message: string) {
		super(message);
		this.name = "AdministratorCredentialError";
		this.code = code;
	}
}

export interface CreateTemporaryPasswordAdministratorInput {
	readonly email: string;
	readonly headers: Headers;
	readonly name: string;
	readonly temporaryPassword: string;
}

export interface ResetAdministratorPasswordInput {
	readonly headers: Headers;
	readonly temporaryPassword: string;
	readonly userId: string;
}

export interface TemporaryPasswordMetadataUpdate {
	readonly mustChangePassword: true;
	readonly userId: string;
}

export interface AdministratorCredentialUnitOfWork {
	readonly auth: Pick<
		AppAuth["api"],
		"createUser" | "revokeUserSessions" | "setUserPassword"
	>;
	createMetadata(
		values: ReturnType<typeof createAdministratorMetadataValues>,
	): Promise<void>;
	markTemporaryPassword(values: TemporaryPasswordMetadataUpdate): Promise<void>;
}

export interface AdministratorCredentialDependencies {
	runAtomic<T>(
		operation: (unitOfWork: AdministratorCredentialUnitOfWork) => Promise<T>,
	): Promise<T>;
}

export interface AdministratorCredentialRuntimeDependencies {
	readonly database?: Database;
	readonly environment?: EnvironmentSource;
}

function validateTemporaryPassword(password: string): void {
	if (isStrongAdministratorPassword(password)) return;
	throw new AdministratorCredentialError(
		"INVALID_TEMPORARY_PASSWORD",
		"Temporary administrator password does not meet the security policy.",
	);
}

function createUnitOfWork(
	transaction: DatabaseTransaction,
	environment?: EnvironmentSource,
): AdministratorCredentialUnitOfWork {
	const auth = createAuth({
		database: transaction as AuthDatabase,
		databaseTransaction: false,
		environment,
		updateLastLogin: async () => {},
	});

	return {
		auth: auth.api,
		async createMetadata(values) {
			await transaction.insert(adminMetadata).values(values);
		},
		async markTemporaryPassword(values) {
			const updated = await transaction
				.update(adminMetadata)
				.set({ mustChangePassword: values.mustChangePassword })
				.where(eq(adminMetadata.userId, values.userId))
				.returning({ userId: adminMetadata.userId });
			if (updated.length !== 1) {
				throw new Error("Administrator metadata was not updated.");
			}
		},
	};
}

export function createAdministratorCredentialDependencies(
	dependencies: AdministratorCredentialRuntimeDependencies = {},
): AdministratorCredentialDependencies {
	// Fail before acquiring a database connection when auth configuration is bad.
	readAuthEnvironment(dependencies.environment);
	const database = dependencies.database ?? getDatabase();

	return {
		runAtomic: (operation) =>
			database.transaction((transaction) =>
				operation(createUnitOfWork(transaction, dependencies.environment)),
			),
	};
}

export async function createTemporaryPasswordAdministrator(
	input: CreateTemporaryPasswordAdministratorInput,
	dependencies?: AdministratorCredentialDependencies,
): Promise<{ userId: string }> {
	validateTemporaryPassword(input.temporaryPassword);
	const resolvedDependencies =
		dependencies ?? createAdministratorCredentialDependencies();

	try {
		return await resolvedDependencies.runAtomic(async (unitOfWork) => {
			const created = await unitOfWork.auth.createUser({
				body: {
					email: input.email,
					name: input.name,
					password: input.temporaryPassword,
					role: "admin",
				},
				headers: input.headers,
			});
			await unitOfWork.createMetadata(
				createAdministratorMetadataValues(created.user.id, true),
			);
			return { userId: created.user.id };
		});
	} catch (error) {
		if (error instanceof AdministratorCredentialError) throw error;
		throw new AdministratorCredentialError(
			"ADMINISTRATOR_CREATE_FAILED",
			"Administrator creation failed.",
		);
	}
}

export async function resetAdministratorTemporaryPassword(
	input: ResetAdministratorPasswordInput,
	dependencies?: AdministratorCredentialDependencies,
): Promise<{ userId: string }> {
	validateTemporaryPassword(input.temporaryPassword);
	const resolvedDependencies =
		dependencies ?? createAdministratorCredentialDependencies();

	try {
		return await resolvedDependencies.runAtomic(async (unitOfWork) => {
			await unitOfWork.auth.setUserPassword({
				body: {
					newPassword: input.temporaryPassword,
					userId: input.userId,
				},
				headers: input.headers,
			});
			await unitOfWork.markTemporaryPassword({
				mustChangePassword: true,
				userId: input.userId,
			});
			await unitOfWork.auth.revokeUserSessions({
				body: { userId: input.userId },
				headers: input.headers,
			});
			return { userId: input.userId };
		});
	} catch (error) {
		if (error instanceof AdministratorCredentialError) throw error;
		throw new AdministratorCredentialError(
			"ADMINISTRATOR_RESET_FAILED",
			"Administrator password reset failed.",
		);
	}
}
