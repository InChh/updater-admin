import { createFileRoute } from "@tanstack/solid-router";

import { forwardApiRequest } from "../server/api/app.server";

export const Route = createFileRoute("/health")({
	server: {
		handlers: {
			GET: ({ request }) => forwardApiRequest(request),
		},
	},
});
