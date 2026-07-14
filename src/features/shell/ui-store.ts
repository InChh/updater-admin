import { useSelector } from "@tanstack/solid-store";
import { Store } from "@tanstack/store";
import type { Accessor } from "solid-js";

import type { SupportedLocale } from "../../shared/api/common";
import {
	PROGRAMS_PATH,
	PROTECTED_ROUTE_REGISTRY,
	type ProtectedRouteId,
	resolveProtectedRoute,
} from "./route-registry";

export interface OpenedTab {
	readonly closable: boolean;
	readonly href: string;
	readonly key: string;
	readonly routeId: ProtectedRouteId;
	/**
	 * Dynamic label data and an accessible fallback. Renderers use the route
	 * registry's tabTitleKey for localized static labels.
	 */
	readonly title: string;
}

export type OpenTabInput = Pick<OpenedTab, "href" | "routeId" | "title">;

export interface ShellUiState {
	readonly accountId: string | null;
	readonly activeTabKey: string;
	readonly hydrated: boolean;
	readonly locale: SupportedLocale;
	readonly mobileNavigationOpen: boolean;
	readonly openedTabs: readonly OpenedTab[];
	readonly sidebarCollapsed: boolean;
}

export interface HydrateForAccountInput {
	readonly accountId: string;
	readonly currentTab?: OpenTabInput;
	readonly locale?: SupportedLocale;
}

export interface SwitchAccountInput {
	readonly accountId: string;
	readonly currentTab?: OpenTabInput;
	readonly locale?: SupportedLocale;
}

export interface CloseTabResult {
	readonly closed: boolean;
	readonly navigateTo: string | null;
}

export interface SessionStorageLike {
	getItem(key: string): string | null;
	removeItem(key: string): void;
	setItem(key: string, value: string): void;
}

export interface ShellUiControllerOptions {
	readonly initialLocale?: SupportedLocale;
	readonly storage?: SessionStorageLike | null;
}

export interface ShellUiController {
	readonly store: Store<ShellUiState>;
	closeTab(key: string): CloseTabResult;
	dispose(): void;
	getState(): ShellUiState;
	hydrateForAccount(input: HydrateForAccountInput): void;
	logout(): void;
	openOrActivateTab(input: OpenTabInput): OpenedTab;
	setLocale(locale: SupportedLocale): void;
	setMobileNavigationOpen(open: boolean): void;
	setSidebarCollapsed(collapsed: boolean): void;
	subscribe(listener: (state: ShellUiState) => void): () => void;
	switchAccount(input: SwitchAccountInput): void;
	toggleSidebar(): void;
}

interface PersistedShellUiState {
	readonly activeTabKey: string;
	readonly locale?: SupportedLocale;
	readonly openedTabs: readonly OpenedTab[];
	readonly sidebarCollapsed: boolean;
	readonly version: 1;
}

const STORAGE_KEY_PREFIX = "updater-admin:shell:v1";
const MAX_OPENED_TABS = 50;
const MAX_TAB_TITLE_LENGTH = 256;
const SUPPORTED_LOCALE_SET: ReadonlySet<string> = new Set(["zh-CN", "en"]);

function browserSessionStorage(): SessionStorageLike | null {
	if (typeof window === "undefined") return null;
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}

function hasControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 32 || codePoint === 127;
	});
}

function validAccountId(accountId: string): boolean {
	return (
		accountId.length > 0 &&
		accountId.length <= 128 &&
		accountId === accountId.trim() &&
		!hasControlCharacter(accountId)
	);
}

function requireAccountId(accountId: string): void {
	if (!validAccountId(accountId)) {
		throw new TypeError("accountId must be a non-empty canonical identifier.");
	}
}

