import { expect, type Route, test } from "@playwright/test";
import type { HashWorkerTask } from "../../src/features/versions/hash-worker";
import type { OssMultipartUploadInput } from "../../src/features/versions/oss-uploader.client";
import { createUploadQueueController } from "../../src/features/versions/upload-store";
import { createUploadWorkflow } from "../../src/features/versions/upload-workflow.client";
import type { FileMetadataDto } from "../../src/shared/api/files";
import type {
	ProgramDetailDto,
	ProgramListItemDto,
} from "../../src/shared/api/programs";
import type {
	PublicReleaseDownloadFileInput,
	PublicReleaseDownloadUrlsResponse,
	PublicReleaseFileMetadataDto,
	PublicReleaseFilePageDto,
	PublicReleaseHeaderDto,
} from "../../src/shared/api/public-releases";
import {
	type CompleteUploadItemInput,
	type CompleteUploadsRequest,
	MAX_COMPLETE_UPLOAD_FILES,
	MAX_RESOLVE_DRAFT_FILES,
	type ResolveDraftFilesRequest,
	type UploadCredentialsResponse,
	type UploadFileMetadataInput,
} from "../../src/shared/api/uploads";
import type {
	VersionDetailDto,
	VersionListItemDto,
} from "../../src/shared/api/versions";
import {
	createScaleReleaseMetadata,
	incrementalReleaseFixtureDirectory,
	loadIncrementalReleaseFixture,
	SCALE_RELEASE_FILE_COUNT,
} from "../fixtures/version-incremental-upload";
import {
	AUTHENTICATED_E2E_SKIP_REASON,
	fulfillJson,
	HAS_E2E_ADMIN_CREDENTIALS,
	parseRequestBody,
	signIn,
} from "./support";

const PROGRAM_ID = "71111111-1111-4111-8111-111111111111";
const V1_ID = "72222222-2222-4222-8222-222222222222";
const V2_ID = "73333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-08-07T02:00:00.000Z";
const OSS_ORIGIN = "https://updater-e2e.oss-cn-hangzhou.aliyuncs.com";
const SCALE_HASH = "a".repeat(64);

interface ObservedIncrementalRequests {
	readonly activations: unknown[];
	readonly completions: unknown[];
	readonly credentials: unknown[];
	readonly drafts: unknown[];
	readonly finalizations: unknown[];
	readonly ossPuts: string[];
	readonly publicDownloads: unknown[];
	readonly resolves: unknown[];
	readonly unexpected: string[];
}

function weakEtag(revision: number): `W/"${bigint}"` {
	return `W/"${BigInt(revision)}"`;
}

function versionDetail(version: VersionListItemDto): VersionDetailDto {
	const { etag: _etag, ...detail } = version;
	return detail;
}

function uploadFiles(
	body: Readonly<Record<string, unknown>>,
): readonly UploadFileMetadataInput[] {
	return Array.isArray(body.files)
		? (body.files as readonly UploadFileMetadataInput[])
		: [];
}

function completedFiles(
	body: Readonly<Record<string, unknown>>,
): readonly CompleteUploadItemInput[] {
	return Array.isArray(body.files)
		? (body.files as readonly CompleteUploadItemInput[])
		: [];
}

function requestedDownloads(
	body: Readonly<Record<string, unknown>>,
): readonly PublicReleaseDownloadFileInput[] {
	return Array.isArray(body.files)
		? (body.files as readonly PublicReleaseDownloadFileInput[])
		: [];
}

function identitiesMatch(
	left: UploadFileMetadataInput,
	right: UploadFileMetadataInput,
): boolean {
	return (
		left.path === right.path &&
		left.sha256 === right.sha256 &&
		left.size === right.size
	);
}

function metadata(file: UploadFileMetadataInput, id: string): FileMetadataDto {
	return {
		checksumAlgorithm: "sha256",
		createdAt: CREATED_AT,
		id,
		mimeType: file.mimeType,
		path: file.path,
		sha256: file.sha256,
		size: file.size,
		updatedAt: CREATED_AT,
	};
}

