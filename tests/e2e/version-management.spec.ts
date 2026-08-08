import { expect, type Route, test } from "@playwright/test";

import type { WeakEntityTag } from "../../src/shared/api/common";
import type { FileMetadataDto } from "../../src/shared/api/files";
import type {
	ProgramDetailDto,
	ProgramListItemDto,
} from "../../src/shared/api/programs";
import type {
	CompleteUploadItemInput,
	UploadFileMetadataInput,
} from "../../src/shared/api/uploads";
import type {
	VersionDetailDto,
	VersionListItemDto,
} from "../../src/shared/api/versions";
import { captureScreenshot } from "./support";

const email = process.env.E2E_ADMIN_EMAIL;
const password = process.env.E2E_ADMIN_PASSWORD;
const hasCredentials = Boolean(email && password);

const PROGRAM_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const FILE_ID = "33333333-3333-4333-8333-333333333333";
const OSS_ORIGIN = "https://updater-e2e.oss-cn-hangzhou.aliyuncs.com";
const CREATED_AT = "2026-07-15T02:00:00.000Z";

interface MockVersion extends VersionDetailDto {
	readonly etag: WeakEntityTag;
}

interface ObservedRequests {
	readonly activations: unknown[];
	readonly completions: unknown[];
	readonly creates: unknown[];
	readonly deletes: string[];
	readonly finalizations: unknown[];
	readonly ossCompletions: string[];
	readonly ossInitializations: string[];
	readonly ossPuts: string[];
	readonly resolves: unknown[];
	readonly unexpected: string[];
	readonly updates: unknown[];
	readonly uploadCredentials: unknown[];
}

function parseJsonRecord(
	value: string | null,
): Readonly<Record<string, unknown>> {
	if (!value) return {};
	const parsed: unknown = JSON.parse(value);
	return parsed && typeof parsed === "object" && !Array.isArray(parsed)
		? (parsed as Readonly<Record<string, unknown>>)
		: {};
}

function weakEtag(revision: number): WeakEntityTag {
	return `W/"${BigInt(revision)}"`;
}

async function fulfillJson(
	route: Route,
	body: unknown,
	options: {
		readonly etag?: WeakEntityTag;
		readonly status?: number;
	} = {},
): Promise<void> {
	await route.fulfill({
		body: JSON.stringify(body),
		contentType: "application/json",
		headers: options.etag ? { etag: options.etag } : undefined,
		status: options.status ?? 200,
	});
}

function listItem(version: MockVersion): VersionListItemDto {
	return {
		associatedFileCount: version.associatedFileCount,
		createdAt: version.createdAt,
		description: version.description,
		etag: version.etag,
		expectedFileCount: version.expectedFileCount,
		fileCount: version.fileCount,
		finalizedAt: version.finalizedAt,
		id: version.id,
		isActive: version.isActive,
		isLatest: version.isLatest,
		lifecycleStatus: version.lifecycleStatus,
		programId: version.programId,
		updatedAt: version.updatedAt,
		versionNumber: version.versionNumber,
	};
}

function detail(version: MockVersion): VersionDetailDto {
	const { etag: _etag, ...data } = version;
	return data;
}

function uploadFilesFromBody(
	body: Readonly<Record<string, unknown>>,
): readonly UploadFileMetadataInput[] {
	return Array.isArray(body.files)
		? (body.files as readonly UploadFileMetadataInput[])
		: [];
}

function completedUploadFilesFromBody(
	body: Readonly<Record<string, unknown>>,
): readonly CompleteUploadItemInput[] {
	return Array.isArray(body.files)
		? (body.files as readonly CompleteUploadItemInput[])
		: [];
}

