import { describe, expect, it } from "vitest";

import {
	type CreateDraftVersionInput,
	type DraftVersionDto,
	type FinalizeDraftVersionRequest,
	type FinalizeDraftVersionResponse,
	type SetVersionActivationInput,
	type UpdateVersionInput,
	VERSION_FILE_PAGE_DEFAULT_SIZE,
	VERSION_FILE_PAGE_MAX_SIZE,
	VERSION_LIFECYCLE_STATUSES,
	VERSION_MAX_PAGE,
	VERSION_PAGE_SIZES,
	VERSION_SORTS,
} from "./versions";

const CREATED_AT = "2026-08-06T00:00:00.000Z";
const FINALIZED_AT = "2026-08-06T00:05:00.000Z";
const PROGRAM_ID = "9868f293-fbdf-4ed6-a845-8300c02d57c4";
const VERSION_ID = "50266132-abdd-41db-82d0-794cfbb37a6b";

type HasFileIdsKey<T> = "fileIds" extends keyof T ? true : false;
type FinalizeAcceptsFileIds = {
	readonly fileIds: readonly string[];
} extends FinalizeDraftVersionRequest
	? true
	: false;

const CREATE_DRAFT_HAS_FILE_IDS: HasFileIdsKey<CreateDraftVersionInput> = false;
const UPDATE_VERSION_HAS_FILE_IDS: HasFileIdsKey<UpdateVersionInput> = false;
const FINALIZE_ACCEPTS_FILE_IDS: FinalizeAcceptsFileIds = false;

function draftVersion(): DraftVersionDto {
	return {
		associatedFileCount: 10_000,
		createdAt: CREATED_AT,
		description: "Large release draft",
		etag: 'W/"1"',
		expectedFileCount: 10_001,
		fileCount: 10_000,
		finalizedAt: null,
		id: VERSION_ID,
		isActive: false,
		isLatest: false,
		lifecycleStatus: "draft",
		programId: PROGRAM_ID,
		updatedAt: CREATED_AT,
		versionNumber: "1.2.3",
	};
}

describe("version API contract", () => {
	it("keeps sorting and every page bound scoped to one request", () => {
		expect(VERSION_SORTS).toEqual(["createdAt:desc", "createdAt:asc"]);
		expect(VERSION_PAGE_SIZES).toEqual([20, 50, 100]);
		expect(VERSION_MAX_PAGE).toBe(1_000_000);
		expect(VERSION_FILE_PAGE_DEFAULT_SIZE).toBe(200);
		expect(VERSION_FILE_PAGE_MAX_SIZE).toBe(500);
	});

	it("creates a draft from an expected count without a complete file ID array", () => {
		const input: CreateDraftVersionInput = {
			description: "Large release draft",
			expectedFileCount: 10_001,
			versionNumber: "1.2.3",
		};

		expect(input.expectedFileCount).toBe(10_001);
		expect(input).not.toHaveProperty("fileIds");
		expect(CREATE_DRAFT_HAS_FILE_IDS).toBe(false);
	});

	it("exposes draft lifecycle and resumable association counts", () => {
		const draft = draftVersion();

		expect(VERSION_LIFECYCLE_STATUSES).toEqual(["draft", "finalized"]);
		expect(draft).toMatchObject({
			associatedFileCount: 10_000,
			expectedFileCount: 10_001,
			fileCount: 10_000,
			finalizedAt: null,
			isActive: false,
			lifecycleStatus: "draft",
		});
		expect(draft).not.toHaveProperty("fileIds");
	});

	it("limits metadata updates to version fields", () => {
		const descriptionUpdate: UpdateVersionInput = {
			description: "Updated release notes",
		};
		const versionNumberUpdate: UpdateVersionInput = {
			versionNumber: "1.2.4",
		};

		expect(descriptionUpdate).toEqual({
			description: "Updated release notes",
		});
		expect(versionNumberUpdate).toEqual({ versionNumber: "1.2.4" });
		expect(UPDATE_VERSION_HAS_FILE_IDS).toBe(false);
	});

	it("finalizes without transporting file membership", () => {
		const request: FinalizeDraftVersionRequest = {};
		const response: FinalizeDraftVersionResponse = {
			associatedFileCount: 10_001,
			createdAt: CREATED_AT,
			description: "Large release draft",
			expectedFileCount: 10_001,
			fileCount: 10_001,
			finalizedAt: FINALIZED_AT,
			id: VERSION_ID,
			isActive: false,
			isLatest: false,
			lifecycleStatus: "finalized",
			programId: PROGRAM_ID,
			updatedAt: FINALIZED_AT,
			versionNumber: "1.2.3",
		};

		expect(request).toEqual({});
		expect(response).toMatchObject({
			associatedFileCount: 10_001,
			fileCount: 10_001,
			finalizedAt: FINALIZED_AT,
			lifecycleStatus: "finalized",
		});
		expect(response).not.toHaveProperty("fileIds");
		expect(FINALIZE_ACCEPTS_FILE_IDS).toBe(false);
	});

	it("uses an explicit boolean activation body", () => {
		const input: SetVersionActivationInput = { isActive: false };
		expect(input).toEqual({ isActive: false });
	});
});
