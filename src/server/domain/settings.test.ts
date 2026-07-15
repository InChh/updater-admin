import { describe, expect, it, vi } from "vitest";

import type { UpdateSystemSettingsInput } from "../../shared/api/settings";
import {
	createSettingsRepository,
	type SettingsMutationContext,
	type SettingsRepository,
	SettingsStaleWriteRepositoryError,
	type SystemSettingsRecord,
} from "../db/repositories/settings.server";
import { auditEvents, systemSettings } from "../db/schema";
import {
	createSettingsService,
	SettingsPreconditionRequiredError,
	SettingsStaleWriteError,
	SettingsValidationError,
} from "./settings.server";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-15T08:00:00.000Z");
const audit: SettingsMutationContext = {
	actorId: ACTOR_ID,
	ip: "203.0.113.8",
	requestId: "req_settings",
	userAgent: "test",
};
const input: UpdateSystemSettingsInput = {
	defaultLocale: "en",
	defaultPageSize: 50,
	repositoryUrl: "https://github.com/example/updater",
	systemName: "Updater Admin",
};

function settings(
	overrides: Partial<SystemSettingsRecord> = {},
): SystemSettingsRecord {
	return {
		defaultLocale: "zh-CN",
		defaultPageSize: 20,
		repositoryUrl: null,
		rowVersion: 3n,
		systemName: "版本管理系统",
		updatedAt: new Date("2026-07-14T01:00:00.000Z"),
		updatedBy: null,
		...overrides,
	};
}

function repository(
	overrides: Partial<SettingsRepository> = {},
): SettingsRepository {
	return {
		getOrCreate: vi.fn(async () => settings()),
		update: vi.fn(async () =>
			settings({
				defaultLocale: "en",
				defaultPageSize: 50,
				repositoryUrl: input.repositoryUrl,
				rowVersion: 4n,
				systemName: "Updater Admin",
				updatedAt: NOW,
				updatedBy: ACTOR_ID,
			}),
		),
		...overrides,
	};
}

describe("settings service", () => {
	it("stays lazy and returns only the public singleton fields with an ETag", async () => {
		const getRepository = vi.fn(() => repository());
		const service = createSettingsService({ getRepository });

		expect(getRepository).not.toHaveBeenCalled();
		await expect(service.get()).resolves.toEqual({
			data: {
				defaultLocale: "zh-CN",
				defaultPageSize: 20,
				repositoryUrl: null,
				systemName: "版本管理系统",
			},
			etag: 'W/"3"',
		});
		expect(getRepository).toHaveBeenCalledOnce();
	});

	it("falls back to approved defaults when a legacy record has unsupported defaults", async () => {
		const service = createSettingsService({
			repository: repository({
				getOrCreate: async () =>
					settings({ defaultLocale: "fr", defaultPageSize: 25 }),
			}),
		});

		await expect(service.get()).resolves.toMatchObject({
			data: { defaultLocale: "zh-CN", defaultPageSize: 20 },
		});
	});

	it("normalizes whitespace and an empty repository URL before updating", async () => {
		const update = vi.fn(async () =>
			settings({
				defaultLocale: "en",
				defaultPageSize: 100,
				repositoryUrl: null,
				rowVersion: 4n,
				systemName: "Updater Admin",
			}),
		);
		const service = createSettingsService({
			now: () => NOW,
			repository: repository({ update }),
		});

		const result = await service.update(
			'W/"3"',
			{
				defaultLocale: "en",
				defaultPageSize: 100,
				repositoryUrl: "   ",
				systemName: "  Updater Admin  ",
			},
			audit,
		);

		expect(update).toHaveBeenCalledWith({
			audit,
			defaultLocale: "en",
			defaultPageSize: 100,
			expectedRowVersion: 3n,
			now: NOW,
			repositoryUrl: null,
			systemName: "Updater Admin",
		});
		expect(result.etag).toBe('W/"4"');
	});

	it("preserves a trimmed credential-free HTTPS repository URL", async () => {
		const update = vi.fn(async () => settings({ rowVersion: 4n }));
		const service = createSettingsService({
			repository: repository({ update }),
		});

		await service.update(
			'W/"3"',
			{
				...input,
				repositoryUrl: "  https://git.example.com/team/repo?tab=readme#setup  ",
			},
			audit,
		);

		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				repositoryUrl: "https://git.example.com/team/repo?tab=readme#setup",
			}),
		);
	});

	it("rejects insecure, malformed, credential-bearing, and oversized repository URLs", async () => {
		const update = vi.fn(async () => settings());
		const service = createSettingsService({
			repository: repository({ update }),
		});

		for (const repositoryUrl of [
			"http://github.com/example/repo",
			"not a URL",
			"https://user:secret@example.com/repo",
			"https://git.example.com/team/repo?token=synthetic-secret",
			"https://git.example.com/team/repo?api_key=synthetic-secret",
			"https://git.example.com/team/repo?X-Amz-Signature=synthetic",
			"https://git.example.com/team/repo#access_token=synthetic-secret",
			"https://git.example.com/team/repo#/callback?client_secret=synthetic",
			"https://git.example.com/team/repo?ref=ghp_0123456789abcdefghijklmnopqrstuv",
			"https://git.example.com/team/repo#state=eyJheader12345.eyJpayload12345.signature12345",
			`https://example.com/${"x".repeat(2040)}`,
		]) {
			await expect(
				service.update('W/"3"', { ...input, repositoryUrl }, audit),
			).rejects.toBeInstanceOf(SettingsValidationError);
		}
		expect(update).not.toHaveBeenCalled();
	});

	it("validates locale, page size, and Unicode-safe system names", async () => {
		const update = vi.fn(async () => settings());
		const service = createSettingsService({
			repository: repository({ update }),
		});

		const invalidInputs = [
			{ ...input, defaultLocale: "fr" },
			{ ...input, defaultPageSize: 25 },
			{ ...input, systemName: "   " },
			{ ...input, systemName: "x".repeat(129) },
			{ ...input, systemName: "bad\0name" },
			{ ...input, systemName: "\ud800" },
		] as const;
		for (const invalidInput of invalidInputs) {
			await expect(
				service.update('W/"3"', invalidInput as never, audit),
			).rejects.toBeInstanceOf(SettingsValidationError);
		}
		expect(update).not.toHaveBeenCalled();
	});

	it("counts Unicode code points at the exact system-name limit", async () => {
		const update = vi.fn(async () => settings({ rowVersion: 4n }));
		const service = createSettingsService({
			repository: repository({ update }),
		});

		await expect(
			service.update(
				'W/"3"',
				{ ...input, systemName: "🚀".repeat(128) },
				audit,
			),
		).resolves.toBeDefined();
		await expect(
			service.update(
				'W/"3"',
				{ ...input, systemName: "🚀".repeat(129) },
				audit,
			),
		).rejects.toMatchObject({
			fieldErrors: [{ code: "TOO_LONG", path: "systemName" }],
		});
		expect(update).toHaveBeenCalledOnce();
	});

	it("requires a current well-formed If-Match token", async () => {
		const update = vi.fn(async () => settings());
		const service = createSettingsService({
			repository: repository({ update }),
		});

		await expect(service.update(null, input, audit)).rejects.toBeInstanceOf(
			SettingsPreconditionRequiredError,
		);
		await expect(
			service.update('W/"invalid"', input, audit),
		).rejects.toBeInstanceOf(SettingsStaleWriteError);
		expect(update).not.toHaveBeenCalled();
	});

	it("maps a repository compare-and-swap failure to a stale write", async () => {
		const service = createSettingsService({
			repository: repository({
				update: async () => {
					throw new SettingsStaleWriteRepositoryError();
				},
			}),
		});

		await expect(service.update('W/"3"', input, audit)).rejects.toBeInstanceOf(
			SettingsStaleWriteError,
		);
	});
});

