import type { MessageKey } from "../../lib/i18n/catalogs";

export const PROGRAMS_PATH = "/programs" as const;

export const PROTECTED_ROUTE_IDS = [
	"programs",
	"programVersions",
	"administrators",
	"monitoringOverview",
	"monitoringAudit",
	"profileSettings",
	"accountSettings",
	"systemSettings",
] as const;

export type ProtectedRouteId = (typeof PROTECTED_ROUTE_IDS)[number];
export type ProtectedNavGroup =
	| "programs"
	| "administrators"
	| "monitoring"
	| "settings";
type DeclaredRouteMessageKey =
	`routes.${ProtectedRouteId}.${"pageTitle" | "tabTitle"}`;
type Assert<Condition extends true> = Condition;
type _RouteMessageKeysExistInCatalog = Assert<
	DeclaredRouteMessageKey extends MessageKey ? true : false
>;
export type RouteMessageKey = DeclaredRouteMessageKey;
export type RouteMessageKeyCatalogAlignment = _RouteMessageKeysExistInCatalog;

export interface ProtectedRouteDefinition {
	readonly closable: boolean;
	readonly fallbackTitle: string;
	readonly id: ProtectedRouteId;
	readonly navGroup: ProtectedNavGroup;
	readonly pageTitleKey: RouteMessageKey;
	readonly path: string;
	readonly tabTitleKey: RouteMessageKey;
}

export const PROTECTED_ROUTE_REGISTRY = {
	accountSettings: {
		closable: true,
		fallbackTitle: "Account",
		id: "accountSettings",
		navGroup: "settings",
		pageTitleKey: "routes.accountSettings.pageTitle",
		path: "/settings/account",
		tabTitleKey: "routes.accountSettings.tabTitle",
	},
	administrators: {
		closable: true,
		fallbackTitle: "Administrators",
		id: "administrators",
		navGroup: "administrators",
		pageTitleKey: "routes.administrators.pageTitle",
		path: "/administrators",
		tabTitleKey: "routes.administrators.tabTitle",
	},
	monitoringAudit: {
		closable: true,
		fallbackTitle: "Audit",
		id: "monitoringAudit",
		navGroup: "monitoring",
		pageTitleKey: "routes.monitoringAudit.pageTitle",
		path: "/monitoring/audit",
		tabTitleKey: "routes.monitoringAudit.tabTitle",
	},
	monitoringOverview: {
		closable: true,
		fallbackTitle: "Monitoring",
		id: "monitoringOverview",
		navGroup: "monitoring",
		pageTitleKey: "routes.monitoringOverview.pageTitle",
		path: "/monitoring/overview",
		tabTitleKey: "routes.monitoringOverview.tabTitle",
	},
	profileSettings: {
		closable: true,
		fallbackTitle: "Profile",
		id: "profileSettings",
		navGroup: "settings",
		pageTitleKey: "routes.profileSettings.pageTitle",
		path: "/settings/profile",
		tabTitleKey: "routes.profileSettings.tabTitle",
	},
	programVersions: {
		closable: true,
		fallbackTitle: "Program versions",
		id: "programVersions",
		navGroup: "programs",
		pageTitleKey: "routes.programVersions.pageTitle",
		path: "/programs/$programId/versions",
		tabTitleKey: "routes.programVersions.tabTitle",
	},
	programs: {
		closable: false,
		fallbackTitle: "Programs",
		id: "programs",
		navGroup: "programs",
		pageTitleKey: "routes.programs.pageTitle",
		path: PROGRAMS_PATH,
		tabTitleKey: "routes.programs.tabTitle",
	},
	systemSettings: {
		closable: true,
		fallbackTitle: "System settings",
		id: "systemSettings",
		navGroup: "settings",
		pageTitleKey: "routes.systemSettings.pageTitle",
		path: "/settings/system",
		tabTitleKey: "routes.systemSettings.tabTitle",
	},
} as const satisfies Record<ProtectedRouteId, ProtectedRouteDefinition>;

