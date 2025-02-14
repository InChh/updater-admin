import { Helmet } from "react-helmet-async";

import Logo from "@/assets/images/logo.png";
import Router from "@/router/index";

import { hasAuthParams, useAuth } from "react-oidc-context";
import { MotionLazy } from "./components/animate/motion-lazy";
import Toast from "./components/toast";
import { AntdAdapter } from "./theme/adapter/antd.adapter";
import { ThemeProvider } from "./theme/theme-provider";
import { useEffect, useState } from "react";

function App() {
	const auth = useAuth();
	const [hasTriedSignin, setHasTriedSignin] = useState(false);

	// automatically sign-in
	useEffect(() => {
		if (!hasAuthParams() && !auth.isAuthenticated && !auth.activeNavigator && !auth.isLoading && !hasTriedSignin) {
			auth.signinRedirect();
			setHasTriedSignin(true);
		}
	}, [auth, hasTriedSignin]);

	return (
		<ThemeProvider adapters={[AntdAdapter]}>
			<MotionLazy>
				<Helmet>
					<title>软件版本管理系统</title>
					<link rel="icon" href={Logo} />
				</Helmet>
				<Toast />

				<Router />
			</MotionLazy>
		</ThemeProvider>
	);
}

export default App;
