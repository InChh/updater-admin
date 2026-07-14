import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { EnvironmentSource } from "../env.server";
import {
	AUTH_HTTP_DISABLED_PATHS,
	type AuthDatabase,
	createAuth,
	createSessionLoginHook,
	updateLastLoginAt,
} from "./auth.server";
import {
	type BootstrapAdminState,
	type BootstrapDependencies,
	type BootstrapFromEnvironmentDependencies,
	type BootstrapRepository,
	BootstrapStateError,
	bootstrapAdministrator,
	bootstrapAdministratorFromEnvironment,
	createAdministratorMetadataValues,
	formatBootstrapFailure,
} from "./bootstrap.server";
import { getSafeSession, type SafeSessionDependencies } from "./session.server";

const AUTH_ENVIRONMENT: EnvironmentSource = {
	BETTER_AUTH_SECRET:
		"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_",
	BETTER_AUTH_URL: "http://localhost:3000",
	NODE_ENV: "development",
};

const BOOTSTRAP_INPUT = {
	email: "Admin@Example.com",
	name: "Initial Administrator",
	password: "Bootstrap!Admin-2026#Safe",
};

function createTestAuth(
	environment = AUTH_ENVIRONMENT,
	rateLimitEnabled = true,
) {
	return createAuth({
		database: {} as AuthDatabase,
		databaseTransaction: false,
		environment,
		rateLimitEnabled,
		updateLastLogin: async () => {},
	});
}

