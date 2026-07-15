import { createFileRoute, redirect } from "@tanstack/solid-router";

export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({
			search: { page: 1, sort: "createdAt:desc" },
			to: "/programs",
		});
	},
});
