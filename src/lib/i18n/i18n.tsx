import { I18nProvider as KobalteI18nProvider } from "@kobalte/core/i18n";
import {
	type Accessor,
	createContext,
	createEffect,
	createMemo,
	createSignal,
	type JSX,
	onMount,
	useContext,
} from "solid-js";

import {
	catalogs,
	DEFAULT_LOCALE,
	isSupportedLocale,
	type MessageKey,
	type SupportedLocale,
} from "./catalogs";

export const LOCALE_STORAGE_KEY = "updater-admin:locale";
export const DISPLAY_TIME_ZONE = "Asia/Shanghai";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

export type TranslationValues = Readonly<Record<string, string | number>>;

export interface LocaleStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface SafeApiProblemLike {
	readonly code?: unknown;
	readonly requestId?: unknown;
}

export interface I18nContextValue {
	readonly locale: Accessor<SupportedLocale>;
	setLocale(locale: SupportedLocale): Promise<void>;
	t(key: MessageKey, values?: TranslationValues): string;
	formatApiError(error: unknown): string;
	formatBytes(value: number): string;
	formatDate(value: Date | string): string;
	formatNumber(value: number): string;
}

export interface I18nProviderProps {
	readonly children?: JSX.Element;
	/** Reactive authenticated-profile locale. Anonymous consumers may omit it. */
	readonly locale?: SupportedLocale | null;
	/** Persist an authenticated locale change before the optimistic value settles. */
	readonly onLocaleChange?: (locale: SupportedLocale) => Promise<void> | void;
	readonly storage?: LocaleStorage;
	readonly storageKey?: string;
}

export const API_ERROR_MESSAGE_KEYS = {
	BAD_REQUEST: "errors.api.badRequest",
	FORBIDDEN: "errors.api.forbidden",
	INTERNAL_ERROR: "errors.api.internalError",
	LAST_ADMIN_REQUIRED: "errors.api.lastAdminRequired",
	NOT_FOUND: "errors.api.notFound",
	PRECONDITION_REQUIRED: "errors.api.preconditionRequired",
	PROGRAM_NAME_CONFLICT: "errors.api.conflict",
	RATE_LIMITED: "errors.api.rateLimited",
	STALE_WRITE: "errors.api.staleWrite",
	UNAUTHENTICATED: "errors.api.unauthenticated",
	UPLOAD_METADATA_CONFLICT: "errors.api.conflict",
	VALIDATION_FAILED: "errors.api.validationFailed",
	VERSION_NOT_GREATER: "errors.api.conflict",
	VERSION_NUMBER_CONFLICT: "errors.api.conflict",
} as const satisfies Readonly<Record<string, MessageKey>>;

const I18nContext = createContext<I18nContextValue>();

function getRecord(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === "object"
		? (value as Readonly<Record<string, unknown>>)
		: null;
}

function getProblemRecord(error: unknown): Readonly<Record<string, unknown>> {
	const direct = getRecord(error) ?? {};
	return getRecord(direct.problem) ?? direct;
}

export function resolveApiErrorMessageKey(error: unknown): MessageKey {
	const code = getProblemRecord(error).code;
	if (typeof code === "string" && Object.hasOwn(API_ERROR_MESSAGE_KEYS, code)) {
		return API_ERROR_MESSAGE_KEYS[code as keyof typeof API_ERROR_MESSAGE_KEYS];
	}
	return "errors.api.generic";
}

export function getSafeApiRequestId(error: unknown): string | null {
	const requestId = getProblemRecord(error).requestId;
	return typeof requestId === "string" && REQUEST_ID_PATTERN.test(requestId)
		? requestId
		: null;
}

export function interpolateMessage(
	template: string,
	values?: TranslationValues,
): string {
	if (!values) return template;
	return template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (placeholder, key) =>
		Object.hasOwn(values, key) ? String(values[key]) : placeholder,
	);
}

