// Geometry of the note for the Contents panel, in every view mode: line tops, scroll anchors, marks.
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Platform, type MarkdownView } from "obsidian";
import { setLineMark, type MarkKind } from "./highlight";

/**
 * What the Contents panel needs from the note, whatever the mode:
 * - Live Preview and Source: CodeMirror 6 only renders lines near the viewport, so positions come
 *   from the editor's height map (lineBlockAt), never from the DOM.
 * - Reading: the preview renderer also virtualizes; positions come from its section heights.
 * All tops are in the scroll element's content coordinates (comparable to scrollTop).
 */
export interface NoteSurface {
	mode: "editor" | "reading";
	scrollEl: HTMLElement;
	/** Top of the 0-based `line`, or null when unknown. */
	lineTop(line: number): number | null;
	/** A position that survives height corrections above it. */
	anchor(): ScrollAnchor;
	anchorTop(anchor: ScrollAnchor): number;
	mark(kind: MarkKind, line: number | null): void;
	/** Editing modes: cursor at the end of the line, no scroll, focus. Reading: no-op. */
	placeCursor(line: number): void;
}

export interface ScrollAnchor {
	mode: "editor" | "reading";
	/** scrollTop when taken (used as is when nothing moved). */
	top: number;
	/** Document position (editor) or section index (reading) at the top of the viewport. */
	key: number;
	/** Pixels between that key's top and scrollTop. */
	delta: number;
}

const FLASH_MS = 1500;

export function surfaceFor(view: MarkdownView): NoteSurface | null {
	if (view.getMode() === "preview") return readingSurface(view);
	return editorSurface(view);
}

// ---- editing modes (CodeMirror 6) ----------------------------------------------

function editorSurface(view: MarkdownView): NoteSurface | null {
	const cm = (view.editor as unknown as { cm?: EditorView } | undefined)?.cm;
	if (!cm || !cm.scrollDOM || typeof cm.lineBlockAt !== "function") return null;
	const scrollEl = cm.scrollDOM;

	/** Where line 1 starts, in scroller content coordinates (inline title and properties sit above). */
	const docOffset = () => cm.documentTop - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
	const posOfLine = (line: number): number | null => {
		const n = line + 1;
		if (n < 1 || n > cm.state.doc.lines) return null;
		return cm.state.doc.line(n).from;
	};

	return {
		mode: "editor",
		scrollEl,
		lineTop(line) {
			const pos = posOfLine(line);
			if (pos === null) return null;
			return docOffset() + cm.lineBlockAt(pos).top;
		},
		anchor() {
			const top = scrollEl.scrollTop;
			const off = docOffset();
			const block = cm.lineBlockAtHeight(Math.max(0, top - off));
			return { mode: "editor", top, key: block.from, delta: top - (off + block.top) };
		},
		anchorTop(a) {
			if (a.mode !== "editor") return a.top;
			const pos = Math.min(a.key, cm.state.doc.length);
			return docOffset() + cm.lineBlockAt(pos).top + a.delta;
		},
		mark(kind, line) {
			if (setLineMark(cm, kind, line)) scheduleFlashClear(kind, line, cm, () => setLineMark(cm, "flash", null));
		},
		placeCursor(line) {
			const pos = posOfLine(line);
			if (pos === null) return;
			const end = cm.state.doc.lineAt(pos).to;
			try {
				cm.dispatch({ selection: EditorSelection.cursor(end), scrollIntoView: false });
				// On phones, focusing pops the keyboard over the note: leave that to the user.
				if (!Platform.isMobile) cm.focus();
			} catch {
				// Editor gone.
			}
		},
	};
}

// ---- reading view --------------------------------------------------------------

interface PreviewSection {
	el: HTMLElement;
	height: number;
	start?: { line: number };
}

interface PreviewRenderer {
	previewEl: HTMLElement;
	sizerEl: HTMLElement;
	sections: PreviewSection[];
}

