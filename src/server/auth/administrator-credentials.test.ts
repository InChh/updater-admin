import { describe, expect, it, vi } from "vitest";

import {
	type AdministratorCredentialDependencies,
	AdministratorCredentialError,
	type AdministratorCredentialUnitOfWork,
	createTemporaryPasswordAdministrator,
	resetAdministratorTemporaryPassword,
} from "./administrator-credentials.server";

const ADMINISTRATOR_ID = "20000000-0000-4000-8000-000000000001";
const TEMPORARY_PASSWORD = "Temporary!Admin-2026#Safe";

interface UnitOfWorkSpies {
	readonly createMetadata: ReturnType<typeof vi.fn>;
	readonly createUser: ReturnType<typeof vi.fn>;
	readonly markTemporaryPassword: ReturnType<typeof vi.fn>;
	readonly revokeUserSessions: ReturnType<typeof vi.fn>;
	readonly setUserPassword: ReturnType<typeof vi.fn>;
}

function createTestUnitOfWork(): {
	readonly spies: UnitOfWorkSpies;
	readonly unitOfWork: AdministratorCredentialUnitOfWork;
} {
	const spies: UnitOfWorkSpies = {
		createMetadata: vi.fn(async () => {}),
		createUser: vi.fn(async () => ({ user: { id: ADMINISTRATOR_ID } })),
		markTemporaryPassword: vi.fn(async () => {}),
		revokeUserSessions: vi.fn(async () => {}),
		setUserPassword: vi.fn(async () => {}),
	};

	return {
		spies,
		unitOfWork: {
			auth: {
				createUser: spies.createUser,
				revokeUserSessions: spies.revokeUserSessions,
				setUserPassword: spies.setUserPassword,
			},
			createMetadata: spies.createMetadata,
			markTemporaryPassword: spies.markTemporaryPassword,
		} as unknown as AdministratorCredentialUnitOfWork,
	};
}

function createTestDependencies(
	unitOfWork: AdministratorCredentialUnitOfWork,
): {
	readonly dependencies: AdministratorCredentialDependencies;
	readonly transactionCount: () => number;
} {
	let transactions = 0;
	return {
		dependencies: {
			async runAtomic<T>(
				operation: (unit: AdministratorCredentialUnitOfWork) => Promise<T>,
			): Promise<T> {
				transactions += 1;
				return operation(unitOfWork);
			},
		},
		transactionCount: () => transactions,
	};
}

function createHeaders() {
	return new Headers({ cookie: "better-auth.session_token=server-only" });
}

