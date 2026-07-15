export type AuthMutationErrorCode =
	| "AUTH_REQUEST_FAILED"
	| "INVALID_CREDENTIALS"
	| "RATE_LIMITED";

export interface AuthMutationResult {
	readonly error?: {
		readonly code: AuthMutationErrorCode;
	} | null;
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

const MAX_AUTH_ERROR_BODY_BYTES = 1024;

function requestFailure(
	code: AuthMutationErrorCode = "AUTH_REQUEST_FAILED",
): AuthMutationResult {
	return { error: { code } };
}

async function hasInvalidCredentialsCode(response: Response): Promise<boolean> {
	const contentType = response.headers.get("content-type")?.toLowerCase();
	if (
		!contentType ||
		(!contentType.startsWith("application/json") &&
			!contentType.startsWith("application/problem+json"))
	) {
		return false;
	}

	const declaredLength = response.headers.get("content-length");
	if (
		declaredLength &&
		(/^\d+$/.test(declaredLength) === false ||
			Number(declaredLength) > MAX_AUTH_ERROR_BODY_BYTES)
	) {
		return false;
	}

	const reader = response.body?.getReader();
	if (!reader) return false;
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let body = "";
	let bytesRead = 0;

	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			if (!chunk.value) continue;
			bytesRead += chunk.value.byteLength;
			if (bytesRead > MAX_AUTH_ERROR_BODY_BYTES) {
				await reader.cancel();
				return false;
			}
			body += decoder.decode(chunk.value, { stream: true });
		}
		body += decoder.decode();
	} catch {
		return false;
	} finally {
		reader.releaseLock();
	}

	try {
		const parsed: unknown = JSON.parse(body);
		return (
			typeof parsed === "object" &&
			parsed !== null &&
			"code" in parsed &&
			parsed.code === "INVALID_EMAIL_OR_PASSWORD"
		);
	} catch {
		return false;
	}
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
		if (response.ok) return {};
		if (path === "/api/auth/sign-in/email") {
			if (response.status === 429) return requestFailure("RATE_LIMITED");
			if (
				response.status === 401 &&
				(await hasInvalidCredentialsCode(response))
			) {
				return requestFailure("INVALID_CREDENTIALS");
			}
		}
		return requestFailure();
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
