import type { Accessor, JSX } from "solid-js";
import { Show } from "solid-js";

import type { EntityResult } from "../../shared/api/common";
import type { ProgramDetailDto } from "../../shared/api/programs";

export interface ProgramVersionsDataBoundaryProps {
	readonly children: (
		program: Accessor<EntityResult<ProgramDetailDto>>,
	) => JSX.Element;
	readonly fallback: JSX.Element;
	readonly program: Accessor<EntityResult<ProgramDetailDto> | null | undefined>;
}

/**
 * Keeps the versions subtree mounted while a background program query replaces
 * its data object. The subtree owns live File and Worker state during uploads,
 * so keying it by the query result would discard an in-progress session.
 */
export function ProgramVersionsDataBoundary(
	props: ProgramVersionsDataBoundaryProps,
) {
	return (
		<Show fallback={props.fallback} when={props.program()}>
			{(program) => props.children(program)}
		</Show>
	);
}
