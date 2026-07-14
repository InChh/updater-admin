export const DISPOSABLE_DATABASE_CONFIRMATION =
	"updater-admin-destructive-tests";

function normalizedDatabaseHostname(hostname: string) {
	const labels = hostname.toLowerCase().split(".");
	const firstLabel = labels[0];
	if (firstLabel?.endsWith("-pooler")) {
		labels[0] = firstLabel.slice(0, -"-pooler".length);
	}
	return labels.join(".");
}

function normalizedDatabasePort(url: URL) {
	if (url.port) return url.port;
	return url.protocol === "postgres:" || url.protocol === "postgresql:"
		? "5432"
		: "";
}

function normalizedDatabaseName(url: URL) {
	const path = url.pathname.startsWith("/")
		? url.pathname.slice(1)
		: url.pathname;
	// Match the Neon/pg connection parser, which decodes the path with decodeURI.
	return decodeURI(path);
}

export function pointsToSameDatabase(left: string, right: string | undefined) {
	if (!right) return false;
	try {
		const leftUrl = new URL(left);
		const rightUrl = new URL(right);
		return (
			normalizedDatabaseHostname(leftUrl.hostname) ===
				normalizedDatabaseHostname(rightUrl.hostname) &&
			normalizedDatabasePort(leftUrl) === normalizedDatabasePort(rightUrl) &&
			normalizedDatabaseName(leftUrl) === normalizedDatabaseName(rightUrl)
		);
	} catch {
		// Destructive test guards must fail closed for malformed URL encodings.
		return true;
	}
}

interface DisposableDatabaseGuardInput {
	readonly confirmation: string | undefined;
	readonly databaseUrl: string | undefined;
	readonly testDatabaseUrl: string;
}

export function assertDisposableDatabaseGuard({
	confirmation,
	databaseUrl,
	testDatabaseUrl,
}: DisposableDatabaseGuardInput) {
	if (confirmation !== DISPOSABLE_DATABASE_CONFIRMATION) {
		throw new Error(
			`TEST_DATABASE_CONFIRM_DISPOSABLE must equal ${DISPOSABLE_DATABASE_CONFIRMATION}`,
		);
	}
	if (pointsToSameDatabase(testDatabaseUrl, databaseUrl)) {
		throw new Error(
			"TEST_DATABASE_URL must not identify the DATABASE_URL database",
		);
	}
}
