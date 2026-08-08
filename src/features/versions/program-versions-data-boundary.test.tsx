import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal, onCleanup, onMount } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";

import type { EntityResult } from "../../shared/api/common";
import type { ProgramDetailDto } from "../../shared/api/programs";
import { ProgramVersionsDataBoundary } from "./program-versions-data-boundary";

afterEach(cleanup);

function program(versionCount: number): EntityResult<ProgramDetailDto> {
	return {
		data: {
			createdAt: "2026-08-08T00:00:00.000Z",
			description: "",
			id: "50d5b11b-db8d-419a-b699-97320ada7c72",
			name: "Upload acceptance",
			updatedAt: "2026-08-08T00:00:00.000Z",
			versionCount,
		},
		etag: 'W/"1"',
	};
}

describe("ProgramVersionsDataBoundary", () => {
	it("keeps the upload-owning subtree mounted across program data refreshes", () => {
		const [currentProgram, setCurrentProgram] = createSignal(program(2));
		let cleanups = 0;
		let mounts = 0;

		function UploadOwner(props: {
			readonly current: () => EntityResult<ProgramDetailDto>;
		}) {
			onMount(() => {
				mounts += 1;
			});
			onCleanup(() => {
				cleanups += 1;
			});
			return <output>{props.current().data.versionCount}</output>;
		}

		const view = render(() => (
			<ProgramVersionsDataBoundary
				fallback={<span>Loading</span>}
				program={currentProgram}
			>
				{(current) => <UploadOwner current={current} />}
			</ProgramVersionsDataBoundary>
		));

		expect(screen.getByText("2")).toBeTruthy();
		expect(mounts).toBe(1);
		setCurrentProgram(program(3));
		expect(screen.getByText("3")).toBeTruthy();
		expect(mounts).toBe(1);
		expect(cleanups).toBe(0);

		view.unmount();
		expect(cleanups).toBe(1);
	});
});
