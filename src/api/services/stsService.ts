import apiClient from "@/api/apiClient.ts";

export enum StsServiceApi {
	Sts = "/app/sts/upload",
}

export interface StsToken {
	accessKeyId: string;
	accessKeySecret: string;
	securityToken: string;
	expiration: string;
}

const getStsToken = () =>
	apiClient.get<StsToken>({
		url: StsServiceApi.Sts,
	});

export default {
	getStsToken,
};
