// The tag picker: a field and a calm column of tags. One tag in color at a time (the one under
// the cursor, tinted by Tag colors when it runs), the reason of its rank next to it, sub-tags with
// Tab, a filter that ignores case and accents, a new tag created by typing its name.
//
// Two ways to use it:
//  - `new TagPicker(el, options)` builds it inside `el` (the host places it and decides when it
//    shows: Brainstorm puts it in its composing window);
//  - `openTagPicker(anchor, options)` opens it on its own: a popover under `anchor` on a computer,
//    a sheet at the bottom of the screen on a phone. It closes itself once a tag is chosen or on
//    Escape, a click outside, or `close()`.
//
// The tags come from `sources`, read again at each render; nothing here depends on a module.
import { Platform, setIcon } from "obsidian";
import { tagCapsule } from "./capsule";
import { chipList, highlight, shownName, type Chip, type ChipWhy } from "./logic";

export { tagCapsule } from "./capsule";
export { chipList, highlight, isTagName, shownName, type Chip, type ChipGroup, type ChipQuery, type ChipWhy } from "./logic";

/** Where the tags come from. Every function is called again at each render of the column. */
export interface TagPickerSources {
	/** Every tag of the vault, most used first, without "#". */
	all(): readonly string[];
	/** Tags of the place being edited (the note, its area): offered before the others. */
	near?(): readonly string[];
	/** Tags chosen recently, most recent first: after the near ones. */
	recent?(): readonly string[];
	/** The tag already chosen, offered first (its reason: "chosen"). */
	chosen?(): string | null;
	/** A suggestion, offered right after the chosen tag, with the reason shown next to it (already translated). */
	suggestion?(): { tag: string; reason?: string } | null;
}

/** Translates a key: a module's `ctx.t` works (it falls back to the core strings `tag-picker.*`). */
export type TagPickerTranslate = (key: string, vars?: Record<string, string | number>) => string;

export interface TagPickerOptions {
	t: TagPickerTranslate;
	sources: TagPickerSources;
	/** Classes that color a tag (`--sk-tag-*`), see `tagColorsFrom`. Neutral without. */
	colors?: (tag: string) => string;
	/** Name of the column for screen readers (default "Tag"). */
	label?: string;
	/** Large rows and buttons, no key hints, no hover highlight (default: on phones). */
	touch?: boolean;
	/** Rows offered before the column scrolls (default 60). */
	limit?: number;
	/**
	 * A key pressed in the field, before the picker handles it. Return true when the host handled it
	 * (it then prevents the default itself).
	 */
	onKey?(e: KeyboardEvent): boolean;
	/** A tag is chosen (Enter, Tab on a tag without sub-tags, click). `from` is where its row was on screen. */
	onChoose(tag: string, info: { create: boolean; from: DOMRect | null }): void;
	/** Escape with nothing typed (default: nothing). */
	onCancel?(): void;
	/** Shift+Tab at the top level (default: nothing). */
	onBack?(): void;
	/** Enter or Tab while no row is offered (default: nothing). */
	onEmpty?(): void;
	/** The column changed: `"list"` it was rebuilt (filter, level, open), `"move"` the highlight moved. */
	onChange?(kind: "list" | "move"): void;
}

/** The classes of Tag colors for a tag, when that module runs. `ctx` is a module context (or anything with `service`). */
export function tagColorsFrom(ctx: { service<T>(name: string): T | undefined }): (tag: string) => string {
	return (tag) => {
		const colors = ctx.service<{ version: number; classes(tag: string): string }>("tag-colors");
		if (!colors || colors.version !== 1) return "";
		try {
			return colors.classes(tag);
		} catch {
			return "";
		}
	};
}

