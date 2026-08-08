import { describe, expect, it, vi } from "vitest";

import type { UploadCredentialsRequest } from "../../shared/api/uploads";
import { createUploadCredentialManager } from "./credential-manager.client";

function response(accessKeyId: string, expiration: number) {
	return {
		bucket: "release-bucket",
		credentials: {
			accessKeyId,
			accessKeySecret: "temporary-secret",
			expiration: new Date(expiration).toISOString(),
			securityToken: "temporary-token",
		},
		region: "oss-cn-hangzhou",
		uploadPrefix: "releases/",
	};
}

describe("upload credential manager", () => {
	it("reuses credentials while more than sixty seconds remain", async () => {
		let now = 0;
		const requestCredentials = vi.fn(async () => response("key-1", 120_000));
		const manager = createUploadCredentialManager({
			now: () => now,
			requestCredentials,
		});

		await expect(manager.getCredentials()).resolves.toMatchObject({
			credentials: { accessKeyId: "key-1" },
		});
		now = 59_999;
		await manager.getCredentials();

		expect(requestCredentials).toHaveBeenCalledOnce();
		manager.dispose();
	});

	it("coalesces concurrent refreshes after the cached window becomes stale", async () => {
		let now = 0;
		let finishRefresh:
			| ((value: ReturnType<typeof response>) => void)
			| undefined;
		const requestCredentials = vi
			.fn(async () => response("key-1", 120_000))
			.mockImplementationOnce(async () => response("key-1", 120_000));
		const manager = createUploadCredentialManager({
			now: () => now,
			requestCredentials,
		});
		await manager.getCredentials();
		now = 60_000;
		requestCredentials.mockImplementationOnce(
			() =>
				new Promise<ReturnType<typeof response>>((resolve) => {
					finishRefresh = resolve;
				}),
		);

		const refreshes = Array.from({ length: 8 }, () => manager.getCredentials());
		await vi.waitFor(() => expect(requestCredentials).toHaveBeenCalledTimes(2));
		finishRefresh?.(response("key-2", 300_000));

		await expect(Promise.all(refreshes)).resolves.toEqual(
			Array.from({ length: 8 }, () => response("key-2", 300_000)),
		);
		expect(requestCredentials).toHaveBeenCalledTimes(2);
		manager.dispose();
	});

	it("does not retain credentials or complete a refresh after disposal", async () => {
		let resolveRequest:
			| ((value: ReturnType<typeof response>) => void)
			| undefined;
		const requestCredentials = vi.fn(
			(_input: UploadCredentialsRequest, signal?: AbortSignal) =>
				new Promise<ReturnType<typeof response>>((resolve, reject) => {
					resolveRequest = resolve;
					signal?.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					);
				}),
		);
		const manager = createUploadCredentialManager({ requestCredentials });
		const pending = manager.getCredentials();
		manager.dispose();
		resolveRequest?.(response("key-1", Date.now() + 120_000));

		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(manager.peekCredentials()).toBeNull();
	});
});
