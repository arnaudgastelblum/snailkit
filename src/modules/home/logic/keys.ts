// Keys typed while the keyboard is on the Home itself (not in the search field, not on one of its
// lines): after Esc in the empty search field, or after a click on an empty spot. Pure.

export interface KeyMods {
	ctrl: boolean;
	meta: boolean;
	alt: boolean;
	/** An input method is composing a character (the key is not the character yet). */
	composing: boolean;
}

/**
 * A character typed on the Home itself goes into the search field, as in a launcher: whoever types
 * a word there means to search. Read as a one-letter shortcut (`T` opens today's note), the rest of
 * the word would land in the note just opened. `/` and `?` keep their meaning; a space does nothing.
 */
export function typesInSearch(key: string, mods: KeyMods): boolean {
	if (mods.ctrl || mods.meta || mods.alt || mods.composing) return false;
	if ([...key].length !== 1 || key === "/" || key === "?") return false;
	return key.trim() !== "";
}
