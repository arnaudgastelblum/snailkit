// Composing a task from a caught sentence. The sentence is already a real "- [ ] Title" line in
// the text (its title is edited in place, step 1); a small numbered window slides in under it:
// step 2 the tag (a calm column: one tag in color at a time, the one under the cursor, the reason
// of its rank next to it), step 3 the description (only when lines follow: a bracket in the
// margin, with a grip, says which lines below become the description). Placing writes
// "- [ ] Title #tag" and indents the description under it; Escape gives the original text back,
// character for character.
import { indentUnit } from "@codemirror/language";
import { isolateHistory, undo, undoDepth } from "./history";
import { Decoration, EditorView, type ViewUpdate, type WidgetType } from "@codemirror/view";
import type { EditorState, Range, Transaction } from "@codemirror/state";
import { Platform, setIcon } from "obsidian";
import { capsule } from "./capsule";
import { keyNames, SessionView } from "./editor";
import { guardField, ours, setGuard, setSpacer } from "./guard";
import { candidateRange, chipList, defaultCount, fish, highlight, lineInfo, poseLines, shownName, stepAfterTag, suggestion, withoutTag, type Chip, type LineInfo } from "./logic";

type Step = "title" | "tag" | "desc";

const SVG_NS = "http://www.w3.org/2000/svg";
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** A mouse wheel notch is at least this many pixels: one line per notch. */
const WHEEL_NOTCH = 50;
/** Trackpad deltas add up to one line every this many pixels. */
const WHEEL_STEP = 60;
/** Rows the column offers before it scrolls. */
const ROWS = 60;

export class Composer {
	step: Step = "title";
	tag: string | null = null;
	suggested: string | null = null;
	private suggestedWord: string | null = null;
	count = 0;
	/** Lines after the task line that can become its description. */
	candCount = 0;
	/** How many of them were its description already (editing a task). */
	private wasDescription = 0;
	private level: string | null = null;
	private filter = "";
	private hi = 0;
	private chips: Chip[] = [];
	readonly edit: boolean;
	/** The line numbers, in the text as composed. */
	taskLine: number;
	/** The region the catch rewrote, and what it was. */
	private fishFrom: number;
	private fishTo: number;
	private readonly original: string;
	private readonly caret: number;
	/** Where the original line started, and the depth of the undo history before the catch. */
	private readonly origFrom: number;
	private readonly startDepth: number;
	/** Start of the task line, and end of the lines that can become its description (followed through changes). */
	private taskFrom = 0;
	private zoneEnd = 0;
	/** Another tool changed the note while composing: the history can no longer be rewound to the catch. */
	private foreign = false;
	private ended = false;
	private spacer = 0;
	private dragY: number | null = null;
	private spring = { y0: 0, y1: 0, v0: 0, v1: 0, started: false };
	private frame = 0;
	private resize: ResizeObserver | null = null;
	private readonly phone = Platform.isMobile;
	private cleanups: Array<() => void> = [];
	private helpTimer = 0;
	/** Where the pointer last was over the column (see the mouse move of the rows). */
	private mouse = { x: -1, y: -1 };

	// The window.
	private panel!: HTMLElement;
	private rowTag!: HTMLElement;
	private rowDesc: HTMLElement | null = null;
	private summaryBtn!: HTMLElement;
	private openEl!: HTMLElement;
	private fieldEl!: HTMLElement;
	private crumb!: HTMLElement;
	private input!: HTMLInputElement;
	private listEl!: HTMLElement;
	private cursorEl!: HTMLElement;
	private countEl!: HTMLElement;
	private previewEl!: HTMLElement;
	private lessBtn!: HTMLButtonElement;
	private moreBtn!: HTMLButtonElement;
	private placeKey!: HTMLElement;
	private hintEl!: HTMLElement;
	private helpBtn!: HTMLButtonElement;
	private helpEl: HTMLElement | null = null;
	// Bracket elements, in the editor's layer.
	private svg!: SVGSVGElement;
	private path!: SVGPathElement;
	private knob!: HTMLElement;
	private badge!: HTMLElement;

	constructor(private sv: SessionView, n: number, info: LineInfo, start: number, end: number) {
		const view = sv.view;
		const state = view.state;
		const line = state.doc.line(n);
		this.original = line.text;
		let lines: string[];
		let task: number;
		let titleStart: number;
		if (info.kind === "task") {
			const split = SessionView.splitTask(line.text);
			this.edit = true;
			this.tag = split.tag;
			lines = [split.text];
			task = 0;
			titleStart = info.bodyStart;
			this.caret = line.text.length;
		} else {
			this.edit = false;
			const f = info.kind === "decide" ? fish(line.text, 0, info.body.length, " ") : fish(line.text, start, end);
			lines = f.lines;
			task = f.task;
			titleStart = f.titleStart;
			this.caret = info.bodyStart + (info.kind === "decide" ? 0 : start);
		}
		const produced = lines.join("\n");
		this.origFrom = line.from;
		this.startDepth = undoDepth(state);
		this.fishFrom = line.from;
		this.fishTo = line.from + produced.length;
		this.taskLine = n + task;
		const taskFrom = line.from + lines.slice(0, task).reduce((s, l) => s + l.length + 1, 0);
		const taskTo = taskFrom + lines[task].length;
		view.dispatch({
			changes: { from: line.from, to: line.to, insert: produced },
			selection: { anchor: taskTo },
			effects: setGuard.of({ from: taskFrom + titleStart, to: taskTo }),
			annotations: [ours.of(true), isolateHistory.of("full")],
			userEvent: "input.sessions",
		});
		this.taskFrom = taskFrom;

		// The description: the paragraph that follows (or the description the task already has).
		const doc = view.state.doc;
		const all: string[] = [];
		for (let i = 1; i <= doc.lines; i++) all.push(doc.line(i).text);
		const range = candidateRange(all, this.taskLine - 1, sv.rt.isClosing);
		this.candCount = range.count;
		this.wasDescription = range.description;
		const cands = all.slice(this.taskLine, this.taskLine + this.candCount);
		this.count = this.edit ? range.description : defaultCount(cands);
		this.zoneEnd = doc.line(this.taskLine + this.candCount).to;

		const title = withoutTag(lineInfo(lines[task]).body);
		const context = [title, ...cands.slice(0, Math.max(1, this.count))].join(" ");
		const sug = suggestion(context, sv.rt.settings.learned, sv.rt.allTags());
		this.suggested = this.tag ?? sug?.tag ?? null;
		this.suggestedWord = this.tag ? null : sug?.word ?? null;

		this.buildPanel();
		this.buildBracket();
		view.scrollDOM.classList.add("sk-sessions-composing");
		this.renderDesc();
		// On a phone the title is not edited first (the keyboard would cover the sheet): the column opens.
		this.goStep(this.phone ? "tag" : "title", !this.phone);
		if (this.phone) {
			// The keyboard and the editing toolbar step aside: the sheet takes their place.
			view.contentDOM.blur();
			this.baseHeight = window.innerHeight;
			const place = () => this.placeSheet();
			const later = () => {
				place();
				window.setTimeout(place, 120);
				window.setTimeout(place, 400);
			};
			// The app reports its keyboard with its own events (height included); iOS also scrolls the
			// visual viewport instead of resizing the page. Every signal is followed.
			const kbShow = (e: Event) => {
				const h = (e as Event & { keyboardHeight?: number }).keyboardHeight;
				if (typeof h === "number") this.keyboard = h;
				later();
			};
			const kbHide = () => {
				this.keyboard = 0;
				later();
			};
			const vv = window.visualViewport;
			vv?.addEventListener("resize", place);
			vv?.addEventListener("scroll", place);
			window.addEventListener("resize", place);
			window.addEventListener("keyboardWillShow", kbShow);
			window.addEventListener("keyboardDidShow", kbShow);
			window.addEventListener("keyboardWillHide", kbHide);
			window.addEventListener("keyboardDidHide", kbHide);
			this.panel.addEventListener("focusin", later);
			this.cleanups.push(() => {
				vv?.removeEventListener("resize", place);
				vv?.removeEventListener("scroll", place);
				window.removeEventListener("resize", place);
				window.removeEventListener("keyboardWillShow", kbShow);
				window.removeEventListener("keyboardDidShow", kbShow);
				window.removeEventListener("keyboardWillHide", kbHide);
				window.removeEventListener("keyboardDidHide", kbHide);
				this.panel.removeEventListener("focusin", later);
			});
			window.setTimeout(place, 50);
			window.setTimeout(place, 400);
		}
		sv.redraw();
		this.loop();
		window.setTimeout(() => this.ensureVisible(), 30);
	}

