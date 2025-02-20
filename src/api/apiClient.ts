import axios, { type AxiosRequestConfig, type AxiosError, type AxiosResponse } from "axios";

import { t } from "@/locales/i18n";
import userStore from "@/store/userStore";

import { User } from "oidc-client-ts";
import { useAuth } from "react-oidc-context";
import { toast } from "sonner";
import type { ErrorResponse } from "#/api";

// 创建 axios 实例
const axiosInstance = axios.create({
	baseURL: import.meta.env.VITE_APP_BASE_API,
	timeout: 50000,
	headers: { "Content-Type": "application/json;charset=utf-8" },
});

function getToken() {
	const oidcStorage = localStorage.getItem(
		`oidc.user:${import.meta.env.VITE_APP_OIDC_AUTHORITY}:${import.meta.env.VITE_APP_OIDC_CLIENT_ID}`,
	);
	if (!oidcStorage) {
		return null;
	}

	return User.fromStorageString(oidcStorage).access_token;
}

// 请求拦截
axiosInstance.interceptors.request.use(
	(config) => {
		// 在请求被发送之前做些什么
		const token = getToken();
		config.headers.Authorization = `Bearer ${token}`;
		return config;
	},
	(error) => {
		// 请求错误时做些什么
		return Promise.reject(error);
	},
);

// 响应拦截
axiosInstance.interceptors.response.use(
	(res: AxiosResponse<any>) => {
		// const { status, data, message } = res.data;
		// // 业务请求成功
		// const hasSuccess = data && Reflect.has(res.data, "status") && status === ResultEnum.SUCCESS;
		// if (hasSuccess) {
		return res.data;
		// }

		// 业务请求错误
		// throw new Error(message || t("sys.api.apiRequestFailed"));
	},
	(error: AxiosError<ErrorResponse>) => {
		const { response, message } = error || {};

		const errMsg = response?.data.error.message || message || t("sys.api.errorMessage");
		const details = response?.data.error.details;
		const status = response?.status;
		if (status === 401) {
			const auth = useAuth();
			userStore.getState().actions.clearUserInfoAndToken();
			auth.signinRedirect();
		}
		if (status !== 404) {
			toast.error(`${errMsg}${details ? `: ${details}` : ""}`, {
				position: "top-center",
			});
		}
		return Promise.reject(error);
	},
);

class APIClient {
	get<T = any>(config: AxiosRequestConfig): Promise<T> {
		return this.request({ ...config, method: "GET" });
	}

	post<T = any>(config: AxiosRequestConfig): Promise<T> {
		return this.request({ ...config, method: "POST" });
	}

	put<T = any>(config: AxiosRequestConfig): Promise<T> {
		return this.request({ ...config, method: "PUT" });
	}

	delete<T = any>(config: AxiosRequestConfig): Promise<T> {
		return this.request({ ...config, method: "DELETE" });
	}

	request<T = any>(config: AxiosRequestConfig): Promise<T> {
		return new Promise((resolve, reject) => {
			axiosInstance
				.request<any, AxiosResponse<any>>(config)
				.then((res: AxiosResponse<any>) => {
					resolve(res as unknown as Promise<T>);
				})
				.catch((e: Error | AxiosError) => {
					reject(e);
				});
		});
	}
}

export default new APIClient();
