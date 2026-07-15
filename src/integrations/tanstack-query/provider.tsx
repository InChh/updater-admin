import { MutationCache, QueryClient } from "@tanstack/solid-query";

import { captureBrowserException } from "../../lib/sentry";

export function createApplicationQueryClient() {
	return new QueryClient({
		mutationCache: new MutationCache({
			onError: (error) => captureBrowserException(error),
		}),
	});
}

export function getContext() {
	const queryClient = createApplicationQueryClient();
	return {
		queryClient,
	};
}
