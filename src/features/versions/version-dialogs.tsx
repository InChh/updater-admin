import { ClientOnly } from "@tanstack/solid-router";
import { createClientOnlyFn } from "@tanstack/solid-start";
import { lazy } from "solid-js";

import type { VersionDialogsProps } from "./version-dialogs.client";

export type {
	VersionDialogsProps,
	VersionUploadSession,
	VersionUploadSessionFactory,
} from "./version-dialogs.client";

const loadVersionDialogs = createClientOnlyFn(
	() => import("./version-dialogs.client"),
);
const ClientVersionDialogs = lazy(loadVersionDialogs);

/**
 * Upload dialogs own File, Worker, and ali-oss state, so the implementation is
 * loaded only after hydration while this isomorphic route keeps a safe shell.
 */
export function VersionDialogs(props: VersionDialogsProps) {
	return (
		<ClientOnly fallback={null}>
			<ClientVersionDialogs {...props} />
		</ClientOnly>
	);
}