test.describe("nested version management", () => {
	test.skip(
		!hasCredentials,
		"E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required for the authenticated version journey.",
	);

	test("opens a program tab and uploads, finalizes, activates, edits, and deletes a version", async ({
		page,
	}, testInfo) => {
		const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
		const programName = `E2E version program ${nonce}`;
		const initialVersion = "1.0.0";
		const updatedVersion = "1.1.0";
		let programVersionCount = 0;
		let versionRevision = 1;
		let version: MockVersion | null = null;
		const observed: ObservedRequests = {
			activations: [],
			completions: [],
			creates: [],
			deletes: [],
			finalizations: [],
			ossCompletions: [],
			ossInitializations: [],
			ossPuts: [],
			resolves: [],
			unexpected: [],
			updates: [],
			uploadCredentials: [],
		};
		const program: ProgramDetailDto = {
			createdAt: CREATED_AT,
			description: "Program supplied by the Playwright API fixture.",
			id: PROGRAM_ID,
			name: programName,
			updatedAt: CREATED_AT,
			versionCount: 0,
		};
		const programListItem: ProgramListItemDto = {
			createdAt: program.createdAt,
			description: program.description,
			etag: weakEtag(1),
			id: program.id,
			name: program.name,
			updatedAt: program.updatedAt,
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
						systemName: "E2E version system",
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
					{ ...program, versionCount: programVersionCount },
					{ etag: weakEtag(1) },
				);
				return;
			}

			if (method === "GET" && pathname === versionsPath) {
				await fulfillJson(route, {
					items: version ? [listItem(version)] : [],
					page: Number(searchParams.get("page") ?? 1),
					pageSize: Number(searchParams.get("pageSize") ?? 20),
					total: version ? 1 : 0,
				});
				return;
			}

			if (method === "POST" && pathname === `${versionsPath}/drafts`) {
				const body = parseJsonRecord(request.postData());
				observed.creates.push(body);
				version = {
					associatedFileCount: 0,
					createdAt: CREATED_AT,
					description:
						typeof body.description === "string" ? body.description : "",
					etag: weakEtag(versionRevision),
					expectedFileCount:
						typeof body.expectedFileCount === "number"
							? body.expectedFileCount
							: 1,
					fileCount: 0,
					finalizedAt: null,
					id: VERSION_ID,
					isActive: false,
					isLatest: false,
					lifecycleStatus: "draft",
					programId: PROGRAM_ID,
					updatedAt: CREATED_AT,
					versionNumber:
						typeof body.versionNumber === "string"
							? body.versionNumber
							: initialVersion,
				};
				programVersionCount = 1;
				await fulfillJson(route, detail(version), { etag: version.etag });
				return;
			}

			if (
				method === "POST" &&
				pathname === `${versionsPath}/${VERSION_ID}/files/resolve` &&
				version
			) {
				const body = parseJsonRecord(request.postData());
				observed.resolves.push(body);
				await fulfillJson(route, {
					files: uploadFilesFromBody(body).map(({ path }) => ({
						path,
						status: "uploadRequired",
					})),
				});
				return;
			}

			if (method === "POST" && pathname === "/api/v1/uploads/credentials") {
				const body = parseJsonRecord(request.postData());
				observed.uploadCredentials.push(body);
				await fulfillJson(route, {
					bucket: "updater-e2e",
					credentials: {
						accessKeyId: "e2e-temporary-access-key",
						accessKeySecret: "e2e-temporary-secret",
						expiration: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
						securityToken: "e2e-temporary-security-token",
					},
					region: "oss-cn-hangzhou",
					uploadPrefix: `e2e/${nonce}/`,
				});
				return;
			}

			if (
				method === "POST" &&
				pathname === `${versionsPath}/${VERSION_ID}/files/complete` &&
				version
			) {
				const body = parseJsonRecord(request.postData());
				observed.completions.push(body);
				const files = completedUploadFilesFromBody(body);
				const completedFiles: FileMetadataDto[] = files.map((file) => ({
					checksumAlgorithm: "sha256",
					createdAt: CREATED_AT,
					id: FILE_ID,
					mimeType: file.mimeType,
					path: file.path,
					sha256: file.sha256,
					size: file.size,
					updatedAt: CREATED_AT,
				}));
				version = {
					...version,
					associatedFileCount: completedFiles.length,
					fileCount: completedFiles.length,
				};
				await fulfillJson(route, { files: completedFiles });
				return;
			}

			if (
				method === "POST" &&
				pathname === `${versionsPath}/${VERSION_ID}/finalize` &&
				version
			) {
				const body = parseJsonRecord(request.postData());
				observed.finalizations.push(body);
				versionRevision += 1;
				version = {
					...version,
					etag: weakEtag(versionRevision),
					finalizedAt: new Date().toISOString(),
					lifecycleStatus: "finalized",
					updatedAt: new Date().toISOString(),
				};
				await fulfillJson(route, detail(version), { etag: version.etag });
				return;
			}

			if (
				method === "GET" &&
				pathname === `${versionsPath}/${VERSION_ID}` &&
				version
			) {
				await fulfillJson(route, detail(version), { etag: version.etag });
				return;
			}

			if (
				method === "PUT" &&
				pathname === `${versionsPath}/${VERSION_ID}/activation` &&
				version
			) {
				const body = parseJsonRecord(request.postData());
				observed.activations.push(body);
				versionRevision += 1;
				version = {
					...version,
					etag: weakEtag(versionRevision),
					isActive: body.isActive === true,
					isLatest: body.isActive === true,
					updatedAt: new Date().toISOString(),
				};
				await fulfillJson(route, detail(version), { etag: version.etag });
				return;
			}

			if (
				method === "PATCH" &&
				pathname === `${versionsPath}/${VERSION_ID}` &&
				version
			) {
				const body = parseJsonRecord(request.postData());
				observed.updates.push(body);
				versionRevision += 1;
				version = {
					...version,
					description:
						typeof body.description === "string"
							? body.description
							: version.description,
					etag: weakEtag(versionRevision),
					updatedAt: new Date().toISOString(),
					versionNumber:
						typeof body.versionNumber === "string"
							? body.versionNumber
							: version.versionNumber,
				};
				await fulfillJson(route, detail(version), { etag: version.etag });
				return;
			}

			if (
				method === "DELETE" &&
				pathname === `${versionsPath}/${VERSION_ID}` &&
				version
			) {
				observed.deletes.push(VERSION_ID);
				version = null;
				programVersionCount = 0;
				await route.fulfill({ status: 204 });
				return;
			}

			observed.unexpected.push(`${method} ${pathname}`);
			await fulfillJson(
				route,
				{
					code: "E2E_ROUTE_NOT_STUBBED",
					requestId: "e2e-route-not-stubbed",
					status: 501,
					title: "E2E route not stubbed",
					type: "about:blank",
				},
				{ status: 501 },
			);
		});

		await page.route(`${OSS_ORIGIN}/**`, async (route) => {
			const request = route.request();
			const origin = request.headers().origin ?? "http://127.0.0.1:3000";
			const corsHeaders = {
				"access-control-allow-headers":
					request.headers()["access-control-request-headers"] ?? "*",
				"access-control-allow-methods": "PUT, POST, GET, DELETE, OPTIONS",
				"access-control-allow-origin": origin,
				"access-control-expose-headers": "ETag, x-oss-request-id",
			};
			if (request.method() === "OPTIONS") {
				await route.fulfill({ headers: corsHeaders, status: 204 });
				return;
			}
			if (request.method() === "PUT") {
				observed.ossPuts.push(request.url());
				await route.fulfill({
					body: "",
					headers: {
						...corsHeaders,
						etag: '"e2e-object-etag"',
						"x-oss-request-id": "e2e-oss-request",
					},
					status: 200,
				});
				return;
			}
			if (
				request.method() === "POST" &&
				new URL(request.url()).searchParams.has("uploads")
			) {
				observed.ossInitializations.push(request.url());
				await route.fulfill({
					body: `<?xml version="1.0" encoding="UTF-8"?>
<InitiateMultipartUploadResult>
  <Bucket>updater-e2e</Bucket>
  <Key>e2e-release-artifact</Key>
  <UploadId>e2e-upload-id</UploadId>
</InitiateMultipartUploadResult>`,
					contentType: "application/xml",
					headers: corsHeaders,
					status: 200,
				});
				return;
			}
			if (
				request.method() === "POST" &&
				new URL(request.url()).searchParams.has("uploadId")
			) {
				observed.ossCompletions.push(request.url());
				await route.fulfill({
					body: `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUploadResult>
  <Location>${OSS_ORIGIN}/e2e-release-artifact</Location>
  <Bucket>updater-e2e</Bucket>
  <Key>e2e-release-artifact</Key>
  <ETag>&quot;e2e-object-etag&quot;</ETag>
</CompleteMultipartUploadResult>`,
					contentType: "application/xml",
					headers: {
						...corsHeaders,
						etag: '"e2e-object-etag"',
						"x-oss-request-id": "e2e-oss-complete-request",
					},
					status: 200,
				});
				return;
			}
			observed.unexpected.push(
				`${request.method()} ${new URL(request.url()).pathname}`,
			);
			await route.fulfill({ headers: corsHeaders, status: 405 });
		});

		await page.goto("/login?returnTo=%2Fprograms");
		await page.getByLabel(/邮箱|Email/).fill(email ?? "");
		await page.getByLabel(/密码|Password/).fill(password ?? "");
		await page.getByRole("button", { name: /登录|Sign in/ }).click();
		await expect(page).toHaveURL(/\/programs(?:\?.*)?$/);
		await expect(page.getByText(programName, { exact: true })).toBeVisible();

		await page
			.getByRole("link", {
				name: new RegExp(
					`查看程序 ${programName} 的版本|View versions for ${programName}`,
				),
			})
			.click();
		await expect(page).toHaveURL(
			new RegExp(`/programs/${PROGRAM_ID}/versions(?:\\?.*)?$`),
		);
		await expect(
			page.getByRole("tab", { name: new RegExp(programName) }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: /版本管理|Version management/ }),
		).toBeVisible();

		await page.getByRole("button", { name: /^(创建|Create)$/ }).click();
		const createDialog = page.getByRole("dialog");
		await expect(
			createDialog.getByRole("heading", { name: /创建版本|Create version/ }),
		).toBeVisible();
		await createDialog.getByLabel(/版本号|Version number/).fill(initialVersion);
		await createDialog
			.getByLabel(/描述|Description/)
			.fill("Created through the intercepted direct-to-OSS E2E journey.");
		await createDialog
			.getByLabel(/选择程序文件夹|Choose program folder/)
			.setInputFiles({
				buffer: Buffer.alloc(128 * 1024, "e2e release artifact\n"),
				mimeType: "text/plain",
				name: "release.txt",
			});

		const uploadButton = createDialog.getByRole("button", {
			name: /^(上传|Upload)$/,
		});
		await expect(uploadButton).toBeEnabled();
		await uploadButton.click();
		await expect(
			createDialog.getByText(/已登记|Registered/, { exact: true }),
		).toBeVisible();
		await captureScreenshot(page, testInfo, "version-create-dialog.png");
		const createVersionButton = createDialog.getByRole("button", {
			name: /完成版本|Finalize version/,
		});
		await expect(createVersionButton).toBeEnabled();
		await createVersionButton.click();
		await expect(createDialog).toHaveCount(0);
		await expect(
			page.getByRole("table").getByText(initialVersion, { exact: true }),
		).toBeVisible();

		const activation = page.getByRole("switch", {
			name: new RegExp(
				`启用版本 ${initialVersion}|Enable version ${initialVersion}`,
			),
		});
		await activation.click();
		await expect(activation).toBeChecked();
		await expect(page.getByText(/最新|Latest/, { exact: true })).toBeVisible();
		await captureScreenshot(page, testInfo, "version-management.png");

		await page
			.getByRole("button", {
				name: new RegExp(
					`编辑版本 ${initialVersion}|Edit version ${initialVersion}`,
				),
			})
			.click();
		const editDialog = page.getByRole("dialog");
		await expect(
			editDialog.getByRole("heading", { name: /编辑版本|Edit version/ }),
		).toBeVisible();
		await editDialog.getByLabel(/版本号|Version number/).fill(updatedVersion);
		await editDialog
			.getByLabel(/描述|Description/)
			.fill("Updated by the nested version E2E journey.");
		await editDialog
			.getByRole("button", { name: /保存更改|Save changes/ })
			.click();
		await expect(editDialog).toHaveCount(0);
		await expect(
			page.getByRole("table").getByText(updatedVersion, { exact: true }),
		).toBeVisible();

		await page
			.getByRole("button", {
				name: new RegExp(
					`删除版本 ${updatedVersion}|Delete version ${updatedVersion}`,
				),
			})
			.click();
		const deleteDialog = page.getByRole("dialog");
		await expect(
			deleteDialog.getByRole("heading", { name: /删除版本|Delete version/ }),
		).toBeVisible();
		await deleteDialog.getByRole("button", { name: /^(删除|Delete)$/ }).click();
		await expect(deleteDialog).toHaveCount(0);
		await expect(
			page.getByRole("table").getByText(updatedVersion, { exact: true }),
		).toHaveCount(0);

		expect(observed.uploadCredentials).toHaveLength(1);
		expect(observed.ossInitializations).toHaveLength(1);
		expect(observed.ossPuts).toHaveLength(1);
		expect(observed.ossCompletions).toHaveLength(1);
		expect(observed.completions).toHaveLength(1);
		expect(observed.creates).toEqual([
			expect.objectContaining({
				expectedFileCount: 1,
				versionNumber: initialVersion,
			}),
		]);
		expect(observed.resolves).toHaveLength(1);
		expect(observed.uploadCredentials).toEqual([{}]);
		expect(observed.finalizations).toEqual([{}]);
		expect(observed.activations).toEqual([{ isActive: true }]);
		expect(observed.updates).toEqual([
			expect.objectContaining({ versionNumber: updatedVersion }),
		]);
		expect(observed.deletes).toEqual([VERSION_ID]);
		expect(observed.unexpected).toEqual([]);
	});
});
