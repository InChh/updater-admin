import { createFileRoute } from "@tanstack/solid-router";

import { forwardApiRequest } from "../../../../server/api/app.server";

export const Route = createFileRoute("/api/public/v2/$")({
	server: {
		handlers: {
			ANY: ({ request }) => forwardApiRequest(request),
		},
	},
});
