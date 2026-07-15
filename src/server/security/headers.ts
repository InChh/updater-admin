export const SECURITY_RESPONSE_HEADERS = {
	"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
} as const;

/**
 * Netlify custom headers do not apply to SSR/function responses, so Start's
 * request middleware applies the same policy to every dynamic response.
 */
export function withSecurityResponseHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
		headers.set(name, value);
	}

	return new Response(response.body, {
		headers,
		status: response.status,
		statusText: response.statusText,
	});
}
