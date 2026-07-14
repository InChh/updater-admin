import type { ApiProblem } from "../../shared/api/common";
import type {
	ChangePasswordInput,
	PasswordChangedResult,
} from "../../shared/api/profile";

export class ApiProblemResponse extends Error {
	readonly problem: ApiProblem;

	constructor(problem: ApiProblem) {
		super(problem.code);
		this.name = "ApiProblemResponse";
		this.problem = problem;
	}
}

function isApiProblem(value: unknown): value is ApiProblem {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<ApiProblem>;
	return (
		typeof candidate.code === "string" &&
		typeof candidate.requestId === "string" &&
		typeof candidate.status === "number" &&
		typeof candidate.title === "string" &&
		typeof candidate.type === "string"
	);
}

async function readProblem(response: Response): Promise<ApiProblem> {
	try {
		const value: unknown = await response.json();
		if (isApiProblem(value)) return value;
	} catch {
		// The fallback remains deterministic and contains no server response text.
	}
	return {
		code: "INTERNAL_ERROR",
		requestId: response.headers.get("x-request-id") ?? "unavailable",
		status: response.status,
		title: "Request failed",
		type: "about:blank",
	};
}

export async function changeCurrentPassword(
	input: ChangePasswordInput,
	fetcher: typeof fetch = fetch,
): Promise<PasswordChangedResult> {
	const response = await fetcher("/api/v1/profile/change-password", {
		body: JSON.stringify(input),
		credentials: "include",
		headers: { "content-type": "application/json" },
		method: "POST",
	});
	if (!response.ok) throw new ApiProblemResponse(await readProblem(response));
	return (await response.json()) as PasswordChangedResult;
}
