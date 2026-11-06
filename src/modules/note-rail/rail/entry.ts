// Hotkeys as text, for the Search row of the Snailkit menu. Tested in test/note-rail.test.ts.

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
	return Array.isArray(custom) ? custom as readonly HotkeyLike[] : Array.isArray(defaults) ? defaults as readonly HotkeyLike[] : [];
}
