import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../lib/i18n/i18n";
import type {
	MonitoringStatusDto,
	TimeSeries,
} from "../../shared/api/monitoring";
import { MonitoringOverviewPage } from "./monitoring-overview-page";

const STATUS: MonitoringStatusDto = {
	application: {
		buildId: "deploy-42",
		commitRef: "abcdef",
		environment: "preview",
		name: "updater-admin",
		version: "1.0.0",
	},
	checkedAt: "2026-07-15T01:00:00.000Z",
	dependencies: {
		neon: {
			checkedAt: "2026-07-15T01:00:00.000Z",
			latencyMs: 12,
			status: "ready",
		},
		ossSts: {
			checkedAt: "2026-07-15T01:00:00.000Z",
			latencyMs: 34,
			status: "degraded",
		},
	},
	metrics: {
		activeVersions: 3,
		files: 7,
		programs: 2,
		status: "ready",
		totalBytes: "1536",
		versions: 5,
	},
	recentOperations: { items: [], status: "ready" },
	status: "degraded",
};

const SERIES: TimeSeries = {
	from: "2026-07-14",
	interval: "day",
	points: [
		{ bucket: "2026-07-14", value: 1 },
		{ bucket: "2026-07-15", value: 2 },
	],
	to: "2026-07-15",
	total: 3,
};

afterEach(() => vi.unstubAllGlobals());

describe("MonitoringOverviewPage", () => {
	it("shows dependency health and refreshes exact status and series queries", async () => {
		const fetcher = vi.fn(async (input: RequestInfo | URL) => {
			const path = String(input);
			return Response.json(path.includes("release-series") ? SERIES : STATUS);
		});
		vi.stubGlobal("fetch", fetcher);
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const onSearchChange = vi.fn();
		render(() => (
			<QueryClientProvider client={queryClient}>
				<I18nProvider locale="en">
					<MonitoringOverviewPage
						onSearchChange={onSearchChange}
						search={() => ({ days: 30 })}
					/>
				</I18nProvider>
			</QueryClientProvider>
		));

		expect(await screen.findByText("Neon database")).toBeTruthy();
		expect(screen.getByText("updater-admin")).toBeTruthy();
		expect(screen.getByText("1.0.0")).toBeTruthy();
		expect(screen.getByText("preview")).toBeTruthy();
		expect(screen.getByText("abcdef")).toBeTruthy();
		expect(screen.getByText("deploy-42")).toBeTruthy();
		expect(screen.getByText("12 ms latency")).toBeTruthy();
		expect(screen.getByText("OSS upload credentials")).toBeTruthy();
		expect(screen.getByText("1.5 KB")).toBeTruthy();
		expect(screen.getByRole("img", { name: "Release trend" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "7 days" }));
		expect(onSearchChange).toHaveBeenCalledWith({ days: 7 });

		fireEvent.click(
			screen.getByRole("button", { name: "Refresh monitoring data" }),
		);
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
	});
});
