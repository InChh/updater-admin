import { describe, expect, it, vi } from "vitest";

import type { ProgramMutationContext } from "../db/repositories/programs.server";
import { createUploadsService } from "./uploads.server";

const AUDIT: ProgramMutationContext = {
	actorId: "ef87aa07-320c-4e32-b788-f3688309371c",
	ip: "127.0.0.1",
	requestId: "req-1",
	userAgent: "vitest",
};

describe("uploads service", () => {
	it("issues one prefix-scoped temporary credential set and audits it", async () => {
		const append = vi.fn(async () => ({
			createdAt: new Date("2026-08-08T00:00:00.000Z"),
			id: "704f73c0-92ac-4477-9cdf-459b428112c9",
		}));
		const issueUploadCredentials = vi.fn(async () => ({
			accessKeyId: "temporary-id",
			accessKeySecret: "temporary-secret",
			expiration: "2099-01-01T00:00:00.000Z",
			securityToken: "temporary-token",
		}));
		const service = createUploadsService({
			auditRepository: { append },
			configuration: {
				bucket: "updater-files",
				region: "oss-cn-hangzhou",
				uploadPrefix: "releases/",
			},
			stsService: { issueUploadCredentials },
		});

		await expect(service.issueCredentials({}, AUDIT)).resolves.toMatchObject({
			bucket: "updater-files",
			region: "oss-cn-hangzhou",
			uploadPrefix: "releases/",
		});
		expect(issueUploadCredentials).toHaveBeenCalledOnce();
		expect(append).toHaveBeenCalledOnce();
	});
});
