// react-query
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// vercel analytics
import { Analytics } from "@vercel/analytics/react";
// react
import { Suspense } from "react";
import ReactDOM from "react-dom/client";
// helmet
import { HelmetProvider } from "react-helmet-async";
// svg icons
import "virtual:svg-icons-register";
// mock api
import worker from "./_mock";
// i18n
import "./locales/i18n";
// css
import "./global.css";
import "./theme/theme.css";

import { type User, WebStorageStateStore } from "oidc-client-ts";
import { AuthProvider, type AuthProviderProps } from "react-oidc-context";
// root component
import App from "./App";
import ProgressBar from "./components/progress-bar";
import useUserStore from "./store/userStore";

const charAt = `
    ███████╗██╗      █████╗ ███████╗██╗  ██╗ 
    ██╔════╝██║     ██╔══██╗██╔════╝██║  ██║
    ███████╗██║     ███████║███████╗███████║
    ╚════██║██║     ██╔══██║╚════██║██╔══██║
    ███████║███████╗██║  ██║███████║██║  ██║
    ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
  `;
console.info(`%c${charAt}`, "color: #5BE49B");

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const oidcConfig: AuthProviderProps = {
	authority: import.meta.env.VITE_APP_OIDC_AUTHORITY,
	client_id: import.meta.env.VITE_APP_OIDC_CLIENT_ID,
	scope: "openid profile email offline_access roles UpdaterServer",
	redirect_uri: `${window.location.origin}/signin-oidc`,
	userStore: new WebStorageStateStore({ store: window.localStorage }),
	onSigninCallback: (user: User | undefined): void => {
		window.history.replaceState({}, document.title, window.location.pathname);
		if (user) {
			const userStore = useUserStore.getState();
			userStore.actions.setUserToken({
				accessToken: user.access_token,
				refreshToken: user.refresh_token,
			});
			userStore.actions.setUserInfo({
				id: user.profile.sub,
				email: user.profile.email ?? "",
				username: user.profile.preferred_username ?? "",
				avatar: user.profile.picture,
				role: user.profile.roles as string[],
			});
			console.info("🚀 Successfully signed in", user);
		}
	},
};
root.render(
	<AuthProvider {...oidcConfig}>
		<HelmetProvider>
			<QueryClientProvider client={new QueryClient()}>
				{/* <ReactQueryDevtools initialIsOpen={false} /> */}
				<Suspense>
					<ProgressBar />
					<Analytics />
					<App />
				</Suspense>
			</QueryClientProvider>
		</HelmetProvider>
		,
	</AuthProvider>,
);

// 🥵 start service worker mock in development mode
worker.start({ onUnhandledRequest: "bypass" });
