import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildSensitiveSpans,
	classifySensitiveValue,
	detectSensitiveTokens,
	type ScannedFrame,
} from "./sensitiveText";

describe("classifySensitiveValue", () => {
	it.each([
		["sk-proj-4fJ9xQ2LmZt8VwR1bN6cYh3KdPa7Es0U", "known-format"],
		["ghp_8Rk2mXvQ9LsT4wYz1NbC6dHe0JfA3gUi5PoK", "known-format"],
		["AKIAIOSFODNN7EXAMPLE", "known-format"],
		["sk_live_51HxQ2LmZt8VwR1bN6cYh3", "known-format"],
		["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0", "known-format"],
		["Zq8#vL2!pT9xR4@mW7kN3$bY", "high-entropy"],
	])("flags %s", (value, reason) => {
		expect(classifySensitiveValue(value, null)).toBe(reason);
	});

	it("flags values after a secret label", () => {
		expect(classifySensitiveValue("hunter2-Correct!Horse", "Password:")).toBe("labelled");
		expect(classifySensitiveValue("abc123", "API_KEY=")).toBe("labelled");
		expect(classifySensitiveValue("Bearer", "Authorization:")).toBeNull();
	});

	it.each([
		"3f2c9a1e-7b4d-4e8a-9c6f-1d2e3f4a5b6c",
		"https://api.notte.cc/v1/sessions",
		"lucas@example.com",
		"a1b2c3d",
		"••••••••",
		"src/components/video-editor/VideoPlayback.tsx",
		"'origin/main'.",
		"displays.",
	])("ignores %s", (value) => {
		expect(classifySensitiveValue(value, null)).toBeNull();
	});
});

describe("detectSensitiveTokens", () => {
	it("blurs only the value of a KEY=value token", () => {
		const text = "OPENAI_API_KEY=sk-proj-4fJ9xQ2LmZt8VwR1bN6cYh3KdPa7Es0U";
		const [detection] = detectSensitiveTokens([{ text, box: [0, 0.5, 1, 0.02] }]);
		expect(detection.reason).toBe("known-format");
		expect(detection.box[0]).toBeCloseTo(15 / text.length);
	});
});

describe("buildSensitiveSpans on a real Vision scan", () => {
	// Output of recordly-text-scan on a 12s video: a terminal with an OpenAI key
	// and a JWT (0-4s), a settings page with a password, a GitHub token and an
	// AWS key (4-8s), and release notes with no secrets (8-12s).
	const frames: ScannedFrame[] = readFileSync(
		path.join(__dirname, "__fixtures__/sensitive-text-scan.jsonl"),
		"utf8",
	)
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line))
		.filter((entry) => entry.type === "frame");

	it("finds every secret and nothing on the clean screen", () => {
		const spans = buildSensitiveSpans(frames, 500, 12000);
		const firstScreen = spans.filter((span) => span.startMs < 3000);
		const secondScreen = spans.filter((span) => span.startMs >= 3000);
		// The OCR read the key's 9th character as "Ø"; its KEY= label still catches it.
		expect(firstScreen.map((span) => span.reason).sort()).toEqual(["known-format", "labelled"]);
		expect(secondScreen.map((span) => span.reason).sort()).toEqual([
			"known-format",
			"known-format",
			"labelled",
		]);
		// Blurs cover each screen fully, never leaving a secret visible at a cut.
		for (const span of firstScreen) expect([span.startMs, span.endMs]).toEqual([0, 4000]);
		for (const span of secondScreen) expect([span.startMs, span.endMs]).toEqual([3500, 8000]);
		expect(spans.some((span) => span.endMs > 8000)).toBe(false);
	});
});