export class TagPicker {
	/** The element the picker was built in (it gets the class `sk-tag-picker`). */
	readonly el: HTMLElement;
	readonly input: HTMLInputElement;
	readonly listEl: HTMLElement;
	private fieldEl: HTMLElement;
	private crumb: HTMLElement;
	private cursorEl: HTMLElement;
	private chips: Chip[] = [];
	private hi = 0;
	private levelTag: string | null = null;
	private filterText = "";
	private destroyed = false;
	private readonly touch: boolean;
	/** Where the pointer last was over the column (see the mouse move of the rows). */
	private mouse = { x: -1, y: -1 };

	constructor(el: HTMLElement, private readonly options: TagPickerOptions) {
		this.el = el;
		this.touch = options.touch ?? Platform.isMobile;
		el.addClass("sk-tag-picker");
		el.toggleClass("is-touch", this.touch);
		const t = options.t;
		this.fieldEl = el.createDiv({ cls: "sk-tag-picker-field" });
		setIcon(this.fieldEl.createSpan({ cls: "sk-tag-picker-field-icon" }), "tag");
		this.crumb = this.fieldEl.createSpan({ cls: "sk-tag-picker-crumb" });
		this.input = this.fieldEl.createEl("input", { cls: "sk-tag-picker-input", attr: { type: "text", autocomplete: "off", spellcheck: "false", "aria-label": t("tag-picker.search") } });
		this.listEl = el.createDiv({ cls: "sk-tag-picker-list", attr: { role: "listbox", "aria-label": options.label ?? t("tag-picker.label") } });
		this.cursorEl = this.listEl.createDiv({ cls: "sk-tag-picker-cursor" });
		this.input.addEventListener("input", () => this.onInput());
		this.input.addEventListener("keydown", (e) => {
			if (this.options.onKey?.(e)) return;
			if (this.handleKey(e)) {
				e.preventDefault();
				e.stopPropagation();
			}
		});
	}

	/** The row under the cursor (the tag the host may preview), or null. */
	current(): Chip | null {
		return this.chips[this.hi] ?? null;
	}

	/** The parent whose sub-tags are shown (after Tab), or null. */
	get level(): string | null {
		return this.levelTag;
	}

	/** What is typed in the field (without "#"). */
	get filter(): string {
		return this.filterText;
	}

	/** Something is typed, or the column is inside a parent: Escape clears that first. */
	get busy(): boolean {
		return !!this.filterText || !!this.levelTag;
	}

	/** Rebuilds the column from the top, the cursor on `want` (or the first row). */
	open(want?: string | null): void {
		if (this.destroyed) return;
		this.chips = this.list();
		const i = want ? this.chips.findIndex((c) => c.tag.toLowerCase() === want.toLowerCase()) : -1;
		this.hi = i >= 0 ? i : 0;
		this.render(true);
	}

	/** Forgets the filter and the parent. `render` false leaves the column as it is (it is about to hide). */
	reset(render = true): void {
		this.filterText = "";
		this.levelTag = null;
		this.input.value = "";
		if (render) {
			this.hi = 0;
			this.render(true);
		}
	}

	focus(): void {
		this.input.focus({ preventScroll: true });
	}

	/** The reason of a tag's rank as the column shows it ("" when it has none). */
	reasonOf(tag: string): { kind: ChipWhy["kind"]; text: string } | null {
		const why = this.list().find((c) => c.tag.toLowerCase() === tag.toLowerCase())?.why;
		return why ? { kind: why.kind, text: this.whyText(why) } : null;
	}

