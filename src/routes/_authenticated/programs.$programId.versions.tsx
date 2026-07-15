import { createQuery } from "@tanstack/solid-query";
import {
	createFileRoute,
	useNavigate,
	useRouterState,
} from "@tanstack/solid-router";
import { createEffect, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { programDetailQueryOptions } from "../../features/programs/queries";
import { applySystemDefaultPageSize } from "../../features/settings/system-defaults";
import { systemSettingsQueryOptions } from "../../features/settings/system-queries";
import { shellUiController } from "../../features/shell/ui-store";
import { versionListQueryOptions } from "../../features/versions/queries";
import {
	parseProgramVersionsParams,
	validateVersionRouteSearch,
	versionListLoaderDeps,
} from "../../features/versions/search";
import { VersionsPage } from "../../features/versions/versions-page";
import { useI18n } from "../../lib/i18n/i18n";

export const Route = createFileRoute(
	"/_authenticated/programs/$programId/versions",
)({
	params: { parse: parseProgramVersionsParams },
	validateSearch: validateVersionRouteSearch,
	loaderDeps: ({ search }) => versionListLoaderDeps(search),
	loader: async ({ context, deps, params }) => {
		const programOptions = programDetailQueryOptions(params.programId);
		const settingsOptions = systemSettingsQueryOptions();
		await Promise.all([
			context.queryClient.prefetchQuery(programOptions),
			context.queryClient.prefetchQuery(settingsOptions),
		]);
		const settings = context.queryClient.getQueryData(settingsOptions.queryKey);
		const listSearch = applySystemDefaultPageSize(
			deps,
			settings?.data.defaultPageSize ?? 20,
		);
		await context.queryClient.prefetchQuery(
			versionListQueryOptions(params.programId, listSearch),
		);
		return { pageSize: listSearch.pageSize };
	},
	component: ProgramVersionsRoute,
	ssr: false,
});

function ProgramVersionsRoute() {
	const i18n = useI18n();
	const data = Route.useLoaderData();
	const href = useRouterState({ select: (state) => state.location.href });
	const navigate = useNavigate({ from: Route.fullPath });
	const params = Route.useParams();
	const search = Route.useSearch();
	const programQuery = createQuery(() =>
		programDetailQueryOptions(params().programId),
	);

	createEffect(() => {
		const program = programQuery.data;
		if (!program) return;
		const currentHref = href();
		const title = program.data.name;
		// AppShell first records the concrete href. Retitle in a microtask so its
		// generic ID-prefix fallback cannot win a same-tick search navigation.
		queueMicrotask(() => {
			if (href() !== currentHref) return;
			shellUiController.openOrActivateTab({
				href: currentHref,
				routeId: "programVersions",
				title,
			});
		});
	});

	return (
		<Show
			when={!programQuery.isError || programQuery.data}
			fallback={
				<div class="page-enter mx-auto w-full max-w-[1180px] px-5 py-7 lg:px-8 lg:py-9">
					<section class="panel overflow-hidden">
						<div class="grid min-h-64 place-items-center p-8 text-center">
							<div>
								<p class="m-0 text-sm text-danger" role="alert">
									{i18n.formatApiError(programQuery.error)}
								</p>
								<Button
									class="mt-4"
									onClick={() => void programQuery.refetch()}
									type="button"
									variant="secondary"
								>
									{i18n.t("common.retry")}
								</Button>
							</div>
						</div>
					</section>
				</div>
			}
		>
			<Show
				keyed
				when={programQuery.data}
				fallback={
					<div class="grid min-h-64 place-items-center text-sm text-muted">
						{i18n.t("common.loading")}
					</div>
				}
			>
				{(program) => (
					<VersionsPage
						onSearchChange={(nextSearch, options) => {
							void navigate({
								replace: options?.replace,
								search: nextSearch,
							});
						}}
						program={() => program}
						search={() => ({ ...search(), pageSize: data().pageSize })}
					/>
				)}
			</Show>
		</Show>
	);
}