async function fulfillOss(
	route: Route,
	observed: ObservedIncrementalRequests,
): Promise<void> {
	const request = route.request();
	const requestUrl = new URL(request.url());
	const origin = request.headers().origin ?? "http://127.0.0.1:3187";
	const corsHeaders = {
		"access-control-allow-headers":
			request.headers()["access-control-request-headers"] ?? "*",
		"access-control-allow-methods": "PUT, POST, DELETE, OPTIONS",
		"access-control-allow-origin": origin,
		"access-control-expose-headers": "ETag, x-oss-request-id",
	};

	if (request.method() === "OPTIONS") {
		await route.fulfill({ headers: corsHeaders, status: 204 });
		return;
	}
	if (request.method() === "PUT") {
		observed.ossPuts.push(decodeURIComponent(requestUrl.pathname));
		await route.fulfill({
			body: "",
			headers: {
				...corsHeaders,
				etag: '"e2e-object-etag"',
				"x-oss-request-id": "e2e-oss-part",
			},
			status: 200,
		});
		return;
	}
	if (request.method() === "POST" && requestUrl.searchParams.has("uploads")) {
		await route.fulfill({
			body: `<?xml version="1.0" encoding="UTF-8"?>
<InitiateMultipartUploadResult>
  <Bucket>updater-e2e</Bucket>
  <Key>${requestUrl.pathname.slice(1)}</Key>
  <UploadId>e2e-upload-id</UploadId>
</InitiateMultipartUploadResult>`,
			contentType: "application/xml",
			headers: corsHeaders,
			status: 200,
		});
		return;
	}
	if (request.method() === "POST" && requestUrl.searchParams.has("uploadId")) {
		await route.fulfill({
			body: `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUploadResult>
  <Location>${request.url()}</Location>
  <Bucket>updater-e2e</Bucket>
  <Key>${requestUrl.pathname.slice(1)}</Key>
  <ETag>&quot;e2e-object-etag&quot;</ETag>
</CompleteMultipartUploadResult>`,
			contentType: "application/xml",
			headers: {
				...corsHeaders,
				etag: '"e2e-object-etag"',
				"x-oss-request-id": "e2e-oss-complete",
			},
			status: 200,
		});
		return;
	}

	observed.unexpected.push(`${request.method()} ${requestUrl.pathname}`);
	await route.fulfill({ headers: corsHeaders, status: 405 });
}

function scaleHashTask(itemId: string): HashWorkerTask {
	return {
		cancel: () => {},
		jobId: itemId,
		promise: Promise.resolve(SCALE_HASH),
	};
}

function scaleCredentials(): UploadCredentialsResponse {
	return {
		bucket: "updater-e2e",
		credentials: {
			accessKeyId: "scale-e2e-key",
			accessKeySecret: "scale-e2e-secret",
			expiration: "2099-12-31T23:59:59.000Z",
			securityToken: "scale-e2e-token",
		},
		region: "oss-cn-hangzhou",
		uploadPrefix: "scale-e2e/",
	};
}

function scaleCompletionResponse(request: CompleteUploadsRequest) {
	return {
		files: request.files.map((file, index) => ({
			checksumAlgorithm: "sha256" as const,
			createdAt: CREATED_AT,
			id: `scale-metadata-${index}`,
			mimeType: file.mimeType,
			path: file.path,
			sha256: file.sha256,
			size: file.size,
			updatedAt: CREATED_AT,
		})),
	};
}

