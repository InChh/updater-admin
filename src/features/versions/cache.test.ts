import { QueryClient } from "@tanstack/solid-query";
import { describe, expect, it } from "vitest";

import { versionQueryKeys } from "../../lib/api/query-keys";
import type { EntityResult, WeakEntityTag } from "../../shared/api/common";
import type {
	VersionDetailDto,
	VersionListItemDto,
	VersionPage,
} from "../../shared/api/versions";
import {
	invalidateProgramVersions,
	patchVersionActivation,
	reconcileVersionActivation,
	refreshStaleVersion,
	removeVersionDetail,
	rollbackVersionLists,
	storeVersionDetail,
} from "./cache";

const PROGRAM_A = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const PROGRAM_B = "4b3a970a-7379-4ef1-a2fa-45483c2bc469";
const VERSION_A = "e795a604-793c-47f6-aedd-006e77ea177c";
const VERSION_B = "7974502f-9a2f-4160-96c4-771724bd1223";
const VERSION_C = "9dd55dfe-3aba-4320-8125-80f1059096dd";

const ETAG_1: WeakEntityTag = 'W/"1"';
const ETAG_2: WeakEntityTag = 'W/"2"';

function row(
	id: string,
	programId: string,
	overrides: Partial<VersionListItemDto> = {},
): VersionListItemDto {
	return {
		associatedFileCount: 1,
		createdAt: "2026-07-15T00:00:00.000Z",
		description: id,
		etag: ETAG_1,
		expectedFileCount: null,
		fileCount: 1,
		finalizedAt: "2026-07-15T00:00:00.000Z",
		id,
		isActive: true,
		isLatest: false,
		lifecycleStatus: "finalized",
		programId,
		updatedAt: "2026-07-15T00:00:00.000Z",
		versionNumber: id === VERSION_A ? "2.0.0" : "1.0.0",
		...overrides,
	};
}

function page(
	items: readonly VersionListItemDto[],
	pageNumber = 1,
): VersionPage {
	return {
		items,
		page: pageNumber,
		pageSize: 20,
		total: items.length,
	};
}

function detail(
	item: VersionListItemDto,
	overrides: Partial<VersionDetailDto> = {},
	etag = item.etag,
): EntityResult<VersionDetailDto> {
	const { etag: _etag, ...data } = item;
	return {
		data: {
			...data,
			...overrides,
		},
		etag,
	};
}

function cachedRows(
	client: QueryClient,
	programId: string,
): readonly VersionListItemDto[] {
	return client
		.getQueriesData<VersionPage>({
			queryKey: versionQueryKeys.lists(programId),
		})
		.flatMap(([, cached]) => cached?.items ?? []);
}

