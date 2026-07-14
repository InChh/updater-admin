import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/solid-router";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";

import { Suspense } from "solid-js";
import { HydrationScript } from "solid-js/web";

import { ToastRegion } from "../components/ui/toast";
import type { getContext } from "../integrations/tanstack-query/provider";
import { I18nProvider } from "../lib/i18n/i18n";
import styleCss from "../styles.css?url";

export const Route = createRootRouteWithContext<
	ReturnType<typeof getContext>
>()({
	head: () => ({
		links: [{ rel: "stylesheet", href: styleCss }],
		meta: [
			{ charSet: "utf-8" },
			{
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
				name: "viewport",
			},
		],
		title: "版本管理系统",
	}),
	shellComponent: RootComponent,
});

function RootComponent() {
	return (
		<html lang="zh-CN">
			<head>
				<HydrationScript />
				<HeadContent />
			</head>
			<body>
				<I18nProvider>
					<LocalizedRootContent />
				</I18nProvider>
				<Scripts />
			</body>
		</html>
	);
}

function LocalizedRootContent() {
	return (
		<Suspense>
			<Outlet />
			<ToastRegion />
		</Suspense>
	);
}
