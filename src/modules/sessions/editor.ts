// The editor side of idea sessions: pale dots next to likely tasks, the sentence under the pointer
// with its "+" and "?" grips, the keyboard (catch, keep to decide, next likely task), and the
// composition of a task (see compose.ts). One SessionView per editor.
import { EditorState, Prec, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { editorInfoField, Platform, Scope, setIcon, type KeymapEventHandler, type TFile, type WorkspaceLeaf } from "obsidian";
import { Composer } from "./compose";
import { guardField, guardFilters, ours, refresh, spacerField } from "./guard";
import { undo, undoDepth } from "./history";
import { bodyStart, fish, groupTag, hiddenLines, indentWidth, lineInfo, markOf, sentenceAt, summarize, withoutTag, type LineInfo, type Sentence } from "./logic";
import { Saisie } from "./saisie";
import type { SessionsRuntime } from "./runtime";
import { elementOf } from "../../ui/dom";

export { ours, refresh };

export interface Hover {
	/** Line number (1-based). */
	line: number;
	/** Offsets of the sentence in the document. */
	from: number;
	to: number;
	/** Offsets of the sentence in the line body. */
	start: number;
	end: number;
	kind: "free" | "task" | "decide";
	/** Set by the keyboard (Alt+arrows): kept while the cursor stays on the line. */
	kb?: boolean;
}

interface Marker {
	line: number;
	kind: "task" | "question";
	sentence: Sentence;
}

interface DecideMemory {
	from: number;
	to: number;
	produced: string;
	original: string;
}

const mod = () => (Platform.isMacOS ? "Cmd" : "Ctrl");
const alt = () => (Platform.isMacOS ? "Option" : "Alt");
export const keyNames = { mod, alt };

let current: ViewPlugin<SessionView> | null = null;

/** The SessionView of an editor, while the module is on. */
export function viewOf(cm: EditorView): SessionView | null {
	return current ? cm.plugin(current) : null;
}

export function sessionsEditor(rt: SessionsRuntime): Extension {
	const plugin = ViewPlugin.define((view) => new SessionView(view, rt), { decorations: (v) => v.decorations });
	current = plugin;
	rt.ctx.register(() => {
		if (current === plugin) current = null;
	});
	const run = (f: (v: SessionView) => boolean) => (view: EditorView) => {
		const v = view.plugin(plugin);
		return !!v && v.active && f(v);
	};
	return [
		guardField,
		spacerField,
		guardFilters,
		plugin,
		Prec.highest(keymap.of([
			{ key: "Mod-Enter", run: run((v) => v.modEnter()) },
			{ key: "Mod-Shift-Enter", run: run((v) => v.decideAtCaret()) },
			{ key: "Alt-ArrowDown", run: run((v) => v.altArrow(1)) },
			{ key: "Alt-ArrowUp", run: run((v) => v.altArrow(-1)) },
			{ key: "Enter", run: run((v) => !!v.composer && v.composer.titleKey("Enter")) },
			{ key: "Tab", run: run((v) => !!v.composer && v.composer.titleKey("Tab")) },
			{ key: "Shift-Tab", run: run((v) => !!v.composer && v.composer.titleKey("Shift-Tab")) },
			{ key: "ArrowDown", run: run((v) => !!v.composer && v.composer.titleKey("ArrowDown")) },
			{ key: "ArrowUp", run: run((v) => !!v.composer && v.composer.titleKey("ArrowUp")) },
			{ key: "Mod-/", run: run((v) => !!v.composer && v.composer.toggleHelp()) },
			{ key: "Escape", run: run((v) => v.escape()) },
		])),
	];
}

/** The tag of the task being composed, at the end of its line (dashed while only suggested). */
class TagWidget extends WidgetType {
	constructor(readonly tag: string | null, readonly preview: boolean, readonly label: string, readonly classes: string, readonly onClick: () => void) {
		super();
	}
	eq(other: TagWidget): boolean {
		return other.tag === this.tag && other.preview === this.preview && other.classes === this.classes && other.label === this.label;
	}
	toDOM(view: EditorView): HTMLElement {
		const doc = view.dom.ownerDocument;
		const el = elementOf(doc, "span");
		el.className = "sk-sessions-tagslot" + (this.preview ? " is-preview" : "");
		if (this.tag) {
			const cap = el.createSpan();
			cap.className = `sk-tag-capsule ${this.classes}`.trim();
			const parts = this.tag.split("/");
			const root = cap.createSpan();
			root.className = "sk-tag-capsule-root";
			root.textContent = parts[0];
			if (parts.length > 1) {
				const leaf = cap.createSpan();
				leaf.className = "sk-tag-capsule-leaf";
				leaf.textContent = parts.slice(1).join(" › ");
			}
		} else {
			const pill = el.createSpan();
			pill.className = "sk-sessions-tagph";
			pill.textContent = this.label;
		}
		el.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.onClick();
		});
		return el;
	}
	ignoreEvent(): boolean {
		return true;
	}
}