export interface ProtectedRouteMatch {
	readonly closable: boolean;
	readonly fallbackTitle: string;
	readonly href: string;
	readonly key: string;
	readonly navGroup: ProtectedNavGroup;
	readonly pageTitleKey: RouteMessageKey;
	readonly programId?: string;
	readonly routeId: ProtectedRouteId;
	readonly tabTitleKey: RouteMessageKey;
}

const INTERNAL_URL_BASE = "https://updater-admin.invalid";
const MAX_INTERNAL_HREF_LENGTH = 2048;
const CANONICAL_UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROGRAM_VERSIONS_PATH_PATTERN =
	/^\/programs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/versions$/;
const ENCODED_CONTROL_CHARACTER_PATTERN = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;

const STATIC_ROUTE_IDS = PROTECTED_ROUTE_IDS.filter(
	(routeId): routeId is Exclude<ProtectedRouteId, "programVersions"> =>
		routeId !== "programVersions",
);

function canonicalInternalHref(value: unknown): string | null {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > MAX_INTERNAL_HREF_LENGTH ||
		value !== value.trim() ||
		!value.startsWith("/") ||
		value.startsWith("//") ||
		value.includes("\\") ||
		ENCODED_CONTROL_CHARACTER_PATTERN.test(value) ||
		[...value].some((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint < 32 || codePoint === 127;
		})
	) {
		return null;
	}

	let parsed: URL;
	try {
		parsed = new URL(value, INTERNAL_URL_BASE);
	} catch {
		return null;
	}

	if (
		parsed.origin !== INTERNAL_URL_BASE ||
		parsed.pathname.includes("%") ||
		parsed.hash.length > 0
	) {
		return null;
	}

	const canonical = `${parsed.pathname}${parsed.search}${parsed.hash}`;
	return canonical === value ? canonical : null;
}

export function isCanonicalProgramId(value: string): boolean {
	return CANONICAL_UUID_PATTERN.test(value);
}

function requireCanonicalProgramId(programId: string): void {
	if (!isCanonicalProgramId(programId)) {
		throw new TypeError("programId must be a canonical lowercase UUID.");
	}
}

export function programVersionsHref(programId: string): string {
	requireCanonicalProgramId(programId);
	return `/programs/${programId}/versions`;
}

export function programVersionsTabKey(programId: string): string {
	requireCanonicalProgramId(programId);
	return `programVersions:${programId}`;
}

export function resolveProtectedRoute(
	value: unknown,
): ProtectedRouteMatch | null {
	const href = canonicalInternalHref(value);
	if (!href) return null;

	const parsed = new URL(href, INTERNAL_URL_BASE);
	const programVersionsMatch = PROGRAM_VERSIONS_PATH_PATTERN.exec(
		parsed.pathname,
	);
	if (programVersionsMatch) {
		const programId = programVersionsMatch[1];
		if (!programId) return null;
		const definition = PROTECTED_ROUTE_REGISTRY.programVersions;
		return {
			closable: definition.closable,
			fallbackTitle: definition.fallbackTitle,
			href,
			key: programVersionsTabKey(programId),
			navGroup: definition.navGroup,
			pageTitleKey: definition.pageTitleKey,
			programId,
			routeId: definition.id,
			tabTitleKey: definition.tabTitleKey,
		};
	}

	for (const routeId of STATIC_ROUTE_IDS) {
		const definition = PROTECTED_ROUTE_REGISTRY[routeId];
		if (parsed.pathname === definition.path) {
			return {
				closable: definition.closable,
				fallbackTitle: definition.fallbackTitle,
				href,
				key: definition.id,
				navGroup: definition.navGroup,
				pageTitleKey: definition.pageTitleKey,
				routeId: definition.id,
				tabTitleKey: definition.tabTitleKey,
			};
		}
	}

	return null;
}

export function isProtectedRouteHref(value: unknown): value is string {
	return resolveProtectedRoute(value) !== null;
}

/** Return a registered same-origin destination, or the pinned programs page. */
export function validateReturnTo(value: unknown): string {
	return resolveProtectedRoute(value)?.href ?? PROGRAMS_PATH;
}
