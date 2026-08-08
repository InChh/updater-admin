import { describe, expect, it } from "vitest";

import { createUploadStsPolicy } from "./sts.server";

describe("upload STS policy", () => {
	it("keeps browser credentials scoped to PutObject and AbortMultipartUpload under the normalized prefix", () => {
		const policy = createUploadStsPolicy({
			bucket: "updater-artifacts",
			uploadPrefix: "updater-admin/releases",
		});

		expect(policy).toEqual({
			Statement: [
				{
					Action: ["oss:PutObject", "oss:AbortMultipartUpload"],
					Effect: "Allow",
					Resource: ["acs:oss:*:*:updater-artifacts/updater-admin/releases/*"],
				},
			],
			Version: "1",
		});
		const serialized = JSON.stringify(policy);
		expect(serialized).not.toContain("GetObject");
		expect(serialized).not.toContain("ListParts");
		expect(serialized).not.toContain("AccessKey");
	});
});