/** The invitation on the first empty line of a new brainstorm: gone with the first letter. */
class InviteWidget extends WidgetType {
	constructor(readonly text: string) {
		super();
	}
	eq(other: InviteWidget): boolean {
		return other.text === this.text;
	}
	toDOM(view: EditorView): HTMLElement {
		const el = elementOf(view.dom.ownerDocument, "span");
		el.className = "sk-sessions-invite";
		el.setAttr("aria-hidden", "true");
		el.textContent = this.text;
		return el;
	}
	ignoreEvent(): boolean {
		return false;
	}
}

export class SessionView {
	decorations: DecorationSet = Decoration.none;
	active = false;
	hover: Hover | null = null;
	composer: Composer | null = null;
	/** Layer in the scroller for the dots, the grips and the composition (scrolls with the text). */
	readonly layer: HTMLElement;
	private markersEl: HTMLElement;
	private actsEl: HTMLElement;
	private markers: Marker[] = [];
	private markerEls = new Map<string, HTMLElement>();
	private hidden: { doc: unknown; lines: boolean[] } | null = null;
	private leaveTimer = 0;
	/** History depth right after the last task placed here (the toast's Undo only undoes that step). */
	private lastPose = -1;
	private decided: DecideMemory[] = [];
	private transient: Array<{ pos: number; cls: string; style?: string; id: number }> = [];
	private transientId = 0;
	private destroyed = false;
	private cleanups: Array<() => void> = [];

	constructor(readonly view: EditorView, readonly rt: SessionsRuntime) {
		rt.views.add(this);
		const doc = view.dom.ownerDocument;
		this.layer = elementOf(doc, "div");
		this.layer.className = "sk-sessions-layer";
		this.markersEl = this.layer.createDiv();
		this.markersEl.className = "sk-sessions-markers";
		this.actsEl = this.layer.createDiv();
		this.actsEl.className = "sk-sessions-acts";
		this.buildActs();
		view.scrollDOM.appendChild(this.layer);
		this.saisie = new Saisie(this);
		this.listen(view.scrollDOM, "mousemove", (e) => this.onMove(e as MouseEvent));
		this.listen(view.scrollDOM, "mouseleave", () => this.leaveSoon());
		this.listen(view.contentDOM, "mousedown", (e) => this.onDown(e as MouseEvent), true);
		this.listen(view.contentDOM, "click", (e) => this.onClick(e as MouseEvent));
		this.listen(this.markersEl, "mousedown", (e) => e.preventDefault());
		this.listen(this.markersEl, "click", (e) => this.onMarkerClick(e as MouseEvent));
		this.listen(doc, "pointerdown", (e) => {
			if (!Platform.isMobile || !this.hover || this.composer) return;
			const t = e.target as Node;
			if (!this.layer.contains(t) && !view.contentDOM.contains(t)) this.setHover(null);
		});
		// Obsidian's own hotkey on Ctrl/Cmd+Enter (open a link in a new tab) runs before the editor:
		// while a session has the focus, a scope of ours goes first.
		this.keyScope = new Scope(this.rt.app.scope);
		this.keyScope.register(["Mod"], "Enter", () => (this.active ? (this.modEnter(), false) : true));
		this.keyScope.register(["Mod", "Shift"], "Enter", () => (this.active && !this.composer ? (this.decideAtCaret(), false) : true));
		this.listen(doc, "focusin", () => this.syncScope());
		this.listen(doc, "focusout", () => window.setTimeout(() => this.syncScope(), 0));
		this.recheck(true);
	}

	private keyScope: Scope;
	private scoped = false;
	/** The pill, its card and the sealed look of a brainstorm note. */
	readonly saisie: Saisie;
	/** The line lit by "Show me" (its start), and a counter that restarts its pulse. */
	private spot: { pos: number; n: number } | null = null;
	private spotN = 0;

	/** Lights one line ("Show me") and brings it to the middle of the view; null puts the light out. */
	spotLine(pos: number | null, scroll: boolean): void {
		if (this.destroyed) return;
		this.spot = pos === null ? null : { pos, n: ++this.spotN };
		this.view.dispatch({ effects: scroll && pos !== null ? [refresh.of(null), EditorView.scrollIntoView(pos, { y: "center" })] : refresh.of(null) });
	}

	/** The note was just finished here: the stamp lands. */
	sealed(): void {
		this.saisie.sealed();
	}
	/** Ctrl/Cmd+/ is Obsidian's "Toggle comment": only while a task is composed does it open the shortcuts instead. */
	private helpKey: KeymapEventHandler | null = null;