export function shellUiStorageKey(accountId: string): string {
	requireAccountId(accountId);
	return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(accountId)}`;
}

function validLocale(value: unknown): value is SupportedLocale {
	return typeof value === "string" && SUPPORTED_LOCALE_SET.has(value);
}

function validTitle(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_TAB_TITLE_LENGTH &&
		value === value.trim() &&
		!hasControlCharacter(value)
	);
}

export function createOpenedTab(input: OpenTabInput): OpenedTab {
	if (!validTitle(input.title)) {
		throw new TypeError("Tab title must be a non-empty canonical label.");
	}
	const match = resolveProtectedRoute(input.href);
	if (!match || match.routeId !== input.routeId) {
		throw new TypeError("Tab href must match its registered protected route.");
	}
	return {
		closable: match.closable,
		href: match.href,
		key: match.key,
		routeId: match.routeId,
		title: input.title,
	};
}

function pinnedProgramsTab(): OpenedTab {
	return createOpenedTab({
		href: PROGRAMS_PATH,
		routeId: "programs",
		title: PROTECTED_ROUTE_REGISTRY.programs.fallbackTitle,
	});
}

function initialState(initialLocale: SupportedLocale): ShellUiState {
	const pinned = pinnedProgramsTab();
	return {
		accountId: null,
		activeTabKey: pinned.key,
		hydrated: false,
		locale: initialLocale,
		mobileNavigationOpen: false,
		openedTabs: [pinned],
		sidebarCollapsed: false,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePersistedTab(value: unknown): OpenedTab | null {
	if (!isRecord(value) || !validTitle(value.title)) return null;
	if (
		typeof value.href !== "string" ||
		typeof value.key !== "string" ||
		typeof value.routeId !== "string" ||
		typeof value.closable !== "boolean"
	) {
		return null;
	}

	const match = resolveProtectedRoute(value.href);
	if (
		!match ||
		match.routeId !== value.routeId ||
		match.key !== value.key ||
		match.closable !== value.closable
	) {
		return null;
	}

	return {
		closable: match.closable,
		href: match.href,
		key: match.key,
		routeId: match.routeId,
		title: value.title,
	};
}

function normalizePersistedTabs(value: unknown): OpenedTab[] {
	const tabs = [pinnedProgramsTab()];
	if (!Array.isArray(value)) return tabs;

	for (const candidate of value.slice(0, MAX_OPENED_TABS)) {
		const tab = normalizePersistedTab(candidate);
		if (!tab) continue;
		const existingIndex = tabs.findIndex(({ key }) => key === tab.key);
		if (existingIndex >= 0) tabs[existingIndex] = tab;
		else if (tabs.length < MAX_OPENED_TABS) tabs.push(tab);
	}
	return tabs;
}

function parsePersistedState(raw: string | null): PersistedShellUiState | null {
	if (!raw) return null;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRecord(value) || value.version !== 1) return null;

	const openedTabs = normalizePersistedTabs(value.openedTabs);
	const activeTabKey =
		typeof value.activeTabKey === "string" &&
		openedTabs.some(({ key }) => key === value.activeTabKey)
			? value.activeTabKey
			: openedTabs[0]?.key;
	if (!activeTabKey) return null;

	return {
		activeTabKey,
		...(validLocale(value.locale) ? { locale: value.locale } : {}),
		openedTabs,
		sidebarCollapsed:
			typeof value.sidebarCollapsed === "boolean"
				? value.sidebarCollapsed
				: false,
		version: 1,
	};
}

function replaceOrAppendTab(
	openedTabs: readonly OpenedTab[],
	tab: OpenedTab,
): readonly OpenedTab[] {
	const index = openedTabs.findIndex(({ key }) => key === tab.key);
	if (index < 0) {
		return openedTabs.length < MAX_OPENED_TABS
			? [...openedTabs, tab]
			: [...openedTabs.slice(0, MAX_OPENED_TABS - 1), tab];
	}
	return openedTabs.map((current, currentIndex) =>
		currentIndex === index ? tab : current,
	);
}

function persistedState(state: ShellUiState): PersistedShellUiState {
	return {
		activeTabKey: state.activeTabKey,
		locale: state.locale,
		openedTabs: state.openedTabs,
		sidebarCollapsed: state.sidebarCollapsed,
		version: 1,
	};
}

export function createShellUiController(
	options: ShellUiControllerOptions = {},
): ShellUiController {
	const initialLocale = validLocale(options.initialLocale)
		? options.initialLocale
		: "zh-CN";
	const storage =
		options.storage === undefined ? browserSessionStorage() : options.storage;
	const store = new Store<ShellUiState>(initialState(initialLocale));

	const writeState = (state: ShellUiState) => {
		if (!storage || !state.accountId || !state.hydrated) return;
		try {
			storage.setItem(
				shellUiStorageKey(state.accountId),
				JSON.stringify(persistedState(state)),
			);
		} catch {
			// UI state persistence is best effort; navigation remains in memory.
		}
	};
	const persistenceSubscription = store.subscribe(writeState);

	const openOrActivateTab = (input: OpenTabInput): OpenedTab => {
		const tab = createOpenedTab(input);
		store.setState((state) => ({
			...state,
			activeTabKey: tab.key,
			mobileNavigationOpen: false,
			openedTabs: replaceOrAppendTab(state.openedTabs, tab),
		}));
		return tab;
	};

	const hydrateForAccount = (input: HydrateForAccountInput) => {
		requireAccountId(input.accountId);

		let persisted: PersistedShellUiState | null = null;
		if (storage) {
			try {
				persisted = parsePersistedState(
					storage.getItem(shellUiStorageKey(input.accountId)),
				);
			} catch {
				persisted = null;
			}
		}

		const openedTabs = persisted?.openedTabs ?? [pinnedProgramsTab()];
		let next: ShellUiState = {
			accountId: input.accountId,
			activeTabKey: persisted?.activeTabKey ?? openedTabs[0]?.key ?? "programs",
			hydrated: true,
			locale: validLocale(input.locale)
				? input.locale
				: (persisted?.locale ?? initialLocale),
			mobileNavigationOpen: false,
			openedTabs,
			sidebarCollapsed: persisted?.sidebarCollapsed ?? false,
		};
		if (input.currentTab) {
			const currentTab = createOpenedTab(input.currentTab);
			next = {
				...next,
				activeTabKey: currentTab.key,
				openedTabs: replaceOrAppendTab(next.openedTabs, currentTab),
			};
		}
		store.setState(() => next);
	};

	return {
		store,
		closeTab: (key) => {
			const state = store.state;
			const index = state.openedTabs.findIndex((tab) => tab.key === key);
			const tab = state.openedTabs[index];
			if (index < 0 || !tab?.closable) {
				return { closed: false, navigateTo: null };
			}

			const openedTabs = state.openedTabs.filter(
				(candidate) => candidate.key !== key,
			);
			if (state.activeTabKey !== key) {
				store.setState((current) => ({ ...current, openedTabs }));
				return { closed: true, navigateTo: null };
			}

			const fallback =
				state.openedTabs[index - 1] ?? openedTabs[0] ?? pinnedProgramsTab();
			store.setState((current) => ({
				...current,
				activeTabKey: fallback.key,
				openedTabs,
			}));
			return { closed: true, navigateTo: fallback.href };
		},
		dispose: () => persistenceSubscription.unsubscribe(),
		getState: () => store.state,
		hydrateForAccount,
		logout: () => {
			const accountId = store.state.accountId;
			if (storage && accountId) {
				try {
					storage.removeItem(shellUiStorageKey(accountId));
				} catch {
					// In-memory reset remains authoritative for logout.
				}
			}
			store.setState(() => initialState(initialLocale));
		},
		openOrActivateTab,
		setLocale: (locale) => {
			if (!validLocale(locale)) throw new TypeError("Unsupported locale.");
			store.setState((state) => ({ ...state, locale }));
		},
		setMobileNavigationOpen: (mobileNavigationOpen) =>
			store.setState((state) => ({ ...state, mobileNavigationOpen })),
		setSidebarCollapsed: (sidebarCollapsed) =>
			store.setState((state) => ({ ...state, sidebarCollapsed })),
		subscribe: (listener) => {
			const subscription = store.subscribe(listener);
			return () => subscription.unsubscribe();
		},
		switchAccount: hydrateForAccount,
		toggleSidebar: () =>
			store.setState((state) => ({
				...state,
				sidebarCollapsed: !state.sidebarCollapsed,
			})),
	};
}

export const shellUiController = createShellUiController();
export const shellUiStore = shellUiController.store;

export function useShellUiSelector<Selected>(
	selector: (state: ShellUiState) => Selected,
): Accessor<Selected> {
	return useSelector(shellUiStore, selector);
}