describe("version cache", () => {
	it("patches every cached program list and reconciles the exact server entity and ETag", () => {
		const client = new QueryClient();
		const descending = versionQueryKeys.list(PROGRAM_A, {
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		const ascending = versionQueryKeys.list(PROGRAM_A, {
			page: 2,
			pageSize: 20,
			sort: "createdAt:asc",
		});
		const siblingLatest = row(VERSION_B, PROGRAM_A, { isLatest: true });
		client.setQueryData(
			descending,
			page([row(VERSION_A, PROGRAM_A), siblingLatest]),
		);
		client.setQueryData(
			ascending,
			page([row(VERSION_A, PROGRAM_A), row(VERSION_C, PROGRAM_A)], 2),
		);
		client.setQueryData(
			versionQueryKeys.list(PROGRAM_B, {
				page: 1,
				pageSize: 20,
				sort: "createdAt:desc",
			}),
			page([row(VERSION_B, PROGRAM_B, { isLatest: true })]),
		);
		storeVersionDetail(client, detail(siblingLatest));

		patchVersionActivation(client, PROGRAM_A, VERSION_A, true);
		expect(
			cachedRows(client, PROGRAM_A).filter(({ id }) => id === VERSION_A),
		).toHaveLength(2);

		const server = detail(
			row(VERSION_A, PROGRAM_A),
			{
				description: "server description",
				fileCount: 3,
				isActive: true,
				isLatest: true,
				updatedAt: "2026-07-15T01:00:00.000Z",
			},
			ETAG_2,
		);
		reconcileVersionActivation(client, server);

		const targetRows = cachedRows(client, PROGRAM_A).filter(
			({ id }) => id === VERSION_A,
		);
		expect(targetRows).toHaveLength(2);
		for (const target of targetRows) {
			expect(target).toMatchObject({
				description: "server description",
				etag: ETAG_2,
				fileCount: 3,
				isActive: true,
				isLatest: true,
			});
		}
		expect(
			cachedRows(client, PROGRAM_A).filter(
				({ id, isLatest }) => id !== VERSION_A && isLatest,
			),
		).toHaveLength(0);
		expect(
			client.getQueryData(versionQueryKeys.detail(PROGRAM_A, VERSION_A)),
		).toEqual(server);
		expect(
			client.getQueryData<EntityResult<VersionDetailDto>>(
				versionQueryKeys.detail(PROGRAM_A, VERSION_B),
			)?.data.isLatest,
		).toBe(false);
		expect(cachedRows(client, PROGRAM_B)[0]?.isLatest).toBe(true);
	});

	it("rolls only the target row back without replacing unrelated cached data", () => {
		const client = new QueryClient();
		const pageOneKey = versionQueryKeys.list(PROGRAM_A, {
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		const pageTwoKey = versionQueryKeys.list(PROGRAM_A, {
			page: 2,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		const pageOne = page([row(VERSION_A, PROGRAM_A, { isLatest: true })]);
		const pageTwo = page([row(VERSION_B, PROGRAM_A)], 2);
		client.setQueryData(pageOneKey, pageOne);
		client.setQueryData(pageTwoKey, pageTwo);

		const snapshot = patchVersionActivation(
			client,
			PROGRAM_A,
			VERSION_A,
			false,
		);
		expect(cachedRows(client, PROGRAM_A)[0]).toMatchObject({
			isActive: false,
			isLatest: false,
		});

		rollbackVersionLists(client, snapshot);

		expect(client.getQueryData(pageOneKey)).toEqual(pageOne);
		expect(client.getQueryData(pageTwoKey)).toEqual(pageTwo);
	});

	it("preserves a sibling activation reconciliation when another row rolls back", () => {
		const client = new QueryClient();
		const listKey = versionQueryKeys.list(PROGRAM_A, {
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		client.setQueryData(
			listKey,
			page([
				row(VERSION_A, PROGRAM_A, { isActive: false }),
				row(VERSION_B, PROGRAM_A, { isActive: true, isLatest: true }),
			]),
		);

		const failedSnapshot = patchVersionActivation(
			client,
			PROGRAM_A,
			VERSION_A,
			true,
		);
		patchVersionActivation(client, PROGRAM_A, VERSION_B, false);
		reconcileVersionActivation(
			client,
			detail(
				row(VERSION_B, PROGRAM_A),
				{ isActive: false, isLatest: false },
				ETAG_2,
			),
		);

		rollbackVersionLists(client, failedSnapshot);

		expect(cachedRows(client, PROGRAM_A)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					etag: ETAG_1,
					id: VERSION_A,
					isActive: false,
				}),
				expect.objectContaining({
					etag: ETAG_2,
					id: VERSION_B,
					isActive: false,
					isLatest: false,
				}),
			]),
		);
	});

	it("keeps the server latest flag authoritative instead of recomputing it locally", () => {
		const client = new QueryClient();
		const listKey = versionQueryKeys.list(PROGRAM_A, {
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		client.setQueryData(
			listKey,
			page([
				row(VERSION_A, PROGRAM_A, {
					isActive: false,
					versionNumber: "9.0.0",
				}),
				row(VERSION_B, PROGRAM_A, { isLatest: true }),
			]),
		);

		patchVersionActivation(client, PROGRAM_A, VERSION_A, true);
		reconcileVersionActivation(
			client,
			detail(row(VERSION_A, PROGRAM_A), {
				isActive: true,
				isLatest: false,
				versionNumber: "9.0.0",
			}),
		);

		expect(cachedRows(client, PROGRAM_A)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: VERSION_A, isLatest: false }),
				expect.objectContaining({ id: VERSION_B, isLatest: true }),
			]),
		);
	});

	it("refreshes only a stale exact detail and its program lists", async () => {
		const client = new QueryClient();
		const versionA = detail(row(VERSION_A, PROGRAM_A));
		const versionB = detail(row(VERSION_B, PROGRAM_A));
		const otherProgramVersion = detail(row(VERSION_C, PROGRAM_B));
		storeVersionDetail(client, versionA);
		storeVersionDetail(client, versionB);
		storeVersionDetail(client, otherProgramVersion);
		const programAList = versionQueryKeys.list(PROGRAM_A, {
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		const programBList = versionQueryKeys.list(PROGRAM_B, {
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		client.setQueryData(programAList, page([row(VERSION_A, PROGRAM_A)]));
		client.setQueryData(programBList, page([row(VERSION_C, PROGRAM_B)]));

		await refreshStaleVersion(client, PROGRAM_A, VERSION_A);

		expect(client.getQueryState(programAList)?.isInvalidated).toBe(true);
		expect(client.getQueryState(programBList)?.isInvalidated).toBe(false);
		expect(
			client.getQueryState(versionQueryKeys.detail(PROGRAM_A, VERSION_A))
				?.isInvalidated,
		).toBe(true);
		expect(
			client.getQueryState(versionQueryKeys.detail(PROGRAM_A, VERSION_B))
				?.isInvalidated,
		).toBe(false);

		await invalidateProgramVersions(client, PROGRAM_A);
		expect(
			client.getQueryState(versionQueryKeys.detail(PROGRAM_A, VERSION_B))
				?.isInvalidated,
		).toBe(true);
		expect(
			client.getQueryState(versionQueryKeys.detail(PROGRAM_B, VERSION_C))
				?.isInvalidated,
		).toBe(false);

		removeVersionDetail(client, PROGRAM_A, VERSION_A);
		expect(
			client.getQueryData(versionQueryKeys.detail(PROGRAM_A, VERSION_A)),
		).toBeUndefined();
	});
});
