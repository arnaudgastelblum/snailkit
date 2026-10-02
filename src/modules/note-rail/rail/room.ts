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
		this.remeasureEditorSoon(sizer);
	}

	destroy(): void {
		for (const s of this.sizers) {
			s.style.transform = "";
			s.removeClass("sk-note-rail-room");
		}
		this.sizers.clear();
		this.shift = 0;
		this.remeasureEditorSoon(null);
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
		const textLeft = rect.left - tx + padL;
		const textRight = rect.right - tx - padR;
		const scrollRight = scrollRect.left + scroller.clientWidth;
		// The card is positioned with offsets (its own transform animates, so do not use its rect).
		const panelLeft = host.left + panel.offsetLeft;
		const panelRight = panelLeft + panel.offsetWidth;

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
