import { cleanup } from "@solidjs/testing-library";
import { afterEach } from "vitest";

function createMemoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => values.delete(key),
		setItem: (key, value) => values.set(key, value),
	};
}

// Node 25 exposes an incomplete experimental Storage when no backing file is
// configured. Keep browser tests deterministic by using a standards-shaped
// in-memory implementation when jsdom inherits that incomplete global.
if (typeof window.localStorage?.clear !== "function") {
	Object.defineProperty(window, "localStorage", {
		configurable: true,
		value: createMemoryStorage(),
	});
}

if (typeof window.sessionStorage?.clear !== "function") {
	Object.defineProperty(window, "sessionStorage", {
		configurable: true,
		value: createMemoryStorage(),
	});
}

afterEach(() => {
	cleanup();
});
