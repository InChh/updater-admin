import { Elysia, type Static, t } from "elysia";

import type {
	FileDetailDto,
	FileListSearch,
	FileMetadataDto,
	FilePage,
} from "../../../shared/api/files";
import { FILE_MAX_PAGE } from "../../../shared/api/files";
import {
	createFilesService,
	FileNotFoundError,
	type FilesService,
	VersionsValidationError,
} from "../../domain/versions.server";
import type { ApiRequestContextStore } from "../context.server";
import { ApiProblemError } from "../problem";
import type { ExactWireShape } from "../schemas/alignment";

const FILE_PATH_TRANSPORT_MAX_LENGTH = 1024 * 2;
const FILE_MIME_TRANSPORT_MAX_LENGTH = 255 * 2;
const FILE_ETAG_TRANSPORT_MAX_LENGTH = 255 * 2;

export const fileMetadataSchema = t.Object(
	{
		checksumAlgorithm: t.Literal("sha256"),
		createdAt: t.String({ format: "date-time" }),
		id: t.String({ format: "uuid" }),
		mimeType: t.String({ maxLength: FILE_MIME_TRANSPORT_MAX_LENGTH }),
		objectEtag: t.Union([
			t.String({ maxLength: FILE_ETAG_TRANSPORT_MAX_LENGTH }),
			t.Null(),
		]),
		path: t.String({ maxLength: FILE_PATH_TRANSPORT_MAX_LENGTH, minLength: 1 }),
		sha256: t.String({ pattern: "^[0-9a-f]{64}$" }),
		size: t.String({ pattern: "^(0|[1-9][0-9]{0,18})$" }),
		updatedAt: t.String({ format: "date-time" }),
	},
	{ additionalProperties: false },
);

export const filePageSchema = t.Object(
	{
		items: t.Array(fileMetadataSchema),
		page: t.Integer({ minimum: 1 }),
		pageSize: t.Union([t.Literal(20), t.Literal(50), t.Literal(100)]),
		total: t.Integer({ minimum: 0 }),
	},
	{ additionalProperties: false },
);

export const fileListSearchSchema = t.Object(
	{
		page: t.Optional(t.Numeric({ maximum: FILE_MAX_PAGE, minimum: 1 })),
		pageSize: t.Optional(
			t.Union([t.Literal("20"), t.Literal("50"), t.Literal("100")]),
		),
		path: t.Optional(t.String({ maxLength: FILE_PATH_TRANSPORT_MAX_LENGTH })),
		sort: t.Optional(
			t.Union([
				t.Literal("path:asc"),
				t.Literal("path:desc"),
				t.Literal("createdAt:desc"),
				t.Literal("createdAt:asc"),
			]),
		),
	},
	{ additionalProperties: false },
);

const fileIdParamsSchema = t.Object(
	{ fileId: t.String({ format: "uuid" }) },
	{ additionalProperties: false },
);

type Assert<Condition extends true> = Condition;
type _FileSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof fileMetadataSchema>, FileMetadataDto>
>;
type _FileDetailSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof fileMetadataSchema>, FileDetailDto>
>;
type _FilePageSchemaMatchesDto = Assert<
	ExactWireShape<Static<typeof filePageSchema>, FilePage>
>;

export type FilesSchemaAlignment =
	| _FileSchemaMatchesDto
	| _FileDetailSchemaMatchesDto
	| _FilePageSchemaMatchesDto;

export interface FilesModuleDependencies {
	readonly contextStore: ApiRequestContextStore;
	readonly getFilesService?: () => FilesService;
}

function mapFilesError(error: unknown): never {
	if (error instanceof VersionsValidationError) {
		throw new ApiProblemError({
			code: "VALIDATION_FAILED",
			fieldErrors: error.fieldErrors,
			status: 422,
		});
	}
	if (error instanceof FileNotFoundError) {
		throw new ApiProblemError({ code: "NOT_FOUND", status: 404 });
	}
	throw error;
}

async function execute<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		return mapFilesError(error);
	}
}

function requireSession(
	contextStore: ApiRequestContextStore,
	request: Request,
): void {
	const context = contextStore.require(request);
	if (!context.session) throw new Error("Files route requires a session.");
}

export function createFilesModule({
	contextStore,
	getFilesService = () => createFilesService(),
}: FilesModuleDependencies) {
	return new Elysia({ name: "updater-admin.files" })
		.get(
			"/files",
			async ({ query, request }) => {
				requireSession(contextStore, request);
				const search: FileListSearch = {
					page: query.page ?? 1,
					pageSize: Number(query.pageSize ?? 20) as 20 | 50 | 100,
					...(query.path === undefined ? {} : { path: query.path }),
					sort: query.sort ?? "createdAt:desc",
				};
				const result = await execute(() => getFilesService().list(search));
				return { ...result, items: [...result.items] };
			},
			{
				query: fileListSearchSchema,
				response: { 200: filePageSchema },
			},
		)
		.get(
			"/files/:fileId",
			async ({ params, request, set }): Promise<FileDetailDto> => {
				requireSession(contextStore, request);
				const result = await execute(() =>
					getFilesService().getById(params.fileId),
				);
				set.headers.etag = result.etag;
				return result.data;
			},
			{
				params: fileIdParamsSchema,
				response: { 200: fileMetadataSchema },
			},
		);
}
