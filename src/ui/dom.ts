// An element made by the helpers of its own document's window (createEl), as Obsidian asks: a
// popout window has its own document, its own window and its own helpers.

/** A new element of `doc`, not attached yet. */
export function elementOf<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, o?: DomElementInfo | string): HTMLElementTagNameMap[K] {
	const win = (doc.win ?? window) as unknown as { createEl: typeof createEl };
	return win.createEl(tag, o);
}

/**
 * A button that destroys something: `setDestructive()` since Obsidian 1.13, else the class that
 * the older `setWarning()` put (the plugin runs from 1.8.7).
 */
export function destructive<T extends { buttonEl: HTMLElement }>(button: T): T {
	const b = button as T & { setDestructive?(): unknown };
	if (typeof b.setDestructive === "function") b.setDestructive();
	else button.buttonEl.addClass("mod-warning");
	return button;
}
