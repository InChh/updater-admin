import { QueryClient } from "@tanstack/solid-query";
import { describe, expect, it, vi } from "vitest";

import {
	applySystemDefaultPageSize,
	resolveSystemDefaultPageSize,
} from "./system-defaults";
import { systemSettingsQueryOptions } from "./system-queries";

const cachedSettings = {
	data: {
		defaultLocale: "zh-CN" as const,
		defaultPageSize: 50 as const,
		repositoryUrl: null,
		systemName: "Updater Admin",
	},
	etag: 'W/"1"' as const,
};

describe("system list defaults", () => {
	it("uses the Query-backed system default when pageSize is absent", () => {
		expect(
			applySystemDefaultPageSize({ page: 1, sort: "createdAt:desc" }, 50),
		).toEqual({ page: 1, pageSize: 50, sort: "createdAt:desc" });
	});

	it("keeps explicit URL state authoritative", () => {
		expect(
			applySystemDefaultPageSize(
				{ page: 2, pageSize: 20, sort: "createdAt:desc" },
				100,
			),
		).toEqual({ page: 2, pageSize: 20, sort: "createdAt:desc" });
	});

	it("uses stale cached settings without waiting for their refresh", () => {
		const queryClient = new QueryClient();
		const options = systemSettingsQueryOptions();
		queryClient.setQueryData(options.queryKey, cachedSettings);
		const neverFinishes = new Promise<void>(() => undefined);
		const prefetch = vi
			.spyOn(queryClient, "prefetchQuery")
			.mockReturnValue(neverFinishes);

		expect(resolveSystemDefaultPageSize(queryClient)).toBe(50);
		expect(prefetch).toHaveBeenCalledOnce();
	});

	it("uses the fallback immediately while uncached settings load", () => {
		const queryClient = new QueryClient();
		const neverFinishes = new Promise<void>(() => undefined);
		const prefetch = vi
			.spyOn(queryClient, "prefetchQuery")
			.mockReturnValue(neverFinishes);

		expect(resolveSystemDefaultPageSize(queryClient)).toBe(20);
		expect(prefetch).toHaveBeenCalledOnce();
	});
});