test("drives 10,001 files through real resolve and completion batching without DOM rows", async () => {
	const metadataFixture = createScaleReleaseMetadata();
	const queue = createUploadQueueController({ storage: null });
	queue.addFiles(
		metadataFixture.map(({ mimeType, path }) => ({
			file: new File(["x"], path.split("/").at(-1) ?? path, { type: mimeType }),
			path,
		})),
	);
	const resolveRequests: ResolveDraftFilesRequest[] = [];
	const completionRequests: CompleteUploadsRequest[] = [];
	const credentialRequests: object[] = [];
	const uploads: OssMultipartUploadInput[] = [];
	const workflow = createUploadWorkflow(queue, {
		completeUploads: async (request) => {
			completionRequests.push(request);
			return scaleCompletionResponse(request);
		},
		requestCredentials: async (request) => {
			credentialRequests.push(request);
			return scaleCredentials();
		},
		resolveFiles: async (request) => {
			resolveRequests.push(request);
			return {
				files: request.files.map(({ path }) => ({
					path,
					status: "uploadRequired",
				})),
			};
		},
		startHashTask: ({ itemId }) => scaleHashTask(itemId),
		startUploadTask: (input) => {
			uploads.push(input);
			return {
				cancel: () => {},
				promise: Promise.resolve({
					objectKey: input.objectKey,
				}),
			};
		},
	});
	workflow.setDraft({ programId: PROGRAM_ID, versionId: V2_ID });

	try {
		await workflow.start();

		expect(metadataFixture).toHaveLength(SCALE_RELEASE_FILE_COUNT);
		expect(resolveRequests).toHaveLength(
			Math.ceil(SCALE_RELEASE_FILE_COUNT / MAX_RESOLVE_DRAFT_FILES),
		);
		expect(
			resolveRequests.reduce((sum, request) => sum + request.files.length, 0),
		).toBe(SCALE_RELEASE_FILE_COUNT);
		expect(
			Math.max(...resolveRequests.map((request) => request.files.length)),
		).toBe(MAX_RESOLVE_DRAFT_FILES);
		expect(
			resolveRequests.every(
				(request) => request.files.length < SCALE_RELEASE_FILE_COUNT,
			),
		).toBe(true);
		expect(completionRequests).toHaveLength(
			Math.ceil(SCALE_RELEASE_FILE_COUNT / MAX_COMPLETE_UPLOAD_FILES),
		);
		expect(
			completionRequests.reduce(
				(sum, request) => sum + request.files.length,
				0,
			),
		).toBe(SCALE_RELEASE_FILE_COUNT);
		expect(
			Math.max(...completionRequests.map((request) => request.files.length)),
		).toBe(MAX_COMPLETE_UPLOAD_FILES);
		expect(
			completionRequests.every(
				(request) => request.files.length < SCALE_RELEASE_FILE_COUNT,
			),
		).toBe(true);
		expect(credentialRequests).toEqual([{}]);
		expect(uploads).toHaveLength(SCALE_RELEASE_FILE_COUNT);
		expect(
			queue.getState().items.every(({ status }) => status === "complete"),
		).toBe(true);
	} finally {
		workflow.dispose();
		queue.dispose();
	}
});

