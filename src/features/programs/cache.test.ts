import { QueryClient } from "@tanstack/solid-query";
import { describe, expect, it } from "vitest";

import { programQueryKeys } from "../../lib/api/query-keys";
import type { EntityResult } from "../../shared/api/common";
import type { ProgramDetailDto } from "../../shared/api/programs";
import {
	invalidateProgramLists,
	refreshStaleProgram,
	removeProgramDetail,
	storeProgramDetail,
} from "./cache";

const PROGRAM_A = "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501";
const PROGRAM_B = "4b3a970a-7379-4ef1-a2fa-45483c2bc469";

function entity(id: string): EntityResult<ProgramDetailDto> {
	return {
		data: {
			createdAt: "2026-07-15T00:00:00.000Z",
			description: null,
			id,
			name: id === PROGRAM_A ? "A" : "B",
			updatedAt: "2026-07-15T00:00:00.000Z",
			versionCount: 0,
		},
		etag: 'W/"1"',
	};
}

describe("program cache boundaries", () => {
	it("invalidates only program lists after ordinary mutations", async () => {
		const client = new QueryClient();
		const listKey = programQueryKeys.list({
			page: 1,
			pageSize: 20,
			sort: "createdAt:desc",
		});
		client.setQueryData(listKey, {
			items: [],
			page: 1,
			pageSize: 20,
			total: 0,
		});
		client.setQueryData(programQueryKeys.detail(PROGRAM_A), entity(PROGRAM_A));

		await invalidateProgramLists(client);

		expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
		expect(
			client.getQueryState(programQueryKeys.detail(PROGRAM_A))?.isInvalidated,
		).toBe(false);
	});

	it("refreshes the stale detail and lists without touching sibling details", async () => {
		const client = new QueryClient();
		storeProgramDetail(client, entity(PROGRAM_A));
		storeProgramDetail(client, entity(PROGRAM_B));
		client.setQueryData(
			programQueryKeys.list({
				page: 1,
				pageSize: 20,
				sort: "createdAt:desc",
			}),
			{ items: [], page: 1, pageSize: 20, total: 0 },
		);

		await refreshStaleProgram(client, PROGRAM_A);

		expect(
			client.getQueryState(programQueryKeys.detail(PROGRAM_A))?.isInvalidated,
		).toBe(true);
		expect(
			client.getQueryState(programQueryKeys.detail(PROGRAM_B))?.isInvalidated,
		).toBe(false);
		removeProgramDetail(client, PROGRAM_A);
		expect(
			client.getQueryData(programQueryKeys.detail(PROGRAM_A)),
		).toBeUndefined();
	});
});
