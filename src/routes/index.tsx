import { createFileRoute, redirect } from "@tanstack/solid-router";

export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({
			search: { page: 1, pageSize: 20, sort: "createdAt:desc" },
			to: "/programs",
		});
	},
});
