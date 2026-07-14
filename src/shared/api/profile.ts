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
}

export interface ChangePasswordInput {
	readonly currentPassword: string;
	readonly newPassword: string;
}

export interface PasswordChangedResult {
	readonly reauthenticationRequired: true;
}