	/** Called by the composer as it starts and ends. */
	composing(on: boolean): void {
		if (on && !this.helpKey) this.helpKey = this.keyScope.register(["Mod"], "/", () => (this.composer ? (this.composer.toggleHelp(), false) : true));
		else if (!on && this.helpKey) {
			this.keyScope.unregister(this.helpKey);
			this.helpKey = null;
		}
	}

	/** Another leaf became active: a composition left in a hidden editor (always, on a phone) is cancelled, its text given back. */
	onLeafChange(leaf: WorkspaceLeaf | null): void {
		if (this.destroyed) return;
		const container = (leaf?.view as { containerEl?: HTMLElement } | undefined)?.containerEl ?? null;
		const inActive = !!container && container.contains(this.view.dom);
		// Another note took the screen: the pill's card or sheet would act on this one.
		if (!inActive) this.saisie.closeFloating();
		if (!this.composer) return;
		const hidden = !this.view.dom.isConnected || this.view.dom.offsetParent === null;
		if (!inActive && (Platform.isMobile || hidden)) this.composer.cancel(false);
	}

	/** Our keys go first while this editor (or its composition panel) has the focus. */
	syncScope(): void {
		const el = this.view.dom.ownerDocument.activeElement;
		const want = !this.destroyed && this.active && !!el && (this.view.dom.contains(el) || this.layer.contains(el) || !!this.composer?.owns(el));
		if (want === this.scoped) return;
		this.scoped = want;
		if (want) this.rt.app.keymap.pushScope(this.keyScope);
		else this.rt.app.keymap.popScope(this.keyScope);
	}

	private listen(target: EventTarget, type: string, handler: (e: Event) => void, capture = false): void {
		target.addEventListener(type, handler, capture);
		this.cleanups.push(() => target.removeEventListener(type, handler, capture));
	}

	get file(): TFile | null {
		return this.view.state.field(editorInfoField, false)?.file ?? null;
	}

	get t() {
		return (key: string, vars?: Record<string, string | number>) => this.rt.ctx.t(key, vars);
	}

	/** Is the module at work in this editor (a session, or every note)? Called when that may change. */
	recheck(first = false): void {
		if (this.destroyed) return;
		const active = !this.rt.stopped && this.rt.activeFor(this.file);
		if (active === this.active && !first) {
			// Still at work here, but the note may have been adopted, archived or brought back: the pill follows.
			this.saisie.update();
			this.redraw();
			return;
		}
		this.active = active;
		window.setTimeout(() => this.syncScope(), 0);
		this.view.scrollDOM.classList.toggle("sk-sessions-on", active);
		this.view.scrollDOM.classList.toggle("sk-sessions-dots", active && this.rt.settings.dots);
		if (!active) {
			// No longer a session (forgotten, or the setting changed): the text being composed goes back as it was.
			this.composer?.cancel();
			this.setHover(null);
			this.markers = [];
			this.drawMarkers();
		}
		this.saisie.update();
		this.redraw();
	}

	/** Rebuild the decorations and remeasure, from outside an update. */
	redraw(): void {
		if (this.destroyed) return;
		this.view.scrollDOM.classList.toggle("sk-sessions-dots", this.active && this.rt.settings.dots);
		window.setTimeout(() => {
			if (!this.destroyed) this.view.dispatch({ effects: refresh.of(null) });
		}, 0);
	}

