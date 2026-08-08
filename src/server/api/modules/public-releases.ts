import { Elysia, type Static, t } from "elysia";

import {
	PUBLIC_RELEASE_DOWNLOAD_REQUEST_MAX_ITEMS,
	PUBLIC_RELEASE_FILE_PAGE_MAX_SIZE,
	type PublicReleaseDownloadUrlsRequest,
	type PublicReleaseDownloadUrlsResponse,
	type PublicReleaseFileDto,
	type PublicReleaseFileMetadataDto,
	type PublicReleaseFilePageDto,
	type PublicReleaseFilePageSearch,
	type PublicReleaseHeaderDto,
	type PublicReleaseManifestDto,
} from "../../../shared/api/public-releases";
import {
	MAX_UPLOAD_MIME_TYPE_CODE_POINTS,
	MAX_UPLOAD_PATH_CODE_POINTS,
} from "../../../shared/api/uploads";
import {
	createPublicReleasesService,
	PUBLIC_RELEASE_CURSOR_MAX_LENGTH,
	PublicReleaseCursorError,
	PublicReleaseNotFoundError,
	type PublicReleasesService,
	type PublicReleasesV2Service,
} from "../../domain/public-releases.server";
import { ApiProblemError } from "../problem";
import type { ExactWireShape } from "../schemas/alignment";

const PUBLIC_RELEASE_PATH_TRANSPORT_MAX_LENGTH =
	MAX_UPLOAD_PATH_CODE_POINTS * 2;
const PUBLIC_RELEASE_MIME_TRANSPORT_MAX_LENGTH =
	MAX_UPLOAD_MIME_TYPE_CODE_POINTS * 2;

