import type { QueryClient, QueryKey } from "@tanstack/solid-query";

import { versionQueryKeys } from "../../lib/api/query-keys";
import type { EntityResult } from "../../shared/api/common";
import type {
	VersionDetailDto,
	VersionListItemDto,
	VersionPage,
} from "../../shared/api/versions";

interface VersionListSnapshotEntry {
	readonly queryKey: QueryKey;
	readonly row: VersionListItemDto;
}

export interface VersionListSnapshot {
	readonly programId: string;
	readonly queries: readonly VersionListSnapshotEntry[];
}

function toVersionListItem(
	version: EntityResult<VersionDetailDto>,
): VersionListItemDto {
	const { data, etag } = version;
	return {
		createdAt: data.createdAt,
		description: data.description,
		etag,
		fileCount: data.fileCount,
		id: data.id,
		isActive: data.isActive,
		isLatest: data.isLatest,
		programId: data.programId,
		updatedAt: data.updatedAt,
		versionNumber: data.versionNumber,
	};
}

function updateVersionLists(
	queryClient: QueryClient,
	programId: string,
	update: (row: VersionListItemDto) => VersionListItemDto,
): void {
	queryClient.setQueriesData<VersionPage>(
		{ queryKey: versionQueryKeys.lists(programId) },
		(page) => {
			if (!page) return page;
			let changed = false;
			const items = page.items.map((row) => {
				const next = update(row);
				changed ||= next !== row;
				return next;
			});
			return changed ? { ...page, items } : page;
		},
	);
}

export function storeVersionDetail(
	queryClient: QueryClient,
	version: EntityResult<VersionDetailDto>,
): void {
	queryClient.setQueryData(
		versionQueryKeys.detail(version.data.programId, version.data.id),
		version,
	);
}

export function removeVersionDetail(
	queryClient: QueryClient,
	programId: string,
	versionId: string,
): void {
	queryClient.removeQueries({
		exact: true,
		queryKey: versionQueryKeys.detail(programId, versionId),
	});
}

export function invalidateVersionLists(
	queryClient: QueryClient,
	programId: string,
) {
	return queryClient.invalidateQueries({
		queryKey: versionQueryKeys.lists(programId),
	});
}

export function invalidateVersionDetails(
	queryClient: QueryClient,
	programId: string,
) {
	return queryClient.invalidateQueries({
		queryKey: versionQueryKeys.details(programId),
	});
}

export async function invalidateProgramVersions(
	queryClient: QueryClient,
	programId: string,
): Promise<void> {
	await Promise.all([
		invalidateVersionLists(queryClient, programId),
		invalidateVersionDetails(queryClient, programId),
	]);
}

export async function refreshStaleVersion(
	queryClient: QueryClient,
	programId: string,
	versionId: string,
): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({
			exact: true,
			queryKey: versionQueryKeys.detail(programId, versionId),
		}),
		invalidateVersionLists(queryClient, programId),
	]);
}

export function snapshotVersionLists(
	queryClient: QueryClient,
	programId: string,
	versionId: string,
): VersionListSnapshot {
	const queries = queryClient
		.getQueriesData<VersionPage>({
			queryKey: versionQueryKeys.lists(programId),
		})
		.flatMap(([queryKey, data]) => {
			const row = data?.items.find(({ id }) => id === versionId);
			return row ? [{ queryKey, row }] : [];
		});
	return { programId, queries };
}

export function patchVersionActivation(
	queryClient: QueryClient,
	programId: string,
	versionId: string,
	isActive: boolean,
): VersionListSnapshot {
	const snapshot = snapshotVersionLists(queryClient, programId, versionId);
	updateVersionLists(queryClient, programId, (row) => {
		if (row.id !== versionId) return row;
		return {
			...row,
			isActive,
			isLatest: isActive ? row.isLatest : false,
		};
	});
	return snapshot;
}

export function rollbackVersionLists(
	queryClient: QueryClient,
	snapshot: VersionListSnapshot,
): void {
	for (const { queryKey, row: previousRow } of snapshot.queries) {
		queryClient.setQueryData<VersionPage>(queryKey, (current) => {
			if (!current) return current;
			let changed = false;
			const items = current.items.map((row) => {
				if (row.id !== previousRow.id) return row;
				changed = true;
				return previousRow;
			});
			return changed ? { ...current, items } : current;
		});
	}
}

export function reconcileVersionActivation(
	queryClient: QueryClient,
	version: EntityResult<VersionDetailDto>,
): void {
	storeVersionDetail(queryClient, version);
	const serverRow = toVersionListItem(version);

	updateVersionLists(queryClient, serverRow.programId, (row) => {
		if (row.id === serverRow.id) return serverRow;
		if (serverRow.isLatest && row.isLatest) {
			return { ...row, isLatest: false };
		}
		return row;
	});

	if (!serverRow.isLatest) return;
	queryClient.setQueriesData<EntityResult<VersionDetailDto>>(
		{ queryKey: versionQueryKeys.details(serverRow.programId) },
		(cached) => {
			if (!cached || cached.data.id === serverRow.id || !cached.data.isLatest) {
				return cached;
			}
			return { ...cached, data: { ...cached.data, isLatest: false } };
		},
	);
}
