import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../lib/i18n/i18n";
import { ReleaseTrendChart } from "./release-trend-chart";

describe("ReleaseTrendChart", () => {
	it("renders an accessible renderer-neutral chart and table alternative", () => {
		render(() => (
			<I18nProvider locale="en">
				<ReleaseTrendChart
					series={{
						from: "2026-07-14",
						interval: "day",
						points: [
							{ bucket: "2026-07-14", value: 2 },
							{ bucket: "2026-07-15", value: 3 },
						],
						to: "2026-07-15",
						total: 5,
					}}
				/>
			</I18nProvider>
		));

		const chart = screen.getByRole("img", { name: "Release trend" });
		expect(chart.querySelector("polyline")).toBeTruthy();
		expect(chart.querySelectorAll("rect")).toHaveLength(2);
		expect(screen.getByText("View release data table")).toBeTruthy();
		expect(
			screen.getByRole("table", { name: "Daily release counts" }),
		).toBeTruthy();
		expect(screen.getByRole("cell", { name: "3" })).toBeTruthy();
	});
});
