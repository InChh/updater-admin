import { useLocale as useKobalteLocale } from "@kobalte/core/i18n";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, type JSX } from "solid-js";
import { renderToString } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RouteMessageKey } from "../../features/shell/route-registry";
import {
	DEFAULT_LOCALE,
	en,
	isSupportedLocale,
	type MessageKey,
	zhCN,
} from "./catalogs";
import {
	type I18nContextValue,
	I18nProvider,
	interpolateMessage,
	LOCALE_STORAGE_KEY,
	readStoredLocale,
	useI18n,
} from "./i18n";

interface ProbeProps {
	readonly capture?: (context: I18nContextValue) => void;
}

function Probe(props: ProbeProps): JSX.Element {
	const i18n = useI18n();
	const kobalteLocale = useKobalteLocale();
	props.capture?.(i18n);
	return (
		<div data-testid="locale-probe">
			{i18n.locale()}|{kobalteLocale.locale()}|
			{i18n.t("routes.programs.pageTitle")}
		</div>
	);
}

afterEach(() => {
	window.localStorage.clear();
	document.documentElement.lang = "";
});

describe("localization catalogs", () => {
	it("keeps English and route metadata in exact parity with canonical zh-CN", () => {
		const routeKeyTypeProof: RouteMessageKey extends MessageKey ? true : false =
			true;

		expect(Object.keys(en)).toEqual(Object.keys(zhCN));
		expect(routeKeyTypeProof).toBe(true);
		expect(DEFAULT_LOCALE).toBe("zh-CN");
	});

	it("validates supported locales and interpolates only supplied placeholders", () => {
		expect(isSupportedLocale("zh-CN")).toBe(true);
		expect(isSupportedLocale("en")).toBe(true);
		expect(isSupportedLocale("en-US")).toBe(false);
		expect(
			interpolateMessage("{name}: {count} / {missing}", {
				count: 3,
				name: "release",
			}),
		).toBe("release: 3 / {missing}");
	});
});

describe("I18nProvider", () => {
	it("is SSR-safe and defaults to zh-CN without browser storage", () => {
		expect(readStoredLocale(null)).toBeNull();
		expect(() =>
			renderToString(() => (
				<I18nProvider>
					<Probe />
				</I18nProvider>
			)),
		).not.toThrow();
	});

	it("hydrates an anonymous locale from storage and updates lang and storage", async () => {
		window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
		let context: I18nContextValue | undefined;
		render(() => (
			<I18nProvider>
				<Probe capture={(value) => (context = value)} />
			</I18nProvider>
		));

		await waitFor(() => {
			expect(screen.getByTestId("locale-probe").textContent).toBe(
				"en|en|Programs",
			);
			expect(document.documentElement.lang).toBe("en");
		});

		await context?.setLocale("zh-CN");
		await waitFor(() => {
			expect(screen.getByTestId("locale-probe").textContent).toBe(
				"zh-CN|zh-CN|程序",
			);
			expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
			expect(document.documentElement.lang).toBe("zh-CN");
		});
	});

	it("prefers and reacts to an authenticated profile locale", async () => {
		window.localStorage.setItem(LOCALE_STORAGE_KEY, "invalid-storage-value");
		const [profileLocale, setProfileLocale] = createSignal<"en" | "zh-CN">(
			"en",
		);
		const persistLocale = vi.fn(async (locale: "en" | "zh-CN") => {
			setProfileLocale(locale);
		});
		let context: I18nContextValue | undefined;

		render(() => (
			<I18nProvider locale={profileLocale()} onLocaleChange={persistLocale}>
				<Probe capture={(value) => (context = value)} />
			</I18nProvider>
		));

		expect(screen.getByTestId("locale-probe").textContent).toBe(
			"en|en|Programs",
		);
		await context?.setLocale("zh-CN");

		await waitFor(() => {
			expect(persistLocale).toHaveBeenCalledWith("zh-CN");
			expect(screen.getByTestId("locale-probe").textContent).toBe(
				"zh-CN|zh-CN|程序",
			);
			expect(document.documentElement.lang).toBe("zh-CN");
		});
		expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(
			"invalid-storage-value",
		);
	});

	it("formats Shanghai dates, numbers, and byte sizes deterministically", () => {
		let context: I18nContextValue | undefined;
		render(() => (
			<I18nProvider locale="en">
				<Probe capture={(value) => (context = value)} />
			</I18nProvider>
		));

		expect(context?.formatDate("2026-07-14T00:00:00.000Z")).toContain(
			"08:00:00",
		);
		expect(context?.formatNumber(1_234_567.5)).toBe("1,234,567.5");
		expect(context?.formatBytes(1_536)).toBe("1.5 KB");
		expect(context?.formatBytes(Number.NaN)).toBe("—");
		expect(context?.formatDate("invalid")).toBe("—");
	});

	it("maps API codes safely and never renders raw server details", () => {
		let context: I18nContextValue | undefined;
		render(() => (
			<I18nProvider locale="en">
				<Probe capture={(value) => (context = value)} />
			</I18nProvider>
		));

		const known = context?.formatApiError({
			code: "INTERNAL_ERROR",
			detail: "database password and SQL must remain private",
			requestId: "req_safe-123",
			title: "raw server title",
		});
		expect(known).toBe(
			"The service is temporarily unavailable. Request ID: req_safe-123",
		);
		expect(known).not.toContain("database");
		expect(known).not.toContain("server title");

		const unknown = context?.formatApiError({
			code: "UNRECOGNIZED_SECRET_ERROR",
			detail: "must not render",
			requestId: "unsafe\nrequest-id",
		});
		expect(unknown).toBe("The operation failed. Try again later.");
		expect(unknown).not.toContain("must not render");
	});
});
