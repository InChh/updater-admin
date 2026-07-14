import { describe, expect, it } from "vitest";

import {
	assertDisposableDatabaseGuard,
	DISPOSABLE_DATABASE_CONFIRMATION,
	pointsToSameDatabase,
} from "./database-test-safety";

describe("disposable database safety", () => {
	it("treats Neon pooled and direct hosts for the same branch as one database", () => {
		expect(
			pointsToSameDatabase(
				"postgresql://test:test@ep-example-pooler.us-east-2.aws.neon.tech/updater_admin_test",
				"postgresql://prod:prod@ep-example.us-east-2.aws.neon.tech:5432/updater_admin_test",
			),
		).toBe(true);
		expect(
			pointsToSameDatabase(
				"postgresql://test:test@ep-test-pooler.us-east-2.aws.neon.tech/updater_admin_test",
				"postgresql://prod:prod@ep-production.us-east-2.aws.neon.tech/updater_admin_test",
			),
		).toBe(false);
	});

	it("normalizes encoded database names and fails closed on malformed encodings", () => {
		expect(
			pointsToSameDatabase(
				"postgresql://test:test@ep-example.example/%75pdater_admin",
				"postgresql://prod:prod@ep-example.example/updater_admin",
			),
		).toBe(true);
		expect(
			pointsToSameDatabase(
				"postgresql://test:test@ep-example.example/%E0%A4%A",
				"postgresql://prod:prod@ep-example.example/updater_admin",
			),
		).toBe(true);
	});

	it("requires the exact confirmation before accepting a distinct database", () => {
		const input = {
			databaseUrl: "postgresql://prod:prod@ep-production.example/prod",
			testDatabaseUrl: "postgresql://test:test@ep-test.example/test",
		};
		expect(() =>
			assertDisposableDatabaseGuard({ ...input, confirmation: undefined }),
		).toThrow("TEST_DATABASE_CONFIRM_DISPOSABLE");
		expect(() =>
			assertDisposableDatabaseGuard({
				...input,
				confirmation: DISPOSABLE_DATABASE_CONFIRMATION,
			}),
		).not.toThrow();
	});

	it("rejects pooled/direct aliases even with the confirmation", () => {
		expect(() =>
			assertDisposableDatabaseGuard({
				confirmation: DISPOSABLE_DATABASE_CONFIRMATION,
				databaseUrl:
					"postgresql://prod:prod@ep-example.us-east-2.aws.neon.tech/prod",
				testDatabaseUrl:
					"postgresql://test:test@ep-example-pooler.us-east-2.aws.neon.tech/prod",
			}),
		).toThrow("TEST_DATABASE_URL");
	});
});
