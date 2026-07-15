import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../lib/i18n/i18n";
import type { ProfileDto } from "../../shared/api/profile";
import { ProfileForm } from "./profile-form";

const routerMocks = vi.hoisted(() => ({
	invalidate: vi.fn(async () => {}),
	navigate: vi.fn(async () => {}),
}));

vi.mock("@tanstack/solid-router", () => ({
	useRouter: () => routerMocks,
}));
vi.mock("../../components/ui/toast", () => ({ notify: vi.fn() }));
vi.mock("../../lib/session-query", () => ({
	sessionQueryKey: ["auth", "session"] as const,
}));

const PROFILE: ProfileDto = {
	currentSession: {
		createdAt: "2026-07-15T00:00:00.000Z",
		expiresAt: "2026-07-16T00:00:00.000Z",
		id: "ca6f79db-c7c4-4a34-9ab5-2a85ca9df501",
		updatedAt: "2026-07-15T00:00:00.000Z",
	},
	email: "admin@example.com",
	emailVerified: true,
	id: "ba6f79db-c7c4-4a34-9ab5-2a85ca9df502",
	image: null,
	lastLoginAt: "2026-07-15T01:00:00.000Z",
	locale: "zh-CN",
	mustChangePassword: false,
	name: "Release Admin",
	otherSessions: [],
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("ProfileForm", () => {
	it("does not persist the locale a second time after saving the profile", async () => {
		const updatedProfile = {
			...PROFILE,
			locale: "en" as const,
			name: "Release Admin Updated",
		};
		const fetcher = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) =>
				new Response(
					JSON.stringify(init?.method === "PATCH" ? updatedProfile : PROFILE),
					{
						headers: {
							"content-type": "application/json",
							etag: init?.method === "PATCH" ? 'W/"2"' : 'W/"1"',
						},
					},
				),
		);
		vi.stubGlobal("fetch", fetcher);
		const onLocaleChange = vi.fn(async () => {});
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		render(() => (
			<QueryClientProvider client={queryClient}>
				<I18nProvider locale="zh-CN" onLocaleChange={onLocaleChange}>
					<ProfileForm />
				</I18nProvider>
			</QueryClientProvider>
		));

		const nameInput = await screen.findByRole("textbox", { name: "姓名" });
		fireEvent.input(nameInput, {
			target: { value: updatedProfile.name },
		});
		fireEvent.change(screen.getByRole("combobox", { name: "界面语言" }), {
			target: { value: "en" },
		});
		fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

		await waitFor(() => {
			expect(
				fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH"),
			).toHaveLength(1);
			expect(routerMocks.invalidate).toHaveBeenCalledWith({ sync: true });
		});
		expect(onLocaleChange).not.toHaveBeenCalled();
	});
});
