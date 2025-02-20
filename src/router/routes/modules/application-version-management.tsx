import { CircleLoading } from "@/components/loading";
import { Suspense, lazy } from "react";
import type { AppRouteObject } from "#/router";

const ApplicationVersionPage = lazy(() => import("@/pages/application-version"));

const ApplicationVersionManagement: AppRouteObject = {
	path: "version/:applicationId",
	element: (
		<Suspense fallback={<CircleLoading />}>
			<ApplicationVersionPage />
		</Suspense>
	),
	meta: {
		key: "/version/:applicationId",
		label: "sys.menu.applicationVersions",
		hideMenu: true,
	},
};

export default ApplicationVersionManagement;