export const publicReleaseFileSchema = t.Object(
	{
		checksumAlgorithm: t.Literal("sha256"),
		downloadUrl: t.String({ format: "uri", maxLength: 8_192 }),
		mimeType: t.String({
			maxLength: PUBLIC_RELEASE_MIME_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
		path: t.String({
			maxLength: PUBLIC_RELEASE_PATH_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
		sha256: t.String({ pattern: "^[0-9a-f]{64}$" }),
		size: t.String({ maxLength: 20, pattern: "^(0|[1-9][0-9]*)$" }),
	},
	{ additionalProperties: false },
);

export const publicReleaseManifestSchema = t.Object(
	{
		description: t.String({ maxLength: 2_048 }),
		downloadExpiresAt: t.String({ format: "date-time" }),
		files: t.Array(publicReleaseFileSchema),
		programId: t.String({ format: "uuid" }),
		programName: t.String({ maxLength: 256, minLength: 1 }),
		publishedAt: t.String({ format: "date-time" }),
		versionNumber: t.String({
			maxLength: 20,
			pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
		}),
	},
	{ additionalProperties: false },
);

export const publicReleaseHeaderSchema = t.Object(
	{
		description: t.String({ maxLength: 2_048 }),
		fileCount: t.Integer({ minimum: 0 }),
		programName: t.String({ maxLength: 256, minLength: 1 }),
		publishedAt: t.String({ format: "date-time" }),
		versionNumber: t.String({
			maxLength: 20,
			pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
		}),
	},
	{ additionalProperties: false },
);

export const publicReleaseFileMetadataSchema = t.Object(
	{
		checksumAlgorithm: t.Literal("sha256"),
		mimeType: t.String({
			maxLength: PUBLIC_RELEASE_MIME_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
		path: t.String({
			maxLength: PUBLIC_RELEASE_PATH_TRANSPORT_MAX_LENGTH,
			minLength: 1,
		}),
		sha256: t.String({ pattern: "^[0-9a-f]{64}$" }),
		size: t.String({ maxLength: 20, pattern: "^(0|[1-9][0-9]*)$" }),
	},
	{ additionalProperties: false },
);

export const publicReleaseFilePageSearchSchema = t.Object(
	{
		cursor: t.Optional(
			t.String({ maxLength: PUBLIC_RELEASE_CURSOR_MAX_LENGTH, minLength: 1 }),
		),
		pageSize: t.Optional(
			t.Numeric({ maximum: PUBLIC_RELEASE_FILE_PAGE_MAX_SIZE, minimum: 1 }),
		),
	},
	{ additionalProperties: false },
);

export const publicReleaseFilePageSchema = t.Object(
	{
		items: t.Array(publicReleaseFileMetadataSchema, {
			maxItems: PUBLIC_RELEASE_FILE_PAGE_MAX_SIZE,
		}),
		nextCursor: t.Union([
			t.String({ maxLength: PUBLIC_RELEASE_CURSOR_MAX_LENGTH, minLength: 1 }),
			t.Null(),
		]),
		pageSize: t.Integer({
			maximum: PUBLIC_RELEASE_FILE_PAGE_MAX_SIZE,
			minimum: 1,
		}),
		versionNumber: t.String({
			maxLength: 20,
			pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
		}),
	},
	{ additionalProperties: false },
);

export const publicReleaseDownloadUrlsRequestSchema = t.Object(
	{
		files: t.Array(
			t.Object(
				{
					path: t.String({
						maxLength: PUBLIC_RELEASE_PATH_TRANSPORT_MAX_LENGTH,
						minLength: 1,
					}),
					sha256: t.String({ pattern: "^[0-9a-f]{64}$" }),
				},
				{ additionalProperties: false },
			),
			{
				maxItems: PUBLIC_RELEASE_DOWNLOAD_REQUEST_MAX_ITEMS,
				minItems: 1,
			},
		),
	},
	{ additionalProperties: false },
);

export const publicReleaseDownloadUrlsResponseSchema = t.Object(
	{
		downloadExpiresAt: t.String({ format: "date-time" }),
		files: t.Array(
			t.Object(
				{
					downloadUrl: t.String({ format: "uri", maxLength: 8_192 }),
					path: t.String({
						maxLength: PUBLIC_RELEASE_PATH_TRANSPORT_MAX_LENGTH,
						minLength: 1,
					}),
					sha256: t.String({ pattern: "^[0-9a-f]{64}$" }),
				},
				{ additionalProperties: false },
			),
			{ maxItems: PUBLIC_RELEASE_DOWNLOAD_REQUEST_MAX_ITEMS },
		),
	},
	{ additionalProperties: false },
);

const publicProgramParamsSchema = t.Object(
	{ programId: t.String({ format: "uuid" }) },
	{ additionalProperties: false },
);

const publicVersionParamsSchema = t.Object(
	{
		programId: t.String({ format: "uuid" }),
		// Canonical numeric validation is domain-owned so malformed versions share
		// the same enumeration-resistant NOT_FOUND response as unavailable ones.
		versionNumber: t.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);

type Assert<Condition extends true> = Condition;
type _FileSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof publicReleaseFileSchema>, PublicReleaseFileDto>
>;
type _ManifestSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof publicReleaseManifestSchema>,
		PublicReleaseManifestDto
	>
>;
type _HeaderSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof publicReleaseHeaderSchema>,
		PublicReleaseHeaderDto
	>
>;
type _MetadataSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof publicReleaseFileMetadataSchema>,
		PublicReleaseFileMetadataDto
	>
>;
type _PageSearchSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof publicReleaseFilePageSearchSchema>,
		PublicReleaseFilePageSearch
	>
>;
type _PageSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof publicReleaseFilePageSchema>,
		PublicReleaseFilePageDto
	>
>;
type _DownloadRequestSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof publicReleaseDownloadUrlsRequestSchema>,
		PublicReleaseDownloadUrlsRequest
	>
>;
type _DownloadResponseSchemaMatchesDto = Assert<
	ExactWireShape<
		Static<typeof publicReleaseDownloadUrlsResponseSchema>,
		PublicReleaseDownloadUrlsResponse
	>
>;

export type PublicReleasesSchemaAlignment =
	| _FileSchemaMatchesDto
	| _ManifestSchemaMatchesDto
	| _HeaderSchemaMatchesDto
	| _MetadataSchemaMatchesDto
	| _PageSearchSchemaMatchesDto
	| _PageSchemaMatchesDto
	| _DownloadRequestSchemaMatchesDto
	| _DownloadResponseSchemaMatchesDto;

export interface PublicReleasesModuleDependencies {
	readonly getPublicReleasesService?: () => PublicReleasesService;
}

export interface PublicReleasesV2ModuleDependencies {
	readonly getPublicReleasesV2Service?: () => PublicReleasesV2Service;
}

function mapPublicReleaseError(error: unknown): never {
	if (error instanceof PublicReleaseNotFoundError) {
		throw new ApiProblemError({ code: "NOT_FOUND", status: 404 });
	}
	if (error instanceof PublicReleaseCursorError) {
		throw new ApiProblemError({ code: "BAD_REQUEST", status: 400 });
	}
	throw error;
}

async function execute<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		return mapPublicReleaseError(error);
	}
}

function wireManifest(manifest: PublicReleaseManifestDto) {
	return {
		...manifest,
		files: manifest.files.map((file) => ({ ...file })),
	};
}

function wireFilePage(page: PublicReleaseFilePageDto) {
	return {
		...page,
		items: page.items.map((file) => ({ ...file })),
	};
}

function wireDownloadUrls(response: PublicReleaseDownloadUrlsResponse) {
	return {
		...response,
		files: response.files.map((file) => ({ ...file })),
	};
}

/** Existing public v1 manifest routes. */
export function createPublicReleasesModule({
	getPublicReleasesService = () => createPublicReleasesService(),
}: PublicReleasesModuleDependencies = {}) {
	return new Elysia({ name: "updater-admin.public-releases" })
		.get(
			"/programs/:programId/releases/latest",
			async ({ params }) =>
				wireManifest(
					await execute(() =>
						getPublicReleasesService().getLatest(params.programId),
					),
				),
			{
				params: publicProgramParamsSchema,
				response: { 200: publicReleaseManifestSchema },
			},
		)
		.get(
			"/programs/:programId/releases/:versionNumber",
			async ({ params }) =>
				wireManifest(
					await execute(() =>
						getPublicReleasesService().getByVersionNumber(
							params.programId,
							params.versionNumber,
						),
					),
				),
			{
				params: publicVersionParamsSchema,
				response: { 200: publicReleaseManifestSchema },
			},
		);
}

/** Additive public v2 metadata traversal and selective signing routes. */
export function createPublicReleasesV2Module({
	getPublicReleasesV2Service = () => createPublicReleasesService(),
}: PublicReleasesV2ModuleDependencies = {}) {
	return new Elysia({ name: "updater-admin.public-releases-v2" })
		.get(
			"/programs/:programId/releases/latest",
			async ({ params }) =>
				execute(() =>
					getPublicReleasesV2Service().getLatestHeader(params.programId),
				),
			{
				params: publicProgramParamsSchema,
				response: { 200: publicReleaseHeaderSchema },
			},
		)
		.get(
			"/programs/:programId/releases/:versionNumber/files",
			async ({ params, query }) =>
				wireFilePage(
					await execute(() =>
						getPublicReleasesV2Service().getFilePage(
							params.programId,
							params.versionNumber,
							query,
						),
					),
				),
			{
				params: publicVersionParamsSchema,
				query: publicReleaseFilePageSearchSchema,
				response: { 200: publicReleaseFilePageSchema },
			},
		)
		.post(
			"/programs/:programId/releases/:versionNumber/download-urls",
			async ({ body, params }) =>
				wireDownloadUrls(
					await execute(() =>
						getPublicReleasesV2Service().getDownloadUrls(
							params.programId,
							params.versionNumber,
							body,
						),
					),
				),
			{
				body: publicReleaseDownloadUrlsRequestSchema,
				params: publicVersionParamsSchema,
				response: { 200: publicReleaseDownloadUrlsResponseSchema },
			},
		)
		.get(
			"/programs/:programId/releases/:versionNumber",
			async ({ params }) =>
				execute(() =>
					getPublicReleasesV2Service().getHeaderByVersionNumber(
						params.programId,
						params.versionNumber,
					),
				),
			{
				params: publicVersionParamsSchema,
				response: { 200: publicReleaseHeaderSchema },
			},
		);
}
