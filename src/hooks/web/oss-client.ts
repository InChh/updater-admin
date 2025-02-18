import OSS from "ali-oss";
import stsService from "@/api/services/stsService.ts";

let ossClient: OSS | undefined = undefined;

const useOssClient = async () => {
	if (ossClient !== undefined) {
		return ossClient;
	}

	const token = await stsService.getStsToken();
	ossClient = new OSS({
		region: import.meta.env.VITE_APP_OSS_REGION,
		accessKeyId: token.accessKeyId,
		accessKeySecret: token.accessKeySecret,
		stsToken: token.securityToken,
		bucket: import.meta.env.VITE_APP_OSS_BUCKET,
	});
	return ossClient;
};

export default useOssClient;
