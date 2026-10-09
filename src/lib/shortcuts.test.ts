import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS, mergeWithDefaults } from "./shortcuts";

describe("mergeWithDefaults", () => {
	it("moves a saved legacy ⌘D delete binding to the new default", () => {
		const merged = mergeWithDefaults({ deleteSelected: { key: "d", ctrl: true } });
		expect(merged.deleteSelected).toEqual(DEFAULT_SHORTCUTS.deleteSelected);
	});

	it("keeps other custom bindings", () => {
		const merged = mergeWithDefaults({ deleteSelected: { key: "x", alt: true } });
		expect(merged.deleteSelected).toEqual({ key: "x", alt: true });
	});
});
