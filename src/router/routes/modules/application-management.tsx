import { Iconify } from "@/components/icon";
import { CircleLoading } from "@/components/loading";
import { Suspense, lazy } from "react";
import type { AppRouteObject } from "#/router.ts";

const ApplicationPage = lazy(() => import("@/pages/application"));

const applicationManagement: AppRouteObject = {
	order: 1,
	path: "application",
	meta: {
		label: "sys.menu.applications",
		icon: <Iconify icon="icon-park-solid:all-application" className="ant-menu-item-icon" size="24" />,
		key: "/application",
	},
	element: (
		<Suspense fallback={<CircleLoading />}>
			<ApplicationPage />
		</Suspense>
	),
};

export default applicationManagement;
