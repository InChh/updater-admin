import { randomUUID } from "node:crypto";
import process from "node:process";

import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
	createDatabaseClient,
	type ManagedDatabaseClient,
} from "../client.server";
import { adminMetadata, auditEvents, session, user } from "../schema";
import { assertDisposableDatabaseGuard } from "../schema/database-test-safety";
import {
	AdministratorStaleWriteRepositoryError,
	type AdministratorsRepositoryRuntimeDependencies,
	createAdministratorsRepository,
	LastActiveAdministratorRepositoryError,
} from "./administrators.server";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
	describe("administrators repository database integration", () => {
		it.skip("TEST_DATABASE_URL is absent; no disposable database was provisioned", () => {});
	});
} else {
	assertDisposableDatabaseGuard({
		confirmation: process.env.TEST_DATABASE_CONFIRM_DISPOSABLE,
		databaseUrl: process.env.DATABASE_URL,
		testDatabaseUrl,
	});

	type AuthApiFactory = NonNullable<
		AdministratorsRepositoryRuntimeDependencies["createAuthApi"]
	>;
	type AuthApi = ReturnType<AuthApiFactory>;

	const createDatabaseBackedAuthApi: AuthApiFactory = (transaction) => {
		// This keeps the integration test credential-free while preserving the same
		// transaction and user/session effects expected from Better Auth's admin API.
		// Better Auth endpoint wiring remains covered by auth/API tests and deployment
		// smoke checks; the invariant and rollback boundary are exercised here in SQL.
		return {
			adminUpdateUser: async (request: {
				body: { data: { name?: string }; userId: string };
			}) => {
				if (request.body.data.name !== undefined) {
					await transaction
						.update(user)
						.set({ name: request.body.data.name })
						.where(eq(user.id, request.body.userId));
				}
				return {} as never;
			},
			banUser: async (request: { body: { userId: string } }) => {
				await transaction
					.update(user)
					.set({
						banned: true,
						banReason: "Disabled by an administrator",
					})
					.where(eq(user.id, request.body.userId));
				await transaction
					.delete(session)
					.where(eq(session.userId, request.body.userId));
				return {} as never;
			},
			revokeUserSessions: async (request: { body: { userId: string } }) => {
				await transaction
					.delete(session)
					.where(eq(session.userId, request.body.userId));
				return {} as never;
			},
			unbanUser: async (request: { body: { userId: string } }) => {
				await transaction
					.update(user)
					.set({ banned: false, banReason: null })
					.where(eq(user.id, request.body.userId));
				return {} as never;
			},
		} as unknown as AuthApi;
	};

	describe("administrators repository database integration", () => {
		let client: ManagedDatabaseClient;
		const fixtureUserIds: string[] = [];

		beforeAll(() => {
			client = createDatabaseClient({ databaseUrl: testDatabaseUrl });
		});

		afterEach(async () => {
			if (fixtureUserIds.length === 0) return;
			await client.db
				.delete(auditEvents)
				.where(inArray(auditEvents.actorId, fixtureUserIds));
			await client.db
				.delete(session)
				.where(inArray(session.userId, fixtureUserIds));
			await client.db
				.delete(adminMetadata)
				.where(inArray(adminMetadata.userId, fixtureUserIds));
			await client.db.delete(user).where(inArray(user.id, fixtureUserIds));
			fixtureUserIds.length = 0;
		});

		afterAll(async () => {
			await client?.close();
		});

		async function insertAdministrator(label: string): Promise<string> {
			const id = randomUUID();
			fixtureUserIds.push(id);
			await client.db.insert(user).values({
				banned: false,
				email: `${label}-${id}@example.test`,
				emailVerified: true,
				id,
				name: label,
				role: "admin",
			});
			await client.db.insert(adminMetadata).values({
				locale: "zh-CN",
				mustChangePassword: false,
				userId: id,
			});
			await client.db.insert(session).values({
				expiresAt: new Date("2099-01-01T00:00:00.000Z"),
				token: `administrator-db-test-${randomUUID()}`,
				userId: id,
			});
			return id;
		}

		function mutationAudit(actorId: string) {
			return {
				actorId,
				ip: "203.0.113.8",
				requestId: `req_${randomUUID()}`,
				userAgent: "administrators-db-test",
			};
		}

		it("serializes opposing disables so exactly one active administrator remains", async () => {
			const firstId = await insertAdministrator("First administrator");
			const secondId = await insertAdministrator("Second administrator");
			const repository = createAdministratorsRepository(client.db, {
				createAuthApi: createDatabaseBackedAuthApi,
			});

			const results = await Promise.allSettled([
				repository.update({
					audit: mutationAudit(firstId),
					enabled: false,
					expectedRowVersion: 1n,
					headers: new Headers(),
					id: secondId,
				}),
				repository.update({
					audit: mutationAudit(secondId),
					enabled: false,
					expectedRowVersion: 1n,
					headers: new Headers(),
					id: firstId,
				}),
			]);

			const fulfilled = results.filter(
				(result) => result.status === "fulfilled",
			);
			const rejected = results.filter(
				(result): result is PromiseRejectedResult =>
					result.status === "rejected",
			);
			expect(fulfilled).toHaveLength(1);
			expect(rejected).toHaveLength(1);
			expect(rejected[0]?.reason).toBeInstanceOf(
				LastActiveAdministratorRepositoryError,
			);

			const administrators = await client.db
				.select({ banned: user.banned, id: user.id })
				.from(user)
				.where(inArray(user.id, [firstId, secondId]));
			const active = administrators.filter((row) => row.banned !== true);
			const disabled = administrators.filter((row) => row.banned === true);
			expect(active).toHaveLength(1);
			expect(disabled).toHaveLength(1);

			const metadataRows = await client.db
				.select({
					rowVersion: adminMetadata.rowVersion,
					userId: adminMetadata.userId,
				})
				.from(adminMetadata)
				.where(inArray(adminMetadata.userId, [firstId, secondId]));
			expect(
				metadataRows.find((row) => row.userId === disabled[0]?.id)?.rowVersion,
			).toBe(2n);
			expect(
				metadataRows.find((row) => row.userId === active[0]?.id)?.rowVersion,
			).toBe(1n);

			const remainingSessions = await client.db
				.select({ userId: session.userId })
				.from(session)
				.where(inArray(session.userId, [firstId, secondId]));
			expect(remainingSessions).toEqual([{ userId: active[0]?.id }]);
			const audits = await client.db
				.select({ action: auditEvents.action, actorId: auditEvents.actorId })
				.from(auditEvents)
				.where(inArray(auditEvents.actorId, [firstId, secondId]));
			expect(audits).toEqual([
				{ action: "administrator.updated", actorId: active[0]?.id },
			]);
		});

		it("allows only one concurrent mutation for the same administrator ETag", async () => {
			const actorId = await insertAdministrator("Actor administrator");
			const targetId = await insertAdministrator("Target administrator");
			const repository = createAdministratorsRepository(client.db, {
				createAuthApi: createDatabaseBackedAuthApi,
			});

			const results = await Promise.allSettled([
				repository.update({
					audit: mutationAudit(actorId),
					expectedRowVersion: 1n,
					headers: new Headers(),
					id: targetId,
					name: "Winner A",
				}),
				repository.update({
					audit: mutationAudit(actorId),
					expectedRowVersion: 1n,
					headers: new Headers(),
					id: targetId,
					name: "Winner B",
				}),
			]);

			expect(
				results.filter((result) => result.status === "fulfilled"),
			).toHaveLength(1);
			const rejected = results.filter(
				(result): result is PromiseRejectedResult =>
					result.status === "rejected",
			);
			expect(rejected).toHaveLength(1);
			expect(rejected[0]?.reason).toBeInstanceOf(
				AdministratorStaleWriteRepositoryError,
			);

			const current = await repository.findById(targetId);
			expect(["Winner A", "Winner B"]).toContain(current?.name);
			expect(current?.rowVersion).toBe(2n);
			const audits = await client.db
				.select({ action: auditEvents.action })
				.from(auditEvents)
				.where(eq(auditEvents.actorId, actorId));
			expect(audits).toEqual([{ action: "administrator.updated" }]);
		});
	});
}
