// "Make room": when an open panel would cover the readable column, the column (the sizer of the
// visible mode) glides aside by exactly the overlap, with a transform only (no reflow), and glides
// back when the panel closes.
import type { EditorView } from "@codemirror/view";
import type { MarkdownView } from "obsidian";

/** Space kept between the panel and the text it pushed aside. */
const GUTTER = 18;
/** How much of the column's own side padding may be eaten when the pane is narrow. */
const SLACK = 8;

export class RoomController {
	private shift = 0;
	private sizers = new Set<HTMLElement>();

	constructor(private view: MarkdownView) {}

	/** Recompute for the given panel card (null = no panel, put the column back). */
	update(panel: HTMLElement | null, side: "left" | "right", enabled: boolean): void {
		const sizer = this.visibleSizer();
		// A new sizer (mode switch) carries no transform yet.
		if (sizer && !this.sizers.has(sizer)) this.shift = 0;
		let shift = 0;
		if (panel && enabled && sizer) shift = this.computeShift(panel, sizer, side);

		// Reset the sizer of the other mode (mode switched while open).
		for (const s of this.sizers) {
			if (s !== sizer) {
				s.style.transform = "";
				s.removeClass("sk-note-rail-room");
				s.parentElement?.removeClass("sk-note-rail-room-clip");
				this.sizers.delete(s);
			}
		}
		if (!sizer) return;
		if (!this.sizers.has(sizer)) {
			sizer.addClass("sk-note-rail-room");
			this.sizers.add(sizer);
		}
		shift = Math.round(shift);
		if (shift === this.shift && sizer.style.transform === (shift ? `translateX(${shift}px)` : "")) return;
		this.shift = shift;
		sizer.style.transform = shift ? `translateX(${shift}px)` : "";
		this.clip(sizer, shift !== 0);
		this.remeasureEditorSoon(sizer);
	}

	destroy(): void {
		for (const s of this.sizers) {
			s.style.transform = "";
			s.removeClass("sk-note-rail-room");
			s.parentElement?.removeClass("sk-note-rail-room-clip");
		}
		this.sizers.clear();
		this.shift = 0;
		this.remeasureEditorSoon(null);
	}

	/**
	 * A full-width column moved aside would give the note a sideways scrollbar: the scroller clips
	 * while the column is moved, and until it has glided back.
	 */
	private clip(sizer: HTMLElement, on: boolean): void {
		const scroller = sizer.parentElement;
		if (!scroller) return;
		if (on) {
			scroller.addClass("sk-note-rail-room-clip");
			return;
		}
		const done = () => {
			if (!sizer.style.transform) scroller.removeClass("sk-note-rail-room-clip");
		};
		sizer.addEventListener("transitionend", done, { once: true });
		// No transition (reduced motion, column already in place): the event never comes.
		window.setTimeout(done, 700);
	}

	private visibleSizer(): HTMLElement | null {
		const root = this.view.contentEl;
		if (this.view.getMode() === "preview") return root.querySelector<HTMLElement>(".markdown-reading-view .markdown-preview-sizer");
		return root.querySelector<HTMLElement>(".markdown-source-view .cm-sizer");
	}

	private computeShift(panel: HTMLElement, sizer: HTMLElement, side: "left" | "right"): number {
		const scroller = sizer.parentElement;
		if (!scroller) return 0;
		const host = this.view.contentEl.getBoundingClientRect();
		const scrollRect = scroller.getBoundingClientRect();
		const cs = sizer.ownerDocument.defaultView?.getComputedStyle(sizer);
		const padL = cs ? parseFloat(cs.paddingLeft) || 0 : 0;
		const padR = cs ? parseFloat(cs.paddingRight) || 0 : 0;
		// Untransformed geometry of the column: remove the translation rendered right now
		// (mid-transition it is neither the old nor the new target).
		const rect = sizer.getBoundingClientRect();
		const tx = currentTranslateX(sizer);
		let textLeft = rect.left - tx + padL;
		let textRight = rect.right - tx - padR;
		// Readable line length is often a narrower text column inside a full-width sizer (Obsidian's
		// default theme, where each line is centered): measure a line then.
		const column = sizer.querySelector<HTMLElement>(":scope > .cm-contentContainer > .cm-content > .cm-line, :scope > .markdown-preview-section");
		if (column) {
			const c = column.getBoundingClientRect();
			if (c.width > 0 && c.width < rect.width - padL - padR - 1) {
				textLeft = c.left - tx;
				textRight = c.right - tx;
			}
		}
		const scrollRight = scrollRect.left + scroller.clientWidth;
		// The card is positioned with offsets (its own transform animates, so do not use its rect).
		// Its width may be gliding to another panel's: the inner column already has the final width.
		const inner = panel.firstElementChild as HTMLElement | null;
		const width = inner ? inner.offsetWidth + 2 : panel.offsetWidth;
		const anchor = host.left + panel.offsetLeft;
		const panelLeft = side === "left" ? anchor : anchor + panel.offsetWidth - width;
		const panelRight = panelLeft + width;

		if (side === "left") {
			const need = panelRight + GUTTER - textLeft;
			const room = scrollRight - textRight - SLACK;
			return Math.max(0, Math.min(need, room));
		}
		const need = textRight - (panelLeft - GUTTER);
		const room = textLeft - scrollRect.left - SLACK;
		return -Math.max(0, Math.min(need, room));
	}

	/** CodeMirror draws the cursor and selection in layers outside the sizer: let it re-measure. */
	private remeasureEditorSoon(sizer: HTMLElement | null): void {
		const cm = (this.view.editor as unknown as { cm?: EditorView } | undefined)?.cm;
		if (!cm || typeof cm.requestMeasure !== "function") return;
		const measure = () => {
			try {
				cm.requestMeasure();
			} catch {
				// Editor destroyed meanwhile.
			}
		};
		measure();
		if (sizer) sizer.addEventListener("transitionend", measure, { once: true });
	}
}

/** Horizontal translation currently rendered on `el` (reads the computed matrix, cross-window). */
function currentTranslateX(el: HTMLElement): number {
	const t = el.ownerDocument.defaultView?.getComputedStyle(el).transform;
	if (!t || t === "none") return 0;
	const m = t.match(/^matrix(3d)?\((.+)\)$/);
	if (!m) return 0;
	const v = m[2].split(",").map((n) => parseFloat(n));
	const x = m[1] ? v[12] : v[4];
	return isFinite(x) ? x : 0;
}
