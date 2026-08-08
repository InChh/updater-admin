import { createQuery } from "@tanstack/solid-query";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { createEffect, Show } from "solid-js";

import { Button } from "../../components/ui/button";
import { programDetailQueryOptions } from "../../features/programs/queries";
import {
	applySystemDefaultPageSize,
	resolveSystemDefaultPageSize,
} from "../../features/settings/system-defaults";
import { programVersionsTabKey } from "../../features/shell/route-registry";
import {
	shellUiController,
	useShellUiSelector,
} from "../../features/shell/ui-store";
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
	loader: ({ context, deps, params }) => {
		const programOptions = programDetailQueryOptions(params.programId);
		void context.queryClient.prefetchQuery(programOptions);
		const listSearch = applySystemDefaultPageSize(
			deps,
			resolveSystemDefaultPageSize(context.queryClient),
		);
		return { pageSize: listSearch.pageSize };
	},
	component: ProgramVersionsRoute,
	ssr: false,
});

function ProgramVersionsRoute() {
	const i18n = useI18n();
	const data = Route.useLoaderData();
	const navigate = useNavigate({ from: Route.fullPath });
	const params = Route.useParams();
	const search = Route.useSearch();
	const programQuery = createQuery(() =>
		programDetailQueryOptions(params().programId),
	);
	const currentTab = useShellUiSelector((state) =>
		state.openedTabs.find(
			({ key }) => key === programVersionsTabKey(params().programId),
		),
	);

	createEffect(() => {
		const program = programQuery.data;
		const tab = currentTab();
		if (!program || !tab || tab.title === program.data.name) return;
		shellUiController.retitleTab(tab.key, program.data.name);
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
