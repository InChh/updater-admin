import { describe, expect, it, vi } from "vitest";

import {
	createOssMetadataClient,
	type OssMetadataError,
} from "./client.server";
import {
	createUploadRoleSessionName,
	createUploadStsPolicy,
	createUploadStsService,
	type UploadAssumeRoleRequest,
	type UploadStsError,
} from "./sts.server";

const CONFIGURATION = {
	bucket: "updater-artifacts",
	uploadPrefix: "updater-admin/releases/",
	uploadRoleArn: "acs:ram::123456789:role/updater-upload",
} as const;

const TEMPORARY_CREDENTIALS = {
	accessKeyId: "STS.temporary-id",
	accessKeySecret: "temporary-secret",
	expiration: "2026-07-15T03:15:00+00:00",
	securityToken: "temporary-token",
} as const;

function successfulStsClient(captured: UploadAssumeRoleRequest[]) {
	return {
		async assumeRole(request: UploadAssumeRoleRequest) {
			captured.push(request);
			return { credentials: TEMPORARY_CREDENTIALS, statusCode: 200 };
		},
	};
}

function expectStsError(
	operation: () => Promise<unknown>,
	code: UploadStsError["code"],
) {
	return expect(operation()).rejects.toEqual(
		expect.objectContaining({ code, name: "UploadStsError" }),
	);
}

function expectMetadataError(
	operation: () => Promise<unknown>,
	code: OssMetadataError["code"],
) {
	return expect(operation()).rejects.toEqual(
		expect.objectContaining({ code, name: "OssMetadataError" }),
	);
}

describe("upload STS policy", () => {
	it("allows only direct object upload and multipart recovery under one prefix", () => {
		const policy = createUploadStsPolicy(CONFIGURATION);

		expect(policy).toEqual({
			Statement: [
				{
					Action: [
						"oss:PutObject",
						"oss:AbortMultipartUpload",
						"oss:ListParts",
					],
					Effect: "Allow",
					Resource: ["acs:oss:*:*:updater-artifacts/updater-admin/releases/*"],
				},
			],
			Version: "1",
		});
		const serialized = JSON.stringify(policy);
		expect(serialized).not.toContain("GetObject");
		expect(serialized).not.toContain("DeleteObject");
		expect(serialized).not.toContain("ListObjects");
		expect(serialized).not.toContain("accessKey");
		expect(serialized).not.toContain("secret");
	});

	it("normalizes the configured prefix and rejects unsafe scope", () => {
		expect(
			createUploadStsPolicy({
				bucket: "updater-artifacts",
				uploadPrefix: "release",
			}).Statement[0].Resource,
		).toEqual(["acs:oss:*:*:updater-artifacts/release/*"]);
		expect(() =>
			createUploadStsPolicy({
				bucket: "Invalid_Bucket",
				uploadPrefix: "release/",
			}),
		).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
		expect(() =>
			createUploadStsPolicy({
				bucket: "updater-artifacts",
				uploadPrefix: "../release/",
			}),
		).toThrowError(expect.objectContaining({ code: "DOT_SEGMENT" }));
		for (const uploadPrefix of ["release/*/", "release/?/"]) {
			expect(() =>
				createUploadStsPolicy({
					bucket: "updater-artifacts",
					uploadPrefix,
				}),
			).toThrowError(
				expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
			);
		}
	});

	it("creates a RAM-safe role-session name from an opaque actor ID", () => {
		expect(createUploadRoleSessionName()).toBe("updater-upload-administrator");
		expect(createUploadRoleSessionName("actor/with spaces:and中文")).toBe(
			"updater-upload-actor-with-spaces-and",
		);
		const longName = createUploadRoleSessionName("a".repeat(200));
		expect(longName).toHaveLength(64);
		expect(longName).toMatch(/^[A-Za-z0-9.@_-]{2,64}$/);
	});
});

describe("upload STS service", () => {
	it("lazily issues a 900-second AssumeRole request and canonical credentials", async () => {
		const captured: UploadAssumeRoleRequest[] = [];
		const client = successfulStsClient(captured);
		const service = createUploadStsService({
			client,
			configuration: CONFIGURATION,
		});

		expect(captured).toHaveLength(0);
		await expect(
			service.issueUploadCredentials({ actorId: "admin-123" }),
		).resolves.toEqual({
			accessKeyId: "STS.temporary-id",
			accessKeySecret: "temporary-secret",
			expiration: "2026-07-15T03:15:00.000Z",
			securityToken: "temporary-token",
		});
		expect(captured).toHaveLength(1);
		expect(captured[0]).toMatchObject({
			durationSeconds: 900,
			roleArn: CONFIGURATION.uploadRoleArn,
			roleSessionName: "updater-upload-admin-123",
		});
		expect(JSON.parse(captured[0]?.policy ?? "{}")).toEqual(
			createUploadStsPolicy(CONFIGURATION),
		);
		expect(Object.keys(await service.issueUploadCredentials()).sort()).toEqual([
			"accessKeyId",
			"accessKeySecret",
			"expiration",
			"securityToken",
		]);
	});

	it("accepts a short configurable duration but rejects out-of-range values", async () => {
		const captured: UploadAssumeRoleRequest[] = [];
		await createUploadStsService({
			client: successfulStsClient(captured),
			configuration: CONFIGURATION,
			durationSeconds: 1_800,
		}).issueUploadCredentials();
		expect(captured[0]?.durationSeconds).toBe(1_800);

		for (const durationSeconds of [899, 3_601, 900.5]) {
			const assumeRole = vi.fn();
			await expectStsError(
				() =>
					createUploadStsService({
						client: { assumeRole },
						configuration: CONFIGURATION,
						durationSeconds,
					}).issueUploadCredentials(),
				"INVALID_CONFIGURATION",
			);
			expect(assumeRole).not.toHaveBeenCalled();
		}
	});

	it("wraps provider errors and malformed responses without retaining secrets", async () => {
		const providerError = new Error("provider leaked permanent-secret");
		await expectStsError(
			() =>
				createUploadStsService({
					client: {
						assumeRole: async () => {
							throw providerError;
						},
					},
					configuration: CONFIGURATION,
				}).issueUploadCredentials(),
			"ASSUME_ROLE_FAILED",
		);

		for (const response of [
			{ credentials: TEMPORARY_CREDENTIALS, statusCode: 500 },
			{
				credentials: { ...TEMPORARY_CREDENTIALS, securityToken: undefined },
				statusCode: 200,
			},
			{
				credentials: { ...TEMPORARY_CREDENTIALS, expiration: "not-a-date" },
				statusCode: 200,
			},
		]) {
			await expectStsError(
				() =>
					createUploadStsService({
						client: { assumeRole: async () => response },
						configuration: CONFIGURATION,
					}).issueUploadCredentials(),
				response.statusCode === 500 ? "ASSUME_ROLE_FAILED" : "INVALID_RESPONSE",
			);
		}
	});
});

