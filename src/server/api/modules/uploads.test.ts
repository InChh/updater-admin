import { Elysia } from "elysia";
import { describe, expect, it, vi } from "vitest";

import type { SafeSessionView } from "../../auth/session.server";
import type { UploadsService } from "../../domain/uploads.server";
import { ApiRequestContextStore } from "../context.server";
import { mapApiError } from "../problem";
import { createUploadsModule } from "./uploads";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const credentialsResponse = {
	bucket: "updater-artifacts",
	credentials: {
		accessKeyId: "STS.temporary",
		accessKeySecret: "temporary-secret",
		expiration: "2099-07-15T01:15:00.000Z",
		securityToken: "temporary-token",
	},
	region: "oss-cn-hangzhou",
	uploadPrefix: "releases/",
};

function testApp(service: UploadsService) {
	const contextStore = new ApiRequestContextStore();
	return new Elysia({ normalize: false })
		.onError((context) =>
			mapApiError(context, {
				getRequestId: () => "req_test",
			}),
		)
		.onRequest(({ request }) => {
			contextStore.initialize(request, "req_test");
			contextStore.setSession(request, {
				user: { id: ACTOR_ID },
			} as SafeSessionView);
			contextStore.setAudit(request, {
				actorId: ACTOR_ID,
				ip: "127.0.0.1",
				requestId: "req_test",
				userAgent: "vitest",
			});
		})
		.use(
			createUploadsModule({ contextStore, getUploadsService: () => service }),
		);
}

function post(path: string, body: unknown) {
	return new Request(`http://localhost${path}`, {
		body: JSON.stringify(body),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
}

describe("uploads Elysia module", () => {
	it("issues only short-lived credentials", async () => {
		const issueCredentials = vi.fn(async () => credentialsResponse);
		const app = testApp({ issueCredentials });
		const response = await app.handle(post("/uploads/credentials", {}));

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual(credentialsResponse);
		expect(issueCredentials).toHaveBeenCalledOnce();
	});

	it("does not expose the obsolete unscoped completion route", async () => {
		const app = testApp({
			issueCredentials: vi.fn(async () => credentialsResponse),
		});
		const response = await app.handle(post("/uploads/complete", { files: [] }));
		expect(response.status).toBe(404);
	});
});
