import process from "node:process";

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

type EnvironmentValidator = (value: string) => boolean;

export class EnvironmentValidationError extends Error {
	readonly variableNames: readonly string[];

	constructor(variableNames: readonly string[]) {
		const names = [...new Set(variableNames)].sort();
		super(`Missing or invalid environment variables: ${names.join(", ")}`);
		this.name = "EnvironmentValidationError";
		this.variableNames = names;
	}
}

function isUrlWithProtocols(...protocols: string[]): EnvironmentValidator {
	return (value) => {
		try {
			const url = new URL(value);
			return protocols.includes(url.protocol) && Boolean(url.hostname);
		} catch {
			return false;
		}
	};
}

const localDevelopmentHostnames = new Set([
	"localhost",
	"127.0.0.1",
	"[::1]",
	"::1",
]);

function isProductionEnvironment(source: EnvironmentSource) {
	return [source.NODE_ENV, source.CONTEXT].some(
		(value) => value?.trim().toLowerCase() === "production",
	);
}

function isApplicationOrigin(value: string, production: boolean): boolean {
	try {
		const url = new URL(value);
		const isOriginOnly =
			Boolean(url.hostname) &&
			!url.username &&
			!url.password &&
			(url.pathname === "/" || url.pathname === "") &&
			!url.search &&
			!url.hash;

		if (!isOriginOnly) return false;
		if (url.protocol === "https:") return true;

		return (
			!production &&
			url.protocol === "http:" &&
			localDevelopmentHostnames.has(url.hostname.toLowerCase())
		);
	} catch {
		return false;
	}
}

function isRepeatedSecret(value: string) {
	for (
		let patternLength = 1;
		patternLength <= value.length / 2;
		patternLength++
	) {
		if (value.length % patternLength !== 0) continue;

		const pattern = value.slice(0, patternLength);
		if (pattern.repeat(value.length / patternLength) === value) return true;
	}

	return false;
}

interface DiverseValueConstraints {
	readonly maximumLength?: number;
	readonly minimumLength: number;
	readonly minimumUniqueCharacters: number;
}

function isDiverseNonRepeatedValue(
	value: string,
	{
		maximumLength = Number.POSITIVE_INFINITY,
		minimumLength,
		minimumUniqueCharacters,
	}: DiverseValueConstraints,
) {
	return (
		value.length >= minimumLength &&
		value.length <= maximumLength &&
		value.trim() === value &&
		new Set(value).size >= minimumUniqueCharacters &&
		!isRepeatedSecret(value)
	);
}

const insecureSecretMarkers = [
	"betterauthsecret",
	"changeme",
	"defaultsecret",
	"examplesecret",
	"placeholdersecret",
	"replaceme",
	"testsecret",
	"yoursecret",
];

const isStrongAuthSecret: EnvironmentValidator = (value) => {
	if (
		!isDiverseNonRepeatedValue(value, {
			minimumLength: 32,
			minimumUniqueCharacters: 12,
		})
	) {
		return false;
	}

	const canonicalValue = value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
	return !insecureSecretMarkers.some((marker) =>
		canonicalValue.includes(marker),
	);
};

const isStrongBootstrapPassword: EnvironmentValidator = (value) =>
	isDiverseNonRepeatedValue(value, {
		maximumLength: 128,
		minimumLength: 12,
		minimumUniqueCharacters: 8,
	});

function readRequiredEnvironment<const Name extends string>(
	source: EnvironmentSource,
	validators: Readonly<Record<Name, EnvironmentValidator>>,
): Record<Name, string> {
	const invalidNames: string[] = [];
	const values = {} as Record<Name, string>;

	for (const name of Object.keys(validators) as Name[]) {
		const value = source[name];
		if (!value || !value.trim() || !validators[name](value)) {
			invalidNames.push(name);
			continue;
		}
		values[name] = value;
	}

	if (invalidNames.length > 0) {
		throw new EnvironmentValidationError(invalidNames);
	}

	return values;
}

const isPresent: EnvironmentValidator = () => true;

export function readDatabaseEnvironment(
	source: EnvironmentSource = process.env,
) {
	const values = readRequiredEnvironment(source, {
		DATABASE_URL: isUrlWithProtocols("postgres:", "postgresql:"),
	});
	return { databaseUrl: values.DATABASE_URL };
}

export function readAuthEnvironment(source: EnvironmentSource = process.env) {
	const production = isProductionEnvironment(source);
	const values = readRequiredEnvironment(source, {
		BETTER_AUTH_SECRET: isStrongAuthSecret,
		BETTER_AUTH_URL: (value) => isApplicationOrigin(value, production),
	});
	return {
		betterAuthSecret: values.BETTER_AUTH_SECRET,
		betterAuthUrl: values.BETTER_AUTH_URL,
	};
}

export function readBootstrapAdminEnvironment(
	source: EnvironmentSource = process.env,
) {
	const values = readRequiredEnvironment(source, {
		BOOTSTRAP_ADMIN_EMAIL: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
		BOOTSTRAP_ADMIN_NAME: isPresent,
		BOOTSTRAP_ADMIN_PASSWORD: isStrongBootstrapPassword,
	});
	return {
		email: values.BOOTSTRAP_ADMIN_EMAIL,
		name: values.BOOTSTRAP_ADMIN_NAME,
		password: values.BOOTSTRAP_ADMIN_PASSWORD,
	};
}

export function readOssEnvironment(source: EnvironmentSource = process.env) {
	const values = readRequiredEnvironment(source, {
		OSS_ACCESS_KEY_ID: isPresent,
		OSS_ACCESS_KEY_SECRET: isPresent,
		OSS_BUCKET: (value) => /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value),
		OSS_REGION: isPresent,
		OSS_STS_ENDPOINT: isPresent,
		OSS_UPLOAD_PREFIX: isPresent,
		OSS_UPLOAD_RAM_ROLE_ARN: isPresent,
	});
	return {
		accessKeyId: values.OSS_ACCESS_KEY_ID,
		accessKeySecret: values.OSS_ACCESS_KEY_SECRET,
		bucket: values.OSS_BUCKET,
		region: values.OSS_REGION,
		stsEndpoint: values.OSS_STS_ENDPOINT,
		uploadPrefix: values.OSS_UPLOAD_PREFIX,
		uploadRoleArn: values.OSS_UPLOAD_RAM_ROLE_ARN,
	};
}

export function readSentryRuntimeEnvironment(
	source: EnvironmentSource = process.env,
) {
	const values = readRequiredEnvironment(source, {
		SENTRY_DSN: isUrlWithProtocols("http:", "https:"),
		SENTRY_ENVIRONMENT: isPresent,
	});
	return {
		dsn: values.SENTRY_DSN,
		environment: values.SENTRY_ENVIRONMENT,
	};
}

export function readSentrySourceMapEnvironment(
	source: EnvironmentSource = process.env,
) {
	const values = readRequiredEnvironment(source, {
		SENTRY_AUTH_TOKEN: isPresent,
		SENTRY_ORG: isPresent,
		SENTRY_PROJECT: isPresent,
	});
	return {
		authToken: values.SENTRY_AUTH_TOKEN,
		organization: values.SENTRY_ORG,
		project: values.SENTRY_PROJECT,
	};
}
