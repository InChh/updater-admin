import type { SupportedLocale } from "./common";

export interface ProfileDto {
	readonly currentSession: {
		readonly createdAt: string;
		readonly expiresAt: string;
		readonly id: string;
		readonly updatedAt: string;
	};
	readonly email: string;
	readonly emailVerified: boolean;
	readonly id: string;
	readonly image: string | null;
	readonly lastLoginAt: string | null;
	readonly locale: SupportedLocale;
	readonly mustChangePassword: boolean;
	readonly name: string;
	readonly otherSessions: readonly ProfileSessionSummaryDto[];
}

export interface ProfileSessionSummaryDto {
	readonly createdAt: string;
	readonly expiresAt: string;
	readonly id: string;
	readonly ipAddress: string | null;
	readonly updatedAt: string;
	readonly userAgent: string | null;
}

export type UpdateProfileInput =
	| { readonly locale: SupportedLocale; readonly name?: string }
	| { readonly locale?: SupportedLocale; readonly name: string };

export interface ChangePasswordInput {
	readonly currentPassword: string;
	readonly newPassword: string;
}

export interface PasswordChangedResult {
	readonly reauthenticationRequired: true;
}
