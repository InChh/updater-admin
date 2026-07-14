import { createFileRoute, Outlet } from "@tanstack/solid-router";

export const Route = createFileRoute("/_authenticated/programs")({
	component: () => <Outlet />,
	ssr: false,
});
