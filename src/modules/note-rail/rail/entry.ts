// Pure rules of the two entry points at the top of the rail: the Search magnifier (its tooltip
// shows the command's hotkey) and the area pill (what a click does). Tested in
// test/note-rail.test.ts.

/** A hotkey as Obsidian stores it ("Mod" is Ctrl on Windows and Linux, Cmd on macOS). */
export interface HotkeyLike {
	modifiers: readonly string[];
	key: string;
}

const MAC_SYMBOLS: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘", Mod: "⌘" };
const MODIFIER_ORDER = ["Mod", "Ctrl", "Meta", "Alt", "Shift"];

/** The first hotkey, written the platform's way ("Ctrl+O", "⌘O"), or "" without one. */
export function hotkeyText(hotkeys: readonly HotkeyLike[] | null | undefined, mac: boolean): string {
	const hotkey = hotkeys?.find((h) => h && typeof h.key === "string" && h.key.trim());
	if (!hotkey) return "";
	const modifiers = [...new Set(hotkey.modifiers ?? [])].sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
	const key = hotkey.key.length === 1 ? hotkey.key.toUpperCase() : hotkey.key;
	if (mac) return modifiers.map((m) => MAC_SYMBOLS[m] ?? m).join("") + key;
	return [...modifiers.map((m) => (m === "Mod" ? "Ctrl" : m === "Meta" ? "Win" : m)), key].join("+");
}

/**
 * The hotkeys of a command: the user's own when they set some (an empty list means "removed"),
 * else the command's defaults.
 */
export function commandHotkeys(custom: readonly HotkeyLike[] | undefined, defaults: readonly HotkeyLike[] | undefined): readonly HotkeyLike[] {
	return Array.isArray(custom) ? custom : Array.isArray(defaults) ? defaults : [];
}

/**
 * What a click on the area pill does.
 * - "place": the page of the area in the Workbench (Home module on, plain click or tap).
 * - "note": the area note itself (Ctrl or Cmd click opens it in a new tab).
 * - "menu": the path as a menu (without Home: on a phone, or on the area note itself).
 * With Home, Ctrl or Cmd click keeps the old way, so the area note stays one click away.
 */
export function pillAction(options: { home: boolean; mobile: boolean; isArea: boolean; mod: boolean }): "place" | "note" | "menu" {
	if (options.home && !options.mod) return "place";
	return options.mobile || options.isArea ? "menu" : "note";
}

/** A press held this long on the pill (touch or pen) shows the path menu instead of the click. */
export const LONG_PRESS_MS = 500;
/** Moving the finger further than this (pixels) cancels a long press (the user is scrolling). */
export const LONG_PRESS_SLOP = 10;