	/**
	 * The keys of the column: ↑ ↓ (and ← → at the ends of the field), Home, End, Enter, Tab into the
	 * sub-tags, Shift+Tab or Backspace back up, Escape. Returns true when the key was used; the
	 * picker calls it on its own field, a host calls it for keys pressed elsewhere.
	 */
	handleKey(e: KeyboardEvent): boolean {
		if (this.destroyed) return false;
		const k = e.key;
		const input = this.input;
		const caretEnd = input.selectionStart === input.value.length;
		const caretStart = input.selectionStart === 0;
		if (k === "Escape") {
			if (this.busy) this.reset();
			else this.options.onCancel?.();
		} else if (k === "Enter") {
			const it = this.chips[this.hi];
			if (it) this.choose(it);
			else this.options.onEmpty?.();
		} else if (k === "Tab") {
			if (e.shiftKey) {
				if (!this.ascend()) this.options.onBack?.();
			} else if (!this.descend()) {
				const it = this.chips[this.hi];
				if (it) this.choose(it);
				else this.options.onEmpty?.();
			}
		} else if (k === "ArrowDown") this.setHi(this.hi + 1);
		else if (k === "ArrowUp") this.setHi(this.hi - 1);
		else if (k === "ArrowRight" && !input.value) this.descend();
		else if (k === "ArrowLeft" && !input.value) this.ascend();
		else if (k === "ArrowRight" && caretEnd) this.setHi(this.hi + 1);
		else if (k === "ArrowLeft" && caretStart) this.setHi(this.hi - 1);
		else if (k === "Backspace" && !input.value && this.levelTag) this.ascend();
		else if (k === "Home" && !input.value) this.setHi(0);
		else if (k === "End" && !input.value) this.setHi(this.chips.length - 1);
		else return false;
		return true;
	}

	destroy(): void {
		this.destroyed = true;
	}

	// ----- the column -----

	private list(): Chip[] {
		const s = this.options.sources;
		const sug = s.suggestion?.() ?? null;
		return chipList({
			filter: this.filterText,
			level: this.levelTag,
			tag: s.chosen?.() ?? null,
			suggested: sug?.tag ?? null,
			near: s.near?.() ?? [],
			recent: s.recent?.() ?? [],
			all: s.all(),
			limit: this.options.limit ?? 60,
		});
	}

	private classes(tag: string): string {
		return this.options.colors?.(tag) ?? "";
	}

	/** "learned · word", "recent", "subject of the note"... as shown next to a tag. */
	private whyText(why: ChipWhy | undefined): string {
		if (!why) return "";
		const t = this.options.t;
		if (why.kind === "learned") return this.options.sources.suggestion?.()?.reason || t("tag-picker.why.suggested");
		return t(`tag-picker.why.${why.kind}`);
	}

