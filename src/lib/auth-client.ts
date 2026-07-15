interface AuthMutationResult {
	readonly error?: unknown;
}

type AuthClientResult = Promise<AuthMutationResult>;

interface EmailSignInInput {
	readonly email: string;
	readonly password: string;
}

type AuthMutationPath =
	| "/api/auth/revoke-other-sessions"
	| "/api/auth/sign-in/email"
	| "/api/auth/sign-out";

function requestFailure(): AuthMutationResult {
	return { error: { code: "AUTH_REQUEST_FAILED" } };
}

async function postAuthMutation(
	path: AuthMutationPath,
	body: EmailSignInInput | Record<string, never>,
): AuthClientResult {
	try {
		const response = await fetch(path, {
			body: JSON.stringify(body),
			credentials: "same-origin",
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		return response.ok ? {} : requestFailure();
	} catch {
		return requestFailure();
	}
}

// Better Auth remains the sole server-side owner of credential and cookie
// mutations. This browser adapter exposes only the three UI-owned operations;
// TanStack Query continues to own the session cache through session-query.ts.
export const authClient = {
	revokeOtherSessions: (): AuthClientResult =>
		postAuthMutation("/api/auth/revoke-other-sessions", {}),
	signIn: {
		email: (input: EmailSignInInput): AuthClientResult =>
			postAuthMutation("/api/auth/sign-in/email", input),
	},
	signOut: (): AuthClientResult => postAuthMutation("/api/auth/sign-out", {}),
};