describe("settings repository", () => {
	it("uses an id-targeted conflict-safe insert before concurrent singleton reads", async () => {
		const onConflictDoNothing = vi.fn(
			async (_options: { readonly target: unknown }) => undefined,
		);
		const limit = vi.fn(async () => [settings()]);
		const database = {
			insert: vi.fn(() => ({
				values: vi.fn(() => ({ onConflictDoNothing })),
			})),
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({ limit })),
				})),
			})),
			transaction: vi.fn(),
		};
		const settingsRepository = createSettingsRepository(database as never);

		await expect(
			Promise.all([
				settingsRepository.getOrCreate(),
				settingsRepository.getOrCreate(),
			]),
		).resolves.toHaveLength(2);
		expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
		for (const [options] of onConflictDoNothing.mock.calls) {
			expect(options).toEqual({ target: systemSettings.id });
		}
	});

	it("updates and audits the fixed singleton in one transaction", async () => {
		const before = settings();
		const updated = settings({
			defaultLocale: "en",
			defaultPageSize: 50,
			repositoryUrl: input.repositoryUrl,
			rowVersion: 4n,
			systemName: input.systemName,
			updatedAt: NOW,
			updatedBy: ACTOR_ID,
		});
		let auditValues: Record<string, unknown> | undefined;
		const transaction = {
			insert: vi.fn((table: unknown) => {
				if (table === systemSettings) {
					return {
						values: () => ({
							onConflictDoNothing: async () => undefined,
						}),
					};
				}
				expect(table).toBe(auditEvents);
				return {
					values: (values: Record<string, unknown>) => {
						auditValues = values;
						return {
							returning: async () => [
								{
									createdAt: NOW,
									id: "00000000-0000-4000-8000-000000000099",
								},
							],
						};
					},
				};
			}),
			select: vi.fn(() => ({
				from: () => ({
					where: () => ({
						limit: () => ({ for: async () => [before] }),
					}),
				}),
			})),
			update: vi.fn(() => ({
				set: () => ({
					where: () => ({ returning: async () => [updated] }),
				}),
			})),
		};
		const database = {
			insert: vi.fn(),
			select: vi.fn(),
			transaction: vi.fn(
				async (callback: (client: typeof transaction) => unknown) =>
					callback(transaction),
			),
		};
		const settingsRepository = createSettingsRepository(database as never);

		await expect(
			settingsRepository.update({
				audit,
				...input,
				expectedRowVersion: 3n,
				now: NOW,
			}),
		).resolves.toEqual(updated);
		expect(database.transaction).toHaveBeenCalledOnce();
		expect(auditValues).toMatchObject({
			action: "system-settings.updated",
			actorId: ACTOR_ID,
			afterJson: {
				defaultLocale: "en",
				defaultPageSize: 50,
				repositoryUrl: input.repositoryUrl,
				systemName: input.systemName,
			},
			beforeJson: {
				defaultLocale: "zh-CN",
				defaultPageSize: 20,
				repositoryUrl: null,
				systemName: "版本管理系统",
			},
			requestId: "req_settings",
			resourceId: "1",
			resourceType: "system-settings",
			result: "success",
		});
	});
});
