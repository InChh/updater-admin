import { useI18n } from "../../lib/i18n/i18n";

export function SkipLink() {
	const i18n = useI18n();
	return (
		<a
			class="focus-ring sr-only z-[110] rounded-md bg-white px-3 py-2 text-sm text-ink focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
			href="#main-content"
		>
			{i18n.t("a11y.skipToContent")}
		</a>
	);
}
