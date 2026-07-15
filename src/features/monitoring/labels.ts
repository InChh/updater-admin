import type { MessageKey } from "../../lib/i18n/catalogs";
import type { I18nContextValue } from "../../lib/i18n/i18n";
import type {
	AuditAction,
	AuditResourceType,
	AuditResult,
} from "../../shared/api/audit";

const ACTION_KEYS = {
	"api.mutation": "audit.action.apiMutation",
	"administrator.created": "audit.action.administratorCreated",
	"administrator.password.reset": "audit.action.administratorPasswordReset",
	"administrator.sessions.revoked": "audit.action.administratorSessionsRevoked",
	"administrator.updated": "audit.action.administratorUpdated",
	"profile.password.changed": "audit.action.profilePasswordChanged",
	"profile.updated": "audit.action.profileUpdated",
	"program.created": "audit.action.programCreated",
	"program.deleted": "audit.action.programDeleted",
	"program.updated": "audit.action.programUpdated",
	"system-settings.updated": "audit.action.systemSettingsUpdated",
	"upload.completed": "audit.action.uploadCompleted",
	"upload.credentials.issued": "audit.action.uploadCredentialsIssued",
	"version.activation.updated": "audit.action.versionActivationUpdated",
	"version.created": "audit.action.versionCreated",
	"version.deleted": "audit.action.versionDeleted",
	"version.updated": "audit.action.versionUpdated",
} as const satisfies Record<AuditAction, MessageKey>;

const RESOURCE_KEYS = {
	administrator: "audit.resource.administrator",
	api: "audit.resource.api",
	profile: "audit.resource.profile",
	program: "audit.resource.program",
	"system-settings": "audit.resource.systemSettings",
	upload: "audit.resource.upload",
	version: "audit.resource.version",
} as const satisfies Record<AuditResourceType, MessageKey>;

const RESULT_KEYS = {
	failure: "audit.result.failure",
	success: "audit.result.success",
} as const satisfies Record<AuditResult, MessageKey>;

export function auditActionLabel(
	i18n: I18nContextValue,
	action: string,
): string {
	return Object.hasOwn(ACTION_KEYS, action)
		? i18n.t(ACTION_KEYS[action as AuditAction])
		: action;
}

export function auditResourceLabel(
	i18n: I18nContextValue,
	resourceType: string,
): string {
	return Object.hasOwn(RESOURCE_KEYS, resourceType)
		? i18n.t(RESOURCE_KEYS[resourceType as AuditResourceType])
		: resourceType;
}

export function auditResultLabel(
	i18n: I18nContextValue,
	result: AuditResult,
): string {
	return i18n.t(RESULT_KEYS[result]);
}
