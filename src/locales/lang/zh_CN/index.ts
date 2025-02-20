import account from "./account.json";
import application from "./application.json";
import common from "./common.json";
import sys from "./sys.json";

export default {
	...common,
	...sys,
	...application,
	...account,
};
