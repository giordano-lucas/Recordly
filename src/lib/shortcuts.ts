export const SHORTCUT_ACTIONS = [
	"addZoom",
	"splitClip",
	"addAnnotation",
	"addBlur",
	"addKeyframe",
	"deleteSelected",
	"playPause",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export interface ShortcutBinding {
	key: string;
	/** Maps to Cmd on macOS, Ctrl on Windows/Linux */
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
}

export type ShortcutsConfig = Record<ShortcutAction, ShortcutBinding>;

export interface FixedShortcut {
	label: string;
	display: string;
	bindings: ShortcutBinding[];
}

/** Final Cut Pro default editing keys; handled by useFinalCutShortcuts. */
export const FINAL_CUT_SHORTCUTS: FixedShortcut[] = [
	{ label: "Blade at Playhead", display: "⌘ + B", bindings: [{ key: "b", ctrl: true }] },
	{
		label: "Previous / Next Frame",
		display: "← / →",
		bindings: [{ key: "arrowleft" }, { key: "arrowright" }],
	},
	{
		label: "Back / Forward 10 Frames",
		display: "Shift + ← / →",
		bindings: [
			{ key: "arrowleft", shift: true },
			{ key: "arrowright", shift: true },
		],
	},
	{
		label: "Previous / Next Edit",
		display: "↑ / ↓",
		bindings: [{ key: "arrowup" }, { key: "arrowdown" }],
	},
	{
		label: "Go to Start / End",
		display: "Home / End",
		bindings: [{ key: "home" }, { key: "end" }],
	},
	{ label: "Stop / Play", display: "K / L", bindings: [{ key: "k" }, { key: "l" }] },
	{
		label: "Trim Start / End to Playhead",
		display: "⌥ + [ / ]",
		bindings: [
			{ key: "[", alt: true },
			{ key: "]", alt: true },
		],
	},
	{
		label: "Zoom Timeline In / Out",
		display: "⌘ + = / -",
		bindings: [
			{ key: "=", ctrl: true },
			{ key: "-", ctrl: true },
		],
	},
	{
		label: "Mark Range In / Out",
		display: "I / O",
		bindings: [{ key: "i" }, { key: "o" }],
	},
	{
		label: "Delete Range (with I/O set)",
		display: "⌫",
		bindings: [],
	},
	{ label: "Clear Range", display: "⌥ + X", bindings: [{ key: "x", alt: true }] },
	{ label: "Zoom Timeline to Fit", display: "Shift + Z", bindings: [{ key: "z", shift: true }] },
	{
		label: "Copy / Cut / Paste",
		display: "⌘ + C / X / V",
		bindings: [
			{ key: "c", ctrl: true },
			{ key: "x", ctrl: true },
			{ key: "v", ctrl: true },
		],
	},
	{ label: "Duplicate", display: "⌘ + D", bindings: [{ key: "d", ctrl: true }] },
	{
		label: "Deselect All",
		display: "Esc / ⌘ + Shift + A",
		bindings: [{ key: "escape" }, { key: "a", ctrl: true, shift: true }],
	},
];

export const FIXED_SHORTCUTS: FixedShortcut[] = [
	...FINAL_CUT_SHORTCUTS,
	{ label: "Cycle Annotations Forward", display: "Tab", bindings: [{ key: "tab" }] },
	{
		label: "Cycle Annotations Backward",
		display: "Shift + Tab",
		bindings: [{ key: "tab", shift: true }],
	},
	{
		label: "Delete Selected (alt)",
		display: "Del / ⌫",
		bindings: [{ key: "delete" }, { key: "backspace" }],
	},
	{ label: "Pan Timeline", display: "Shift + Scroll", bindings: [] },
	{ label: "Zoom Timeline", display: "Ctrl + Scroll", bindings: [] },
];

export type ShortcutConflict =
	| { type: "configurable"; action: ShortcutAction }
	| { type: "fixed"; label: string };

export function bindingsEqual(a: ShortcutBinding, b: ShortcutBinding): boolean {
	return (
		a.key.toLowerCase() === b.key.toLowerCase() &&
		!!a.ctrl === !!b.ctrl &&
		!!a.shift === !!b.shift &&
		!!a.alt === !!b.alt
	);
}

export function findConflict(
	binding: ShortcutBinding,
	forAction: ShortcutAction,
	config: ShortcutsConfig,
): ShortcutConflict | null {
	for (const fixed of FIXED_SHORTCUTS) {
		if (fixed.bindings.some((b) => bindingsEqual(b, binding))) {
			return { type: "fixed", label: fixed.label };
		}
	}
	for (const action of SHORTCUT_ACTIONS) {
		if (action !== forAction && bindingsEqual(config[action], binding)) {
			return { type: "configurable", action };
		}
	}
	return null;
}

export const DEFAULT_SHORTCUTS: ShortcutsConfig = {
	addZoom: { key: "z" },
	splitClip: { key: "c" },
	addAnnotation: { key: "a" },
	addBlur: { key: "b" },
	addKeyframe: { key: "f" },
	// ⌘D is Duplicate, as in Final Cut Pro and most editors.
	deleteSelected: { key: "backspace", ctrl: true },
	playPause: { key: " " },
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
	addZoom: "Add Zoom",
	splitClip: "Split Clip",
	addAnnotation: "Add Annotation",
	addBlur: "Add Blur",
	addKeyframe: "Add Keyframe",
	deleteSelected: "Delete Selected",
	playPause: "Play / Pause",
};

export function matchesShortcut(
	e: KeyboardEvent,
	binding: ShortcutBinding,
	isMacPlatform: boolean,
): boolean {
	if (e.key.toLowerCase() !== binding.key.toLowerCase()) return false;

	const primaryMod = isMacPlatform ? e.metaKey : e.ctrlKey;
	if (primaryMod !== !!binding.ctrl) return false;
	if (e.shiftKey !== !!binding.shift) return false;
	if (e.altKey !== !!binding.alt) return false;

	return true;
}

const KEY_LABELS: Record<string, string> = {
	" ": "Space",
	delete: "Del",
	backspace: "⌫",
	escape: "Esc",
	arrowup: "↑",
	arrowdown: "↓",
	arrowleft: "←",
	arrowright: "→",
};

export function formatBinding(binding: ShortcutBinding, isMac: boolean): string {
	const parts: string[] = [];
	if (binding.ctrl) parts.push(isMac ? "⌘" : "Ctrl");
	if (binding.shift) parts.push(isMac ? "⇧" : "Shift");
	if (binding.alt) parts.push(isMac ? "⌥" : "Alt");
	parts.push(KEY_LABELS[binding.key] ?? binding.key.toUpperCase());
	return parts.join(" + ");
}

/** Earlier default for deleteSelected, now Duplicate; saved configs drop it. */
const LEGACY_DELETE_SELECTED: ShortcutBinding = { key: "d", ctrl: true };

export function mergeWithDefaults(partial: Partial<ShortcutsConfig>): ShortcutsConfig {
	const merged = { ...DEFAULT_SHORTCUTS };
	for (const action of SHORTCUT_ACTIONS) {
		const binding = partial[action];
		if (!binding) continue;
		if (action === "deleteSelected" && bindingsEqual(binding, LEGACY_DELETE_SELECTED)) continue;
		merged[action] = binding as ShortcutBinding;
	}
	return merged;
}
