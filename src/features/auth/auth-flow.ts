import type { ChangePasswordInput } from "../../shared/api/profile";
import type { LoginCredentials } from "./login-form";

export interface AuthMutationResult {
	readonly error?: unknown;
}

export interface SignInFlowDependencies<Session> {
	readonly loadSession: () => Promise<Session | null>;
	readonly signIn: (
		credentials: LoginCredentials,
	) => Promise<AuthMutationResult>;
}

export interface PasswordRotationDependencies<Session>
	extends SignInFlowDependencies<Session> {
	readonly changePassword: (input: ChangePasswordInput) => Promise<unknown>;
	readonly clearSessionCache: () => void;
}

export class AuthenticationFlowError extends Error {
	constructor(readonly code: "SIGN_IN_FAILED" | "SESSION_NOT_ESTABLISHED") {
		super(code);
		this.name = "AuthenticationFlowError";
	}
}

export async function signInAndLoadSession<Session>(
	credentials: LoginCredentials,
	dependencies: SignInFlowDependencies<Session>,
): Promise<Session> {
	const result = await dependencies.signIn(credentials);
	if (result.error) throw new AuthenticationFlowError("SIGN_IN_FAILED");
	const session = await dependencies.loadSession();
	if (!session) throw new AuthenticationFlowError("SESSION_NOT_ESTABLISHED");
	return session;
}

export async function rotatePasswordAndReplaceSession<Session>(
	input: ChangePasswordInput & { readonly email: string },
	dependencies: PasswordRotationDependencies<Session>,
): Promise<Session> {
	await dependencies.changePassword({
		currentPassword: input.currentPassword,
		newPassword: input.newPassword,
	});
	// The Elysia endpoint revokes the request session and every older session.
	// Purge Query's projection before Better Auth establishes the replacement.
	dependencies.clearSessionCache();
	return signInAndLoadSession(
		{ email: input.email, password: input.newPassword },
		dependencies,
	);
}