function browserStorage(explicitStorage?: LocaleStorage): LocaleStorage | null {
	if (typeof window === "undefined") return null;
	if (explicitStorage) return explicitStorage;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

export function readStoredLocale(
	storage: LocaleStorage | null | undefined,
	storageKey = LOCALE_STORAGE_KEY,
): SupportedLocale | null {
	if (!storage) return null;
	try {
		const stored = storage.getItem(storageKey);
		return isSupportedLocale(stored) ? stored : null;
	} catch {
		return null;
	}
}

function writeStoredLocale(
	storage: LocaleStorage | null,
	storageKey: string,
	locale: SupportedLocale,
): void {
	try {
		storage?.setItem(storageKey, locale);
	} catch {
		// Storage can be blocked by browser privacy policy; locale remains in memory.
	}
}

export function I18nProvider(props: I18nProviderProps) {
	const [locale, setLocaleSignal] = createSignal<SupportedLocale>(
		isSupportedLocale(props.locale) ? props.locale : DEFAULT_LOCALE,
	);

	createEffect(() => {
		const suppliedLocale = props.locale;
		if (isSupportedLocale(suppliedLocale)) setLocaleSignal(suppliedLocale);
	});

	onMount(() => {
		if (isSupportedLocale(props.locale)) return;
		const storedLocale = readStoredLocale(
			browserStorage(props.storage),
			props.storageKey,
		);
		if (storedLocale) setLocaleSignal(storedLocale);
	});

	createEffect(() => {
		const activeLocale = locale();
		if (typeof document !== "undefined") {
			document.documentElement.lang = activeLocale;
		}
	});

	const dateFormatter = createMemo(
		() =>
			new Intl.DateTimeFormat(locale(), {
				day: "2-digit",
				hour: "2-digit",
				hourCycle: "h23",
				minute: "2-digit",
				month: "2-digit",
				second: "2-digit",
				timeZone: DISPLAY_TIME_ZONE,
				year: "numeric",
			}),
	);
	const numberFormatter = createMemo(() => new Intl.NumberFormat(locale()));
	const byteNumberFormatter = createMemo(
		() =>
			new Intl.NumberFormat(locale(), {
				maximumFractionDigits: 1,
				minimumFractionDigits: 0,
			}),
	);

	const translate = (key: MessageKey, values?: TranslationValues) =>
		interpolateMessage(catalogs[locale()][key], values);

	const context: I18nContextValue = {
		locale,
		async setLocale(nextLocale) {
			if (!isSupportedLocale(nextLocale)) {
				throw new TypeError("Unsupported locale.");
			}
			if (nextLocale === locale()) return;

			const previousLocale = locale();
			setLocaleSignal(nextLocale);
			try {
				await props.onLocaleChange?.(nextLocale);
				if (!isSupportedLocale(props.locale) && !props.onLocaleChange) {
					writeStoredLocale(
						browserStorage(props.storage),
						props.storageKey ?? LOCALE_STORAGE_KEY,
						nextLocale,
					);
				}
			} catch (error) {
				setLocaleSignal(previousLocale);
				throw error;
			}
		},
		t: translate,
		formatApiError(error) {
			const message = translate(resolveApiErrorMessageKey(error));
			const requestId = getSafeApiRequestId(error);
			return requestId
				? `${message} ${translate("errors.api.requestReference", { requestId })}`
				: message;
		},
		formatBytes(value) {
			if (!Number.isFinite(value) || value < 0) {
				return translate("common.notAvailable");
			}
			if (value < 1024) return `${numberFormatter().format(value)} B`;

			const unitIndex = Math.min(
				Math.floor(Math.log(value) / Math.log(1024)),
				BYTE_UNITS.length - 1,
			);
			return `${byteNumberFormatter().format(value / 1024 ** unitIndex)} ${BYTE_UNITS[unitIndex]}`;
		},
		formatDate(value) {
			const date = value instanceof Date ? value : new Date(value);
			return Number.isNaN(date.getTime())
				? translate("common.notAvailable")
				: dateFormatter().format(date);
		},
		formatNumber(value) {
			return Number.isFinite(value)
				? numberFormatter().format(value)
				: translate("common.notAvailable");
		},
	};

	return (
		<I18nContext.Provider value={context}>
			<KobalteI18nProvider locale={locale()}>
				{props.children}
			</KobalteI18nProvider>
		</I18nContext.Provider>
	);
}

export function useI18n(): I18nContextValue {
	const context = useContext(I18nContext);
	if (!context) {
		throw new Error("useI18n must be used within an I18nProvider.");
	}
	return context;
}

export type { Catalog, MessageKey, SupportedLocale } from "./catalogs";
