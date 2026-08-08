import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { systemSettingsQueryKeys } from "../../lib/api/query-keys";
import { I18nProvider } from "../../lib/i18n/i18n";
import { SystemSettingsPage } from "./system-page";

function settingsResponse(systemName: string, etag: string): Response {
	return new Response(
		JSON.stringify({
			defaultLocale: "en",
			defaultPageSize: 20,
			repositoryUrl: null,
			systemName,
		}),
		{ headers: { "content-type": "application/json", etag } },
	);
}

function renderPage(fetcher: ReturnType<typeof vi.fn>) {
	vi.stubGlobal("fetch", fetcher);
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	render(() => (
		<QueryClientProvider client={queryClient}>
			<I18nProvider locale="en">
				<SystemSettingsPage />
			</I18nProvider>
		</QueryClientProvider>
	));
	return queryClient;
}

afterEach(() => vi.unstubAllGlobals());

describe("SystemSettingsPage", () => {
	it("saves with the loaded ETag and updates the shared Query entity", async () => {
		const fetcher = vi
			.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
				settingsResponse("Original", 'W/"2"'),
			)
			.mockResolvedValueOnce(settingsResponse("Original", 'W/"2"'))
			.mockResolvedValueOnce(settingsResponse("Renamed", 'W/"3"'));
		const queryClient = renderPage(fetcher);
		const name = await screen.findByRole("textbox", { name: "System name" });
		fireEvent.input(name, { target: { value: "Renamed" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
		const [, updateInit] = fetcher.mock.calls[1] ?? [];
		expect(new Headers(updateInit?.headers).get("x-updater-if-match")).toBe(
			'W/"2"',
		);
		await waitFor(() =>
			expect(
				queryClient.getQueryData(systemSettingsQueryKeys.detail()),
			).toEqual({
				data: {
					defaultLocale: "en",
					defaultPageSize: 20,
					repositoryUrl: null,
					systemName: "Renamed",
				},
				etag: 'W/"3"',
			}),
		);
	});

	it("reloads the exact singleton after a stale write", async () => {
		const staleProblem = new Response(
			JSON.stringify({
				code: "STALE_WRITE",
				requestId: "req_settings_stale",
				status: 409,
				title: "Conflict",
				type: "about:blank",
			}),
			{
				headers: { "content-type": "application/problem+json" },
				status: 409,
			},
		);
		const fetcher = vi
			.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
				settingsResponse("Original", 'W/"2"'),
			)
			.mockResolvedValueOnce(settingsResponse("Original", 'W/"2"'))
			.mockResolvedValueOnce(staleProblem)
			.mockResolvedValueOnce(settingsResponse("Fresh from server", 'W/"5"'));
		renderPage(fetcher);
		const name = await screen.findByRole("textbox", { name: "System name" });
		fireEvent.input(name, { target: { value: "My update" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() =>
			expect(
				(
					screen.getByRole("textbox", {
						name: "System name",
					}) as HTMLInputElement
				).value,
			).toBe("Fresh from server"),
		);
		expect(fetcher).toHaveBeenCalledTimes(3);
	});
});
