// Where the readable text of a note sits, so the rail can stand next to it instead of at the far
// edge of a wide pane.
import type { MarkdownView } from "obsidian";

/** Left and right edges of the text column, in client coordinates (null while nothing is laid out). */
export function textEdges(view: MarkdownView): { left: number; right: number } | null {
	const root = view.contentEl;
	const sizer = view.getMode() === "preview"
		? root.querySelector<HTMLElement>(".markdown-reading-view .markdown-preview-sizer")
		: root.querySelector<HTMLElement>(".markdown-source-view .cm-sizer");
	if (!sizer) return null;
	const rect = sizer.getBoundingClientRect();
	if (rect.width <= 0) return null;
	const cs = sizer.ownerDocument.defaultView?.getComputedStyle(sizer);
	const padL = cs ? parseFloat(cs.paddingLeft) || 0 : 0;
	const padR = cs ? parseFloat(cs.paddingRight) || 0 : 0;
	let left = rect.left + padL;
	let right = rect.right - padR;
	// Readable line length is often a narrower column inside a full-width sizer (Obsidian's default
	// theme, where each line is centered): measure a line then.
	const line = sizer.querySelector<HTMLElement>(":scope > .cm-contentContainer > .cm-content > .cm-line, :scope > .markdown-preview-section");
	if (line) {
		const c = line.getBoundingClientRect();
		if (c.width > 0 && c.width < right - left - 1) {
			left = c.left;
			right = c.right;
		}
	}
	return { left, right };
}
