import { queryOptions } from "@tanstack/solid-query";
import { createServerFn } from "@tanstack/solid-start";
import {
	getRequestHeaders,
	setResponseHeader,
} from "@tanstack/solid-start/server";

import { getSafeSession } from "../server/auth/session.server";

export const sessionQueryKey = ["auth", "session"] as const;

export const getSessionServerFn = createServerFn({ method: "GET" }).handler(
	async () => {
		setResponseHeader("Cache-Control", "no-store");
		setResponseHeader("Vary", "Cookie");
		return getSafeSession(new Headers(getRequestHeaders()));
	},
);

export function sessionQueryOptions() {
	return queryOptions({
		gcTime: 5 * 60 * 1_000,
		queryFn: () => getSessionServerFn(),
		queryKey: sessionQueryKey,
		retry: false,
		staleTime: 30_000,
	});
}
