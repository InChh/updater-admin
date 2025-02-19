import { SvgIcon } from "@/components/icon";
import { CircleLoading } from "@/components/loading";
import { Suspense, lazy } from "react";
import type { AppRouteObject } from "#/router.ts";

const ApplicationPage = lazy(() => import("@/pages/application"));

const applicationManagement: AppRouteObject = {
	order: 3,
	path: "application",
	meta: {
		label: "sys.menu.applications",
		icon: <SvgIcon icon="ic-application" className="ant-menu-item-icon" size="24" />,
		key: "/application",
	},
	element: (
		<Suspense fallback={<CircleLoading />}>
			<ApplicationPage />
		</Suspense>
	),
};

export default applicationManagement;