	private render(snap = false): void {
		if (this.destroyed) return;
		const t = this.options.t;
		const list = this.list();
		this.chips = list;
		if (this.hi >= list.length) this.hi = Math.max(0, list.length - 1);
		const level = this.levelTag;
		this.fieldEl.toggleClass("is-deep", !!level);
		this.crumb.empty();
		if (level) this.crumb.append(tagCapsule(this.el.ownerDocument, level, this.classes(level)));
		this.input.placeholder = level ? t("tag-picker.sub-placeholder", { tag: level }) : t("tag-picker.placeholder");
		for (const el of Array.from(this.listEl.children)) if (el !== this.cursorEl) el.remove();
		if (!list.length) this.listEl.createDiv({ cls: "sk-tag-picker-empty", text: t("tag-picker.no-match") });
		const showKids = !level && !this.filterText;
		let lastGroup: string | null = null;
		list.forEach((item, i) => {
			const gap = lastGroup !== null && item.group !== lastGroup;
			lastGroup = item.group;
			const classes = item.create ? "" : this.classes(item.tag);
			const row = this.listEl.createDiv({ cls: `sk-tag-picker-it ${classes}`.trim(), attr: { role: "option", "data-i": String(i), "aria-selected": String(i === this.hi) } });
			row.toggleClass("is-hi", i === this.hi);
			row.toggleClass("is-gap", gap);
			row.toggleClass("is-new", !!item.create);
			row.toggleClass("is-gray", !classes);
			row.createEl("i", { cls: "sk-tag-picker-it-dot" });
			const name = row.createSpan({ cls: "sk-tag-picker-it-name" });
			if (item.create) {
				name.appendText(t("tag-picker.create-row") + " ");
				name.createEl("b", { text: item.tag });
				row.setAttr("aria-label", t("tag-picker.create", { tag: item.tag }));
			} else this.renderName(name, item.tag);
			if (showKids && item.kids.length) {
				const shown = item.kids.slice(0, 4);
				row.createSpan({ cls: "sk-tag-picker-it-kids", text: shown.join(" · ") + (item.kids.length > shown.length ? ` · +${item.kids.length - shown.length}` : "") });
			}
			const why = this.whyText(item.why);
			if (why) row.createSpan({ cls: "sk-tag-picker-it-why", text: why });
			if (showKids && item.parent) {
				const more = row.createEl("button", { cls: "sk-tag-picker-it-more", attr: { type: "button", tabindex: "-1", "aria-label": t("tag-picker.subtags", { key: t("tag-picker.key.tab") }), "data-more": String(i) } });
				setIcon(more, "chevron-right");
				more.addEventListener("mousedown", (e) => e.preventDefault());
				more.addEventListener("click", (e) => {
					e.stopPropagation();
					if (this.destroyed) return;
					this.hi = i;
					this.descend();
				});
			}
			row.createEl("kbd", { cls: "sk-tag-picker-it-enter", text: "↵" });
			row.addEventListener("mousedown", (e) => e.preventDefault());
			row.addEventListener("click", () => {
				if (this.destroyed) return;
				this.hi = i;
				this.choose(item);
			});
			if (!this.touch) {
				// Only a pointer that really moves takes the highlight: the browser also sends a mouse
				// move when the rows change under a still pointer.
				row.addEventListener("mousemove", (e) => {
					if (this.destroyed) return;
					if (e.clientX === this.mouse.x && e.clientY === this.mouse.y) return;
					this.mouse = { x: e.clientX, y: e.clientY };
					if (this.hi !== i) this.setHi(i);
				});
			}
		});
		this.placeCursor(snap);
		this.options.onChange?.("list");
	}

	/** "parent / leaf", the parent dimmed; inside a parent, its own sub-tags without the prefix; what matches the filter marked. */
	private renderName(el: HTMLElement, tag: string): void {
		const parts = shownName(tag, this.levelTag).split("/");
		parts.forEach((part, k) => {
			const span = el.createSpan({ cls: k < parts.length - 1 ? "sk-tag-picker-it-root" : "sk-tag-picker-it-leaf" });
			for (const piece of highlight(part, this.filterText)) {
				if (piece.hit) span.createEl("mark", { text: piece.text });
				else span.appendText(piece.text);
			}
			if (k < parts.length - 1) el.createSpan({ cls: "sk-tag-picker-it-sep", text: "/" });
		});
	}

