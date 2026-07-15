import { describe, expect, it } from "vitest";

import { sessionLabel } from "./account-page";

const zhFallbacks = {
	unknownBrowser: "浏览器",
	unknownClient: "未知客户端",
	unknownOs: "未知系统",
};

describe("sessionLabel", () => {
	it("uses localized fallbacks without changing recognized browser names", () => {
		expect(sessionLabel(null, zhFallbacks)).toBe("未知客户端");
		expect(sessionLabel("CustomAgent/1.0", zhFallbacks)).toBe(
			"浏览器 · 未知系统",
		);
		expect(
			sessionLabel(
				"Mozilla/5.0 (Mac OS X) AppleWebKit Safari/605.1",
				zhFallbacks,
			),
		).toBe("Safari · macOS");
	});
});