describe("Better Auth runtime", () => {
	it("uses the approved secure, database-backed, admin-only configuration", async () => {
		const context = await createTestAuth().$context;

		expect(context.options.baseURL).toBe("http://localhost:3000");
		expect(context.options.emailAndPassword).toMatchObject({
			autoSignIn: false,
			disableSignUp: true,
			enabled: true,
			maxPasswordLength: 128,
			minPasswordLength: 12,
		});
		expect(context.options.rateLimit).toMatchObject({
			enabled: true,
			storage: "database",
		});
		expect(context.options.advanced).toMatchObject({
			database: { generateId: "uuid" },
			defaultCookieAttributes: {
				httpOnly: true,
				sameSite: "lax",
				secure: false,
			},
			ipAddress: {
				ipAddressHeaders: ["x-nf-client-connection-ip", "x-forwarded-for"],
			},
		});
		expect(context.options.disabledPaths).toEqual([
			...AUTH_HTTP_DISABLED_PATHS,
		]);
		expect(context.options.plugins?.at(-1)?.id).toBe(
			"tanstack-start-cookies-solid",
		);
		expect(
			context.options.plugins?.some((plugin) => plugin.id === "admin"),
		).toBe(true);
	});

	it("does not cache authentication secrets at module scope", () => {
		const environment = { ...AUTH_ENVIRONMENT };
		expect(() => createTestAuth(environment)).not.toThrow();

		environment.BETTER_AUTH_SECRET = "weak";
		expect(() => createTestAuth(environment)).toThrow("BETTER_AUTH_SECRET");
	});

	it("disables public email sign-up", async () => {
		const response = await createTestAuth(AUTH_ENVIRONMENT, false).handler(
			new Request("http://localhost:3000/api/auth/sign-up/email", {
				body: JSON.stringify({
					email: "new@example.com",
					name: "New User",
					password: "ThisCannotRegister!2026",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
		});
	});

	it.each(
		AUTH_HTTP_DISABLED_PATHS,
	)("returns a raw 404 for disabled Better Auth path %s", async (path) => {
		const response = await createTestAuth().handler(
			new Request(`http://localhost:3000/api/auth${path}`, {
				method: "POST",
			}),
		);
		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Not Found");
	});

	it("keeps only the approved account session endpoints on the raw surface", () => {
		const auth = createTestAuth();
		expect(AUTH_HTTP_DISABLED_PATHS).not.toContain("/list-sessions");
		expect(AUTH_HTTP_DISABLED_PATHS).not.toContain("/revoke-session");
		expect(AUTH_HTTP_DISABLED_PATHS).not.toContain("/revoke-other-sessions");
		expect(auth.api.listSessions).toBeTypeOf("function");
		expect(auth.api.revokeSession).toBeTypeOf("function");
		expect(auth.api.revokeOtherSessions).toBeTypeOf("function");
		// Admin server methods remain available to the later Elysia facade even
		// though their raw HTTP routes are disabled.
		expect(auth.api.createUser).toBeTypeOf("function");
		expect(auth.api.setUserPassword).toBeTypeOf("function");
	});
});

describe("session boundary", () => {
	it("returns a metadata-enriched projection without the session token", async () => {
		const getSession = vi.fn(async () => ({
			session: {
				createdAt: new Date("2026-07-14T01:00:00.000Z"),
				expiresAt: new Date("2026-07-15T01:00:00.000Z"),
				id: "10000000-0000-4000-8000-000000000001",
				ipAddress: "127.0.0.1",
				token: "must-never-leave-the-server",
				updatedAt: new Date("2026-07-14T02:00:00.000Z"),
				userAgent: "secret-agent",
				userId: "20000000-0000-4000-8000-000000000001",
			},
			user: {
				banExpires: null,
				banReason: null,
				banned: false,
				createdAt: new Date("2026-07-14T00:00:00.000Z"),
				email: "admin@example.com",
				emailVerified: true,
				id: "20000000-0000-4000-8000-000000000001",
				image: null,
				name: "Admin",
				role: "admin",
				updatedAt: new Date("2026-07-14T00:00:00.000Z"),
			},
		}));
		const auth = { api: { getSession } } as unknown as NonNullable<
			SafeSessionDependencies["auth"]
		>;

		const view = await getSafeSession(
			new Headers({ cookie: "session=value" }),
			{
				auth,
				loadMetadata: async () => ({
					lastLoginAt: new Date("2026-07-14T01:00:00.000Z"),
					locale: "en",
					mustChangePassword: false,
				}),
			},
		);

		expect(getSession).toHaveBeenCalledWith({
			headers: expect.any(Headers),
			query: { disableCookieCache: true, disableRefresh: true },
		});
		expect(view).toMatchObject({
			metadata: {
				lastLoginAt: "2026-07-14T01:00:00.000Z",
				locale: "en",
				mustChangePassword: false,
			},
			user: { email: "admin@example.com", role: "admin" },
		});
		expect(JSON.stringify(view)).not.toContain("must-never-leave-the-server");
		expect(JSON.stringify(view)).not.toContain("secret-agent");
		expect(JSON.stringify(view)).not.toContain("127.0.0.1");
	});

	it("fails closed when administrator metadata is missing", async () => {
		const auth = {
			api: {
				getSession: vi.fn(async () => ({
					session: {
						createdAt: new Date(0),
						expiresAt: new Date(1),
						id: "session-id",
						token: "server-only",
						updatedAt: new Date(0),
						userId: "user-id",
					},
					user: {
						banned: false,
						email: "admin@example.com",
						emailVerified: true,
						id: "user-id",
						image: null,
						name: "Admin",
						role: "admin",
					},
				})),
			},
		} as unknown as NonNullable<SafeSessionDependencies["auth"]>;

		const view = await getSafeSession(new Headers(), {
			auth,
			loadMetadata: async () => null,
		});
		expect(view?.metadata).toEqual({
			lastLoginAt: null,
			locale: "zh-CN",
			mustChangePassword: true,
		});
	});

	it("records the session creation time through the login hook", async () => {
		const update = vi.fn(async () => {});
		const hook = createSessionLoginHook(update);
		const createdAt = new Date("2026-07-14T03:00:00.000Z");

		await hook({ createdAt, userId: "user-id" });
		expect(update).toHaveBeenCalledWith({ createdAt, userId: "user-id" });
	});

	it("uses a monotonic conditional update for lastLoginAt", async () => {
		let whereClause: unknown;
		const database = {
			update: () => ({
				set: () => ({
					where: (where: unknown) => {
						whereClause = where;
					},
				}),
			}),
		};
		const createdAt = new Date("2026-07-14T03:00:00.000Z");

		await updateLastLoginAt(
			database as unknown as Parameters<typeof updateLastLoginAt>[0],
			{ createdAt, userId: "user-id" },
		);
		const query = new PgDialect().sqlToQuery(
			whereClause as Parameters<PgDialect["sqlToQuery"]>[0],
		);
		expect(query.sql).toContain('"last_login_at" is null');
		expect(query.sql).toContain('"last_login_at" <');
		expect(query.params).toContain(createdAt.toISOString());
	});
});

interface RepositoryHarness {
	readonly createAdmin: ReturnType<
		typeof vi.fn<BootstrapRepository["createAdmin"]>
	>;
	readonly createMetadata: ReturnType<
		typeof vi.fn<BootstrapRepository["createMetadata"]>
	>;
	readonly dependencies: BootstrapDependencies;
}

function createRepositoryHarness(
	state: readonly BootstrapAdminState[] = [],
): RepositoryHarness {
	const createAdmin = vi.fn<BootstrapRepository["createAdmin"]>(async () => ({
		id: "30000000-0000-4000-8000-000000000001",
	}));
	const createMetadata = vi.fn<BootstrapRepository["createMetadata"]>(
		async () => {},
	);
	return {
		createAdmin,
		createMetadata,
		dependencies: {
			runExclusive: async (operation) =>
				operation({
					createAdmin,
					createMetadata,
					listAdminState: async () => state,
				}),
		},
	};
}

describe("administrator bootstrap", () => {
	it("creates exactly one full administrator with non-temporary metadata", async () => {
		const harness = createRepositoryHarness();

		const result = await bootstrapAdministrator(
			BOOTSTRAP_INPUT,
			harness.dependencies,
		);

		expect(result.status).toBe("created");
		expect(harness.createAdmin).toHaveBeenCalledWith({
			email: "admin@example.com",
			name: "Initial Administrator",
			password: BOOTSTRAP_INPUT.password,
			role: "admin",
		});
		expect(harness.createMetadata).toHaveBeenCalledWith({
			locale: "zh-CN",
			mustChangePassword: false,
			userId: result.userId,
		});
	});

	it("treats a matching complete administrator as an idempotent success", async () => {
		const harness = createRepositoryHarness([
			{
				banned: false,
				email: "ADMIN@example.com",
				id: "existing-user",
				mustChangePassword: false,
				role: "admin",
			},
		]);

		const result = await bootstrapAdministrator(
			BOOTSTRAP_INPUT,
			harness.dependencies,
		);

		expect(result).toEqual({
			status: "already-exists",
			userId: "existing-user",
		});
		expect(harness.createAdmin).not.toHaveBeenCalled();
		expect(harness.createMetadata).not.toHaveBeenCalled();
	});

	it.each([
		[
			"different user",
			[
				{
					banned: false,
					email: "other@example.com",
					id: "other-user",
					mustChangePassword: false,
					role: "admin",
				},
			],
		],
		[
			"missing bootstrap metadata",
			[
				{
					banned: false,
					email: "admin@example.com",
					id: "partial-user",
					mustChangePassword: null,
					role: "admin",
				},
			],
		],
		[
			"multiple users",
			[
				{
					banned: false,
					email: "admin@example.com",
					id: "first-user",
					mustChangePassword: false,
					role: "admin",
				},
				{
					banned: false,
					email: "other@example.com",
					id: "second-user",
					mustChangePassword: false,
					role: "admin",
				},
			],
		],
	] as const)("refuses ambiguous state: %s", async (_name, state) => {
		const harness = createRepositoryHarness(state);
		await expect(
			bootstrapAdministrator(BOOTSTRAP_INPUT, harness.dependencies),
		).rejects.toBeInstanceOf(BootstrapStateError);
		expect(harness.createAdmin).not.toHaveBeenCalled();
	});

	it.each([
		"",
		"short",
		"aaaaaaaaaaaa",
		"passwordpassword",
	])("rejects a missing or weak bootstrap password without opening a transaction", async (password) => {
		let transactionOpened = false;
		const runExclusive: BootstrapDependencies["runExclusive"] = async () => {
			transactionOpened = true;
			throw new Error("unexpected transaction");
		};
		const secret = password || "missing-secret-sentinel";
		let error: unknown;
		try {
			await bootstrapAdministrator(
				{ ...BOOTSTRAP_INPUT, password },
				{ runExclusive },
			);
		} catch (caught) {
			error = caught;
		}

		expect(transactionOpened).toBe(false);
		expect(formatBootstrapFailure(error)).toContain("BOOTSTRAP_ADMIN_PASSWORD");
		expect(formatBootstrapFailure(error)).not.toContain(secret);
	});

	it.each([
		undefined,
		"weak-auth-secret",
	])("rejects a missing or weak Better Auth secret before opening a database transaction", async (secret) => {
		const transaction = vi.fn();
		await expect(
			bootstrapAdministratorFromEnvironment({
				database: { transaction } as unknown as NonNullable<
					BootstrapFromEnvironmentDependencies["database"]
				>,
				environment: {
					...AUTH_ENVIRONMENT,
					BETTER_AUTH_SECRET: secret,
					BOOTSTRAP_ADMIN_EMAIL: BOOTSTRAP_INPUT.email,
					BOOTSTRAP_ADMIN_NAME: BOOTSTRAP_INPUT.name,
					BOOTSTRAP_ADMIN_PASSWORD: BOOTSTRAP_INPUT.password,
				},
			}),
		).rejects.toThrow("BETTER_AUTH_SECRET");
		expect(transaction).not.toHaveBeenCalled();
	});

	it("redacts unexpected persistence failures", () => {
		const sensitive = "database-password=do-not-print";
		const message = formatBootstrapFailure(new Error(sensitive));
		expect(message).toBe(
			"Administrator bootstrap failed due to an unexpected server error.",
		);
		expect(message).not.toContain(sensitive);
	});

	it("marks later temporary-password administrators for forced rotation", () => {
		expect(createAdministratorMetadataValues("later-admin", true)).toEqual({
			locale: "zh-CN",
			mustChangePassword: true,
			userId: "later-admin",
		});
	});

	it("can retry cleanly when the exclusive transaction rolls back", async () => {
		let committed: BootstrapAdminState[] = [];
		let failMetadata = true;
		const dependencies: BootstrapDependencies = {
			async runExclusive(operation) {
				const draft = structuredClone(committed);
				const repository: BootstrapRepository = {
					async createAdmin(input) {
						const created = {
							banned: false,
							email: input.email,
							id: "transactional-user",
							mustChangePassword: null,
							role: input.role,
						};
						draft.push(created);
						return { id: created.id };
					},
					async createMetadata(values) {
						if (failMetadata) throw new Error("simulated metadata failure");
						const index = draft.findIndex((item) => item.id === values.userId);
						const created = draft[index];
						if (!created) throw new Error("missing transactional user");
						draft[index] = {
							...created,
							mustChangePassword: values.mustChangePassword,
						};
					},
					async listAdminState() {
						return draft;
					},
				};
				const result = await operation(repository);
				committed = draft;
				return result;
			},
		};

		await expect(
			bootstrapAdministrator(BOOTSTRAP_INPUT, dependencies),
		).rejects.toThrow("simulated metadata failure");
		expect(committed).toEqual([]);

		failMetadata = false;
		expect(
			await bootstrapAdministrator(BOOTSTRAP_INPUT, dependencies),
		).toMatchObject({ status: "created", userId: "transactional-user" });
		expect(
			await bootstrapAdministrator(BOOTSTRAP_INPUT, dependencies),
		).toMatchObject({
			status: "already-exists",
			userId: "transactional-user",
		});
		expect(committed).toHaveLength(1);
	});
});