	/** The tinted bar slides under the row at `hi`; `snap` moves it at once (the column was rebuilt). */
	private placeCursor(snap: boolean): void {
		const row = this.listEl.querySelector<HTMLElement>(".sk-tag-picker-it.is-hi");
		if (!row) {
			this.cursorEl.removeClass("is-shown");
			return;
		}
		const item = this.chips[this.hi];
		this.cursorEl.className = `sk-tag-picker-cursor ${item && !item.create ? this.classes(item.tag) : ""}`.trim();
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
	private setHi(i: number): void {
		if (!this.chips.length) return;
		this.hi = Math.max(0, Math.min(this.chips.length - 1, i));
		for (const el of Array.from(this.listEl.querySelectorAll<HTMLElement>(".sk-tag-picker-it"))) {
			const on = Number(el.dataset.i) === this.hi;
			el.toggleClass("is-hi", on);
			el.setAttr("aria-selected", String(on));
		}
		this.placeCursor(false);
		this.options.onChange?.("move");
	}

	private choose(item: Chip): void {
		const from = this.listEl.querySelector<HTMLElement>(".sk-tag-picker-it.is-hi .sk-tag-picker-it-name");
		const start = from?.getBoundingClientRect() ?? null;
		this.levelTag = null;
		this.filterText = "";
		this.input.value = "";
		this.options.onChoose(item.tag, { create: !!item.create, from: start });
	}

	private descend(): boolean {
		const item = this.chips[this.hi];
		if (!item || item.create || this.levelTag || this.filterText || !item.parent) return false;
		this.levelTag = item.tag;
		this.filterText = "";
		this.input.value = "";
		this.hi = 1;
		this.render(true);
		return true;
	}

	private ascend(): boolean {
		if (!this.levelTag) return false;
		const was = this.levelTag;
		this.levelTag = null;
		this.filterText = "";
		this.input.value = "";
		this.chips = this.list();
		const i = this.chips.findIndex((c) => c.tag.toLowerCase() === was.toLowerCase());
		this.hi = i >= 0 ? i : 0;
		this.render(true);
		return true;
	}

	private onInput(): void {
		const v = this.input.value.replace(/^#/, "").replace(/\s+/g, "-");
		if (v !== this.input.value) this.input.value = v;
		const parent = /^(.+)\/$/.exec(v);
		if (parent && !this.levelTag && this.options.sources.all().some((t) => t.toLowerCase().startsWith(parent[1].toLowerCase() + "/"))) {
			this.levelTag = parent[1];
			this.filterText = "";
			this.input.value = "";
			this.hi = 1;
			this.render(true);
			return;
		}
		this.filterText = v;
		this.hi = 0;
		this.render(true);
	}
}

// ----- on its own: a popover (computer) or a sheet (phone) -----

export interface OpenTagPickerOptions extends Omit<TagPickerOptions, "onChoose" | "onCancel" | "touch"> {
	onChoose(tag: string, info: { create: boolean; from: DOMRect | null }): void;
	/** The picker closed without a tag (Escape, a click outside, `close()`). */
	onCancel?(): void;
	/** The tag the cursor starts on (default: the chosen tag, then the suggestion). */
	want?: string | null;
	/** Popover or sheet (default: sheet on phones). */
	sheet?: boolean;
}

export interface TagPickerHandle {
	readonly picker: TagPicker;
	/** Closes without a tag (calls `onCancel`). */
	close(): void;
}

/**
 * Opens the picker on its own, anchored under `anchor` (above it when there is no room below), or
 * as a sheet at the bottom of the screen on a phone. The field takes the focus.
 */
export function openTagPicker(anchor: HTMLElement, options: OpenTagPickerOptions): TagPickerHandle {
	const doc = anchor.ownerDocument;
	const win = doc.defaultView ?? window;
	const sheet = options.sheet ?? Platform.isMobile;
	const back = sheet ? doc.body.createDiv({ cls: "sk-tag-picker-backdrop" }) : null;
	const pop = doc.body.createDiv({ cls: "sk-tag-picker-pop" + (sheet ? " is-sheet" : ""), attr: { role: "dialog" } });
	if (sheet) pop.createDiv({ cls: "sk-tag-picker-grabber" });
	const body = pop.createDiv();
	let done = false;
	const cleanups: Array<() => void> = [];
	const finish = (chosen: boolean) => {
		if (done) return false;
		done = true;
		picker.destroy();
		for (const c of cleanups.splice(0)) c();
		pop.remove();
		back?.remove();
		if (!chosen) options.onCancel?.();
		return true;
	};
	const picker = new TagPicker(body, {
		...options,
		touch: sheet,
		onChoose: (tag, info) => {
			if (finish(true)) options.onChoose(tag, info);
		},
		onCancel: () => finish(false),
	});
	// Named by hidden texts: an aria-label would show as Obsidian's tooltip over the whole popover.
	const uid = `sk-tag-picker-${Math.random().toString(36).slice(2, 8)}`;
	const nameIt = (el: HTMLElement, key: string) => {
		const label = el.getAttribute("aria-label");
		if (!label) return;
		pop.createSpan({ cls: "sk-tag-picker-sr", text: label, attr: { id: `${uid}-${key}` } });
		el.removeAttribute("aria-label");
		el.setAttribute("aria-labelledby", `${uid}-${key}`);
	};
	nameIt(picker.listEl, "list");
	nameIt(picker.input, "input");
	// On a phone: the sheet sits above the keyboard and the editing toolbar, the column shrinks first.
	let keyboard = 0;
	const baseHeight = win.innerHeight;
	const placeSheet = () => {
		if (done || !sheet) return;
		const vv = win.visualViewport;
		let bottom = vv ? Math.max(0, win.innerHeight - vv.height - vv.offsetTop) : 0;
		if (keyboard > 0 && win.innerHeight > baseHeight - 40) bottom = Math.max(bottom, keyboard);
		const bar = doc.querySelector<HTMLElement>(".mobile-toolbar");
		if (bar) {
			const r = bar.getBoundingClientRect();
			if (r.height && r.top < win.innerHeight) bottom = Math.max(bottom, win.innerHeight - r.top);
		}
		pop.style.bottom = `${bottom}px`;
		const room = Math.max(160, win.innerHeight - bottom - (vv ? vv.offsetTop : 0) - 56);
		const list = picker.listEl;
		list.style.removeProperty("max-height");
		const rest = pop.offsetHeight - list.offsetHeight;
		list.style.maxHeight = `${Math.max(80, Math.min(260, room - rest))}px`;
		pop.style.maxHeight = `${room}px`;
	};
	if (sheet) {
		const later = () => {
			placeSheet();
			win.setTimeout(placeSheet, 120);
			win.setTimeout(placeSheet, 400);
		};
		const kbShow = (e: Event) => {
			const h = (e as Event & { keyboardHeight?: number }).keyboardHeight;
			if (typeof h === "number") keyboard = h;
			later();
		};
		const kbHide = () => {
			keyboard = 0;
			later();
		};
		const vv = win.visualViewport;
		vv?.addEventListener("resize", placeSheet);
		vv?.addEventListener("scroll", placeSheet);
		win.addEventListener("keyboardWillShow", kbShow);
		win.addEventListener("keyboardDidShow", kbShow);
		win.addEventListener("keyboardWillHide", kbHide);
		win.addEventListener("keyboardDidHide", kbHide);
		pop.addEventListener("focusin", later);
		cleanups.push(() => {
			vv?.removeEventListener("resize", placeSheet);
			vv?.removeEventListener("scroll", placeSheet);
			win.removeEventListener("keyboardWillShow", kbShow);
			win.removeEventListener("keyboardDidShow", kbShow);
			win.removeEventListener("keyboardWillHide", kbHide);
			win.removeEventListener("keyboardDidHide", kbHide);
		});
	}
	const place = () => {
		if (done) return;
		if (sheet) {
			placeSheet();
			return;
		}
		const r = anchor.getBoundingClientRect();
		const width = Math.min(360, win.innerWidth - 16);
		const left = Math.max(8, Math.min(r.left, win.innerWidth - width - 8));
		const h = pop.offsetHeight;
		const below = win.innerHeight - r.bottom - 8;
		const top = below >= h || below >= r.top ? r.bottom + 6 : Math.max(8, r.top - h - 6);
		pop.style.left = `${left}px`;
		pop.style.top = `${top}px`;
		pop.style.width = `${width}px`;
	};
	const outside = (e: PointerEvent) => {
		if (!pop.contains(e.target as Node)) finish(false);
	};
	doc.addEventListener("pointerdown", outside, true);
	win.addEventListener("resize", place);
	cleanups.push(() => {
		doc.removeEventListener("pointerdown", outside, true);
		win.removeEventListener("resize", place);
	});
	const s = options.sources;
	picker.open(options.want !== undefined ? options.want : s.chosen?.() ?? s.suggestion?.()?.tag ?? null);
	place();
	picker.focus();
	return { picker, close: () => void finish(false) };
}
