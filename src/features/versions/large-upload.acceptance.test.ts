import { describe, it } from "vitest";

import { runLargeReleaseAcceptance } from "../../../scripts/accept-large-release";

describe.runIf(process.env.RUN_LARGE_UPLOAD_ACCEPTANCE === "true")(
	"real 2,000-file local upload acceptance",
	() => {
		it(
			"uploads a complete release, reuses 1,999 files, and uploads one changed file",
			async () => {
				await runLargeReleaseAcceptance();
			},
			20 * 60 * 1_000,
		);
	},
);
