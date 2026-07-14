import { Elysia } from "elysia";

import { readAuthEnvironment } from "../../env.server";
import { isApiV1Path, requestPathname } from "../context.server";
import { ApiProblemError } from "../problem";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface OriginPluginDependencies {
	readonly getCanonicalOrigin?: () => string | Promise<string>;
}

function normalizeOrigin(value: string): string | null {
	try {
		const parsed = new URL(value);
		if (
			parsed.username ||
			parsed.password ||
			(parsed.pathname !== "/" && parsed.pathname !== "") ||
			parsed.search ||
			parsed.hash
		) {
			return null;
		}
		return parsed.origin;
	} catch {
		return null;
	}
}

export function createOriginPlugin({
	getCanonicalOrigin = () => readAuthEnvironment().betterAuthUrl,
}: OriginPluginDependencies = {}) {
	return new Elysia({ name: "updater-admin.origin" }).onRequest(
		async ({ request }) => {
			if (
				!isApiV1Path(requestPathname(request)) ||
				SAFE_METHODS.has(request.method)
			) {
				return;
			}

			const suppliedOrigin = request.headers.get("origin");
			const canonicalOrigin = normalizeOrigin(await getCanonicalOrigin());
			if (
				!suppliedOrigin ||
				!canonicalOrigin ||
				normalizeOrigin(suppliedOrigin) !== canonicalOrigin
			) {
				throw new ApiProblemError({ code: "FORBIDDEN", status: 403 });
			}
		},
	);
}
