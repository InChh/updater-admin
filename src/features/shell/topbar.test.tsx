import { render, screen } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../lib/i18n/i18n";
import { runSignOut, safeExternalRepositoryUrl, Topbar } from "./topbar";

vi.mock("@tanstack/solid-router", () => ({
	Link: (props: { readonly children?: JSX.Element; readonly to: string }) => (
		<a href={props.to}>{props.children}</a>
	),
}));

const user = {
	email: "admin@example.com",
	image: null,
	name: "Release Admin",
};

function renderTopbar(repositoryUrl: string | null) {
	return render(() => (
		<I18nProvider locale="en">
			<Topbar
				collapsed={false}
				onNavigate={() => {}}
				onOpenMobileNavigation={() => {}}
				onSignOut={() => {}}
				onToggleSidebar={() => {}}
				repositoryUrl={repositoryUrl}
				user={user}
			/>
		</I18nProvider>
	));
}

describe("safeExternalRepositoryUrl", () => {
	it("accepts only credential-free HTTPS links", () => {
		expect(
			safeExternalRepositoryUrl("https://github.com/example/updater"),
		).toBe("https://github.com/example/updater");
		for (const unsafe of [
			null,
			"",
			"http://github.com/example/updater",
			"https://user:secret@github.com/example/updater",
			"javascript:alert(1)",
			"//github.com/example/updater",
		]) {
			expect(safeExternalRepositoryUrl(unsafe)).toBeNull();
		}
	});

	it("shows the repository shortcut only for a safe configured URL", () => {
		const empty = renderTopbar(null);
		expect(
			screen.queryByRole("link", {
				name: "Open source repository in a new window",
			}),
		).toBeNull();
		empty.unmount();

		renderTopbar("https://git.example.com/team/updater");
		const link = screen.getByRole("link", {
			name: "Open source repository in a new window",
		});
		expect(link.getAttribute("href")).toBe(
			"https://git.example.com/team/updater",
		);
		expect(link.getAttribute("target")).toBe("_blank");
		expect(link.getAttribute("rel")).toBe("noopener noreferrer");
		expect(link.getAttribute("referrerpolicy")).toBe("no-referrer");
	});
});

describe("runSignOut", () => {
	it("surfaces sign-out rejection through the supplied UI error handler", async () => {
		const failure = new Error("SIGN_OUT_FAILED");
		const onError = vi.fn();

		await expect(
			runSignOut(async () => {
				throw failure;
			}, onError),
		).resolves.toBeUndefined();
		expect(onError).toHaveBeenCalledWith(failure);
	});
});
