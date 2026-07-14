import { createFileRoute } from "@tanstack/solid-router";

import { PlaceholderPage } from "../../features/shell/placeholder-page";

export const Route = createFileRoute(
	"/_authenticated/programs/$programId/versions",
)({
	component: ProgramVersionsPlaceholder,
	ssr: false,
});

function ProgramVersionsPlaceholder() {
	const params = Route.useParams();
	return (
		<PlaceholderPage programId={params().programId} routeId="programVersions" />
	);
}
