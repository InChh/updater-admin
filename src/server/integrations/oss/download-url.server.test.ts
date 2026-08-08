import { describe, expect, it, vi } from "vitest";

import { PUBLIC_RELEASE_DOWNLOAD_URL_TTL_SECONDS } from "../../../shared/api/public-releases";
import {
	createOssDownloadUrlSigner,
	OssDownloadUrlError,
} from "./download-url.server";

const OSS_ENVIRONMENT = {
	OSS_ACCESS_KEY_ID: "permanent-access-key",
	OSS_ACCESS_KEY_SECRET: "permanent-secret",
	OSS_BUCKET: "updater-artifacts",
	OSS_REGION: "cn-hangzhou",
	OSS_STS_ENDPOINT: "sts.cn-hangzhou.aliyuncs.com",
	OSS_UPLOAD_PREFIX: "releases/",
	OSS_UPLOAD_RAM_ROLE_ARN: "acs:ram::123456789:role/updater-upload",
} as const;

describe("OSS download URL signer", () => {
	it("signs the stored object key verbatim with one 300-second V4 GET", async () => {
		const signatureUrlV4 = vi.fn(
			async () =>
				"https://updater-artifacts.oss-cn-hangzhou.aliyuncs.com/releases%2Fapp.bin?x-oss-signature=redacted",
		);
		const signer = createOssDownloadUrlSigner({
			client: { signatureUrlV4 },
		});

		await expect(
			signer.signGetUrl("releases/abc%20def/app.bin"),
		).resolves.toContain("x-oss-signature=");
		expect(signatureUrlV4).toHaveBeenCalledWith(
			"GET",
			PUBLIC_RELEASE_DOWNLOAD_URL_TTL_SECONDS,
			undefined,
			"releases/abc%20def/app.bin",
		);
	});

	it("creates one lazy HTTPS client from the permanent server principal", async () => {
		const signatureUrlV4 = vi.fn(
			async () => "https://updater-artifacts.example/one?x-oss-signature=value",
		);
		const clientFactory = vi.fn(() => ({ signatureUrlV4 }));
		const signer = createOssDownloadUrlSigner({
			clientFactory,
			environment: OSS_ENVIRONMENT,
		});

		expect(clientFactory).not.toHaveBeenCalled();
		await signer.signGetUrl("one");
		await signer.signGetUrl("two");
		expect(clientFactory).toHaveBeenCalledOnce();
		expect(clientFactory).toHaveBeenCalledWith({
			accessKeyId: "permanent-access-key",
			accessKeySecret: "permanent-secret",
			bucket: "updater-artifacts",
			region: "cn-hangzhou",
			secure: true,
		});
	});

	it("maps invalid keys, provider failures, and non-HTTPS results to one safe error", async () => {
		const secret = "provider-secret-that-must-not-escape";
		const cases = [
			createOssDownloadUrlSigner({
				client: {
					signatureUrlV4: async () => {
						throw new Error(secret);
					},
				},
			}),
			createOssDownloadUrlSigner({
				client: { signatureUrlV4: async () => "http://bucket.example/file" },
			}),
			createOssDownloadUrlSigner({
				client: { signatureUrlV4: async () => "not a URL" },
			}),
		];

		for (const signer of cases) {
			let thrown: unknown;
			try {
				await signer.signGetUrl("object-key");
			} catch (error) {
				thrown = error;
			}
			expect(thrown).toBeInstanceOf(OssDownloadUrlError);
			expect(String(thrown)).not.toContain(secret);
		}

		await expect(cases[0]?.signGetUrl("bad\0key")).rejects.toBeInstanceOf(
			OssDownloadUrlError,
		);
	});
});