	update(u: ViewUpdate): void {
		if (u.docChanged) {
			if (this.active) this.rt.updateStatus();
			this.decided = this.decided
				.map((d) => ({ ...d, from: u.changes.mapPos(d.from, -1), to: u.changes.mapPos(d.to, 1) }))
				.filter((d) => u.state.doc.sliceString(d.from, d.to) === d.produced);
			this.transient = this.transient.map((x) => ({ ...x, pos: u.changes.mapPos(x.pos) }));
			if (this.spot) this.spot = { ...this.spot, pos: u.changes.mapPos(this.spot.pos) };
			this.saisie.update();
			if (this.hover && !this.hover.kb) this.hover = null;
			else if (this.hover) this.hover = this.validHover(this.hover, u.state);
		}
		if (this.file !== this.lastFile) {
			this.lastFile = this.file;
			queueMicrotask(() => this.recheck());
		}
		if (u.focusChanged || (u.selectionSet && !this.scoped)) queueMicrotask(() => this.syncScope());
		this.composer?.update(u);
		if (u.selectionSet && this.hover?.kb) {
			const line = u.state.doc.lineAt(u.state.selection.main.head).number;
			if (line !== this.hover.line) this.hover = null;
		}
		this.decorations = this.buildDecorations(u.state);
		if (this.active && (u.docChanged || u.viewportChanged || u.geometryChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh))))) {
			this.findMarkers(u.state);
			this.measure();
		} else if (u.selectionSet) this.measure();
	}
	private lastFile: TFile | null = null;

	/** The note a composition started in (the editor's own file is already gone when the note unloads). */
	private composeFile: TFile | null = null;

	/** The editor goes away (the note closes, another note takes the leaf): a composition left open gives its sentence back on disk. */
	destroy(): void {
		const file = this.composeFile ?? this.file;
		const left = this.composer?.abandon() ?? null;
		this.shutdown(false);
		if (left && file) this.rt.restoreOnDisk(file, left.composed, left.original);
	}

	/** The module is turning off (or the editor closes): leave the text as it is now, remove our DOM. */
	shutdown(restore = true): void {
		if (this.destroyed) return;
		// Turning the module off in the middle of a composition: the text goes back as it was.
		if (restore && this.composer) {
			try {
				this.composer.cancel();
			} catch {
				this.composer?.end(false);
			}
		}
		this.composer?.end(false);
		this.composing(false);
		this.saisie.destroy();
		this.destroyed = true;
		if (this.scoped) this.rt.app.keymap.popScope(this.keyScope);
		this.scoped = false;
		this.rt.views.delete(this);
		window.clearTimeout(this.leaveTimer);
		for (const c of this.cleanups.splice(0)) c();
		this.layer.remove();
		this.view.scrollDOM.classList.remove("sk-sessions-on", "sk-sessions-dots", "sk-sessions-composing");
	}

	// ----- decorations -----

	private buildDecorations(state: EditorState): DecorationSet {
		if (!this.active) return Decoration.none;
		const ranges: Range<Decoration>[] = [];
		const h = this.hover;
		if (h && !this.composer && h.kind !== "task" && h.to > h.from) {
			ranges.push(Decoration.mark({ class: "sk-sessions-hl" + (h.kb ? " is-kb" : "") }).range(h.from, h.to));
		}
		if (this.composer) this.composer.decorations(state, ranges, (tag, preview, onClick) => new TagWidget(tag, preview, this.t("panel.tag-pill"), tag ? this.rt.tagClasses(tag) : "", onClick));
		if (this.spot && this.spot.pos <= state.doc.length) {
			ranges.push(Decoration.line({ class: `sk-sessions-spot is-pulse-${this.spot.n % 2}` }).range(state.doc.lineAt(this.spot.pos).from));
		}
		const invite = this.inviteAt(state);
		if (invite !== null) ranges.push(Decoration.widget({ widget: new InviteWidget(this.t("invite.prompt")), side: 1 }).range(invite));
		for (const x of this.transient) {
			if (x.pos > state.doc.length) continue;
			const line = state.doc.lineAt(x.pos);
			ranges.push(Decoration.line({ class: x.cls, attributes: x.style ? { style: x.style } : undefined }).range(line.from));
		}
		return Decoration.set(ranges, true);
	}

	/** Where the invitation goes in a brainstorm with no idea yet (the first empty line of its body), or null. */
	private inviteAt(state: EditorState): number | null {
		if (this.composer || state.doc.length > 4000 || !this.rt.isSession(this.file)) return null;
		const lines: string[] = [];
		for (let i = 1; i <= state.doc.lines; i++) lines.push(state.doc.line(i).text);
		if (summarize(lines, this.rt.isClosing).ideas > 0) return null;
		let at = bodyStart(lines);
		if (at >= lines.length) {
			// Nothing but the header: the first empty line after it.
			let k = lines.length - 1;
			while (k >= 0 && !lines[k].trim()) k--;
			at = k + 1;
		} else if (lines[at].trim()) return null;
		if (at >= lines.length) return null;
		// Where the cursor waits, when it is on an empty line below the header.
		const caret = state.doc.lineAt(state.selection.main.head);
		if (caret.number - 1 >= at && !caret.text.trim()) return caret.from;
		return state.doc.line(at + 1).from;
	}

	/** Adds short-lived classes to lines (the landing of a task, its description settling). */
	flashLines(items: Array<{ pos: number; cls: string; style?: string }>, ms: number): void {
		const ids = items.map((x) => {
			const id = ++this.transientId;
			this.transient.push({ ...x, id });
			return id;
		});
		window.setTimeout(() => {
			if (this.destroyed) return;
			this.transient = this.transient.filter((x) => !ids.includes(x.id));
			this.view.dispatch({ effects: refresh.of(null) });
		}, ms);
	}

	// ----- what the lines are -----

	hiddenLines(state: EditorState): boolean[] {
		if (this.hidden?.doc !== state.doc) {
			const lines: string[] = [];
			for (let i = 1; i <= state.doc.lines; i++) lines.push(state.doc.line(i).text);
			this.hidden = { doc: state.doc, lines: hiddenLines(lines) };
		}
		return this.hidden.lines;
	}

	/** A line that can hold ideas (not code, properties, a heading, the closing line...). */
	lineKind(state: EditorState, n: number): LineInfo | null {
		if (n < 1 || n > state.doc.lines) return null;
		if (this.hiddenLines(state)[n - 1]) return null;
		const text = state.doc.line(n).text;
		if (this.rt.isClosing(text)) return null;
		return lineInfo(text);
	}

	private markerOf(state: EditorState, n: number): Marker | null {
		const info = this.lineKind(state, n);
		if (!info || info.kind !== "free" || this.inDescription(state, n, info)) return null;
		const mark = markOf(info.body, this.rt.settings.verbs, this.rt.keptOf(this.file?.path ?? ""));
		return mark ? { line: n, ...mark } : null;
	}

	private findMarkers(state: EditorState): void {
		this.markers = [];
		if (!this.active || !this.rt.settings.dots) return;
		for (const { from, to } of this.view.visibleRanges) {
			const first = state.doc.lineAt(from).number;
			const last = state.doc.lineAt(to).number;
			for (let n = first; n <= last; n++) {
				const m = this.markerOf(state, n);
				if (m && !this.markers.some((x) => x.line === n)) this.markers.push(m);
			}
		}
	}

	/** An indented line under a task: part of its description, not a new idea. */
	private inDescription(state: EditorState, n: number, info: LineInfo): boolean {
		const own = indentWidth(info.indent);
		if (!own) return false;
		for (let k = n - 1; k >= 1 && k >= n - 60; k--) {
			const text = state.doc.line(k).text;
			if (!text.trim()) continue;
			const other = lineInfo(text);
			const w = indentWidth(other.indent);
			if (w < own) return other.kind === "task" || other.kind === "decide";
		}
		return false;
	}

	/** The hover rebuilt for the current text, or null when its line changed kind. */
	private validHover(h: Hover, state: EditorState): Hover | null {
		const info = this.lineKind(state, h.line);
		if (!info || info.kind === "blank" || info.kind === "heading" || info.kind === "other") return null;
		return this.hoverFor(state, h.line, h.start, h.kb);
	}

	/** The hover for the sentence at `offset` of the body of line `n`. */
	private hoverFor(state: EditorState, n: number, offset: number, kb?: boolean): Hover | null {
		const info = this.lineKind(state, n);
		if (!info || (info.kind !== "free" && info.kind !== "task" && info.kind !== "decide")) return null;
		const line = state.doc.line(n);
		if (info.kind === "task" || info.kind === "decide") {
			return { line: n, from: line.from + info.bodyStart, to: line.to, start: 0, end: info.body.length, kind: info.kind, kb };
		}
		const s = sentenceAt(info.body, offset);
		if (!s) return null;
		return { line: n, from: line.from + info.bodyStart + s.start, to: line.from + info.bodyStart + s.end, start: s.start, end: s.end, kind: "free", kb };
	}

	// ----- pointer -----

	private onMove(e: MouseEvent): void {
		if (!this.active || this.composer || e.buttons || Platform.isMobile) return;
		const target = e.target as HTMLElement;
		if (this.actsEl.contains(target)) {
			window.clearTimeout(this.leaveTimer);
			return;
		}
		const content = this.view.contentDOM.getBoundingClientRect();
		if (e.clientY < content.top || e.clientY > content.bottom) {
			this.leaveSoon();
			return;
		}
		window.clearTimeout(this.leaveTimer);
		const state = this.view.state;
		const textLeft = this.textLeft();
		if (e.clientX < textLeft) {
			// In the margin: the line at that height, its marked sentence.
			const block = this.view.lineBlockAtHeight(e.clientY - this.view.documentTop);
			const n = state.doc.lineAt(block.from).number;
			if (this.hover && this.hover.line === n) return;
			const m = this.markers.find((x) => x.line === n);
			this.setHover(this.hoverFor(state, n, m ? m.sentence.start : 0));
			return;
		}
		const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
		if (pos === null) {
			this.leaveSoon();
			return;
		}
		const line = state.doc.lineAt(pos);
		const info = this.lineKind(state, line.number);
		if (!info) {
			this.setHover(null);
			return;
		}
		const rect = this.view.coordsAtPos(line.to, -1);
		// Past the end of a short line: still the line, its last sentence.
		this.setHover(this.hoverFor(state, line.number, Math.max(0, pos - line.from - info.bodyStart)) ?? null);
		void rect;
	}

	private leaveSoon(): void {
		window.clearTimeout(this.leaveTimer);
		this.leaveTimer = window.setTimeout(() => {
			if (this.hover && !this.hover.kb) this.setHover(null);
		}, 160);
	}

	setHover(h: Hover | null): void {
		const a = this.hover;
		if (a === h || (a && h && a.line === h.line && a.from === h.from && a.to === h.to && a.kind === h.kind)) {
			if (a && h) a.kb = h.kb;
			return;
		}
		this.hover = h;
		this.actsEl.toggleClass("is-shown", false);
		this.view.dispatch({ effects: refresh.of(null) });
	}

	/** While composing: a click on a candidate line sets the description, elsewhere it does nothing. */
	private onDown(e: MouseEvent): void {
		if (!this.active) return;
		if (this.composer) {
			if (this.composer.onEditorMouseDown(e)) {
				e.preventDefault();
				e.stopPropagation();
			}
			return;
		}
		const box = (e.target as HTMLElement).closest?.(".task-list-item-checkbox");
		if (box) this.setHover(null);
	}

	/** On a phone there is no pointer hover: a tap on a sentence shows its grips. */
	private onClick(e: MouseEvent): void {
		if (!this.active || this.composer || !Platform.isMobile) return;
		if ((e.target as HTMLElement).closest?.(".task-list-item-checkbox, a, .sk-sessions-tagslot")) return;
		const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
		if (pos === null) return;
		const state = this.view.state;
		const line = state.doc.lineAt(pos);
		const info = this.lineKind(state, line.number);
		if (!info || info.kind === "blank") {
			this.setHover(null);
			return;
		}
		this.setHover(this.hoverFor(state, line.number, Math.max(0, pos - line.from - info.bodyStart)));
	}

	private onMarkerClick(e: MouseEvent): void {
		const el = (e.target as HTMLElement).closest<HTMLElement>(".sk-sessions-marker");
		if (!el || this.composer) return;
		const n = Number(el.dataset.line);
		const m = this.markers.find((x) => x.line === n);
		if (!m) return;
		if (Platform.isMobile && !(this.hover && this.hover.line === n)) {
			this.setHover(this.hoverFor(this.view.state, n, m.sentence.start));
			return;
		}
		this.catchLine(n, m.sentence.start, m.sentence.end);
	}

	// ----- the grips next to the sentence -----

	private buildActs(): void {
		const make = (cls: string, icon: string, label: string) => {
			const b = this.actsEl.createEl("button", { cls: `sk-sessions-act ${cls}`, attr: { type: "button", tabindex: "-1" } });
			const i = b.createSpan({ cls: "sk-sessions-act-icon" });
			if (icon.length === 1) i.setText(icon);
			else setIcon(i, icon);
			b.createSpan({ cls: "sk-sessions-act-label", text: label });
			b.addEventListener("mousedown", (e) => e.preventDefault());
			return b;
		};
		const plus = make("is-task", "+", this.t("act.task"));
		const ask = make("is-decide", "?", this.t("act.decide"));
		const edit = make("is-edit", "pencil", this.t("act.edit"));
		plus.addEventListener("click", () => {
			const h = this.hover;
			if (h) this.catchLine(h.line, h.start, h.end);
		});
		ask.addEventListener("click", () => {
			const h = this.hover;
			if (h) this.toggleDecide(h.line, h.start, h.end);
		});
		edit.addEventListener("click", () => {
			const h = this.hover;
			if (h) this.catchLine(h.line, 0, 0);
		});
	}

	private updateActLabels(h: Hover): void {
		const [plus, ask, edit] = Array.from(this.actsEl.children) as HTMLElement[];
		const k = (...names: string[]) => names.join("+");
		plus.setAttr("aria-label", this.t("act.task-tip", { key: k(mod(), this.t("key.enter")) }));
		ask.setAttr("aria-label", this.t(h.kind === "decide" ? "act.undecide-tip" : "act.decide-tip", { key: k(mod(), this.t("key.shift"), this.t("key.enter")) }));
		edit.setAttr("aria-label", this.t("act.edit-tip", { key: k(mod(), this.t("key.enter")) }));
		this.actsEl.dataset.mode = h.kind;
	}

	// ----- measuring and drawing the layer -----

	/**
	 * Left edge of the text, in client coordinates. Measured on a line itself: some themes (Minimal)
	 * center each line in a wide content area, so the content's own edge can be far to the left.
	 */
	textLeft(): number {
		const content = this.view.contentDOM;
		const line = content.querySelector<HTMLElement>(".cm-line");
		if (line) {
			const linePad = parseFloat(getComputedStyle(line).paddingLeft) || 0;
			return line.getBoundingClientRect().left + Math.min(linePad, 24);
		}
		const r = content.getBoundingClientRect();
		return r.left + (parseFloat(getComputedStyle(content).paddingLeft) || 0);
	}

	/** Converts client coordinates to the layer's (which scrolls with the text). */
	origin(): { x: number; y: number } {
		const r = this.layer.getBoundingClientRect();
		return { x: r.left, y: r.top };
	}

	measure(): void {
		if (this.destroyed) return;
		this.view.requestMeasure({
			key: this,
			read: (view) => {
				const o = this.origin();
				const left = this.textLeft();
				const scroller = view.scrollDOM.getBoundingClientRect();
				const marks = this.markers.map((m) => {
					const line = view.state.doc.line(m.line);
					const info = lineInfo(line.text);
					const c = view.coordsAtPos(line.from + info.bodyStart + m.sentence.start, 1);
					return c ? { m, y: (c.top + c.bottom) / 2 - o.y } : null;
				});
				let acts: { x: number; y: number; right: number } | null = null;
				const h = this.hover;
				if (h && !this.composer && h.line <= view.state.doc.lines) {
					const c = view.coordsAtPos(h.from, 1);
					const lineEnd = view.coordsAtPos(view.state.doc.line(h.line).to, -1);
					if (c) acts = { x: left - o.x, y: Platform.isMobile ? (lineEnd ?? c).bottom - o.y + 6 : (c.top + c.bottom) / 2 - o.y, right: view.contentDOM.getBoundingClientRect().right - o.x };
				}
				let seal: { top: number; left: number; right: number } | null = null;
				if (this.saisie.isSealed) {
					const content = view.contentDOM.getBoundingClientRect();
					const line = view.contentDOM.querySelector<HTMLElement>(".cm-line");
					const right = line ? line.getBoundingClientRect().right : content.right;
					seal = { top: content.top - o.y, left: left - o.x, right: right - o.x };
				}
				return { marks, acts, left: left - o.x, minX: scroller.left - o.x + 6, seal };
			},
			write: (r) => {
				this.drawMarkers(r.marks.filter(Boolean) as Array<{ m: Marker; y: number }>, Math.max(r.minX + 9, r.left - 22));
				if (r.seal) this.saisie.place(r.seal.top, r.seal.left, r.seal.right);
				const h = this.hover;
				if (r.acts && h) {
					this.updateActLabels(h);
					if (Platform.isMobile) {
						this.actsEl.style.removeProperty("left");
						this.actsEl.style.removeProperty("right");
						this.actsEl.style.top = `${r.acts.y}px`;
						this.actsEl.style.left = `${Math.max(r.minX, r.acts.right - this.actsEl.offsetWidth)}px`;
					} else {
						this.actsEl.style.top = `${r.acts.y - 13}px`;
						this.actsEl.style.left = `${Math.max(r.minX, r.left - 40)}px`;
					}
					this.actsEl.toggleClass("is-shown", true);
				} else this.actsEl.toggleClass("is-shown", false);
				this.composer?.layout();
			},
		});
	}

	private drawMarkers(list: Array<{ m: Marker; y: number }> = [], x = 0): void {
		const keep = new Set<string>();
		for (const { m, y } of list) {
			const key = `${m.kind}:${m.line}`;
			keep.add(key);
			let el = this.markerEls.get(key);
			if (!el) {
				el = this.markersEl.createDiv({ cls: `sk-sessions-marker is-${m.kind} is-new` });
				const born = el;
				window.setTimeout(() => born.removeClass("is-new"), 600);
				this.markerEls.set(key, el);
			}
			el.dataset.line = String(m.line);
			el.setAttr("aria-label", m.kind === "task" ? this.t("marker.task", { key: `${alt()}+↓` }) : this.t("marker.question"));
			el.style.top = `${y}px`;
			el.style.left = `${x}px`;
			el.toggleClass("is-hidden", !!this.composer || (!!this.hover && this.hover.line === m.line));
		}
		for (const [key, el] of this.markerEls) {
			if (!keep.has(key)) {
				el.remove();
				this.markerEls.delete(key);
			}
		}
	}

	// ----- actions -----

	/** Ctrl/Cmd+Enter: place the task being composed, or catch the sentence under the cursor. */
	modEnter(): boolean {
		if (this.composer) {
			this.composer.pose(true);
			return true;
		}
		const state = this.view.state;
		const head = state.selection.main.head;
		const line = state.doc.lineAt(head);
		const info = this.lineKind(state, line.number);
		if (!info || info.kind === "blank" || info.kind === "heading" || info.kind === "other") {
			this.rt.ctx.toast(this.t("toast.no-sentence"));
			return true;
		}
		if (this.hover?.kb && this.hover.line === line.number) {
			this.catchLine(line.number, this.hover.start, this.hover.end);
			return true;
		}
		const s = sentenceAt(info.body, Math.max(0, head - line.from - info.bodyStart));
		this.catchLine(line.number, s?.start ?? 0, s?.end ?? info.body.length);
		return true;
	}

	decideAtCaret(): boolean {
		if (this.composer) return true;
		const state = this.view.state;
		const head = state.selection.main.head;
		const line = state.doc.lineAt(head);
		const info = this.lineKind(state, line.number);
		if (!info || (info.kind !== "free" && info.kind !== "decide")) {
			this.rt.ctx.toast(this.t("toast.no-sentence"));
			return true;
		}
		const s = info.kind === "decide" ? null : sentenceAt(info.body, Math.max(0, head - line.from - info.bodyStart));
		this.toggleDecide(line.number, s?.start ?? 0, s?.end ?? info.body.length);
		return true;
	}

	altArrow(dir: 1 | -1): boolean {
		if (this.composer) {
			this.composer.setCount(this.composer.count + dir);
			return true;
		}
		this.jump(dir);
		return true;
	}

	escape(): boolean {
		if (this.composer) {
			this.composer.cancel();
			return true;
		}
		if (this.hover) {
			this.setHover(null);
			return true;
		}
		return false;
	}

	/** Alt+↓ / Alt+↑: the next (previous) likely task or question of the note. */
	private jump(dir: 1 | -1): void {
		const state = this.view.state;
		const all: Marker[] = [];
		for (let n = 1; n <= state.doc.lines; n++) {
			const m = this.markerOf(state, n);
			if (m) all.push(m);
		}
		if (!all.length) {
			this.rt.ctx.toast(this.t("toast.no-likely"));
			return;
		}
		const head = state.selection.main.head;
		const at = (m: Marker) => {
			const line = state.doc.line(m.line);
			return line.from + lineInfo(line.text).bodyStart + m.sentence.start;
		};
		const target = dir > 0 ? all.find((m) => at(m) > head) ?? all[0] : [...all].reverse().find((m) => at(m) < head) ?? all[all.length - 1];
		const pos = at(target);
		this.view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }), annotations: ours.of(true) });
		this.view.focus();
		this.setHover(this.hoverFor(this.view.state, target.line, target.sentence.start, true));
	}

	/** Catches the sentence [start, end) of the body of line `n` (a task line: edits it). */
	catchLine(n: number, start: number, end: number): void {
		if (this.composer || n < 1 || n > this.view.state.doc.lines) return;
		const info = this.lineKind(this.view.state, n);
		if (!info || info.kind === "blank" || info.kind === "heading" || info.kind === "other") return;
		this.setHover(null);
		this.composeFile = this.file;
		this.composer = new Composer(this, n, info, start, end);
		if (this.composer) this.composing(true);
	}

	/** "- [?] sentence", or back to the text it was. */
	toggleDecide(n: number, start: number, end: number): void {
		if (this.composer) return;
		const state = this.view.state;
		const line = state.doc.line(n);
		const info = lineInfo(line.text);
		this.setHover(null);
		if (info.kind === "decide") {
			const memory = this.decided.find((d) => d.from <= line.from && d.to >= line.to);
			if (memory) {
				const before = memory.original.indexOf(info.body.trim());
				this.decided = this.decided.filter((d) => d !== memory);
				this.view.dispatch({
					changes: { from: memory.from, to: memory.to, insert: memory.original },
					selection: { anchor: memory.from + Math.max(0, before) },
					annotations: ours.of(true),
					userEvent: "input.sessions",
				});
			} else {
				const text = info.indent + info.body;
				this.view.dispatch({ changes: { from: line.from, to: line.to, insert: text }, selection: { anchor: line.from + text.length }, annotations: ours.of(true), userEvent: "input.sessions" });
			}
			if (!Platform.isMobile) this.view.focus();
			return;
		}
		if (info.kind !== "free") return;
		const result = fish(line.text, start, end, "?");
		// "To decide" keeps the words as written: only the checkbox is added.
		const body = info.body.slice(start, end).trim();
		result.lines[result.task] = result.lines[result.task].slice(0, result.titleStart) + body;
		const produced = result.lines.join("\n");
		this.view.dispatch({
			changes: { from: line.from, to: line.to, insert: produced },
			selection: { anchor: line.from + result.lines.slice(0, result.task).reduce((s, l) => s + l.length + 1, 0) + result.lines[result.task].length },
			annotations: ours.of(true),
			userEvent: "input.sessions",
		});
		this.decided.push({ from: line.from, to: line.from + produced.length, produced, original: line.text });
		if (!Platform.isMobile) this.view.focus();
	}

	/** After a task is placed: the toast's Undo takes back that one step of the history. */
	rememberPose(depth: number): void {
		this.lastPose = depth;
	}

	undoPose(): boolean {
		if (this.composer || this.lastPose < 0 || undoDepth(this.view.state) !== this.lastPose) return false;
		this.lastPose = -1;
		if (!undo(this.view)) return false;
		this.rt.ctx.toast(this.t("toast.undone"));
		if (!Platform.isMobile) this.view.focus();
		return true;
	}

	cancelCompose(): void {
		this.composer?.cancel();
	}

	/** The group tag of a task line, and the line without it (for editing). */
	static splitTask(text: string): { tag: string | null; text: string } {
		const info = lineInfo(text);
		const tag = groupTag(info.body);
		if (!tag) return { tag: null, text };
		return { tag, text: text.slice(0, info.bodyStart) + withoutTag(info.body, tag) };
	}
}
