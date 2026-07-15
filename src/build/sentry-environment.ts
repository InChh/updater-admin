export function resolveBrowserSentryEnvironment(
	mode: string,
	environment: Readonly<Record<string, string | undefined>>,
): string {
	return (
		environment.SENTRY_ENVIRONMENT?.trim() ||
		environment.CONTEXT?.trim() ||
		mode
	);
}
