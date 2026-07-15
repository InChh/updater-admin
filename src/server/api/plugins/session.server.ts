import { Elysia } from "elysia";
import {
	getSafeSession,
	type SafeSessionView,
} from "../../auth/session.server";
import {
	type ApiRequestContextStore,
	canonicalApiPathname,
	isApiV1Path,
	requestPathname,
} from "../context.server";
import { ApiProblemError } from "../problem";

const FORCED_PASSWORD_ALLOWED_REQUESTS = new Set([
	"GET /api/v1/profile",
	"POST /api/v1/profile/change-password",
]);

export interface SessionPluginDependencies {
	readonly contextStore: ApiRequestContextStore;
	readonly getSession?: (headers: Headers) => Promise<SafeSessionView | null>;
}

export function createSessionPlugin({
	contextStore,
	getSession = getSafeSession,
}: SessionPluginDependencies) {
	return new Elysia({ name: "updater-admin.session" }).onRequest(
		async ({ request }) => {
			const pathname = canonicalApiPathname(requestPathname(request));
			if (!isApiV1Path(pathname)) return;

			const session = await getSession(request.headers);
			if (!session) {
				throw new ApiProblemError({
					code: "UNAUTHENTICATED",
					status: 401,
				});
			}
			if (session.user.role !== "admin") {
				throw new ApiProblemError({ code: "FORBIDDEN", status: 403 });
			}
			if (session.user.banned) {
				throw new ApiProblemError({ code: "FORBIDDEN", status: 403 });
			}
			if (
				session.metadata.mustChangePassword &&
				!FORCED_PASSWORD_ALLOWED_REQUESTS.has(`${request.method} ${pathname}`)
			) {
				throw new ApiProblemError({ code: "FORBIDDEN", status: 403 });
			}

			contextStore.setSession(request, session);
		},
	);
}