test.describe("incremental draft upload and public v2 manifest", () => {
	test.skip(!HAS_E2E_ADMIN_CREDENTIALS, AUTHENTICATED_E2E_SKIP_REASON);

	test("reuses A, uploads B-prime and C, omits D, activates v2, and publishes a complete manifest", async ({
		page,
	}) => {
		const v1Fixture = loadIncrementalReleaseFixture("v1");
		const v2Fixture = loadIncrementalReleaseFixture("v2");
		const previousFiles = new Map(
			v1Fixture.map((file, index) => [
				file.path,
				metadata(
					file,
					`74444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
				),
			]),
		);
		const associatedFiles = new Map<string, FileMetadataDto>();
		const programName = "Incremental upload E2E program";
		let v2: VersionListItemDto | null = null;
		const observed: ObservedIncrementalRequests = {
			activations: [],
			completions: [],
			credentials: [],
			drafts: [],
			finalizations: [],
			ossPuts: [],
			publicDownloads: [],
			resolves: [],
			unexpected: [],
		};
		const program: ProgramDetailDto = {
			createdAt: CREATED_AT,
			description: "Seeded with finalized v1 A/B/D metadata.",
			id: PROGRAM_ID,
			name: programName,
			updatedAt: CREATED_AT,
			versionCount: 1,
		};
		const programListItem: ProgramListItemDto = {
			createdAt: program.createdAt,
			description: program.description,
			etag: weakEtag(1),
			id: program.id,
			name: program.name,
			updatedAt: program.updatedAt,
		};
		const v1: VersionListItemDto = {
			associatedFileCount: 3,
			createdAt: CREATED_AT,
			description: "Prior complete A/B/D release",
			etag: weakEtag(1),
			expectedFileCount: 3,
			fileCount: 3,
			finalizedAt: CREATED_AT,
			id: V1_ID,
			isActive: true,
			isLatest: true,
			lifecycleStatus: "finalized",
			programId: PROGRAM_ID,
			updatedAt: CREATED_AT,
			versionNumber: "1.0.0",
		};

		await page.route("**/api/v1/**", async (route) => {
			const request = route.request();
			const method = request.method();
			const { pathname, searchParams } = new URL(request.url());
			const versionsPath = `/api/v1/programs/${PROGRAM_ID}/versions`;

			if (method === "GET" && pathname === "/api/v1/settings/system") {
				await fulfillJson(
					route,
					{
						defaultLocale: "zh-CN",
						defaultPageSize: 20,
						repositoryUrl: null,
						systemName: "Incremental E2E",
					},
					{ etag: weakEtag(1) },
				);
				return;
			}
			if (method === "GET" && pathname === "/api/v1/programs") {
				await fulfillJson(route, {
					items: [programListItem],
					page: Number(searchParams.get("page") ?? 1),
					pageSize: Number(searchParams.get("pageSize") ?? 20),
					total: 1,
				});
				return;
			}
			if (method === "GET" && pathname === `/api/v1/programs/${PROGRAM_ID}`) {
				await fulfillJson(
					route,
					{ ...program, versionCount: v2 ? 2 : 1 },
					{ etag: weakEtag(1) },
				);
				return;
			}
			if (method === "GET" && pathname === versionsPath) {
				await fulfillJson(route, {
					items: v2 ? [v2, v1] : [v1],
					page: Number(searchParams.get("page") ?? 1),
					pageSize: Number(searchParams.get("pageSize") ?? 20),
					total: v2 ? 2 : 1,
				});
				return;
			}
			if (method === "POST" && pathname === `${versionsPath}/drafts`) {
				const body = parseRequestBody(request.postData());
				observed.drafts.push(body);
				v2 = {
					associatedFileCount: 0,
					createdAt: CREATED_AT,
					description: String(body.description ?? ""),
					etag: weakEtag(1),
					expectedFileCount: Number(body.expectedFileCount),
					fileCount: 0,
					finalizedAt: null,
					id: V2_ID,
					isActive: false,
					isLatest: false,
					lifecycleStatus: "draft",
					programId: PROGRAM_ID,
					updatedAt: CREATED_AT,
					versionNumber: String(body.versionNumber),
				};
				await fulfillJson(route, versionDetail(v2), { etag: v2.etag });
				return;
			}
			if (
				method === "POST" &&
				pathname === `${versionsPath}/${V2_ID}/files/resolve`
			) {
				const body = parseRequestBody(request.postData());
				const files = uploadFiles(body);
				observed.resolves.push(body);
				await fulfillJson(route, {
					files: files.map((file) => {
						const candidate = previousFiles.get(file.path);
						if (candidate && identitiesMatch(file, candidate)) {
							associatedFiles.set(file.path, candidate);
							return { path: file.path, status: "reused" };
						}
						return { path: file.path, status: "uploadRequired" };
					}),
				});
				return;
			}
			if (method === "POST" && pathname === "/api/v1/uploads/credentials") {
				const body = parseRequestBody(request.postData());
				observed.credentials.push(body);
				await fulfillJson(route, {
					bucket: "updater-e2e",
					credentials: {
						accessKeyId: "incremental-e2e-key",
						accessKeySecret: "incremental-e2e-secret",
						expiration: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
						securityToken: "incremental-e2e-token",
					},
					region: "oss-cn-hangzhou",
					uploadPrefix: "incremental-e2e/",
				});
				return;
			}
			if (
				method === "POST" &&
				pathname === `${versionsPath}/${V2_ID}/files/complete`
			) {
				const body = parseRequestBody(request.postData());
				const completed = completedFiles(body).map((file, index) =>
					metadata(
						file,
						`75555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
					),
				);
				observed.completions.push(body);
				for (const file of completed) associatedFiles.set(file.path, file);
				if (v2) {
					v2 = {
						...v2,
						associatedFileCount: associatedFiles.size,
						fileCount: associatedFiles.size,
					};
				}
				await fulfillJson(route, { files: completed });
				return;
			}
			if (
				method === "POST" &&
				pathname === `${versionsPath}/${V2_ID}/finalize` &&
				v2
			) {
				const body = parseRequestBody(request.postData());
				observed.finalizations.push(body);
				v2 = {
					...v2,
					etag: weakEtag(2),
					finalizedAt: new Date().toISOString(),
					lifecycleStatus: "finalized",
					updatedAt: new Date().toISOString(),
				};
				await fulfillJson(route, versionDetail(v2), { etag: v2.etag });
				return;
			}
			if (
				method === "PUT" &&
				pathname === `${versionsPath}/${V2_ID}/activation` &&
				v2
			) {
				const body = parseRequestBody(request.postData());
				observed.activations.push(body);
				v2 = {
					...v2,
					etag: weakEtag(3),
					isActive: body.isActive === true,
					isLatest: body.isActive === true,
					updatedAt: new Date().toISOString(),
				};
				await fulfillJson(route, versionDetail(v2), { etag: v2.etag });
				return;
			}

			observed.unexpected.push(`${method} ${pathname}`);
			await fulfillJson(
				route,
				{
					code: "E2E_ROUTE_NOT_STUBBED",
					requestId: "incremental-route-not-stubbed",
					status: 501,
					title: "Incremental E2E route not stubbed",
					type: "about:blank",
				},
				{ status: 501 },
			);
		});

		await page.route(`${OSS_ORIGIN}/**`, (route) =>
			fulfillOss(route, observed),
		);

		await page.route("**/api/public/v2/**", async (route) => {
			const request = route.request();
			const method = request.method();
			const { pathname } = new URL(request.url());
			const releasePath = `/api/public/v2/programs/${PROGRAM_ID}/releases`;
			const manifest = [...associatedFiles.values()].sort((left, right) =>
				left.path.localeCompare(right.path),
			);

			if (method === "GET" && pathname === `${releasePath}/latest`) {
				const selectedV2 =
					v2?.lifecycleStatus === "finalized" &&
					v2.finalizedAt !== null &&
					v2.isActive
						? v2
						: null;
				const header: PublicReleaseHeaderDto = selectedV2
					? {
							description: "Complete incremental v2 release",
							fileCount: manifest.length,
							programName,
							publishedAt: selectedV2.finalizedAt ?? CREATED_AT,
							versionNumber: "2.0.0",
						}
					: {
							description: v1.description,
							fileCount: v1.fileCount,
							programName,
							publishedAt: v1.finalizedAt ?? CREATED_AT,
							versionNumber: v1.versionNumber,
						};
				await fulfillJson(route, header);
				return;
			}
			if (
				method === "GET" &&
				pathname === `${releasePath}/2.0.0/files` &&
				v2?.isActive
			) {
				const response: PublicReleaseFilePageDto = {
					items: manifest.map(
						(file): PublicReleaseFileMetadataDto => ({
							checksumAlgorithm: "sha256",
							mimeType: file.mimeType,
							path: file.path,
							sha256: file.sha256,
							size: file.size,
						}),
					),
					nextCursor: null,
					pageSize: 200,
					versionNumber: "2.0.0",
				};
				await fulfillJson(route, response);
				return;
			}
			if (
				method === "POST" &&
				pathname === `${releasePath}/2.0.0/download-urls` &&
				v2?.isActive
			) {
				const body = parseRequestBody(request.postData());
				const files = requestedDownloads(body);
				observed.publicDownloads.push(body);
				const response: PublicReleaseDownloadUrlsResponse = {
					downloadExpiresAt: new Date(Date.now() + 300_000).toISOString(),
					files: files.map((file) => ({
						...file,
						downloadUrl: `https://downloads.invalid/${file.path}`,
					})),
				};
				await fulfillJson(route, response);
				return;
			}

			observed.unexpected.push(`${method} ${pathname}`);
			await route.fulfill({ status: 501 });
		});

		await signIn(page);
		await expect(page.getByText(programName, { exact: true })).toBeVisible();
		await page
			.getByRole("link", {
				name: new RegExp(
					`查看程序 ${programName} 的版本|View versions for ${programName}`,
				),
			})
			.click();
		await page.getByRole("button", { name: /^(创建|Create)$/ }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel(/版本号|Version number/).fill("2.0.0");
		await dialog
			.getByLabel(/描述|Description/)
			.fill("Complete A/B-prime/C release");
		await dialog
			.getByLabel(/选择程序文件夹|Choose program folder/)
			.setInputFiles(incrementalReleaseFixtureDirectory("v2"));
		await dialog.getByRole("button", { name: /^(上传|Upload)$/ }).click();
		await expect(
			dialog.getByText(/已登记|Registered/, { exact: true }),
		).toHaveCount(3);
		await dialog
			.getByRole("button", { name: /完成版本|Finalize version/ })
			.click();
		await expect(dialog).toHaveCount(0);
		await expect(
			page.getByRole("table").getByText("2.0.0", { exact: true }),
		).toBeVisible();
		await expect
			.poll(async () =>
				page.evaluate(async (programId) => {
					const response = await fetch(
						`/api/public/v2/programs/${programId}/releases/latest`,
					);
					const header: PublicReleaseHeaderDto = await response.json();
					return header.versionNumber;
				}, PROGRAM_ID),
			)
			.toBe("1.0.0");

		const activation = page.getByRole("switch", {
			name: /启用版本 2\.0\.0|Enable version 2\.0\.0/,
		});
		await activation.click();
		await expect(activation).toBeChecked();
		await expect.poll(() => observed.activations).toEqual([{ isActive: true }]);

		const installedManifest = v1Fixture.map(({ path, sha256, size }) => ({
			path,
			sha256,
			size,
		}));
		const publicResult = await page.evaluate(
			async ({ installed, programId }) => {
				const headerResponse = await fetch(
					`/api/public/v2/programs/${programId}/releases/latest`,
				);
				const header: PublicReleaseHeaderDto = await headerResponse.json();
				const filesResponse = await fetch(
					`/api/public/v2/programs/${programId}/releases/${header.versionNumber}/files?pageSize=200`,
				);
				const manifest: PublicReleaseFilePageDto = await filesResponse.json();
				const installedByPath = new Map(
					installed.map((file) => [file.path, file]),
				);
				const manifestPaths = new Set(manifest.items.map(({ path }) => path));
				const removedPaths = installed
					.filter(({ path }) => !manifestPaths.has(path))
					.map(({ path }) => path);
				const changedFiles = manifest.items.filter((file) => {
					const previous = installedByPath.get(file.path);
					return (
						!previous ||
						previous.sha256 !== file.sha256 ||
						previous.size !== file.size
					);
				});
				const downloadResponse = await fetch(
					`/api/public/v2/programs/${programId}/releases/${header.versionNumber}/download-urls`,
					{
						body: JSON.stringify({
							files: changedFiles.map(({ path, sha256 }) => ({ path, sha256 })),
						}),
						headers: { "content-type": "application/json" },
						method: "POST",
					},
				);
				const downloads: PublicReleaseDownloadUrlsResponse =
					await downloadResponse.json();
				for (const path of removedPaths) installedByPath.delete(path);
				for (const file of manifest.items) {
					installedByPath.set(file.path, {
						path: file.path,
						sha256: file.sha256,
						size: file.size,
					});
				}
				const installedAfter = [...installedByPath.values()].sort(
					(left, right) => left.path.localeCompare(right.path),
				);
				return { downloads, header, installedAfter, manifest, removedPaths };
			},
			{ installed: installedManifest, programId: PROGRAM_ID },
		);

		expect(observed.drafts).toEqual([
			expect.objectContaining({ expectedFileCount: 3, versionNumber: "2.0.0" }),
		]);
		expect(observed.resolves).toHaveLength(1);
		expect(observed.credentials).toEqual([{}]);
		expect(observed.completions).toHaveLength(1);
		expect(observed.finalizations).toEqual([{}]);
		expect(observed.activations).toEqual([{ isActive: true }]);
		expect(observed.ossPuts).toHaveLength(2);
		expect(observed.ossPuts.some((path) => path.endsWith("/A.txt"))).toBe(
			false,
		);
		expect(observed.ossPuts.some((path) => path.endsWith("/B.txt"))).toBe(true);
		expect(observed.ossPuts.some((path) => path.endsWith("/C.txt"))).toBe(true);
		expect(observed.ossPuts.some((path) => path.endsWith("/D.txt"))).toBe(
			false,
		);
		expect([...associatedFiles.keys()].sort()).toEqual([
			"release/A.txt",
			"release/B.txt",
			"release/C.txt",
		]);
		expect(publicResult.header.fileCount).toBe(3);
		expect(publicResult.header.versionNumber).toBe("2.0.0");
		expect(publicResult.manifest.items.map(({ path }) => path)).toEqual([
			"release/A.txt",
			"release/B.txt",
			"release/C.txt",
		]);
		expect(publicResult.downloads.files.map(({ path }) => path)).toEqual([
			"release/B.txt",
			"release/C.txt",
		]);
		expect(publicResult.removedPaths).toEqual(["release/D.txt"]);
		expect(publicResult.installedAfter).toEqual(
			v2Fixture.map(({ path, sha256, size }) => ({ path, sha256, size })),
		);
		expect(observed.publicDownloads).toEqual([
			{
				files: v2Fixture
					.filter(
						({ path }) => path === "release/B.txt" || path === "release/C.txt",
					)
					.map(({ path, sha256 }) => ({ path, sha256 })),
			},
		]);
		expect(observed.unexpected).toEqual([]);
	});
});