	/** An element of this composition (its window or its grip), for the keyboard scope. */
	owns(el: Element): boolean {
		return !this.ended && (this.panel.contains(el) || this.knob.contains(el));
	}

	private get view(): EditorView {
		return this.sv.view;
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.sv.rt.ctx.t(key, vars);
	}

	private tn(key: string, n: number): string {
		return this.sv.rt.ctx.tn(key, n);
	}

	// ----- the text -----

	update(u: ViewUpdate): void {
		if (this.ended) return;
		if (u.docChanged) {
			// Our title edits stay inside the guard. A change from elsewhere (another tool, the
			// editor's own undo) that reaches the caught lines ends the composition.
			let touched = false;
			let fishTouched = false;
			let undone = false;
			for (const tr of u.transactions) {
				if (!tr.docChanged || tr.annotation(ours)) continue;
				const g = tr.startState.field(guardField, false);
				if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) undone = true;
				tr.changes.iterChanges((fromA, toA) => {
					if (g && fromA >= g.from && toA <= g.to) return;
					this.foreign = true;
					if (toA >= this.fishFrom && fromA <= this.zoneEnd) touched = true;
					if (toA >= this.fishFrom && fromA <= this.fishTo) fishTouched = true;
				});
				this.mapThrough(tr);
			}
			const doc = u.state.doc;
			if (touched) {
				this.abort(!fishTouched && !undone);
				return;
			}
			this.taskLine = doc.lineAt(Math.min(this.taskFrom, doc.length)).number;
			if (this.taskLine + this.candCount > doc.lines || lineInfo(doc.line(this.taskLine).text).kind !== "task") {
				this.abort(false);
				return;
			}
		}
		if (u.selectionSet && u.view.hasFocus && this.step !== "title") this.goStep("title", false);
	}

	private mapThrough(tr: Transaction): void {
		this.fishFrom = tr.changes.mapPos(this.fishFrom, -1);
		this.fishTo = tr.changes.mapPos(this.fishTo, 1);
		this.taskFrom = tr.changes.mapPos(this.taskFrom, -1);
		this.zoneEnd = tr.changes.mapPos(this.zoneEnd, 1);
	}

	/** The note changed under the composition: stop, and give the caught text back when it is still intact. */
	private abort(restore: boolean): void {
		const from = this.fishFrom;
		const to = this.fishTo;
		this.end(false);
		window.setTimeout(() => {
			try {
				this.view.dispatch({
					changes: restore ? { from, to, insert: this.original } : undefined,
					effects: [setGuard.of(null), setSpacer.of(null)],
					annotations: ours.of(true),
					userEvent: "input.sessions",
				});
			} catch {
				/* the editor is gone */
			}
		}, 0);
	}

	decorations(
		state: EditorState,
		ranges: Range<Decoration>[],
		tagWidget: (tag: string | null, preview: boolean, onClick: () => void) => WidgetType,
	): void {
		if (this.ended || this.taskLine > state.doc.lines) return;
		const line = state.doc.line(this.taskLine);
		ranges.push(Decoration.line({ class: "sk-sessions-task-line is-composing" + (this.step === "title" ? " is-step-title" : "") }).range(line.from));
		for (let i = 1; i <= this.candCount && this.taskLine + i <= state.doc.lines; i++) {
			const l = state.doc.line(this.taskLine + i);
			ranges.push(Decoration.line({ class: "sk-sessions-cand" + (i <= this.count ? " is-grab" : "") }).range(l.from));
		}
		let name = this.tag;
		let preview = false;
		if (this.step === "tag") {
			const it = this.chips[this.hi];
			if (it) {
				name = it.tag;
				preview = name !== this.tag;
			}
		} else if (!this.tag && this.suggested) {
			name = this.suggested;
			preview = true;
		}
		ranges.push(Decoration.widget({ widget: tagWidget(name, preview, () => this.goStep("tag")), side: 1 }).range(line.to));
	}

	/** A click in the text while composing: a candidate line sets the description; the title is editable; the rest waits. */
	onEditorMouseDown(e: MouseEvent): boolean {
		if ((e.target as HTMLElement).closest?.(".sk-sessions-tagslot")) return true;
		const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
		const n = this.view.state.doc.lineAt(pos).number;
		if (n === this.taskLine) {
			if ((e.target as HTMLElement).closest?.(".task-list-item-checkbox")) return true;
			if (this.step !== "title") window.setTimeout(() => this.goStep("title", false), 0);
			return false;
		}
		const i = n - this.taskLine;
		if (i >= 1 && i <= this.candCount) {
			this.setCount(i === this.count ? i - 1 : i);
			if (this.step !== "desc") this.goStep("desc");
		}
		return true;
	}

	// ----- steps -----

	goStep(step: Step, focus = true): void {
		if (this.ended) return;
		if (step === "desc" && !this.candCount) step = "tag";
		if (this.step === "tag" && step !== "tag") {
			this.filter = "";
			this.level = null;
			this.input.value = "";
		}
		this.step = step;
		this.panel.dataset.step = step;
		this.closeHelp();
		this.rowTag.toggleClass("is-on", step === "tag");
		this.rowDesc?.toggleClass("is-on", step === "desc");
		this.openEl.toggleClass("is-hidden", step !== "tag");
		this.summaryBtn.toggleClass("is-hidden", step === "tag");
		if (step === "tag") {
			const want = this.tag ?? this.suggested;
			this.chips = this.chipList();
			const i = want ? this.chips.findIndex((c) => c.tag.toLowerCase() === want.toLowerCase()) : -1;
			this.hi = i >= 0 ? i : 0;
			this.renderList(true);
		} else {
			this.renderSummary();
			this.renderHint();
		}
		this.placeKey.setText(step === "desc" || (step === "tag" && !this.candCount) ? this.t("key.enter") : `${keyNames.mod()} ${this.t("key.enter")}`);
		if (focus && !this.phone) {
			if (step === "title") {
				this.view.focus();
				const line = this.view.state.doc.line(this.taskLine);
				const head = this.view.state.selection.main.head;
				if (head < line.from || head > line.to) this.view.dispatch({ selection: { anchor: line.to }, annotations: ours.of(true) });
			} else if (step === "tag") this.input.focus({ preventScroll: true });
			else this.knob.focus({ preventScroll: true });
		}
		this.sv.redraw();
		if (this.phone) window.setTimeout(() => this.placeSheet(), 60);
	}

	/** After the tag: the description when lines follow the task, otherwise the task is placed. */
	private afterTag(): void {
		if (stepAfterTag(this.candCount) === "desc") this.goStep("desc");
		else this.pose(false);
	}

	/** Keys of the title step, while the cursor is in the editor. */
	titleKey(key: string): boolean {
		if (this.step !== "title") return false;
		if (key === "Enter") {
			if (this.tag || this.suggested) {
				this.tag = this.tag ?? this.suggested;
				this.afterTag();
			} else this.goStep("tag");
		} else if (key === "Tab") this.goStep("tag");
		else if (key === "ArrowDown") this.setCount(this.count + 1);
		else if (key === "ArrowUp") this.setCount(this.count - 1);
		return true;
	}

	/** Keys in the window (tag field) and on the grip. */
	private onPanelKey(e: KeyboardEvent): void {
		const k = e.key;
		const mod = e.ctrlKey || e.metaKey;
		let handled = true;
		if (k === "Escape") {
			if (this.helpEl) this.closeHelp();
			else if (this.step === "tag" && (this.filter || this.level)) {
				this.filter = "";
				this.level = null;
				this.input.value = "";
				this.hi = 0;
				this.renderList(true);
			} else this.cancel();
		} else if (mod && (k === "/" || e.code === "Slash")) this.toggleHelp();
		else if (mod && k === "Enter") this.pose(true);
		else if (e.altKey && (k === "ArrowDown" || k === "ArrowUp")) this.setCount(this.count + (k === "ArrowDown" ? 1 : -1));
		else if (this.step === "tag") {
			const caretEnd = this.input.selectionStart === this.input.value.length;
			const caretStart = this.input.selectionStart === 0;
			if (k === "Enter") {
				const it = this.chips[this.hi];
				if (it) this.choose(it);
				else this.afterTag();
			} else if (k === "Tab") {
				if (e.shiftKey) {
					if (!this.ascend()) this.goStep("title");
				} else if (!this.descend()) {
					const it = this.chips[this.hi];
					if (it) this.choose(it);
					else this.afterTag();
				}
			} else if (k === "ArrowDown") this.moveHi(1);
			else if (k === "ArrowUp") this.moveHi(-1);
			else if (k === "ArrowRight" && !this.input.value) this.descend();
			else if (k === "ArrowLeft" && !this.input.value) this.ascend();
			else if (k === "ArrowRight" && caretEnd) this.moveHi(1);
			else if (k === "ArrowLeft" && caretStart) this.moveHi(-1);
			else if (k === "Backspace" && !this.input.value && this.level) this.ascend();
			else if (k === "Home" && !this.input.value) this.setHi(0);
			else if (k === "End" && !this.input.value) this.setHi(this.chips.length - 1);
			else handled = false;
		} else if (this.step === "desc") {
			if (k === "ArrowDown" || k === "+" || k === "=") this.setCount(this.count + 1);
			else if (k === "ArrowUp" || k === "-") this.setCount(this.count - 1);
			else if (k === "Home") this.setCount(0);
			else if (k === "End") this.setCount(this.candCount);
			else if (k === "Enter" || k === " ") this.pose(false);
			else if (k === "Tab") {
				if (e.shiftKey) this.goStep("tag");
			} else handled = false;
		} else handled = false;
		if (handled) {
			e.preventDefault();
			e.stopPropagation();
		}
	}

	// ----- the tag column -----

	private chipList(): Chip[] {
		const file = this.sv.file;
		return chipList({
			filter: this.filter,
			level: this.level,
			tag: this.tag,
			suggested: this.suggested,
			suggestedWord: this.suggestedWord,
			near: this.sv.rt.nearTags(file),
			recent: this.sv.rt.recentTags(),
			all: this.sv.rt.allTags(),
			limit: ROWS,
		});
	}

	/** "learned · word", "recent", "subject of the note"... as shown next to a tag. */
	private whyText(why: Chip["why"]): string {
		if (!why) return "";
		if (why.kind === "learned") return why.word ? this.t("why.learned", { word: why.word }) : this.t("why.suggested");
		return this.t(`why.${why.kind}`);
	}

	private renderList(snap = false): void {
		if (this.ended) return;
		const list = this.chipList();
		this.chips = list;
		if (this.hi >= list.length) this.hi = Math.max(0, list.length - 1);
		const deep = !!this.level;
		this.fieldEl.toggleClass("is-deep", deep);
		this.crumb.empty();
		if (deep) this.crumb.append(capsule(this.panel.ownerDocument, this.level!, this.sv.rt.tagClasses(this.level!)));
		this.input.placeholder = deep ? this.t("panel.sub-placeholder", { tag: this.level! }) : this.t("panel.tag-placeholder");
		for (const el of Array.from(this.listEl.children)) if (el !== this.cursorEl) el.remove();
		if (!list.length) this.listEl.createDiv({ cls: "sk-sessions-empty", text: this.t("panel.no-tag") });
		const showKids = !deep && !this.filter;
		let lastGroup: string | null = null;
		list.forEach((item, i) => {
			const gap = lastGroup !== null && item.group !== lastGroup;
			lastGroup = item.group;
			const classes = item.create ? "" : this.sv.rt.tagClasses(item.tag);
			const row = this.listEl.createDiv({ cls: `sk-sessions-it ${classes}`.trim(), attr: { role: "option", "data-i": String(i), "aria-selected": String(i === this.hi) } });
			row.toggleClass("is-hi", i === this.hi);
			row.toggleClass("is-gap", gap);
			row.toggleClass("is-new", !!item.create);
			row.toggleClass("is-gray", !classes);
			row.createEl("i", { cls: "sk-sessions-it-dot" });
			const name = row.createSpan({ cls: "sk-sessions-it-name" });
			if (item.create) {
				name.appendText(this.t("panel.create-row") + " ");
				name.createEl("b", { text: item.tag });
				row.setAttr("aria-label", this.t("panel.create", { tag: item.tag }));
			} else this.renderName(name, item.tag);
			if (showKids && item.kids.length) {
				const shown = item.kids.slice(0, 4);
				row.createSpan({ cls: "sk-sessions-it-kids", text: shown.join(" · ") + (item.kids.length > shown.length ? ` · +${item.kids.length - shown.length}` : "") });
			}
			const why = this.whyText(item.why);
			if (why) row.createSpan({ cls: "sk-sessions-it-why", text: why });
			if (showKids && item.parent) {
				const more = row.createEl("button", { cls: "sk-sessions-it-more", attr: { type: "button", tabindex: "-1", "aria-label": this.t("panel.subtags", { key: this.t("key.tab") }), "data-more": String(i) } });
				setIcon(more, "chevron-right");
				more.addEventListener("mousedown", (e) => e.preventDefault());
				more.addEventListener("click", (e) => {
					e.stopPropagation();
					if (this.ended) return;
					this.hi = i;
					this.descend();
				});
			}
			row.createEl("kbd", { cls: "sk-sessions-it-enter", text: "↵" });
			row.addEventListener("mousedown", (e) => e.preventDefault());
			row.addEventListener("click", () => {
				if (this.ended) return;
				this.hi = i;
				this.choose(item);
			});
			if (!this.phone) {
				// Only a pointer that really moves takes the highlight: the browser also sends a mouse
				// move when the rows change under a still pointer.
				row.addEventListener("mousemove", (e) => {
					if (this.ended || this.step !== "tag") return;
					if (e.clientX === this.mouse.x && e.clientY === this.mouse.y) return;
					this.mouse = { x: e.clientX, y: e.clientY };
					if (this.hi !== i) this.setHi(i);
				});
			}
		});
		this.placeCursor(snap);
		this.renderSummary();
		this.renderHint();
		this.sv.redraw();
	}

	/** "parent / leaf", the parent dimmed; inside a parent, its own sub-tags without the prefix; what matches the filter marked. */
	private renderName(el: HTMLElement, tag: string): void {
		const parts = shownName(tag, this.level).split("/");
		parts.forEach((part, k) => {
			const span = el.createSpan({ cls: k < parts.length - 1 ? "sk-sessions-it-root" : "sk-sessions-it-leaf" });
			for (const piece of highlight(part, this.filter)) {
				if (piece.hit) span.createEl("mark", { text: piece.text });
				else span.appendText(piece.text);
			}
			if (k < parts.length - 1) el.createSpan({ cls: "sk-sessions-it-sep", text: "/" });
		});
	}

	/** The tinted bar slides under the row at `hi`; `snap` moves it at once (the column was rebuilt). */
	private placeCursor(snap: boolean): void {
		const row = this.listEl.querySelector(".sk-sessions-it.is-hi") as HTMLElement | null;
		if (!row) {
			this.cursorEl.removeClass("is-shown");
			return;
		}
		const item = this.chips[this.hi];
		this.cursorEl.className = `sk-sessions-cursor ${item && !item.create ? this.sv.rt.tagClasses(item.tag) : ""}`.trim();
		if (snap) this.listEl.addClass("is-snap");
		this.cursorEl.style.transform = `translateY(${row.offsetTop}px)`;
		this.cursorEl.style.height = `${row.offsetHeight}px`;
		this.cursorEl.addClass("is-shown");
		if (snap) {
			void this.listEl.offsetWidth;
			this.listEl.removeClass("is-snap");
		}
		const lr = this.listEl.getBoundingClientRect();
		const rr = row.getBoundingClientRect();
		if (rr.top < lr.top + 2) this.listEl.scrollTop -= lr.top + 2 - rr.top;
		else if (rr.bottom > lr.bottom - 2) this.listEl.scrollTop += rr.bottom - lr.bottom + 2;
	}

	/** The highlighted row changes without rebuilding the column. */
	private setHi(i: number, hint = true): void {
		if (!this.chips.length) return;
		this.hi = Math.max(0, Math.min(this.chips.length - 1, i));
		for (const el of Array.from(this.listEl.querySelectorAll(".sk-sessions-it")) as HTMLElement[]) {
			const on = Number(el.dataset.i) === this.hi;
			el.toggleClass("is-hi", on);
			el.setAttr("aria-selected", String(on));
		}
		this.placeCursor(false);
		if (hint) this.renderHint();
		this.sv.redraw();
	}

	private moveHi(d: number): void {
		this.setHi(this.hi + d);
	}

	/** The tag row, folded: the tag (or the proposed one), why, and how to change it. */
	private renderSummary(): void {
		const el = this.summaryBtn;
		el.empty();
		el.createSpan({ cls: "sk-sessions-lab", text: this.t("panel.step-tag") });
		const doc = el.ownerDocument;
		const kbd = (parent: HTMLElement, text: string) => parent.createEl("kbd", { text });
		if (this.tag) {
			el.append(capsule(doc, this.tag, this.sv.rt.tagClasses(this.tag)));
			const why = this.whyText(this.chipList().find((c) => c.tag.toLowerCase() === this.tag!.toLowerCase())?.why);
			if (why && why !== this.t("why.chosen")) el.createSpan({ cls: "sk-sessions-why", text: why });
			const chg = el.createSpan({ cls: "sk-sessions-chg" });
			chg.appendText(this.t("panel.change") + " ");
			kbd(chg, this.t("key.tab"));
		} else if (this.suggested) {
			const proposed = capsule(doc, this.suggested, this.sv.rt.tagClasses(this.suggested));
			proposed.addClass("is-proposed");
			el.append(proposed);
			const why = this.suggestedWord ? this.t("why.learned", { word: this.suggestedWord }) : this.t("why.suggested");
			el.createSpan({ cls: "sk-sessions-why", text: `${this.t("panel.proposed")} · ${why}` });
			const chg = el.createSpan({ cls: "sk-sessions-chg" });
			kbd(chg, this.t("key.enter"));
			chg.appendText(` ${this.t("panel.keep")} · `);
			kbd(chg, this.t("key.tab"));
			chg.appendText(` ${this.t("panel.change")}`);
		} else {
			el.createSpan({ cls: "sk-sessions-none", text: this.t("panel.none-yet") });
			const chg = el.createSpan({ cls: "sk-sessions-chg" });
			chg.appendText(this.t("hint.pick") + " ");
			kbd(chg, this.t("key.tab"));
		}
		this.rowTag.toggleClass("is-done", !!this.tag && this.step !== "tag");
		this.rowDesc?.toggleClass("is-done", this.step !== "desc" && this.count > 0);
	}

	private choose(item: Chip): void {
		const from = this.listEl.querySelector(".sk-sessions-it.is-hi .sk-sessions-it-name") as HTMLElement | null;
		const start = from?.getBoundingClientRect() ?? null;
		this.tag = item.tag;
		this.level = null;
		this.filter = "";
		this.input.value = "";
		if (stepAfterTag(this.candCount) === "place") {
			this.pose(false);
			return;
		}
		this.goStep("desc");
		if (start) this.fly(start, item.tag);
	}

	/** The chosen tag flies from its row to the end of the task line, where its capsule now sits. */
	private fly(start: DOMRect, tag: string): void {
		if (reduced() || !start.width) return;
		window.setTimeout(() => {
			if (this.ended) return;
			const slot = this.view.contentDOM.querySelector(".sk-sessions-tagslot") as HTMLElement | null;
			if (!slot) return;
			const end = slot.getBoundingClientRect();
			if (!end.width) return;
			const doc = this.view.dom.ownerDocument;
			const flyer = doc.body.createDiv({ cls: "sk-sessions-flyer" });
			flyer.append(capsule(doc, tag, this.sv.rt.tagClasses(tag)));
			const size = flyer.getBoundingClientRect();
			slot.style.opacity = "0";
			const anim = flyer.animate(
				[
					{ transform: `translate(${start.left}px, ${start.top + (start.height - size.height) / 2}px)`, opacity: 0.9 },
					{ transform: `translate(${end.left}px, ${end.top + (end.height - size.height) / 2}px)`, opacity: 1 },
				],
				{ duration: 420, easing: "cubic-bezier(0.22, 1.25, 0.36, 1)", fill: "both" },
			);
			const done = () => {
				flyer.remove();
				slot.style.opacity = "";
			};
			anim.onfinish = done;
			anim.oncancel = done;
			window.setTimeout(done, 700);
		}, 40);
	}

	private descend(): boolean {
		const item = this.chips[this.hi];
		if (!item || item.create || this.level || this.filter || !item.parent) return false;
		this.level = item.tag;
		this.filter = "";
		this.input.value = "";
		this.hi = 1;
		this.renderList(true);
		return true;
	}

	private ascend(): boolean {
		if (!this.level) return false;
		const was = this.level;
		this.level = null;
		this.filter = "";
		this.input.value = "";
		this.chips = this.chipList();
		const i = this.chips.findIndex((c) => c.tag.toLowerCase() === was.toLowerCase());
		this.hi = i >= 0 ? i : 0;
		this.renderList(true);
		return true;
	}

	private onInput(): void {
		const v = this.input.value.replace(/^#/, "").replace(/\s+/g, "-");
		if (v !== this.input.value) this.input.value = v;
		const parent = /^(.+)\/$/.exec(v);
		if (parent && !this.level && this.sv.rt.allTags().some((t) => t.toLowerCase().startsWith(parent[1].toLowerCase() + "/"))) {
			this.level = parent[1];
			this.filter = "";
			this.input.value = "";
			this.hi = 1;
			this.renderList(true);
			return;
		}
		this.filter = v;
		this.hi = 0;
		this.renderList(true);
	}

	// ----- description -----

	setCount(n: number): void {
		if (this.ended) return;
		const next = Math.max(0, Math.min(this.candCount, n));
		const prev = this.count;
		this.count = next;
		if (next !== prev) {
			if (next > prev) {
				const line = this.view.state.doc.line(this.taskLine + next);
				this.sv.flashLines([{ pos: line.from, cls: "sk-sessions-flash" }], 560);
			}
			this.pop(this.badge);
			this.pop(this.countEl);
			if (this.phone) {
				try {
					navigator.vibrate?.(6);
				} catch {
					/* no vibration */
				}
			}
		}
		this.renderDesc();
		this.sv.redraw();
		if (next !== prev && this.dragY === null) this.keepGripVisible();
	}

	private renderDesc(): void {
		const n = this.count;
		const label = n === 0 ? this.t("panel.no-description") : this.tn("panel.lines", n);
		this.badge.setText(n ? `+${n}` : "0");
		this.badge.toggleClass("is-zero", !n);
		this.knob.setAttr("aria-valuenow", String(n));
		this.knob.setAttr("aria-valuemax", String(this.candCount));
		this.knob.setAttr("aria-valuetext", label);
		if (this.rowDesc) {
			this.countEl.setText(label);
			this.lessBtn.disabled = n === 0;
			this.moreBtn.disabled = n >= this.candCount;
			const doc = this.view.state.doc;
			let first = "";
			for (let i = 1; i <= n && !first; i++) first = doc.line(this.taskLine + i).text.trim();
			this.previewEl.setText(first);
			this.rowDesc.toggleClass("is-done", this.step !== "desc" && n > 0);
		}
		this.renderHint();
	}

	private pop(el: HTMLElement): void {
		el.removeClass("is-pop");
		void el.offsetWidth;
		el.addClass("is-pop");
	}

	/** With the keyboard or − / +, the last line taken stays visible (above the sheet on a phone). */
	private keepGripVisible(): void {
		if (!this.count) return;
		const line = this.view.state.doc.line(this.taskLine + this.count);
		window.requestAnimationFrame(() => {
			if (this.ended) return;
			const c = this.view.coordsAtPos(line.to, -1);
			if (!c) {
				this.view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "nearest", yMargin: 80 }) });
				return;
			}
			const sr = this.view.scrollDOM.getBoundingClientRect();
			const bottom = (this.phone ? Math.min(sr.bottom, this.panel.getBoundingClientRect().top) : sr.bottom) - 40;
			if (c.bottom > bottom) this.view.scrollDOM.scrollBy({ top: c.bottom - bottom, behavior: reduced() ? "auto" : "smooth" });
		});
	}

	// ----- the window -----

	private buildPanel(): void {
		const doc = this.view.dom.ownerDocument;
		const panel = (this.panel = doc.createElement("div"));
		panel.className = "sk-sessions-panel" + (this.phone ? " is-sheet" : "");
		panel.setAttr("role", "dialog");
		panel.setAttr("aria-label", this.t("panel.label"));
		if (this.phone) panel.createDiv({ cls: "sk-sessions-pk-grabber" });

		// Step 2: the tag.
		this.rowTag = panel.createDiv({ cls: "sk-sessions-step is-tag" });
		this.stepButton(this.rowTag, "2", "tag", this.t("panel.step-tag"));
		const tagBody = this.rowTag.createDiv({ cls: "sk-sessions-step-body" });
		this.summaryBtn = tagBody.createEl("button", { cls: "sk-sessions-tag-summary", attr: { type: "button", tabindex: "-1" } });
		this.summaryBtn.addEventListener("click", () => this.goStep("tag"));
		this.openEl = tagBody.createDiv({ cls: "sk-sessions-tag-open" });
		this.fieldEl = this.openEl.createDiv({ cls: "sk-sessions-field" });
		setIcon(this.fieldEl.createSpan({ cls: "sk-sessions-field-icon" }), "tag");
		this.crumb = this.fieldEl.createSpan({ cls: "sk-sessions-crumb" });
		this.input = this.fieldEl.createEl("input", { cls: "sk-sessions-input", attr: { type: "text", autocomplete: "off", spellcheck: "false", "aria-label": this.t("panel.tag-search") } });
		this.listEl = this.openEl.createDiv({ cls: "sk-sessions-list", attr: { role: "listbox", "aria-label": this.t("panel.step-tag") } });
		this.cursorEl = this.listEl.createDiv({ cls: "sk-sessions-cursor" });

		// Step 3: the description, only when lines follow the task.
		if (this.candCount) {
			this.rowDesc = panel.createDiv({ cls: "sk-sessions-step is-desc" });
			this.stepButton(this.rowDesc, "3", "desc", this.t("panel.step-desc"));
			const body = this.rowDesc.createDiv({ cls: "sk-sessions-step-body is-desc" });
			body.createSpan({ cls: "sk-sessions-lab", text: this.t("panel.description") });
			this.lessBtn = body.createEl("button", { cls: "sk-btn is-ghost is-icon is-s", attr: { type: "button", tabindex: "-1", "aria-label": this.t("panel.less") } });
			setIcon(this.lessBtn, "minus");
			this.countEl = body.createEl("b", { cls: "sk-sessions-count" });
			this.moreBtn = body.createEl("button", { cls: "sk-btn is-ghost is-icon is-s", attr: { type: "button", tabindex: "-1", "aria-label": this.t("panel.more") } });
			setIcon(this.moreBtn, "plus");
			this.previewEl = body.createSpan({ cls: "sk-sessions-preview" });
			this.lessBtn.addEventListener("click", () => {
				this.setCount(this.count - 1);
				if (this.step !== "desc") this.goStep("desc");
			});
			this.moreBtn.addEventListener("click", () => {
				this.setCount(this.count + 1);
				if (this.step !== "desc") this.goStep("desc");
			});
		}

		// The foot: two or three keys of the step, "?" for all of them, Cancel, Place.
		const foot = panel.createDiv({ cls: "sk-sessions-foot" });
		this.hintEl = foot.createDiv({ cls: "sk-sessions-hint" });
		this.helpBtn = foot.createEl("button", { cls: "sk-btn is-ghost is-icon is-s is-help", attr: { type: "button", tabindex: "-1", "aria-expanded": "false", "aria-haspopup": "dialog", "aria-label": this.t("panel.help", { key: `${keyNames.mod()}+/` }) } });
		setIcon(this.helpBtn, "circle-help");
		const cancel = foot.createEl("button", { cls: "sk-btn is-ghost is-s", text: this.t("common.cancel"), attr: { type: "button", tabindex: "-1" } });
		const place = foot.createEl("button", { cls: "sk-btn is-primary is-s", attr: { type: "button", tabindex: "-1" } });
		place.appendText(this.t("panel.place"));
		this.placeKey = place.createEl("kbd");

		for (const b of Array.from(panel.querySelectorAll("button"))) b.addEventListener("mousedown", (e) => e.preventDefault());
		cancel.addEventListener("click", () => this.cancel());
		place.addEventListener("click", () => this.pose(true));
		this.helpBtn.addEventListener("click", () => this.toggleHelp());
		if (!this.phone) {
			this.helpBtn.addEventListener("mouseenter", () => {
				window.clearTimeout(this.helpTimer);
				this.helpTimer = window.setTimeout(() => this.openHelp(), 240);
			});
			this.helpBtn.addEventListener("mouseleave", () => this.closeHelpSoon());
		}
		this.input.addEventListener("focus", () => {
			if (this.step !== "tag") this.goStep("tag", false);
		});
		this.input.addEventListener("input", () => this.onInput());
		this.input.addEventListener("keydown", (e) => this.onPanelKey(e));
		panel.addEventListener("keydown", (e) => {
			if (e.target !== this.input) this.onPanelKey(e);
		});

		if (this.phone) doc.body.appendChild(panel);
		else this.sv.layer.appendChild(panel);
		this.resize = new ResizeObserver(() => {
			if (this.ended) return;
			this.fitHint();
			if (this.phone) return;
			const h = Math.ceil(this.panel.offsetHeight + 16);
			if (h !== this.spacer) {
				this.spacer = h;
				const pos = this.view.state.doc.line(this.taskLine).to;
				this.view.dispatch({ effects: setSpacer.of({ pos, height: h }), annotations: ours.of(true) });
			}
		});
		this.resize.observe(panel);
	}

	/** The number of a step, at the left of its row: a click goes there. */
	private stepButton(row: HTMLElement, n: string, step: Step, label: string): void {
		const b = row.createEl("button", { cls: "sk-sessions-stepn", text: n, attr: { type: "button", tabindex: "-1", "aria-label": `${n} · ${label}` } });
		b.addEventListener("click", () => this.goStep(step));
	}

	// ----- the help bar and the "?" -----

	private renderHint(): void {
		const el = this.hintEl;
		if (!el || this.ended) return;
		el.empty();
		const enter = this.t("key.enter");
		const esc = this.t("key.esc");
		const shift = this.t("key.shift");
		const tab = this.t("key.tab");
		const item = (keys: string[], label: string) => {
			const span = el.createSpan();
			for (const k of keys) span.createEl("kbd", { text: k });
			span.createSpan({ cls: "sk-sessions-hint-k", text: label });
		};
		if (this.dragY !== null) {
			el.createSpan({ cls: "sk-sessions-hint-k", text: this.t("hint.drag") });
			return;
		}
		if (this.step === "title") {
			const keep = this.tag ?? this.suggested;
			item([enter], keep ? this.t("hint.keep", { tag: keep.split("/").slice(-1)[0] }) : this.t("hint.choose-tag"));
			item([tab], this.t("hint.tag"));
			item([esc], this.t("hint.cancel"));
		} else if (this.step === "tag") {
			const row = this.chips[this.hi];
			item(["↑", "↓"], this.t("hint.move"));
			item([enter], row?.create ? this.t("hint.create") : this.t("hint.pick"));
			if (this.level) item([shift, tab], this.t("hint.up"));
			else if (row && !this.filter && row.parent) item([tab], this.t("hint.subtags"));
			else item([esc], this.filter ? this.t("hint.clear") : this.t("hint.cancel"));
		} else {
			item(["↓", "↑"], this.t("hint.line"));
			item([enter], this.t("hint.place"));
			item([shift, tab], this.t("hint.tag"));
		}
		this.fitHint();
	}

	/** The bar keeps the keys that fit: the last one goes before it gets cut. */
	private fitHint(): void {
		const el = this.hintEl;
		if (!el) return;
		const items = Array.from(el.children) as HTMLElement[];
		for (const s of items) s.style.display = "";
		for (let i = items.length - 1; i > 0 && el.scrollWidth > el.clientWidth + 1; i--) items[i].style.display = "none";
	}

	toggleHelp(): boolean {
		if (this.ended) return false;
		if (this.helpEl) this.closeHelp();
		else this.openHelp();
		return true;
	}

	private openHelp(): void {
		if (this.ended || this.helpEl) return;
		window.clearTimeout(this.helpTimer);
		const mod = keyNames.mod();
		const alt = keyNames.alt();
		const enter = this.t("key.enter");
		const esc = this.t("key.esc");
		const shift = this.t("key.shift");
		const tab = this.t("key.tab");
		const type = { word: this.t("help.key-type") };
		const mouse = { word: this.t("help.key-mouse") };
		type Key = string | { word: string };
		const steps: Record<Step, Array<[string, Key[]]>> = {
			title: [
				["help.title-enter", [enter]],
				["help.title-tab", [tab]],
				["help.title-lines", ["↓", "↑"]],
			],
			tag: [
				["help.tag-type", [type]],
				["help.tag-move", ["↑", "↓"]],
				["help.tag-enter", [enter]],
				["help.tag-sub", [tab]],
				["help.tag-up", [shift, tab]],
				["help.tag-back", ["⌫"]],
				["help.tag-slash", ["/"]],
				["help.tag-esc", [esc]],
			],
			desc: [
				["help.desc-lines", ["↓", "↑"]],
				["help.desc-ends", ["End", "Home"]],
				["help.desc-mouse", [mouse]],
				["help.desc-enter", [enter]],
				["help.desc-back", [shift, tab]],
			],
		};
		const all: Array<[string, Key[]]> = [
			["help.all-place", [mod, enter]],
			["help.all-lines", [alt, "↓", "↑"]],
			["help.all-cancel", [esc]],
			["help.all-undo", [mod, "Z"]],
			["help.all-help", [mod, "/"]],
		];
		const pop = (this.helpEl = this.panel.createDiv({ cls: "sk-sessions-help", attr: { role: "dialog", "aria-label": this.t("settings.shortcuts") } }));
		const section = (title: string, rows: Array<[string, Key[]]>) => {
			pop.createEl("h4", { text: title });
			for (const [key, keys] of rows) {
				const row = pop.createDiv({ cls: "sk-sessions-help-row" });
				row.createSpan({ text: this.t(key) });
				const k = row.createSpan();
				for (const x of keys) {
					if (typeof x === "string") k.createEl("kbd", { text: x });
					else k.createSpan({ cls: "sk-sessions-hint-k", text: x.word });
				}
			}
		};
		const stepNo = { title: "1", tag: "2", desc: "3" }[this.step];
		section(`${stepNo} · ${this.t(`panel.step-${this.step}`)}`, steps[this.step]);
		section(this.t("help.everywhere"), all);
		pop.createDiv({ cls: "sk-sessions-help-foot", text: this.t("help.foot") });
		pop.addEventListener("mouseenter", () => window.clearTimeout(this.helpTimer));
		pop.addEventListener("mouseleave", () => this.closeHelpSoon());
		this.helpBtn.setAttr("aria-expanded", "true");
	}

	private closeHelpSoon(): void {
		window.clearTimeout(this.helpTimer);
		this.helpTimer = window.setTimeout(() => {
			if (this.helpEl && !this.helpEl.matches(":hover") && !this.helpBtn.matches(":hover")) this.closeHelp();
		}, 260);
	}

	private closeHelp(): void {
		window.clearTimeout(this.helpTimer);
		if (!this.helpEl) return;
		this.helpEl.remove();
		this.helpEl = null;
		this.helpBtn?.setAttr("aria-expanded", "false");
	}

	/** Page height before the keyboard showed, and the keyboard height the app reported (phone). */
	private baseHeight = 0;
	private keyboard = 0;

	/**
	 * On a phone: above the editing toolbar and the keyboard when they show, and never taller than
	 * the room left above them (the tag list shrinks first), so the field being typed in stays in
	 * sight.
	 */
	private placeSheet(): void {
		if (this.ended || !this.phone) return;
		const doc = this.panel.ownerDocument;
		const win = doc.defaultView ?? window;
		const vv = win.visualViewport;
		let bottom = vv ? Math.max(0, win.innerHeight - vv.height - vv.offsetTop) : 0;
		// The app's own keyboard height counts only when the page was not resized for it.
		if (this.keyboard > 0 && win.innerHeight > this.baseHeight - 40) bottom = Math.max(bottom, this.keyboard);
		const bar = doc.querySelector(".mobile-toolbar") as HTMLElement | null;
		if (bar) {
			const r = bar.getBoundingClientRect();
			if (r.height && r.top < win.innerHeight) bottom = Math.max(bottom, win.innerHeight - r.top);
		}
		this.panel.style.bottom = `${bottom}px`;
		const visibleTop = vv ? vv.offsetTop : 0;
		const room = Math.max(160, win.innerHeight - bottom - visibleTop - 56);
		const list = this.panel.querySelector<HTMLElement>(".sk-sessions-list");
		if (list) {
			list.style.maxHeight = "";
			const rest = this.panel.offsetHeight - list.offsetHeight;
			list.style.maxHeight = `${Math.max(80, Math.min(220, room - rest))}px`;
		}
		this.panel.style.maxHeight = `${room}px`;
		const active = doc.activeElement;
		if (active instanceof HTMLElement && this.panel.contains(active)) active.scrollIntoView({ block: "nearest" });
	}

	/** Places the window under the task line, as wide as the text allows. */
	layout(): void {
		if (this.ended || this.phone) return;
		this.view.requestMeasure({
			key: this.panel,
			read: (view) => {
				if (this.taskLine > view.state.doc.lines) return null;
				const block = view.lineBlockAt(view.state.doc.line(this.taskLine).from);
				const o = this.sv.origin();
				const left = this.sv.textLeft();
				const content = view.contentDOM.getBoundingClientRect();
				const scroller = view.scrollDOM.getBoundingClientRect();
				// The step numbers line up with the checkbox of the task (its "1") when the margin has room.
				const shift = left - 10 >= scroller.left + 8 ? 10 : 0;
				return { top: block.bottom - this.spacer + view.documentTop - o.y + 8, left: left - shift - o.x, width: Math.min(470, Math.max(300, content.right - left + shift - 8)) };
			},
			write: (r) => {
				if (!r) return;
				this.panel.style.top = `${r.top}px`;
				this.panel.style.left = `${r.left}px`;
				this.panel.style.width = `${r.width}px`;
			},
		});
	}

	/** The task line and the window in view, with the window fully visible. */
	private ensureVisible(): void {
		if (this.ended) return;
		const line = this.view.state.doc.line(this.taskLine);
		const c = this.view.coordsAtPos(line.from, 1);
		const sr = this.view.scrollDOM.getBoundingClientRect();
		if (!c) {
			this.view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
			return;
		}
		const need = this.phone ? sr.bottom - this.panel.offsetHeight - 120 : sr.bottom - this.panel.offsetHeight - 60;
		if (c.top < sr.top + 30 || c.bottom > need) {
			const delta = c.top - (sr.top + sr.height * (this.phone ? 0.12 : 0.2));
			this.view.scrollDOM.scrollBy({ top: delta, behavior: reduced() ? "auto" : "smooth" });
		}
	}

	// ----- the bracket -----

	private buildBracket(): void {
		const doc = this.view.dom.ownerDocument;
		this.svg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
		this.svg.setAttribute("class", "sk-sessions-bracket");
		this.svg.setAttribute("aria-hidden", "true");
		this.path = doc.createElementNS(SVG_NS, "path") as SVGPathElement;
		this.svg.appendChild(this.path);
		this.sv.layer.appendChild(this.svg);
		this.knob = this.sv.layer.createDiv({ cls: "sk-sessions-knob", attr: { role: "slider", tabindex: "0", "aria-label": this.t("panel.grip"), "aria-valuemin": "0" } });
		this.badge = this.sv.layer.createDiv({ cls: "sk-sessions-badge" });
		if (!this.candCount) {
			this.svg.addClass("is-hidden");
			this.knob.addClass("is-hidden");
			this.badge.addClass("is-hidden");
		}
		this.knob.addEventListener("keydown", (e) => this.onPanelKey(e));
		this.knob.addEventListener("focus", () => {
			if (this.step !== "desc") this.goStep("desc", false);
		});
		this.knob.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			this.knob.setPointerCapture(e.pointerId);
			this.dragY = e.clientY;
			this.knob.addClass("is-drag");
			if (this.step !== "desc") this.goStep("desc", !this.phone);
			this.renderHint();
		});
		this.knob.addEventListener("pointermove", (e) => {
			if (this.dragY === null) return;
			this.dragY = e.clientY;
			this.fromDrag();
		});
		const endDrag = () => {
			if (this.dragY === null) return;
			this.dragY = null;
			this.knob.removeClass("is-drag");
			this.renderHint();
		};
		this.knob.addEventListener("pointerup", endDrag);
		this.knob.addEventListener("pointercancel", endDrag);

		// The mouse wheel takes one line more or less: over the bracket, the lines it can take (and
		// their margin) or the description row of the window. Anywhere else it scrolls the note.
		const onWheel = (e: WheelEvent) => this.onWheel(e);
		const scroller = this.view.scrollDOM;
		scroller.addEventListener("wheel", onWheel, { passive: false, capture: true });
		this.cleanups.push(() => scroller.removeEventListener("wheel", onWheel, { capture: true }));
		if (this.panel && !scroller.contains(this.panel)) {
			const panel = this.panel;
			panel.addEventListener("wheel", onWheel, { passive: false });
			this.cleanups.push(() => panel.removeEventListener("wheel", onWheel));
		}
	}

	/** Trackpads send many small deltas: they add up to one line per WHEEL_STEP pixels. */
	private wheelSum = 0;

	private onWheel(e: WheelEvent): void {
		if (this.ended || e.ctrlKey || e.metaKey || this.candCount === 0 || !this.wheelTargets(e)) return;
		e.preventDefault();
		e.stopPropagation();
		const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
		let steps = 0;
		if (Math.abs(delta) >= WHEEL_NOTCH) {
			// A mouse notch: exactly one line, whatever the system's scroll speed.
			steps = Math.sign(delta);
			this.wheelSum = 0;
		} else {
			this.wheelSum += delta;
			while (Math.abs(this.wheelSum) >= WHEEL_STEP) {
				const dir = Math.sign(this.wheelSum);
				steps += dir;
				this.wheelSum -= dir * WHEEL_STEP;
			}
		}
		if (!steps) return;
		if (this.step !== "desc") this.goStep("desc", false);
		this.setCount(this.count + steps);
	}

	/** The wheel acts on the description only above its own places (see onWheel). */
	private wheelTargets(e: WheelEvent): boolean {
		const target = e.target as Node | null;
		const row = this.rowDesc;
		if (target && (this.knob.contains(target) || this.badge.contains(target) || (row && row.contains(target)))) return true;
		if (this.panel && target && this.panel.contains(target)) return false;
		const doc = this.view.state.doc;
		const firstLine = this.taskLine + 1;
		const lastLine = Math.min(doc.lines, this.taskLine + this.candCount);
		if (firstLine > lastLine) return false;
		const top = this.view.lineBlockAt(doc.line(firstLine).from).top + this.view.documentTop;
		const bottom = this.view.lineBlockAt(doc.line(lastLine).from).bottom + this.view.documentTop;
		return e.clientY >= top - 4 && e.clientY <= bottom + 4;
	}

	private fromDrag(): void {
		if (this.dragY === null) return;
		const doc = this.view.state.doc;
		let n = 0;
		for (let i = 1; i <= this.candCount; i++) {
			const block = this.view.lineBlockAt(doc.line(this.taskLine + i).from);
			const top = block.top + this.view.documentTop;
			if (top + block.height * 0.45 < this.dragY) n = i;
		}
		if (n !== this.count) this.setCount(n);
	}

	/** Spring toward the lines taken; follows the finger while dragging (with a little elastic past the end). */
	private loop(): void {
		const step = () => {
			if (this.ended) return;
			this.frame = window.requestAnimationFrame(step);
			if (!this.candCount) return;
			const view = this.view;
			const doc = view.state.doc;
			if (this.taskLine + this.candCount > doc.lines) return;
			const o = this.sv.origin();
			const top = (n: number) => view.lineBlockAt(doc.line(n).from).top + view.documentTop - o.y;
			const bottom = (n: number) => view.lineBlockAt(doc.line(n).from).bottom + view.documentTop - o.y;
			const base = top(this.taskLine + 1);
			let t0: number;
			let t1: number;
			if (this.count) {
				t0 = top(this.taskLine + 1) + 4;
				t1 = bottom(this.taskLine + this.count) - 4;
			} else {
				t0 = base + 2;
				t1 = base + 8;
			}
			if (this.dragY !== null) {
				const y = this.dragY - o.y;
				const last = bottom(this.taskLine + this.candCount);
				let target = Math.max(base + 8, y);
				if (target > last) target = last + Math.sqrt(target - last) * 3;
				t1 = target;
				if (!this.count) t0 = base + 2;
				this.autoScroll();
			}
			const s = this.spring;
			if (!s.started || reduced()) {
				s.y0 = t0;
				s.y1 = t1;
				s.started = true;
			} else {
				s.v0 = (s.v0 + (t0 - s.y0) * 0.22) * 0.66;
				s.y0 += s.v0;
				s.v1 = (s.v1 + (t1 - s.y1) * 0.2) * 0.68;
				s.y1 += s.v1;
			}
			const x = this.sv.textLeft() - o.x - 10;
			this.draw(x, s.y0, s.y1);
		};
		this.frame = window.requestAnimationFrame(step);
	}

	private draw(x: number, y0: number, y1: number): void {
		const w = 6;
		const h = y1 - y0;
		let d: string;
		if (h < 2 * w + 4) d = `M${x + 4} ${y0} Q${x} ${y0} ${x} ${y0 + Math.max(0, h / 2)} L${x} ${y1}`;
		else {
			const mid = (y0 + y1) / 2;
			d = `M${x + w} ${y0} Q${x} ${y0} ${x} ${y0 + w} L${x} ${mid - w} Q${x} ${mid} ${x - w} ${mid} Q${x} ${mid} ${x} ${mid + w} L${x} ${y1 - w} Q${x} ${y1} ${x + w} ${y1}`;
		}
		this.path.setAttribute("d", d);
		this.path.style.opacity = this.count ? "1" : "0.35";
		const ks = this.phone ? 22 : 16;
		this.knob.style.transform = `translate(${x - ks / 2}px, ${y1 - ks / 2}px)`;
		this.badge.style.transform = `translate(calc(-100% + ${x - ks / 2 - 6}px), ${y1 - 10}px)`;
		this.knob.addClass("is-shown");
		this.badge.addClass("is-shown");
	}

	private autoScroll(): void {
		if (this.dragY === null) return;
		const sr = this.view.scrollDOM.getBoundingClientRect();
		const bottomEdge = (this.phone ? Math.min(sr.bottom, this.panel.getBoundingClientRect().top) : sr.bottom) - 30;
		let d = 0;
		if (this.dragY > bottomEdge) d = Math.min(14, (this.dragY - bottomEdge) / 4);
		else if (this.dragY < sr.top + 40) d = -Math.min(14, (sr.top + 40 - this.dragY) / 4);
		if (d) {
			this.view.scrollDOM.scrollTop += d;
			this.fromDrag();
		}
	}

	// ----- place, cancel -----

	/** Writes the task: "- [ ] Title #tag" and its description indented under it. */
	pose(takePreview: boolean): void {
		if (this.ended) return;
		let tag = this.tag;
		// Place at once: what the line previews. At the tag step that is the row under the cursor, even
		// when a tag was chosen before; elsewhere the proposal, when nothing was chosen.
		if (takePreview) {
			if (this.step === "tag") tag = this.chips[this.hi]?.tag ?? tag;
			else if (!tag) tag = this.suggested;
		}
		const state = this.view.state;
		const doc = state.doc;
		const task = doc.line(this.taskLine);
		const cands: string[] = [];
		for (let i = 1; i <= this.candCount; i++) cands.push(doc.line(this.taskLine + i).text);
		const unit = state.facet(indentUnit) || "\t";
		const posed = poseLines({ taskLine: task.text, tag, candidates: cands, count: this.count, wasDescription: this.wasDescription, unit });
		const last = doc.line(this.taskLine + posed.length - 1);
		const regionEnd = Math.max(this.fishTo, last.to);
		const original = this.original + doc.sliceString(this.fishTo, regionEnd);
		const insert = posed.join("\n");
		const newRegion = doc.sliceString(this.fishFrom, task.from) + insert + doc.sliceString(last.to, regionEnd);
		let descCount = Math.min(this.count, this.candCount);
		while (descCount > 0 && !cands[descCount - 1].trim()) descCount--;
		// Cursor: at the start of the line after the task and its description, ready to write on.
		const after = task.from + insert.length;
		const nextLine = this.taskLine + posed.length <= doc.lines ? doc.line(this.taskLine + posed.length) : null;
		const caret = (nextLine && !this.sv.rt.isClosing(nextLine.text) ? after + 1 : after) - this.fishFrom;
		const taskOffset = task.from - this.fishFrom;
		const composedLength = regionEnd - this.fishFrom;
		const titleText = withoutTag(lineInfo(posed[0]).body, tag ?? undefined).trim();
		const fishFrom = this.fishFrom;
		this.end(false);
		// One step in the history: from the text before the catch to the placed task. Ctrl+Z gives
		// the sentence back as it was, Ctrl+Y places the task again.
		const rewound = this.rewind();
		const from = rewound ? this.origFrom : fishFrom;
		const to = from + (rewound ? original.length : composedLength);
		this.view.dispatch({
			changes: { from, to, insert: newRegion },
			selection: { anchor: from + caret },
			effects: [setGuard.of(null), setSpacer.of(null)],
			annotations: [ours.of(true), isolateHistory.of("full")],
			userEvent: "input.sessions",
		});
		this.sv.rememberPose(undoDepth(this.view.state));
		if (tag) this.sv.rt.learnTag(titleText, tag);

		// The landing: the task springs into place, the description settles line by line.
		const taskPos = from + taskOffset;
		const classes = tag ? this.sv.rt.tagClasses(tag) : "";
		const lines: Array<{ pos: number; cls: string; style?: string }> = [{ pos: taskPos, cls: `sk-sessions-land ${classes}`.trim() }];
		const newDoc = this.view.state.doc;
		const taskNo = newDoc.lineAt(taskPos).number;
		for (let i = 1; i <= descCount && taskNo + i <= newDoc.lines; i++) {
			const l = newDoc.line(taskNo + i);
			lines.push({ pos: l.from, cls: "sk-sessions-settle", style: `--sk-sessions-delay: ${90 + i * 55}ms` });
		}
		this.sv.flashLines(lines, 1100 + descCount * 60);
		this.flyToRail(taskPos, classes);
		const ctx = this.sv.rt.ctx;
		const message = [this.t(this.edit ? "toast.updated" : "toast.placed") + (tag ? ` #${tag}` : ""), descCount ? ctx.tn("toast.lines", descCount) : ""].filter(Boolean).join(" · ");
		ctx.toast(message, { action: { label: this.t("common.undo"), run: () => this.sv.undoPose() }, duration: 6000 });
		if (!this.phone) this.view.focus();
		else this.view.contentDOM.blur();
	}

	/**
	 * Takes the history back to just before the catch (the catch and the title edits undone), so
	 * that what follows is a single step. Only when nothing else changed the note meanwhile;
	 * otherwise false, and the text stays as composed.
	 */
	private rewind(): boolean {
		const view = this.view;
		// The guard would filter the undo steps.
		view.dispatch({ effects: [setGuard.of(null), setSpacer.of(null)], annotations: ours.of(true) });
		if (this.foreign || undoDepth(view.state) <= this.startDepth) return false;
		const before = view.state.doc.toString();
		while (undoDepth(view.state) > this.startDepth) if (!undo(view)) break;
		const doc = view.state.doc;
		const end = this.origFrom + this.original.length;
		const intact = undoDepth(view.state) === this.startDepth && end <= doc.length && doc.sliceString(this.origFrom, end) === this.original
			&& (end === doc.length || doc.sliceString(end, end + 1) === "\n");
		if (intact) return true;
		// Not what was expected: put the composed text back and work on it.
		view.dispatch({ changes: { from: 0, to: doc.length, insert: before }, annotations: ours.of(true) });
		this.foreign = true;
		return false;
	}

	/** Escape: the text as it was before the catch, character for character. `focus` false leaves the focus where it is (another note took it). */
	cancel(focus = true): void {
		if (this.ended) return;
		const from = this.fishFrom;
		const to = this.fishTo;
		this.end(false);
		if (this.rewind()) {
			this.view.dispatch({ selection: { anchor: this.origFrom + this.caret }, annotations: ours.of(true) });
		} else {
			this.view.dispatch({
				changes: { from, to, insert: this.original },
				selection: { anchor: from + this.caret },
				effects: [setGuard.of(null), setSpacer.of(null)],
				annotations: ours.of(true),
				userEvent: "input.sessions",
			});
		}
		if (focus && !this.phone) this.view.focus();
	}

	/**
	 * The editor is being destroyed (the note closes, or another note takes its place) in the middle
	 * of the composition: no transaction is possible any more. Returns the caught region as it is in
	 * the text and what it was, so that the note on disk can get its sentence back.
	 */
	abandon(): { composed: string; original: string } | null {
		if (this.ended) return null;
		const doc = this.view.state.doc;
		const composed = doc.sliceString(this.fishFrom, Math.min(this.fishTo, doc.length));
		this.end(false);
		return composed === this.original ? null : { composed, original: this.original };
	}

	/** Removes the window and the bracket. `release` also lets go of the title guard (when the text was changed from outside). */
	end(release = true): void {
		if (this.ended) return;
		this.ended = true;
		window.cancelAnimationFrame(this.frame);
		window.clearTimeout(this.helpTimer);
		this.resize?.disconnect();
		for (const c of this.cleanups.splice(0)) c();
		this.panel?.remove();
		this.svg?.remove();
		this.knob?.remove();
		this.badge?.remove();
		this.view.scrollDOM.classList.remove("sk-sessions-composing");
		if (this.sv.composer === this) this.sv.composer = null;
		this.sv.composing(false);
		if (release) {
			window.setTimeout(() => {
				try {
					if (this.view.state.field(guardField, false)) this.view.dispatch({ effects: [setGuard.of(null), setSpacer.of(null)], annotations: ours.of(true) });
				} catch {
					/* the editor is gone */
				}
			}, 0);
		}
		this.sv.redraw();
	}

	// ----- the dot that flies to the rail -----

	private flyToRail(lineFrom: number, classes: string): void {
		const leaf = this.view.dom.closest(".workspace-leaf-content");
		const target = leaf?.querySelector('.sk-note-rail-btn[data-btn="tasks"]') as HTMLElement | null;
		if (!target || reduced()) return;
		const b = target.getBoundingClientRect();
		if (!b.width || !b.height) return;
		const info = lineInfo(this.view.state.doc.lineAt(lineFrom).text);
		const a = this.view.coordsAtPos(lineFrom + info.indent.length, 1);
		if (!a) return;
		const doc = this.view.dom.ownerDocument;
		const dot = doc.body.createDiv({ cls: `sk-sessions-fly ${classes}`.trim() });
		const x0 = a.left + 8;
		const y0 = (a.top + a.bottom) / 2;
		const x1 = b.left + b.width / 2;
		const y1 = b.top + b.height / 2;
		const cx = (x0 + x1) / 2;
		const cy = Math.min(y0, y1) - 90;
		const frames: Keyframe[] = [];
		for (let i = 0; i <= 24; i++) {
			const t = i / 24;
			const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
			const x = (1 - e) * (1 - e) * x0 + 2 * (1 - e) * e * cx + e * e * x1;
			const y = (1 - e) * (1 - e) * y0 + 2 * (1 - e) * e * cy + e * e * y1;
			const s = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) * 0.55;
			frames.push({ transform: `translate(${x - 6}px, ${y - 6}px) scale(${s})`, offset: t });
		}
		const anim = dot.animate(frames, { duration: 780, delay: 220, easing: "linear", fill: "both" });
		anim.onfinish = () => {
			dot.remove();
			target.animate([{ transform: "scale(1)" }, { transform: "scale(1.22)", offset: 0.3 }, { transform: "scale(1)" }], { duration: 560, easing: "cubic-bezier(0.2, 1.3, 0.35, 1)" });
		};
		anim.oncancel = () => dot.remove();
	}
}
