import { createMemo, createUniqueId, For, Show } from "solid-js";

import { useI18n } from "../../lib/i18n/i18n";
import type { TimeSeries } from "../../shared/api/monitoring";

export interface ReleaseTrendChartProps {
	readonly series: TimeSeries;
}

const WIDTH = 760;
const HEIGHT = 250;
const LEFT = 46;
const RIGHT = 16;
const TOP = 20;
const BOTTOM = 38;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;

export function ReleaseTrendChart(props: ReleaseTrendChartProps) {
	const i18n = useI18n();
	const titleId = createUniqueId();
	const descriptionId = createUniqueId();
	const maximum = createMemo(() =>
		Math.max(1, ...props.series.points.map((point) => point.value)),
	);
	const slotWidth = createMemo(
		() => PLOT_WIDTH / Math.max(1, props.series.points.length),
	);
	const pointCoordinates = createMemo(() =>
		props.series.points.map((point, index) => ({
			x:
				LEFT +
				(index + 0.5) * (PLOT_WIDTH / Math.max(1, props.series.points.length)),
			y: TOP + PLOT_HEIGHT - (point.value / maximum()) * PLOT_HEIGHT,
		})),
	);
	const polyline = createMemo(() =>
		pointCoordinates()
			.map((point) => `${point.x},${point.y}`)
			.join(" "),
	);
	const labelIndexes = createMemo(() => {
		const lastIndex = props.series.points.length - 1;
		if (lastIndex <= 0) return [0];
		return [...new Set([0, Math.round(lastIndex / 2), lastIndex])];
	});

	return (
		<div>
			<div class="overflow-x-auto rounded-lg border border-border bg-white p-3">
				<svg
					aria-describedby={descriptionId}
					aria-labelledby={titleId}
					class="h-auto min-w-[620px]"
					role="img"
					viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
				>
					<title id={titleId}>{i18n.t("monitoring.chart.title")}</title>
					<desc id={descriptionId}>
						{i18n.t("monitoring.chart.description", {
							from: props.series.from,
							to: props.series.to,
							total: i18n.formatNumber(props.series.total),
						})}
					</desc>
					<defs>
						<linearGradient id={`${titleId}-area`} x1="0" x2="0" y1="0" y2="1">
							<stop offset="0" stop-color="#00a870" stop-opacity="0.2" />
							<stop offset="1" stop-color="#00a870" stop-opacity="0.02" />
						</linearGradient>
					</defs>
					<For each={[0, 0.5, 1]}>
						{(ratio) => {
							const y = TOP + ratio * PLOT_HEIGHT;
							const label = Math.round(maximum() * (1 - ratio));
							return (
								<g>
									<line
										stroke="#e5ece9"
										stroke-dasharray={ratio === 1 ? undefined : "4 5"}
										x1={LEFT}
										x2={WIDTH - RIGHT}
										y1={y}
										y2={y}
									/>
									<text
										fill="#6b7f7a"
										font-size="11"
										text-anchor="end"
										x={LEFT - 9}
										y={y + 4}
									>
										{label}
									</text>
								</g>
							);
						}}
					</For>
					<For each={props.series.points}>
						{(point, index) => {
							const height = (point.value / maximum()) * PLOT_HEIGHT;
							return (
								<rect
									fill="#00a870"
									height={height}
									opacity="0.12"
									rx={Math.min(2, slotWidth() / 4)}
									width={Math.max(1, slotWidth() * 0.58)}
									x={LEFT + index() * slotWidth() + slotWidth() * 0.21}
									y={TOP + PLOT_HEIGHT - height}
								/>
							);
						}}
					</For>
					<Show when={pointCoordinates().length > 1}>
						<polyline
							fill="none"
							points={polyline()}
							stroke="#008b5d"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2.5"
						/>
					</Show>
					<For each={pointCoordinates()}>
						{(point) => (
							<circle
								cx={point.x}
								cy={point.y}
								fill="#ffffff"
								r="2.7"
								stroke="#008b5d"
								stroke-width="1.7"
							/>
						)}
					</For>
					<For each={labelIndexes()}>
						{(index) => (
							<text
								fill="#6b7f7a"
								font-size="11"
								text-anchor={
									index === 0
										? "start"
										: index === props.series.points.length - 1
											? "end"
											: "middle"
								}
								x={
									index === 0
										? LEFT
										: index === props.series.points.length - 1
											? WIDTH - RIGHT
											: pointCoordinates()[index]?.x
								}
								y={HEIGHT - 12}
							>
								{props.series.points[index]?.bucket}
							</text>
						)}
					</For>
				</svg>
			</div>

			<details class="mt-3 rounded-md border border-border bg-mist/35 px-3 py-2 text-sm">
				<summary class="cursor-pointer font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-deep">
					{i18n.t("monitoring.chart.tableAlternative")}
				</summary>
				<div class="mt-2 max-h-64 overflow-auto">
					<table class="w-full border-collapse text-left text-xs">
						<caption class="sr-only">
							{i18n.t("monitoring.chart.tableCaption")}
						</caption>
						<thead>
							<tr>
								<th class="border-b border-border px-2 py-1.5" scope="col">
									{i18n.t("monitoring.chart.date")}
								</th>
								<th class="border-b border-border px-2 py-1.5" scope="col">
									{i18n.t("monitoring.chart.releases")}
								</th>
							</tr>
						</thead>
						<tbody>
							<For each={props.series.points}>
								{(point) => (
									<tr>
										<td class="border-b border-border/70 px-2 py-1.5">
											{point.bucket}
										</td>
										<td class="border-b border-border/70 px-2 py-1.5 tabular-nums">
											{i18n.formatNumber(point.value)}
										</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
				</div>
			</details>
		</div>
	);
}