function readingSurface(view: MarkdownView): NoteSurface | null {
	const pm = view.previewMode as unknown as { renderer?: PreviewRenderer; containerEl: HTMLElement; applyScroll(line: number): void };
	const r = pm.renderer;
	const scrollEl = r?.previewEl ?? pm.containerEl.querySelector<HTMLElement>(".markdown-preview-view");
	if (!scrollEl) return null;
	const sections = r && Array.isArray(r.sections) && r.sizerEl ? r.sections : null;

	/** Top of section i: measured when it is in the DOM, else summed from the renderer's heights. */
	const sectionTop = (i: number): number | null => {
		if (!sections || !r) return null;
		const s = sections[i];
		if (!s) return null;
		const scrollRect = scrollEl.getBoundingClientRect();
		if (s.el && s.el.isConnected && s.el.parentElement === r.sizerEl) {
			return s.el.getBoundingClientRect().top - scrollRect.top + scrollEl.scrollTop;
		}
		// Not rendered: the sizer stacks sections with their recorded heights.
		const base = r.sizerEl.getBoundingClientRect().top - scrollRect.top + scrollEl.scrollTop + (parseFloat(getComputedStyle(r.sizerEl).paddingTop) || 0);
		let y = base;
		for (let k = 0; k < i; k++) y += sections[k].height || 0;
		return y;
	};
	const sectionOfLine = (line: number): number => {
		if (!sections) return -1;
		let idx = -1;
		for (let i = 0; i < sections.length; i++) {
			const st = sections[i].start;
			if (!st || typeof st.line !== "number") continue;
			if (st.line <= line) idx = i;
			else break;
		}
		return idx;
	};
	const sectionAtHeight = (y: number): number => {
		if (!sections) return -1;
		let idx = 0;
		for (let i = 0; i < sections.length; i++) {
			const t = sectionTop(i);
			if (t === null) break;
			if (t <= y) idx = i;
			else break;
		}
		return idx;
	};

	return {
		mode: "reading",
		scrollEl,
		lineTop(line) {
			const i = sectionOfLine(line);
			return i < 0 ? null : sectionTop(i);
		},
		anchor() {
			const top = scrollEl.scrollTop;
			const i = sectionAtHeight(top);
			const t = i >= 0 ? sectionTop(i) : null;
			return { mode: "reading", top, key: i, delta: t === null ? 0 : top - t };
		},
		anchorTop(a) {
			if (a.mode !== "reading" || a.key < 0) return a.top;
			const t = sectionTop(a.key);
			return t === null ? a.top : t + a.delta;
		},
		mark(kind, line) {
			if (!sections) return;
			const cls = kind === "hold" ? "sk-note-rail-hold" : "sk-note-rail-flash";
			for (const s of sections) s.el?.removeClass(cls);
			if (line === null) return;
			const i = sectionOfLine(line);
			const el = i >= 0 ? sections[i].el : null;
			if (!el) return;
			void el.offsetWidth; // restart the animation when the same section is marked again
			el.addClass(cls);
			scheduleFlashClear(kind, line, el, () => el.removeClass("sk-note-rail-flash"));
		},
		placeCursor() {
			// Reading view has no cursor.
		},
	};
}

/** Pending flash cleanups, keyed by editor or element, so turning the module off can run them all at once. */
const flashes = new Map<object, { timer: number; clear: () => void }>();

function scheduleFlashClear(kind: MarkKind, line: number | null, key: object, clear: () => void): void {
	if (kind !== "flash" || line === null) return;
	const prev = flashes.get(key);
	if (prev) window.clearTimeout(prev.timer);
	const timer = window.setTimeout(() => {
		flashes.delete(key);
		clear();
	}, FLASH_MS);
	flashes.set(key, { timer, clear });
}

/** Remove every flash right now (module turned off). */
export function clearAllFlashes(): void {
	for (const { timer, clear } of flashes.values()) {
		window.clearTimeout(timer);
		try {
			clear();
		} catch {
			// Editor or element already gone.
		}
	}
	flashes.clear();
}
