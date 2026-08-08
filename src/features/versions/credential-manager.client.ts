import type {
	UploadCredentialsRequest,
	UploadCredentialsResponse,
} from "../../shared/api/uploads";

export const UPLOAD_CREDENTIAL_MIN_VALIDITY_MS = 60_000;

export type RequestUploadCredentials = (
	input: UploadCredentialsRequest,
	signal?: AbortSignal,
) => Promise<UploadCredentialsResponse>;

export interface UploadCredentialManagerOptions {
	readonly minimumValidityMs?: number;
	readonly now?: () => number;
	readonly requestCredentials: RequestUploadCredentials;
}

export interface UploadCredentialManager {
	dispose(): void;
	getCredentials(): Promise<UploadCredentialsResponse>;
	peekCredentials(): UploadCredentialsResponse | null;
}

function hasMinimumValidity(
	response: UploadCredentialsResponse,
	now: number,
	minimumValidityMs: number,
): boolean {
	const expiration = Date.parse(response.credentials.expiration);
	return Number.isFinite(expiration) && expiration - now > minimumValidityMs;
}

/**
 * One workflow owns one manager. Credentials, the refresh promise, and the
 * request controller stay in memory and disappear when the workflow closes.
 */
export function createUploadCredentialManager(
	options: UploadCredentialManagerOptions,
): UploadCredentialManager {
	const now = options.now ?? Date.now;
	const minimumValidityMs =
		options.minimumValidityMs ?? UPLOAD_CREDENTIAL_MIN_VALIDITY_MS;
	if (!Number.isFinite(minimumValidityMs) || minimumValidityMs < 0) {
		throw new RangeError("minimumValidityMs must be non-negative.");
	}

	let cached: UploadCredentialsResponse | null = null;
	let inFlight: Promise<UploadCredentialsResponse> | null = null;
	let activeRequest: AbortController | null = null;
	let disposed = false;

	const assertUsable = () => {
		if (disposed)
			throw new Error("Upload credential manager has been disposed.");
	};

	return {
		dispose: () => {
			if (disposed) return;
			disposed = true;
			activeRequest?.abort();
			activeRequest = null;
			cached = null;
			inFlight = null;
		},
		getCredentials: async () => {
			assertUsable();
			if (cached && hasMinimumValidity(cached, now(), minimumValidityMs)) {
				return cached;
			}
			if (inFlight) return inFlight;

			const controller = new AbortController();
			activeRequest = controller;
			const request = options
				.requestCredentials({}, controller.signal)
				.then((response) => {
					assertUsable();
					if (!hasMinimumValidity(response, now(), minimumValidityMs)) {
						throw new Error(
							"Upload credentials are invalid or expire too soon to start an upload.",
						);
					}
					cached = response;
					return response;
				});
			inFlight = request;
			try {
				return await request;
			} finally {
				if (inFlight === request) inFlight = null;
				if (activeRequest === controller) activeRequest = null;
			}
		},
		peekCredentials: () => cached,
	};
}
