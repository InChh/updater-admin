import { Construction } from "lucide-solid";
import { Show } from "solid-js";

import { useI18n } from "../../lib/i18n/i18n";
import {
	PROTECTED_ROUTE_REGISTRY,
	type ProtectedRouteId,
} from "./route-registry";

export interface PlaceholderPageProps {
	readonly programId?: string;
	readonly routeId: ProtectedRouteId;
}

export function PlaceholderPage(props: PlaceholderPageProps) {
	const i18n = useI18n();
	const definition = () => PROTECTED_ROUTE_REGISTRY[props.routeId];
	return (
		<div class="page-enter mx-auto w-full max-w-[1180px] px-5 py-7 lg:px-8 lg:py-9">
			<header class="mb-5 flex min-h-9 items-center justify-between gap-4">
				<div>
					<h1 class="m-0 text-xl font-semibold tracking-[-0.012em] text-ink">
						{i18n.t(definition().pageTitleKey)}
					</h1>
					<Show when={props.programId}>
						<p class="data-text m-0 mt-1 text-xs text-muted">
							{props.programId}
						</p>
					</Show>
				</div>
			</header>
			<section class="panel grid min-h-72 place-items-center px-6 py-12 text-center">
				<div class="max-w-sm">
					<div class="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-lg bg-primary-soft text-primary-deep">
						<Construction aria-hidden="true" size={21} />
					</div>
					<p class="m-0 text-sm leading-6 text-muted">
						{i18n.t("pages.placeholder")}
					</p>
				</div>
			</section>
		</div>
	);
}