describe("OSS HEAD metadata adapter", () => {
	it("returns exact byte size and a normalized quoted ETag", async () => {
		const getObjectMeta = vi.fn(async () => ({
			res: {
				headers: {
					"Content-Length": "5497558138880",
					ETag: '"0CC175B9C0F1B6A831C399E269772661-4"',
				},
			},
			status: 200,
		}));
		const client = createOssMetadataClient({ client: { getObjectMeta } });

		await expect(client.headObject("release/hash/app.zip")).resolves.toEqual({
			etag: "0CC175B9C0F1B6A831C399E269772661-4",
			size: 5_497_558_138_880n,
		});
		expect(getObjectMeta).toHaveBeenCalledWith("release/hash/app.zip");
	});

	it("accepts Fetch Headers and zero bytes without creating a signed URL", async () => {
		const getObjectMeta = vi.fn(async () => ({
			res: { headers: new Headers({ "content-length": "0", etag: "empty" }) },
			status: 200,
		}));
		const client = createOssMetadataClient({ client: { getObjectMeta } });

		await expect(client.headObject("release/hash/empty")).resolves.toEqual({
			etag: "empty",
			size: 0n,
		});
		expect(getObjectMeta).toHaveBeenCalledOnce();
	});

	it("rejects invalid metadata rather than rounding or trusting it", async () => {
		for (const headers of [
			{ "content-length": "-1", etag: '"etag"' },
			{ "content-length": "1.5", etag: '"etag"' },
			{ "content-length": "01", etag: '"etag"' },
			{ "content-length": "1" },
			{ "content-length": "1", etag: '""' },
			{ "content-length": "1", etag: "bad\netag" },
		]) {
			const client = createOssMetadataClient({
				client: {
					getObjectMeta: async () => ({ res: { headers }, status: 200 }),
				},
			});
			await expectMetadataError(
				() => client.headObject("release/hash/app.zip"),
				"INVALID_METADATA",
			);
		}
	});

	it("maps not-found and provider failures to secret-free typed errors", async () => {
		for (const [error, code] of [
			[{ status: 404, authorization: "permanent-secret" }, "OBJECT_NOT_FOUND"],
			[{ statusCode: 404 }, "OBJECT_NOT_FOUND"],
			[new Error("provider included Authorization"), "HEAD_FAILED"],
		] as const) {
			const client = createOssMetadataClient({
				client: {
					getObjectMeta: async () => {
						throw error;
					},
				},
			});
			await expectMetadataError(
				() => client.headObject("release/hash/app.zip"),
				code,
			);
		}

		const statusClient = createOssMetadataClient({
			client: { getObjectMeta: async () => ({ status: 404 }) },
		});
		await expectMetadataError(
			() => statusClient.headObject("release/hash/missing.zip"),
			"OBJECT_NOT_FOUND",
		);
	});

	it("lazily creates the permanent-key server client only on HEAD", async () => {
		const getObjectMeta = vi.fn(async () => ({
			res: { headers: { "content-length": "12", etag: '"abc"' } },
			status: 200,
		}));
		const clientFactory = vi.fn(() => ({ getObjectMeta }));
		const client = createOssMetadataClient({
			clientFactory,
			environment: {
				OSS_ACCESS_KEY_ID: "permanent-id",
				OSS_ACCESS_KEY_SECRET: "permanent-secret",
				OSS_BUCKET: "updater-artifacts",
				OSS_REGION: "oss-cn-hangzhou",
				OSS_STS_ENDPOINT: "sts.cn-hangzhou.aliyuncs.com",
				OSS_UPLOAD_PREFIX: "updater-admin/",
				OSS_UPLOAD_RAM_ROLE_ARN: "acs:ram::123456789:role/updater-upload",
			},
		});

		expect(clientFactory).not.toHaveBeenCalled();
		await expect(client.headObject("release/hash/app.zip")).resolves.toEqual({
			etag: "abc",
			size: 12n,
		});
		expect(clientFactory).toHaveBeenCalledWith({
			accessKeyId: "permanent-id",
			accessKeySecret: "permanent-secret",
			bucket: "updater-artifacts",
			region: "oss-cn-hangzhou",
			secure: true,
		});
		expect(clientFactory).toHaveBeenCalledOnce();
	});

	it("rejects an empty object key before touching the OSS client", async () => {
		const getObjectMeta = vi.fn();
		const client = createOssMetadataClient({ client: { getObjectMeta } });
		await expectMetadataError(() => client.headObject(""), "INVALID_METADATA");
		expect(getObjectMeta).not.toHaveBeenCalled();
	});
});
