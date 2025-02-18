/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_APP_ROUTER_MODE: "permission" | "module";
	readonly VITE_APP_BASE_API: string;
	readonly VITE_APP_HOMEPAGE: string;
	readonly VITE_APP_BASE_PATH: string;
	readonly VITE_APP_ENV: "development" | "production";
	readonly VITE_APP_OIDC_AUTHORITY: string;
	readonly VITE_APP_OIDC_CLIENT_ID: string;
	readonly VITE_APP_OSS_REGION: string;
	readonly VITE_APP_OSS_BUCKET: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
