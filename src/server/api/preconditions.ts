import { UPDATER_IF_MATCH_HEADER } from "../../shared/api/common";
import { ApiProblemError } from "./problem";

/**
 * Netlify consumes the standard If-Match request header before proxying a
 * mutation to the server function, so API preconditions use an app-owned
 * request header while responses continue to expose standard ETag headers.
 */
export function readUpdaterIfMatch(request: Request): string {
	const ifMatch = request.headers.get(UPDATER_IF_MATCH_HEADER);
	if (ifMatch === null) {
		throw new ApiProblemError({ code: "PRECONDITION_REQUIRED", status: 428 });
	}
	return ifMatch;
}
