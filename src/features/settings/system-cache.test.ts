import { QueryClient } from "@tanstack/solid-query";
import { describe, expect, it } from "vitest";

import { systemSettingsQueryKeys } from "../../lib/api/query-keys";
import type { EntityResult } from "../../shared/api/common";
import type { SystemSettingsDto } from "../../shared/api/settings";
import {
	markSystemSettingsStale,
	refreshStaleSystemSettings,
	storeSystemSettings,
} from "./system-cache";

const entity: EntityResult<SystemSettingsDto> = {
	data: {
		defaultLocale: "en",
		defaultPageSize: 50,
		repositoryUrl: "https://github.com/example/updater",
		systemName: "Updater Admin",
	},
	etag: 'W/"4"',
};

describe("system settings cache boundary", () => {
	it("stores the authoritative mutation entity and invalidates only the exact singleton", async () => {
		const client = new QueryClient();
		const siblingKey = [...systemSettingsQueryKeys.all, "future"] as const;
		client.setQueryData(siblingKey, { untouched: true });

		storeSystemSettings(client, entity);
		await markSystemSettingsStale(client);

		expect(client.getQueryData(systemSettingsQueryKeys.detail())).toEqual(
			entity,
		);
		expect(
			client.getQueryState(systemSettingsQueryKeys.detail())?.isInvalidated,
		).toBe(true);
		expect(client.getQueryState(siblingKey)?.isInvalidated).toBe(false);
	});

	it("refreshes the exact singleton after a stale write", async () => {
		const client = new QueryClient();
		storeSystemSettings(client, entity);

		await refreshStaleSystemSettings(client);

		expect(
			client.getQueryState(systemSettingsQueryKeys.detail())?.isInvalidated,
		).toBe(true);
	});
});