describe("administrator temporary-password credentials", () => {
	it.each([
		{
			execute: (dependencies: AdministratorCredentialDependencies) =>
				createTemporaryPasswordAdministrator(
					{
						email: "new-admin@example.com",
						headers: createHeaders(),
						name: "New Administrator",
						temporaryPassword: "weak",
					},
					dependencies,
				),
			name: "creation",
		},
		{
			execute: (dependencies: AdministratorCredentialDependencies) =>
				resetAdministratorTemporaryPassword(
					{
						headers: createHeaders(),
						temporaryPassword: "weak",
						userId: ADMINISTRATOR_ID,
					},
					dependencies,
				),
			name: "reset",
		},
	])("rejects a weak password before opening the $name transaction", async ({
		execute,
	}) => {
		let transactionOpened = false;
		const dependencies: AdministratorCredentialDependencies = {
			async runAtomic<T>(): Promise<T> {
				transactionOpened = true;
				throw new Error("The transaction must not open.");
			},
		};

		const error = await execute(dependencies).catch((cause: unknown) => cause);

		expect(error).toBeInstanceOf(AdministratorCredentialError);
		expect(error).toMatchObject({
			code: "INVALID_TEMPORARY_PASSWORD",
			message:
				"Temporary administrator password does not meet the security policy.",
		});
		expect(String(error)).not.toContain("weak");
		expect(transactionOpened).toBe(false);
	});

	it("creates only an administrator with temporary-password metadata in one unit of work", async () => {
		const headers = createHeaders();
		const { spies, unitOfWork } = createTestUnitOfWork();
		const { dependencies, transactionCount } =
			createTestDependencies(unitOfWork);

		const result = await createTemporaryPasswordAdministrator(
			{
				email: "new-admin@example.com",
				headers,
				name: "New Administrator",
				temporaryPassword: TEMPORARY_PASSWORD,
			},
			dependencies,
		);

		expect(result).toEqual({ userId: ADMINISTRATOR_ID });
		expect(transactionCount()).toBe(1);
		expect(spies.createUser).toHaveBeenCalledWith({
			body: {
				email: "new-admin@example.com",
				name: "New Administrator",
				password: TEMPORARY_PASSWORD,
				role: "admin",
			},
			headers,
		});
		expect(spies.createMetadata).toHaveBeenCalledWith({
			locale: "zh-CN",
			mustChangePassword: true,
			userId: ADMINISTRATOR_ID,
		});
		expect(spies.createUser).toHaveBeenCalledBefore(spies.createMetadata);
	});

	it("rolls creation back when temporary-password metadata cannot be written", async () => {
		const committed = {
			metadataUserIds: [] as string[],
			userIds: [] as string[],
		};
		const dependencies: AdministratorCredentialDependencies = {
			async runAtomic<T>(
				operation: (unit: AdministratorCredentialUnitOfWork) => Promise<T>,
			): Promise<T> {
				const working = structuredClone(committed);
				const unit = {
					auth: {
						createUser: vi.fn(async () => {
							working.userIds.push(ADMINISTRATOR_ID);
							return { user: { id: ADMINISTRATOR_ID } };
						}),
						revokeUserSessions: vi.fn(async () => {}),
						setUserPassword: vi.fn(async () => {}),
					},
					createMetadata: vi.fn(async () => {
						throw new Error(`database rejected ${TEMPORARY_PASSWORD}`);
					}),
					markTemporaryPassword: vi.fn(async () => {}),
				} as unknown as AdministratorCredentialUnitOfWork;

				const result = await operation(unit);
				committed.metadataUserIds = working.metadataUserIds;
				committed.userIds = working.userIds;
				return result;
			},
		};

		const error = await createTemporaryPasswordAdministrator(
			{
				email: "new-admin@example.com",
				headers: createHeaders(),
				name: "New Administrator",
				temporaryPassword: TEMPORARY_PASSWORD,
			},
			dependencies,
		).catch((cause: unknown) => cause);

		expect(committed).toEqual({ metadataUserIds: [], userIds: [] });
		expect(error).toMatchObject({
			code: "ADMINISTRATOR_CREATE_FAILED",
			message: "Administrator creation failed.",
		});
		expect(String(error)).not.toContain(TEMPORARY_PASSWORD);
	});

	it("sets a temporary password, marks it for rotation, then revokes every session", async () => {
		const headers = createHeaders();
		const { spies, unitOfWork } = createTestUnitOfWork();
		const { dependencies, transactionCount } =
			createTestDependencies(unitOfWork);

		const result = await resetAdministratorTemporaryPassword(
			{
				headers,
				temporaryPassword: TEMPORARY_PASSWORD,
				userId: ADMINISTRATOR_ID,
			},
			dependencies,
		);

		expect(result).toEqual({ userId: ADMINISTRATOR_ID });
		expect(transactionCount()).toBe(1);
		expect(spies.setUserPassword).toHaveBeenCalledWith({
			body: {
				newPassword: TEMPORARY_PASSWORD,
				userId: ADMINISTRATOR_ID,
			},
			headers,
		});
		expect(spies.markTemporaryPassword).toHaveBeenCalledWith({
			mustChangePassword: true,
			userId: ADMINISTRATOR_ID,
		});
		expect(spies.revokeUserSessions).toHaveBeenCalledWith({
			body: { userId: ADMINISTRATOR_ID },
			headers,
		});
		expect(spies.setUserPassword).toHaveBeenCalledBefore(
			spies.markTemporaryPassword,
		);
		expect(spies.markTemporaryPassword).toHaveBeenCalledBefore(
			spies.revokeUserSessions,
		);
	});

	it("does not continue a reset after the password update fails", async () => {
		const { spies, unitOfWork } = createTestUnitOfWork();
		spies.setUserPassword.mockRejectedValueOnce(
			new Error(`provider rejected ${TEMPORARY_PASSWORD}`),
		);
		const { dependencies } = createTestDependencies(unitOfWork);

		const error = await resetAdministratorTemporaryPassword(
			{
				headers: createHeaders(),
				temporaryPassword: TEMPORARY_PASSWORD,
				userId: ADMINISTRATOR_ID,
			},
			dependencies,
		).catch((cause: unknown) => cause);

		expect(spies.markTemporaryPassword).not.toHaveBeenCalled();
		expect(spies.revokeUserSessions).not.toHaveBeenCalled();
		expect(error).toMatchObject({
			code: "ADMINISTRATOR_RESET_FAILED",
			message: "Administrator password reset failed.",
		});
		expect(String(error)).not.toContain(TEMPORARY_PASSWORD);
	});

	it("rolls a reset back when session revocation fails", async () => {
		const committed = {
			mustChangePassword: false,
			password: "Existing!Admin-2025#Safe",
			sessionCount: 2,
		};
		const dependencies: AdministratorCredentialDependencies = {
			async runAtomic<T>(
				operation: (unit: AdministratorCredentialUnitOfWork) => Promise<T>,
			): Promise<T> {
				const working = structuredClone(committed);
				const unit = {
					auth: {
						createUser: vi.fn(async () => ({
							user: { id: ADMINISTRATOR_ID },
						})),
						revokeUserSessions: vi.fn(async () => {
							throw new Error(`revocation rejected ${TEMPORARY_PASSWORD}`);
						}),
						setUserPassword: vi.fn(async () => {
							working.password = TEMPORARY_PASSWORD;
						}),
					},
					createMetadata: vi.fn(async () => {}),
					markTemporaryPassword: vi.fn(async () => {
						working.mustChangePassword = true;
					}),
				} as unknown as AdministratorCredentialUnitOfWork;

				const result = await operation(unit);
				Object.assign(committed, working);
				return result;
			},
		};

		const error = await resetAdministratorTemporaryPassword(
			{
				headers: createHeaders(),
				temporaryPassword: TEMPORARY_PASSWORD,
				userId: ADMINISTRATOR_ID,
			},
			dependencies,
		).catch((cause: unknown) => cause);

		expect(committed).toEqual({
			mustChangePassword: false,
			password: "Existing!Admin-2025#Safe",
			sessionCount: 2,
		});
		expect(error).toMatchObject({
			code: "ADMINISTRATOR_RESET_FAILED",
			message: "Administrator password reset failed.",
		});
		expect(String(error)).not.toContain(TEMPORARY_PASSWORD);
	});
});
