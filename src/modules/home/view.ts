// The Home tab of the Workbench: one calm column (760 px at most). The search field (drawn by the
// Search module), Today, Pins, the Domains · Map · Tags switch, Recent; and, in place of the Home,
// the pages of a domain, a tag and the older daily notes, with a breadcrumb (Escape goes up).
// A rounded cursor glides from line to line (mouse and arrows) in the hue of the domain.
// The data comes from the runtime and its pure logic; this file draws and listens.
import { getAllTags, Menu, Modal, Platform, setIcon, TFile, type App } from "obsidian";
import type { InlineSearch, TaskInfoLite } from "../../core/services";
import type { TabState, WorkbenchTabHost, WorkbenchTabInstance } from "../../core/workbench/types";
import { mountMap, type MapHandle, type MapState, type MapStrings } from "../../ui/map";
import { Surface } from "../../ui/surface";
import { dateWords, flip, fly, initialOf, reduced, todayLabel, winOf } from "./fx";
import { dropBlock, feature, groupOf, hide, moveBlock, newGroup, pullOut, putBack, renameGroup, deleteGroup, setGroup, show, type Block, type Layout } from "./logic/arrange";
import { blockLines, domainOf, emptyBlock, isPage, openTasksByBlock, pageContent, trailOf, visibleLines } from "./logic/blocks";
import { dateLabel, dayKey, dueLabel, relLabel, splitDated, type DateWords } from "./logic/dates";
import { mapStateAt, usableState, VAULT_ROOT } from "./logic/map";
import { typesInSearch } from "./logic/keys";
import { groupRecents } from "./logic/recents";
import { familyTags, foldTag, hasTag, leafOf, tagFamilies } from "./logic/tags";
import { dueCounts, oldDailyTasks, todayChips, toSortCount } from "./logic/today";
import type { HomeRuntime } from "./runtime";
import { LENSES } from "./settings-logic";
import type { HomeLens, HomePage, HomeTabState } from "./types";

/** Families of tags shown before "N more tags", and sub-tags per family. */
const TAG_FAMILIES = 48;
const TAG_KIDS = 6;
/** Notes listed on a page before "Show N more". */
const PAGE_NOTES = 60;
const TAG_CARDS = 40;

/** What one drawing needs, computed once. */
interface Frame {
	now: number;
	today: string;
	words: DateWords;
	domains: Set<string>;
	pulled: Set<string>;
	tasks: TaskInfoLite[] | null;
	hues: Map<string, number | null>;
}

const isTyping = (el: Element | null) => !!el && (el.matches("input, textarea, select") || (el as HTMLElement).isContentEditable);

function readPage(raw: unknown): HomePage | null {
	if (!raw || typeof raw !== "object") return null;
	const p = raw as Record<string, unknown>;
	if (p.kind === "domain" && typeof p.path === "string" && p.path) return typeof p.here === "string" && p.here ? { kind: "domain", path: p.path, here: p.here } : { kind: "domain", path: p.path };
	if (p.kind === "tag" && typeof p.tag === "string" && p.tag) return { kind: "tag", tag: p.tag };
	if (p.kind === "old-dailies") return { kind: "old-dailies" };
	return null;
}

function readState(raw: TabState | undefined): Partial<HomeTabState> & { hasPage: boolean } {
	const out: Partial<HomeTabState> & { hasPage: boolean } = { hasPage: false };
	if (!raw || typeof raw !== "object") return out;
	if ("page" in raw) {
		out.hasPage = true;
		out.page = readPage(raw.page);
	}
	if (typeof raw.lens === "string" && LENSES.includes(raw.lens as HomeLens)) out.lens = raw.lens as HomeLens;
	if (typeof raw.scroll === "number" && raw.scroll >= 0) out.scroll = raw.scroll;
	if (raw.map && typeof raw.map === "object") out.map = raw.map as MapState;
	if (typeof raw.cursor === "string") out.cursor = raw.cursor;
	return out;
}

const samePage = (a: HomePage | null, b: HomePage | null) => JSON.stringify(a) === JSON.stringify(b);
let nameId = 0;
/** Names a group by hidden text just before it: an aria-label would show as Obsidian's tooltip over every child. */
const nameBy = (el: HTMLElement, text: string): void => {
	const span = el.doc.createElement("span");
	span.className = "sk-home-sr";
	span.textContent = text;
	span.id = `sk-home-name-${++nameId}`;
	el.before(span);
	el.setAttr("aria-labelledby", span.id);
};

export class HomeView implements WorkbenchTabInstance {
	private readonly doc: Document;
	private readonly root: HTMLElement;
	private readonly scroller: HTMLElement;
	private readonly col: HTMLElement;
	private readonly field: HTMLElement;
	private readonly input: HTMLInputElement;
	private readonly tokens: HTMLElement;
	private readonly results: HTMLElement;
	private readonly preview: HTMLElement | null;
	private readonly body: HTMLElement;
	private readonly foot: HTMLElement | null;
	private readonly hintEl: HTMLElement | null;
	private readonly surface: Surface;
	private inline: InlineSearch | null = null;
	private searching = false;
	private page: HomePage | null = null;
	private lens: HomeLens;
	private rootScroll = 0;
	private map: MapHandle | null = null;
	private mapBox: HTMLElement | null = null;
	private mapState: MapState | null = null;
	private readonly phoneOpen = new Set<string>();
	/** Tasks checked while the page is shown: they stay, struck through, until the page is left. */
	private readonly justDone = new Set<string>();
	private readonly tasksByKey = new Map<string, TaskInfoLite>();
	private allTags = false;
	private allNotes = false;
	private howOpen = false;
	private stale = false;
	/** A pinned note is flying to the Pins row: redraws wait until it lands. */
	private flying = false;
	private destroyed = false;
	private popup: { el: HTMLElement; anchor: HTMLElement | null; close: () => void } | null = null;
	private drag: { id: string; at: { before: string } | { after: string } | { group: string | null } | null } | null = null;
	private readonly observer: ResizeObserver;
	private readonly cleanups: Array<() => void> = [];
	private readonly timers = new Set<number>();
	private frame: Frame | null = null;
	/** How the cursor got where it is (a redraw puts it back the same way). */
	private via: "mouse" | "key" = "key";
	readonly phone = Platform.isPhone;
	private readonly touch = Platform.isMobile;

	constructor(
		private readonly rt: HomeRuntime,
		el: HTMLElement,
		readonly host: WorkbenchTabHost,
	) {
		this.doc = el.ownerDocument;
		const state = readState(host.state);
		this.page = state.page ?? null;
		this.lens = state.lens ?? (LENSES.includes(rt.settings.lens as HomeLens) ? (rt.settings.lens as HomeLens) : "domains");
		this.mapState = state.map ?? null;

		this.root = el.createDiv({ cls: "sk-home-tab", attr: { "data-layout": host.layout } });
		this.root.tabIndex = -1;
		this.root.toggleClass("is-phone", this.phone);
		this.root.toggleClass("is-touch", this.touch);
		this.scroller = this.root.createDiv({ cls: "sk-home-scroll" });
		this.col = this.scroller.createDiv({ cls: "sk-home-col" });
		this.field = this.col.createEl("label", { cls: "sk-home-field" });
		setIcon(this.field.createSpan({ cls: "sk-home-field-icon" }), "search");
		this.tokens = this.field.createSpan({ cls: "sk-home-tokens" });
		// Named by its label (no aria-label: Obsidian would show it as a tooltip over the field).
		this.field.createSpan({ cls: "sk-home-sr", text: rt.t("search.label") });
		this.input = this.field.createEl("input", {
			attr: { type: "text", autocomplete: "off", spellcheck: "false", placeholder: rt.t("search.placeholder") },
		});
		if (!this.touch) this.field.createEl("kbd", { cls: "sk-home-slash", text: "/" });
		this.results = this.col.createDiv({ cls: "sk-home-results" });
		this.preview = host.layout === "page" && !this.touch ? this.col.createEl("aside", { cls: "sk-home-preview" }) : null;
		this.body = this.col.createDiv({ cls: "sk-home-body" });
		this.surface = new Surface(this.col, {
			itemSelector: "[data-hnav]",
			scrollEl: this.scroller,
			onSet: (item, via) => {
				this.via = via;
				this.roving(item);
			},
		});

		// The help bar names keys: none on touch devices (phones and tablets alike).
		if (!this.touch) {
			this.foot = this.root.createDiv({ cls: "sk-home-foot" });
			this.hintEl = this.foot.createDiv({ cls: "sk-home-hint" });
			const help = this.foot.createEl("button", { cls: "sk-btn is-ghost is-icon is-s sk-home-help", attr: { type: "button", "aria-label": rt.t("keys.all"), "aria-haspopup": "dialog" } });
			setIcon(help, "circle-help");
			help.addEventListener("click", () => this.toggleHelp(help));
		} else {
			this.foot = null;
			this.hintEl = null;
		}

		this.listen(this.root, "keydown", (e) => this.onKey(e as KeyboardEvent));
		this.listen(this.body, "click", (e) => this.onClick(e as MouseEvent));
		this.listen(this.body, "auxclick", (e) => this.onAuxClick(e as MouseEvent));
		this.listen(this.body, "contextmenu", (e) => this.onContextMenu(e as MouseEvent));
		this.listen(this.body, "dragstart", (e) => this.onDragStart(e as DragEvent));
		this.listen(this.body, "dragover", (e) => this.onDragOver(e as DragEvent));
		this.listen(this.body, "drop", (e) => this.onDrop(e as DragEvent));
		this.listen(this.body, "dragend", () => this.endDrag());
		this.listen(this.doc, "pointerdown", (e) => this.onOutside(e as PointerEvent), true);
		this.listen(this.field, "click", (e) => {
			if (!this.touch) return;
			e.preventDefault();
			this.rt.search()?.open({});
		});
		this.listen(this.input, "focus", () => {
			if (this.touch) {
				this.input.blur();
				return;
			}
			if (this.surface.current) this.surface.clear();
		});

		const RO = (winOf(this.root) as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ?? ResizeObserver;
		this.observer = new RO(() => this.resized());
		this.observer.observe(this.scroller);

		this.attachSearch();
		this.render({ keepKey: state.cursor ?? null, focus: false });
		if (state.scroll) this.scroller.scrollTop = state.scroll;
		if (this.page?.kind === "domain" && this.page.here && !state.cursor) this.revealHere();
	}

	// ----- WorkbenchTabInstance -----

	update(): void {
		this.dataChanged();
	}

	/** Data changed (runtime.changed): drawn now when shown, else when shown again. */
	dataChanged(): void {
		if (this.destroyed) return;
		// Not shown, a note flying, a block being dragged or a "?" panel open: drawn when that ends.
		if (!this.root.isShown() || this.flying || this.drag || this.popup) {
			this.stale = true;
			return;
		}
		this.stale = false;
		this.render();
	}

	getState(): TabState {
		const state: HomeTabState = { page: this.page, lens: this.lens, scroll: Math.round(this.scroller.scrollTop) };
		const map = this.map?.getState() ?? this.mapState;
		if (map) state.map = map;
		const key = this.surface.current?.dataset.key;
		if (key) state.cursor = key;
		return state as unknown as TabState;
	}

	setState(raw: TabState): void {
		const state = readState(raw);
		const page = state.hasPage ? state.page ?? null : this.page;
		const lens = state.lens ?? this.lens;
		const mapChanged = !!state.map && JSON.stringify(state.map) !== JSON.stringify(this.map?.getState() ?? this.mapState);
		if (state.map) this.mapState = state.map;
		if (mapChanged) this.destroyMap();
		const moved = !samePage(page, this.page) || lens !== this.lens;
		if (moved && page) this.inline?.clear();
		if (!this.page && page) this.rootScroll = this.scroller.scrollTop;
		this.page = page;
		this.lens = lens;
		if (moved) {
			this.justDone.clear();
			this.allNotes = false;
		}
		this.render({ keepKey: state.cursor ?? null, focus: false });
		if (state.scroll !== undefined) this.scroller.scrollTop = state.scroll;
		else if (moved) this.scroller.scrollTop = page ? 0 : this.rootScroll;
		if (page?.kind === "domain" && page.here && !state.cursor) this.revealHere();
	}

	focus(): void {
		if (this.destroyed) return;
		if (!this.page && this.inline && !this.touch) {
			this.input.focus({ preventScroll: true });
			return;
		}
		const item = this.surface.current ?? this.surface.items()[0];
		if (item) this.surface.focus(item);
		else this.root.focus({ preventScroll: true });
	}

	busy(): boolean {
		return this.doc.activeElement === this.input && this.input.value !== "";
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.closePopup();
		this.rt.views.delete(this);
		try {
			this.inline?.destroy();
		} catch (error) {
			console.error("[Snailkit] home: search cleanup failed", error);
		}
		this.inline = null;
		this.destroyMap();
		this.observer.disconnect();
		for (const timer of this.timers) winOf(this.root).clearTimeout(timer);
		this.timers.clear();
		for (const off of this.cleanups.splice(0)) off();
		this.surface.destroy();
		this.root.remove();
	}

	// ----- runtime hooks -----

	servicesChanged(): void {
		if (this.destroyed) return;
		this.attachSearch();
	}

	renamed(from: string, to: string): void {
		const page = this.page;
		if (page?.kind === "domain") {
			if (page.path === from) this.page = { ...page, path: to };
			if (page.here === from) this.page = { ...(this.page as typeof page), here: to };
		}
	}

	// ----- helpers -----

	private listen(target: EventTarget, type: string, handler: (event: Event) => void, capture = false): void {
		target.addEventListener(type, handler, capture);
		this.cleanups.push(() => target.removeEventListener(type, handler, capture));
	}

	private later(ms: number, run: () => void): void {
		const win = winOf(this.root);
		const id = win.setTimeout(() => {
			this.timers.delete(id);
			if (!this.destroyed) run();
		}, ms);
		this.timers.add(id);
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.rt.t(key, vars);
	}

	private tn(key: string, count: number, vars?: Record<string, string | number>): string {
		return this.rt.tn(key, count, vars);
	}

	private get world() {
		return this.rt.world;
	}

	private hueOf(path: string): number | null {
		const f = this.frame!;
		if (f.hues.has(path)) return f.hues.get(path)!;
		const domain = domainOf(this.world, path, f.domains);
		const hue = domain ? this.world.hue(domain) : null;
		f.hues.set(path, hue);
		return hue;
	}

	private name(path: string): string {
		return this.world.name(path);
	}

	/** An item the cursor can rest on: keyboard and mouse both reach it. */
	private item(parent: HTMLElement, tag: keyof HTMLElementTagNameMap, cls: string, o: { key: string; act: string; arg?: string; pin?: string | null; hue?: number | null; label?: string; flip?: boolean }): HTMLElement {
		const el = parent.createEl(tag, { cls: `${cls} sk-surface-item` });
		el.setAttr("data-hnav", "");
		el.setAttr("role", "button");
		el.dataset.key = o.key;
		el.dataset.act = o.act;
		if (o.arg !== undefined) el.dataset.arg = o.arg;
		if (o.pin) el.dataset.pin = o.pin;
		if (o.flip) el.dataset.flip = o.key;
		if (o.hue !== undefined && o.hue !== null) el.style.setProperty("--sk-hue", String(o.hue));
		else el.addClass("is-gray");
		if (o.label) el.setAttr("aria-label", o.label);
		el.tabIndex = -1;
		return el;
	}

	private section(parent: HTMLElement, id: string, title: string | ((head: HTMLElement) => void), right?: string | null): HTMLElement {
		const sec = parent.createEl("section", { cls: "sk-home-sec", attr: { "data-sec": id, "data-flip": `sec:${id}` } });
		const head = sec.createDiv({ cls: "sk-home-sech" });
		if (typeof title === "string") head.createEl("h2", { text: title });
		else title(head);
		if (right) head.createSpan({ cls: "sk-home-sech-r", text: right });
		return sec;
	}

	/** One Tab stop per section: the item under the cursor (or the first) takes it. */
	private roving(item: HTMLElement): void {
		const sec = item.closest("[data-sec]");
		if (!sec) return;
		sec.querySelectorAll<HTMLElement>("[data-hnav]").forEach((x) => (x.tabIndex = x === item ? 0 : -1));
	}

	private initRoving(): void {
		this.body.querySelectorAll<HTMLElement>("[data-sec]").forEach((sec) => {
			sec.querySelectorAll<HTMLElement>("[data-hnav]").forEach((x, i) => (x.tabIndex = i === 0 ? 0 : -1));
		});
	}

	private byKey(key: string): HTMLElement | null {
		for (const el of Array.from(this.body.querySelectorAll<HTMLElement>("[data-hnav]"))) if (el.dataset.key === key) return el;
		return null;
	}

	/** Opens a note the Workbench's way; `tab`: in a new tab. */
	private openNote(path: string, line: number | null, event?: MouseEvent | KeyboardEvent, tab = false): void {
		const mod = !!(event && (event.ctrlKey || event.metaKey));
		this.host.open(path, line, tab && !mod ? ({ ctrlKey: true, metaKey: false } as MouseEvent) : event);
	}

	// ----- search -----

	private attachSearch(): void {
		const search = this.rt.search();
		const want = !!search && !this.touch;
		if (this.inline && !want) {
			try {
				this.inline.destroy();
			} catch {
				/* already gone */
			}
			this.inline = null;
			this.setSearching(false);
		}
		if (want && !this.inline) {
			try {
				this.inline = search!.attach({
					input: this.input,
					results: this.results,
					tokens: this.tokens,
					preview: this.preview,
					onActive: (active) => this.setSearching(active),
					onEscape: () => this.root.focus({ preventScroll: true }),
					onLeave: () => {
						const first = this.surface.items()[0];
						if (first) this.surface.focus(first);
					},
					openNote: (path, line, event) => this.openNote(path, line, event),
				});
			} catch (error) {
				console.error("[Snailkit] home: the search could not attach", error);
				this.inline = null;
			}
		}
		this.root.toggleClass("has-search", !!search);
		this.updateHint();
	}

	private setSearching(active: boolean): void {
		if (this.searching === active || this.destroyed) return;
		this.searching = active;
		this.col.toggleClass("is-searching", active);
		if (active) this.surface.clear();
		else if (!reduced(this.root)) this.body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
		this.updateHint();
	}

	/** "/": the Home's search (from a page: the Home first). */
	private toSearch(): void {
		const search = this.rt.search();
		if (!search) return;
		if (this.touch) {
			search.open({});
			return;
		}
		if (this.page) this.goRoot(null, false);
		this.scroller.scrollTo({ top: 0, behavior: reduced(this.root) ? "auto" : "smooth" });
		this.surface.clear();
		this.input.focus({ preventScroll: true });
	}

	/** Text typed elsewhere in the Home, put in the search field at its caret as if typed there. */
	private typeInSearch(text: string): void {
		const input = this.input;
		if (this.doc.activeElement !== input) return;
		const end = input.value.length;
		input.setRangeText(text, input.selectionStart ?? end, input.selectionEnd ?? end, "end");
		const win = (this.doc.defaultView ?? window) as Window & typeof globalThis;
		input.dispatchEvent(new win.Event("input", { bubbles: true }));
	}

	// ----- drawing -----

	private makeFrame(): Frame {
		const now = Date.now();
		const tasks = this.rt.taskList(true);
		return {
			now,
			today: dayKey(now),
			words: dateWords(this.rt.ctx.lang, (k) => this.t(k)),
			domains: this.rt.domainSet(),
			pulled: this.rt.pulledSet(),
			tasks,
			hues: new Map(),
		};
	}

	/** Draws the Home or the page again, keeping the cursor (by key), its focus and the scroll. */
	render(o: { keepKey?: string | null; focus?: boolean } = {}): void {
		if (this.destroyed) return;
		const active = this.doc.activeElement;
		const keepKey = o.keepKey !== undefined ? o.keepKey : this.surface.current?.dataset.key ?? null;
		const hadFocus = o.focus ?? (!!active && this.body.contains(active));
		const scroll = this.scroller.scrollTop;
		this.closePopup();
		this.frame = this.makeFrame();
		this.tasksByKey.clear();
		this.body.empty();
		this.col.toggleClass("on-page", !!this.page);
		this.root.toggleClass("on-page", !!this.page);
		if (this.page) {
			if (this.searching) this.inline?.clear();
			this.destroyMap();
			if (this.page.kind === "domain") this.drawDomainPage(this.page);
			else if (this.page.kind === "tag") this.drawTagPage(this.page.tag);
			else this.drawOldPage();
		} else this.drawRoot();
		this.initRoving();
		this.updateHint();
		this.scroller.scrollTop = scroll;
		const el = keepKey ? this.byKey(keepKey) : null;
		if (el) {
			this.surface.set(el, hadFocus ? "key" : this.via, true);
			this.roving(el);
			if (hadFocus) el.focus({ preventScroll: true });
		} else {
			this.surface.clear();
			if (hadFocus) this.root.focus({ preventScroll: true });
		}
		this.placeThumbs();
	}

	private placeThumbs(): void {
		this.body.querySelectorAll<HTMLElement>(".sk-segm").forEach((segm) => {
			const thumb = segm.querySelector<HTMLElement>(".sk-segm-thumb");
			const on = segm.querySelector<HTMLElement>('[aria-pressed="true"]');
			if (!thumb) return;
			if (!on || !on.offsetWidth) {
				thumb.style.width = "0px";
				return;
			}
			thumb.style.width = `${on.offsetWidth}px`;
			thumb.style.transform = `translateX(${on.offsetLeft}px)`;
		});
	}

	// ----- the Home -----

	private drawRoot(): void {
		const f = this.frame!;
		this.drawToday(f);
		this.drawPins();
		this.drawLensSection();
		this.drawRecents(f);
		if (this.lens !== "map") this.destroyMap();
	}

	private chip(parent: HTMLElement, o: { key: string; act: string; arg?: string; pin?: string | null; hue?: number | null; icon?: string; dot?: boolean; label: string; kbd?: string; title?: string; warn?: boolean }): HTMLElement {
		const el = this.item(parent, "div", "sk-home-chip", { key: o.key, act: o.act, arg: o.arg, pin: o.pin, hue: o.hue, flip: true });
		if (o.warn) {
			el.addClass("is-warn");
			el.createSpan({ cls: "sk-home-wdot" });
		} else if (o.dot) el.createSpan({ cls: "sk-home-dot" });
		else if (o.icon) setIcon(el.createSpan({ cls: "sk-home-chip-icon" }), o.icon);
		el.createSpan({ cls: "sk-home-chip-text", text: o.label });
		if (o.kbd && !this.touch) el.createEl("kbd", { text: o.kbd });
		if (o.title) el.setAttr("title", o.title);
		return el;
	}

	private drawToday(f: Frame): void {
		const rt = this.rt;
		const daily = rt.todayNote();
		const tasks = f.tasks;
		const brainstorms = rt.brainstorms();
		const old = tasks ? oldDailyTasks(tasks, (p) => rt.dayOf(p), f.today).reduce((n, g) => n + g.tasks.length, 0) : null;
		const chips = todayChips({ daily: !!daily, due: tasks ? dueCounts(tasks, f.today) : null, toSort: brainstorms ? toSortCount(brainstorms) : null, old });
		const sec = this.section(this.body, "today", this.t("today.title"));
		const row = sec.createDiv({ cls: "sk-home-chips" });
		for (const chip of chips) {
			if (chip.kind === "daily") {
				this.chip(row, { key: "chip:daily", act: "daily", icon: "sun", label: chip.exists ? todayLabel(rt.ctx.lang, f.now) : this.t("today.create"), kbd: "T", title: this.t("today.daily-tip"), pin: daily?.path ?? null });
			} else if (chip.kind === "due") {
				const parts = [chip.overdue ? this.tn("today.overdue", chip.overdue) : "", chip.today ? this.tn("today.due", chip.today) : ""].filter(Boolean);
				this.chip(row, { key: "chip:due", act: "due", icon: "list-checks", warn: chip.overdue > 0, label: parts.join(" · "), title: this.t("today.due-tip") });
			} else if (chip.kind === "brainstorms") {
				this.chip(row, { key: "chip:brainstorms", act: "brainstorms", icon: "zap", label: this.tn("today.brainstorms", chip.count) });
			} else {
				this.chip(row, { key: "chip:old", act: "old", icon: "calendar-clock", label: this.tn("today.old", chip.count) });
			}
		}
	}

	private drawPins(): void {
		const rail = this.rt.rail();
		if (!rail) return;
		let pins: string[] = [];
		try {
			pins = rail.vaultPins().filter((p) => this.world.exists(p));
		} catch {
			pins = [];
		}
		if (!pins.length) return;
		const sec = this.section(this.body, "pins", this.t("pins.title"));
		const row = sec.createDiv({ cls: "sk-home-chips sk-home-pins" });
		for (const path of pins) {
			const hue = this.hueOf(path);
			this.chip(row, { key: `pin:${path}`, act: "note", arg: path, pin: path, hue, dot: true, label: this.name(path), title: path });
		}
	}

	private drawLensSection(): void {
		const hasDomains = this.rt.layout().order.length > 0;
		const hint = this.lensHint(this.lens, hasDomains) || null;
		const sec = this.section(
			this.body,
			"lens",
			(head) => {
				const segm = head.createDiv({ cls: "sk-segm sk-home-lens-segm", attr: { role: "group" } });
				nameBy(segm, this.t("lens.label"));
				segm.createDiv({ cls: "sk-segm-thumb", attr: { "aria-hidden": "true" } });
				for (const lens of LENSES) {
					const b = segm.createEl("button", { cls: "sk-btn", text: this.t(`lens.${lens}`), attr: { type: "button", "aria-pressed": String(lens === this.lens) } });
					b.dataset.lens = lens;
					b.tabIndex = lens === this.lens ? 0 : -1;
				}
			},
			hint,
		);
		sec.addClass("sk-home-lens-sec");
		const view = sec.createDiv({ cls: "sk-home-lens", attr: { "data-lens": this.lens } });
		this.drawLens(view);
	}

	private drawLens(view: HTMLElement): void {
		if (this.lens === "tags") {
			this.destroyMap();
			this.drawTags(view);
			return;
		}
		const layout = this.rt.layout();
		if (!layout.order.length) {
			this.destroyMap();
			this.drawHow(view);
			return;
		}
		if (this.lens === "map") this.drawMap(view, layout);
		else {
			this.destroyMap();
			this.drawDomains(view, layout);
		}
	}

	/** The words right of the view switch ("" for none): none on phones; on touch, the Map unfolds by a tap. */
	private lensHint(lens: HomeLens, hasDomains: boolean): string {
		if (this.phone || (lens !== "tags" && !hasDomains)) return "";
		return this.t(lens === "map" && this.touch ? "lens.map-hint-touch" : `lens.${lens}-hint`);
	}

	/** Switches the Home's view: the old one fades out, the new one comes in. */
	private setLens(lens: HomeLens, viaKey = false): void {
		if (lens === this.lens) {
			if (viaKey) this.body.querySelector<HTMLElement>(`[data-lens="${lens}"]`)?.focus();
			return;
		}
		this.lens = lens;
		void this.rt.setLens(lens);
		this.host.saveState();
		const segm = this.body.querySelector<HTMLElement>(".sk-home-lens-segm");
		const view = this.body.querySelector<HTMLElement>(".sk-home-lens");
		if (!segm || !view) {
			this.render();
			return;
		}
		segm.querySelectorAll<HTMLElement>("[data-lens]").forEach((b) => {
			const on = b.dataset.lens === lens;
			b.setAttr("aria-pressed", String(on));
			b.tabIndex = on ? 0 : -1;
			if (on && viaKey) b.focus();
		});
		this.placeThumbs();
		const sec = segm.closest<HTMLElement>(".sk-home-sec")!;
		const hasDomains = this.rt.layout().order.length > 0;
		const hint = this.lensHint(lens, hasDomains);
		let right = sec.querySelector<HTMLElement>(".sk-home-sech-r");
		if (!right && hint) right = sec.querySelector(".sk-home-sech")!.createSpan({ cls: "sk-home-sech-r" });
		right?.setText(hint);
		if (this.surface.current && view.contains(this.surface.current)) this.surface.clear();
		this.updateHint();
		const swap = () => {
			if (this.destroyed || this.lens !== lens) return;
			this.frame = this.makeFrame();
			const fresh = this.body.querySelector<HTMLElement>(".sk-home-lens");
			if (!fresh) return;
			flip(this.body, () => {
				fresh.empty();
				fresh.dataset.lens = lens;
				fresh.removeClass("is-out");
				this.drawLens(fresh);
				this.initRoving();
			});
			if (lens !== "map" && !reduced(this.root)) fresh.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
		};
		if (reduced(this.root)) swap();
		else {
			view.addClass("is-out");
			this.later(140, swap);
		}
	}

	/** ↓ from the switch: into the view. */
	private enterLens(): void {
		if (this.lens === "map" && this.map) {
			this.map.focus();
			return;
		}
		const first = this.body.querySelector<HTMLElement>(".sk-home-lens [data-hnav]");
		if (first) this.surface.focus(first);
	}

	private drawHow(view: HTMLElement): void {
		const how = view.createDiv({ cls: "sk-home-how" });
		how.createEl("p").append(rich(this.t(this.lens === "map" ? "domains.how-lead-map" : "domains.how-lead")));
		const button = how.createEl("button", { cls: "sk-btn is-s", attr: { type: "button", "aria-expanded": String(this.howOpen) } });
		setIcon(button.createSpan(), "info");
		button.createSpan({ text: this.t("domains.how") });
		button.addEventListener("click", () => {
			this.howOpen = !this.howOpen;
			this.render();
		});
		if (this.howOpen) {
			const ol = how.createDiv({ cls: "sk-home-how-box" }).createEl("ol");
			for (const key of ["domains.how-1", "domains.how-2", "domains.how-3"]) ol.createEl("li").append(rich(this.t(key)));
		}
	}

	// ----- Domains -----

	private drawDomains(view: HTMLElement, layout: Layout): void {
		const f = this.frame!;
		const counts = f.tasks ? openTasksByBlock(this.world, f.tasks, layout.order) : null;
		if (layout.featured) this.drawBlock(view, layout.featured, true, counts);
		const cols = view.createDiv({ cls: "sk-home-dcols" });
		const named = layout.sections.some((s) => s.group);
		for (const section of layout.sections) {
			const title = section.group?.name ?? (named ? this.t("domains.other") : null);
			const [first, ...rest] = section.blocks;
			if (title) {
				const gs = cols.createDiv({ cls: "sk-home-gs" });
				const gt = gs.createDiv({ cls: "sk-home-gt", text: title, attr: { "data-flip": `gt:${section.group?.id ?? ""}` } });
				gt.dataset.group = section.group?.id ?? "";
				if (section.group) gt.addClass("is-named");
				this.drawBlock(gs, first, false, counts);
			} else this.drawBlock(cols, first, false, counts);
			for (const block of rest) this.drawBlock(cols, block, false, counts);
		}
		if (layout.hidden.length) {
			const line = view.createDiv({ cls: "sk-home-hidl" });
			this.item(line, "div", "sk-home-ln is-more", { key: "hidden", act: "hidden" }).createSpan({ cls: "sk-home-t", text: this.tn("domains.hidden", layout.hidden.length) });
		}
	}

	private drawBlock(parent: HTMLElement, block: Block, featured: boolean, counts: Map<string, number> | null): void {
		const f = this.frame!;
		const hue = this.world.hue(block.domain);
		const name = this.name(block.id);
		const open = !this.phone || this.phoneOpen.has(block.id);
		const db = parent.createDiv({ cls: "sk-home-db", attr: { "data-blk": block.id, "data-flip": `b:${block.id}` } });
		db.toggleClass("is-feat", featured);
		db.toggleClass("is-open", open);
		const dh = this.item(db, "div", "sk-home-dh", { key: `dom:${block.id}`, act: this.phone ? "toggle" : "block", arg: block.id, pin: block.id, hue });
		dh.setAttr("aria-expanded", String(open));
		if (!this.touch) dh.setAttr("draggable", "true");
		dh.createSpan({ cls: "sk-home-pa", text: initialOf(name) });
		dh.createSpan({ cls: "sk-home-nm", text: name });
		dh.createSpan({ cls: "sk-home-ld" });
		const more = dh.createEl("button", { cls: "sk-home-more", attr: { type: "button", "aria-label": this.t("domains.arrange", { name }), "aria-haspopup": "menu", tabindex: "-1" } });
		more.dataset.menu = block.id;
		setIcon(more, "more-horizontal");
		const n = counts?.get(block.id) ?? 0;
		const ct = dh.createSpan({ cls: "sk-home-ct", text: n ? String(n) : "" });
		if (counts) ct.setAttr("title", this.tn("domains.tasks", n));
		if (this.phone) setIcon(dh.createSpan({ cls: "sk-home-chev" }), "chevron-down");
		if (!open) return;
		const lines = blockLines(this.world, block, f.pulled, this.rt.activityMemo);
		const { shown, more: rest } = visibleLines(lines, featured);
		const box = db.createDiv({ cls: "sk-home-lines" });
		for (const line of shown) {
			if (line.kind === "sub") {
				const el = this.item(box, "div", "sk-home-ln is-sub", { key: `ln:${block.id}:${line.path}`, act: "page", arg: line.path, pin: line.path, hue });
				setIcon(el.createSpan({ cls: "sk-home-ln-icon" }), "network");
				el.createSpan({ cls: "sk-home-t", text: this.name(line.path) });
				el.createSpan({ cls: "sk-home-m", text: this.tn("domains.notes", line.count ?? 0) });
			} else {
				const el = this.item(box, "div", "sk-home-ln" + (line.kind === "kid" ? " is-ind" : ""), { key: `ln:${block.id}:${line.path}`, act: "note", arg: line.path, pin: line.path, hue });
				const meta = this.noteMeta(line.path, f);
				el.createSpan({ cls: "sk-home-t", text: meta.label });
				el.createSpan({ cls: "sk-home-m", text: meta.meta });
				el.setAttr("title", this.name(line.path));
			}
		}
		if (!lines.length) {
			// Say what the block holds instead: only brainstorms, sub-MOCs pulled out, or both.
			const why = emptyBlock(this.world, block, f.pulled);
			const text = why.kind === "pulled" || why.kind === "nothing" ? this.t(`domains.empty.${why.kind}`) : this.tn(`domains.empty.${why.kind}`, why.brainstorms);
			box.createDiv({ cls: "sk-home-ln is-quiet", text });
		}
		if (rest > 0 || this.phone) {
			const el = this.item(box, "div", "sk-home-ln is-more", { key: `more:${block.id}`, act: "page", arg: block.id, hue });
			el.createSpan({ cls: "sk-home-t", text: rest > 0 ? this.tn("domains.more", rest) : this.t("domains.open") });
			setIcon(el.createSpan({ cls: "sk-home-ln-arrow" }), "arrow-right");
		}
	}

	/** A note's label (its title, without a leading date) and its meta (the date, or how long ago it changed). */
	private noteMeta(path: string, f: Frame): { label: string; meta: string } {
		const name = this.name(path);
		if (this.world.isDrawing(path)) return { label: name.replace(/\.excalidraw$/i, ""), meta: this.t("date.drawing") };
		const dated = splitDated(name);
		if (dated.date) return { label: dated.label, meta: dateLabel(dated.date, f.today, f.words) };
		return { label: name, meta: relLabel(this.world.mtime(path), f.now, f.words) };
	}

	// ----- Map -----

	private mapStrings(): MapStrings {
		return {
			more: (count) => this.tn("map.more", count),
			moreLabel: (count, name) => this.t("map.more-label", { count, name }),
			recenter: this.t("map.recenter"),
			recenterTip: this.t("map.recenter-tip"),
			tree: this.t("map.tree"),
			breadcrumbs: this.t("map.breadcrumbs"),
			back: this.t("map.back"),
			open: this.t("map.open"),
		};
	}

	private drawMap(view: HTMLElement, layout: Layout): void {
		const source = this.rt.mapSource;
		if (this.map && this.mapBox) {
			view.appendChild(this.mapBox);
			this.map.update();
			this.map.layout();
		} else {
			this.mapBox = view.createDiv({ cls: "sk-home-map" });
			const current = this.rt.recents()[0]?.path ?? null;
			const home = source.home();
			let state: MapState | null = this.mapState && usableState(source, this.mapState) ? this.mapState : null;
			if (!state && current) state = mapStateAt(source, home, current);
			try {
				this.map = mountMap(
					this.mapBox,
					{ source, home, state, current, strings: this.mapStrings(), icon: (el, icon) => setIcon(el, icon), mode: this.phone ? "tree" : "auto" },
					{
						open: (id, how, event) => {
							if (id === VAULT_ROOT) return;
							this.openNote(id, null, event, how === "tab");
						},
						openPage: (id) => this.mapPage(id),
						pin: (id, from) => void this.togglePin(id, from),
						menu: (id, event) => this.mapMenu(id, event),
						escape: () => {
							if (this.inline && !this.touch) this.input.focus({ preventScroll: true });
							else this.body.querySelector<HTMLElement>(".sk-home-lens-segm [aria-pressed='true']")?.focus();
						},
						change: (next) => {
							this.mapState = next;
							this.host.saveState();
						},
					},
				);
			} catch (error) {
				console.error("[Snailkit] home: the map could not open", error);
				this.map = null;
			}
		}
		const help = view.createDiv({ cls: "sk-home-mhelp" });
		help.createSpan({ cls: "sk-home-mhelp-text" }).append(rich(this.t("map.help")));
		const q = help.createEl("button", { cls: "sk-btn is-ghost is-icon is-s", attr: { type: "button", "aria-label": this.t("map.help-button"), "aria-haspopup": "dialog", "aria-expanded": "false" } });
		setIcon(q, "circle-help");
		q.dataset.mapq = "";
		help.createSpan({ cls: "sk-home-sp" });
		if (layout.hidden.length) {
			const b = help.createEl("button", { cls: "sk-home-hidb", text: this.tn("domains.hidden", layout.hidden.length), attr: { type: "button" } });
			b.dataset.hidden = "";
		}
	}

	private destroyMap(): void {
		if (this.map) {
			this.mapState = this.map.getState();
			try {
				this.map.destroy();
			} catch (error) {
				console.error("[Snailkit] home: map cleanup failed", error);
			}
		}
		this.map = null;
		this.mapBox?.remove();
		this.mapBox = null;
	}

	/** "N more" on the Map: the page of that node (under the root: the Domains view). */
	private mapPage(id: string): void {
		const source = this.rt.mapSource;
		if (id === source.home() || id === VAULT_ROOT) {
			this.setLens("domains", true);
			return;
		}
		const f = this.frame ?? this.makeFrame();
		if (isPage(this.world, id, f.domains, f.pulled)) this.go({ kind: "domain", path: id });
		else this.openNote(id, null);
	}

	private mapMenu(id: string, event: MouseEvent | KeyboardEvent): void {
		if (id === VAULT_ROOT) return;
		const source = this.rt.mapSource;
		const node = source.node(id);
		if (!node) return;
		const rail = this.rt.rail();
		const pinned = !!rail?.isPinned(id);
		const menu = new Menu();
		menu.addItem((i) => i.setTitle(this.t("menu.open")).setIcon("file-text").onClick(() => this.openNote(id, null)));
		menu.addItem((i) => i.setTitle(this.t("menu.open-tab")).setIcon("file-plus").onClick(() => this.openNote(id, null, undefined, true)));
		const root = this.map?.getState().root ?? source.home();
		if (node.hasChildren && id !== root) menu.addItem((i) => i.setTitle(this.t("menu.recenter")).setIcon("crosshair").onClick(() => this.map?.recenter(id)));
		menu.addItem((i) => i.setTitle(this.t(pinned ? "menu.unpin" : "menu.pin")).setIcon("pin").onClick(() => void this.togglePin(id, null)));
		const f = this.frame ?? this.makeFrame();
		if (isPage(this.world, id, f.domains, f.pulled)) {
			menu.addSeparator();
			menu.addItem((i) => i.setTitle(this.t("menu.domain-page")).setIcon("layout-list").onClick(() => this.go({ kind: "domain", path: id })));
		}
		this.showMenu(menu, event);
	}

	// ----- Tags -----

	private tagCounts(): Record<string, number> {
		const cache = this.rt.app.metadataCache as unknown as { getTags?(): Record<string, number> };
		try {
			if (typeof cache.getTags === "function") return cache.getTags() ?? {};
		} catch {
			/* read them below */
		}
		const out: Record<string, number> = {};
		for (const file of this.rt.app.vault.getMarkdownFiles()) {
			const meta = this.rt.app.metadataCache.getFileCache(file);
			for (const tag of (meta && getAllTags(meta)) ?? []) out[tag] = (out[tag] ?? 0) + 1;
		}
		return out;
	}

	private pill(parent: HTMLElement, tag: string, cls = "", label?: string): HTMLElement {
		const colors = this.rt.tagClasses(tag);
		const el = parent.createSpan({ cls: `sk-home-pill ${cls} ${colors}`.trim(), text: label ?? tag });
		el.toggleClass("is-colored", !!colors);
		return el;
	}

	private drawTags(view: HTMLElement): void {
		const families = tagFamilies(this.tagCounts());
		if (!families.length) {
			view.createDiv({ cls: "sk-home-empty", text: this.t("tags.empty") });
			return;
		}
		const shown = this.allTags ? families : families.slice(0, TAG_FAMILIES);
		const cols = view.createDiv({ cls: "sk-home-tcols" });
		for (const family of shown) {
			const box = cols.createDiv({ cls: "sk-home-tf" });
			const row = this.item(box, "div", "sk-home-tg", { key: `tag:${foldTag(family.tag)}`, act: "tag", arg: family.tag });
			this.pill(row, family.tag);
			row.createSpan({ cls: "sk-home-n", text: String(family.count) });
			for (const kid of family.kids.slice(0, TAG_KIDS)) {
				const k = this.item(box, "div", "sk-home-tg is-kid", { key: `tag:${foldTag(kid.tag)}`, act: "tag", arg: kid.tag });
				this.pill(k, kid.tag, "", leafOf(kid.tag));
				k.createSpan({ cls: "sk-home-n", text: String(kid.count) });
			}
			if (family.kids.length > TAG_KIDS) {
				const more = this.item(box, "div", "sk-home-tg is-kid is-more", { key: `tagmore:${foldTag(family.tag)}`, act: "tag", arg: family.tag });
				more.createSpan({ cls: "sk-home-t", text: this.tn("domains.more", family.kids.length - TAG_KIDS) });
			}
		}
		if (families.length > TAG_FAMILIES) {
			const line = view.createDiv({ cls: "sk-home-hidl" });
			const el = this.item(line, "div", "sk-home-ln is-more", { key: "tags-all", act: "all-tags" });
			el.createSpan({ cls: "sk-home-t", text: this.allTags ? this.t("tags.fewer") : this.tn("tags.more", families.length - TAG_FAMILIES) });
		}
	}

	// ----- Recent -----

	private drawRecents(f: Frame): void {
		const groups = groupRecents(this.rt.recents(), f.now, (p) => this.world.exists(p));
		if (!groups.length) return;
		const sec = this.section(this.body, "recent", this.t("recent.title"));
		const grid = sec.createDiv({ cls: "sk-home-rec" });
		for (const { group, items } of groups) {
			grid.createDiv({ cls: "sk-home-rl", text: this.t(`recent.${group}`) });
			const rows = grid.createDiv({ cls: "sk-home-rows" });
			for (const recent of items) {
				const hue = this.hueOf(recent.path);
				const el = this.item(rows, "div", "sk-home-rr", { key: `rec:${recent.path}`, act: "note", arg: recent.path, pin: recent.path, hue, flip: true });
				el.createSpan({ cls: "sk-home-dot" });
				el.createSpan({ cls: "sk-home-t", text: this.name(recent.path) });
				const trail = trailOf(this.world, recent.path, f.domains).join(" › ") || folderOf(recent.path);
				el.createSpan({ cls: "sk-home-p", text: trail });
				const meta = group === "today" ? f.words.time(recent.at) : group === "week" ? f.words.weekday(recent.at) : group === "earlier" && recent.at ? f.words.date(recent.at, new Date(recent.at).getFullYear() !== new Date(f.now).getFullYear()) : "";
				el.createSpan({ cls: "sk-home-m", text: meta });
			}
		}
	}

	// ----- pages -----

	private crumbs(items: Array<[string, string | null]>): void {
		const nav = this.body.createEl("nav", { cls: "sk-home-crumbs" });
		nameBy(nav, this.t("dpage.crumbs"));
		if (this.phone) {
			const back = nav.createEl("button", { cls: "sk-home-back", attr: { type: "button" } });
			setIcon(back.createSpan(), "chevron-left");
			back.createSpan({ text: this.t("dpage.back") });
			back.dataset.up = "";
		}
		items.forEach(([label, target], i) => {
			if (i) nav.createSpan({ cls: "sk-home-sep", text: "›" });
			if (target === null) nav.createSpan({ cls: "sk-home-here", text: label });
			else {
				const b = nav.createEl("button", { text: label, attr: { type: "button" } });
				b.dataset.crumb = target;
			}
		});
	}

	private drawDomainPage(page: Extract<HomePage, { kind: "domain" }>): void {
		const f = this.frame!;
		const world = this.world;
		if (!world.exists(page.path)) {
			this.page = null;
			this.drawRoot();
			return;
		}
		const domain = domainOf(world, page.path, f.domains) ?? page.path;
		const hue = world.hue(domain);
		const layout = this.rt.layout();
		const arr = this.rt.arrangement();
		const blockId = f.pulled.has(page.path) || f.domains.has(page.path) ? page.path : null;
		const group = groupOf(arr, blockId ?? domain);
		const groupName = group ? arr.groups.find(([g]) => g === group)?.[1] ?? null : null;
		const items: Array<[string, string | null]> = [[this.t("dpage.home"), "home"]];
		if (groupName) items.push([groupName, `group:${group}`]);
		if (page.path !== domain) items.push([this.name(domain), `dom:${domain}`]);
		const title = this.name(page.path);
		items.push([title, null]);
		this.crumbs(items);

		const head = this.body.createDiv({ cls: "sk-home-ph" });
		const pa = head.createSpan({ cls: "sk-home-pa is-l", text: initialOf(title) });
		pa.style.setProperty("--sk-hue", String(hue));
		head.createEl("h1", { text: title });
		head.createSpan({ cls: "sk-home-sp" });
		const openBtn = head.createEl("button", { cls: "sk-btn is-s", attr: { type: "button" } });
		setIcon(openBtn.createSpan(), "file-text");
		openBtn.createSpan({ text: this.t("dpage.open-note") });
		openBtn.dataset.opennote = page.path;
		const mapBtn = head.createEl("button", { cls: "sk-btn is-ghost is-s sk-home-onmap", attr: { type: "button", "aria-label": this.t("dpage.on-map") } });
		setIcon(mapBtn.createSpan(), "map");
		mapBtn.createSpan({ cls: "sk-home-bt", text: this.t("dpage.on-map") });
		mapBtn.dataset.onmap = page.path;
		if (blockId && layout.order.some((b) => b.id === blockId)) {
			const menu = head.createEl("button", { cls: "sk-btn is-ghost is-icon is-s", attr: { type: "button", "aria-label": this.t("dpage.arrange"), "aria-haspopup": "menu" } });
			setIcon(menu, "more-horizontal");
			menu.dataset.menu = blockId;
		}

		const content = pageContent(world, page.path, f.domains);
		const tasks = (f.tasks ?? []).filter((t) => content.members.has(t.path) && (!t.done || this.justDone.has(t.key)));
		if (content.subs.length) {
			const sec = this.section(this.body, "psub", this.t("dpage.subs"));
			const box = sec.createDiv({ cls: "sk-home-lines is-flat" });
			for (const sub of content.subs) {
				const el = this.item(box, "div", "sk-home-ln is-sub", { key: `sub:${sub}`, act: "page", arg: sub, pin: sub, hue });
				setIcon(el.createSpan({ cls: "sk-home-ln-icon" }), "network");
				el.createSpan({ cls: "sk-home-t", text: this.name(sub) });
				const inside = pageContent(world, sub, f.domains);
				const open = (f.tasks ?? []).filter((t) => !t.done && inside.members.has(t.path)).length;
				const meta = [this.tn("domains.notes", inside.notes.length)];
				if (f.tasks) meta.push(this.tn("dpage.task-count", open));
				el.createSpan({ cls: "sk-home-m", text: meta.join(" · ") });
			}
		}
		const notes = this.allNotes ? content.notes : content.notes.slice(0, PAGE_NOTES);
		const notesSec = this.section(this.body, "pnotes", this.t("dpage.notes"), content.notes.length ? this.t("dpage.notes-hint") : null);
		if (notes.length) {
			const box = notesSec.createDiv({ cls: "sk-home-lines is-two is-flat" });
			for (const path of notes) {
				const el = this.item(box, "div", "sk-home-ln", { key: `note:${path}`, act: "note", arg: path, pin: path, hue });
				const meta = this.noteMeta(path, f);
				el.createSpan({ cls: "sk-home-t", text: meta.label });
				el.createSpan({ cls: "sk-home-m", text: meta.meta });
				el.setAttr("title", this.name(path));
			}
			if (content.notes.length > notes.length) {
				const more = notesSec.createEl("button", { cls: "sk-btn is-ghost is-s sk-home-showmore", text: this.tn("dpage.show-more", content.notes.length - notes.length), attr: { type: "button" } });
				more.dataset.allnotes = "";
			}
		} else notesSec.createDiv({ cls: "sk-home-empty", text: this.t("dpage.no-notes") });
		if (f.tasks) {
			const open = tasks.filter((t) => !t.done).length;
			const sec = this.section(this.body, "ptasks", this.t("dpage.tasks"), tasks.length ? this.tn("dpage.tasks-hint", open) : null);
			if (tasks.length) this.drawTasks(sec, sortTasks(tasks), { note: true });
			else sec.createDiv({ cls: "sk-home-empty", text: this.t("dpage.no-tasks") });
		}
		const sessions = this.rt.brainstorms();
		if (sessions && content.brainstorms.length) {
			const byPath = new Map(sessions.map((s) => [s.path, s]));
			const sec = this.section(this.body, "pbrains", this.t("dpage.brainstorms"));
			for (const path of content.brainstorms) {
				const info = byPath.get(path);
				if (!info) continue;
				const el = this.item(sec, "div", "sk-home-br", { key: `brain:${path}`, act: "note", arg: path, pin: path, hue });
				setIcon(el.createSpan({ cls: "sk-home-bi" }), "zap");
				el.createSpan({ cls: "sk-home-t", text: info.title || this.name(path) });
				el.createSpan({ cls: "sk-home-sp" });
				if (info.state === "to-sort") el.createSpan({ cls: "sk-home-tri", text: this.t("dpage.to-sort") });
				el.createSpan({ cls: "sk-home-m", text: info.created ? relLabel(info.created, f.now, f.words) : "" });
			}
		}
	}

	private drawTasks(parent: HTMLElement, tasks: TaskInfoLite[], o: { note?: boolean; tag?: string | null } = {}): void {
		const f = this.frame!;
		const box = parent.createDiv({ cls: "sk-home-tks" });
		for (const task of tasks) {
			this.tasksByKey.set(task.key, task);
			const hue = this.hueOf(task.path);
			const el = this.item(box, "div", "sk-home-tk", { key: `task:${task.key}`, act: "task", arg: task.key, pin: task.path, hue });
			el.toggleClass("is-done", task.done);
			const cb = el.createEl("button", { cls: "sk-home-cb", attr: { type: "button", tabindex: "-1", "aria-label": this.t(task.done ? "task.uncheck" : "task.check") } });
			setIcon(cb, "check");
			cb.dataset.check = task.key;
			el.createSpan({ cls: "sk-home-tt", text: task.plainTitle || task.title });
			if (task.priority) {
				const pr = el.createSpan({ cls: `sk-home-pr is-${task.priority}`, attr: { title: this.t(`task.${task.priority}`) } });
				setIcon(pr, task.priority === "high" ? "chevrons-up" : task.priority === "medium" ? "chevron-up" : "chevron-down");
			}
			if (o.tag !== undefined && task.tag && foldTag(task.tag) !== foldTag(o.tag ?? "")) this.pill(el, task.tag, "is-s");
			if (o.note) {
				const name = this.name(task.path);
				el.createSpan({ cls: "sk-home-nt", text: splitDated(name).label === name ? name : splitDated(name).label });
			}
			const due = task.due ? dueLabel(task.due, f.today, f.words) : null;
			el.createSpan({ cls: "sk-home-du" + (due?.late && !task.done ? " is-late" : ""), text: due?.text ?? "" });
		}
	}

	private drawTagPage(tag: string): void {
		const f = this.frame!;
		const counts = this.tagCounts();
		const family = foldTag(tag).split("/")[0];
		const display = Object.keys(counts).map((k) => k.replace(/^#/, "")).find((k) => foldTag(k) === foldTag(tag)) ?? tag;
		this.crumbs([
			[this.t("dpage.home"), "home"],
			[this.t("tpage.tags"), "tags"],
			[`#${display}`, null],
		]);
		const tasks = (f.tasks ?? []).filter((t) => hasTag(t.tags.length ? t.tags : [t.tag], tag) && (!t.done || this.justDone.has(t.key)));
		const notes: TFile[] = [];
		for (const file of this.rt.app.vault.getMarkdownFiles()) {
			const meta = this.rt.app.metadataCache.getFileCache(file);
			const tags = meta ? getAllTags(meta) ?? [] : [];
			if (hasTag(tags, tag) && !this.world.isBrainstorm(file.path)) notes.push(file);
		}
		notes.sort((a, b) => b.stat.mtime - a.stat.mtime || a.basename.localeCompare(b.basename));
		const head = this.body.createDiv({ cls: "sk-home-ph" });
		this.pill(head, display, "is-l", `#${display}`);
		const summary = [f.tasks ? this.tn("dpage.task-count", tasks.filter((t) => !t.done).length) : "", this.tn("domains.notes", notes.length)].filter(Boolean).join(" · ");
		head.createSpan({ cls: "sk-home-sum", text: summary });
		const subs = familyTags(counts, family).filter((t) => foldTag(t.tag) !== family);
		if (subs.length) {
			const wrap = this.body.createDiv({ cls: "sk-home-subtags" });
			const segm = wrap.createDiv({ cls: "sk-segm", attr: { role: "group" } });
			nameBy(segm, this.t("tpage.subtags"));
			segm.createDiv({ cls: "sk-segm-thumb", attr: { "aria-hidden": "true" } });
			const familyName = display.split("/")[0];
			const all = segm.createEl("button", { cls: "sk-btn", text: this.t("tpage.all", { tag: familyName }), attr: { type: "button", "aria-pressed": String(foldTag(tag) === family) } });
			all.dataset.tagsel = familyName;
			for (const sub of subs.slice(0, 12)) {
				const b = sub.tag.split("/").slice(1).join("/");
				const button = segm.createEl("button", { cls: "sk-btn", text: b, attr: { type: "button", "aria-pressed": String(foldTag(sub.tag) === foldTag(tag)) } });
				button.dataset.tagsel = sub.tag;
			}
		}
		if (f.tasks) {
			const sec = this.section(this.body, "ttasks", this.t("tpage.tasks"));
			if (tasks.length) this.drawTasks(sec, sortTasks(tasks), { note: true, tag });
			else sec.createDiv({ cls: "sk-home-empty", text: this.t("tpage.no-tasks") });
		}
		const sec = this.section(this.body, "tnotes", this.t("tpage.notes"));
		if (!notes.length) {
			sec.createDiv({ cls: "sk-home-empty", text: this.t("tpage.no-notes") });
			return;
		}
		const cards = sec.createDiv({ cls: "sk-home-cards" });
		const shown = this.allNotes ? notes : notes.slice(0, TAG_CARDS);
		for (const file of shown) {
			const hue = this.hueOf(file.path);
			const card = this.item(cards, "div", "sk-home-card", { key: `card:${file.path}`, act: "note", arg: file.path, pin: file.path, hue });
			card.createDiv({ cls: "sk-home-card-t", text: file.basename });
			const excerpt = card.createDiv({ cls: "sk-home-card-x" });
			void excerptOf(this.rt.app, file).then((text) => {
				if (!this.destroyed && excerpt.isConnected) excerpt.setText(text);
			});
			const foot = card.createDiv({ cls: "sk-home-card-f" });
			foot.createSpan({ cls: "sk-home-dot" });
			foot.createSpan({ cls: "sk-home-card-p", text: trailOf(this.world, file.path, f.domains).join(" › ") || this.t("tpage.no-domain") });
			foot.createSpan({ cls: "sk-home-sp" });
			foot.createSpan({ text: relLabel(file.stat.mtime, f.now, f.words) });
		}
		if (notes.length > shown.length) {
			const more = sec.createEl("button", { cls: "sk-btn is-ghost is-s sk-home-showmore", text: this.tn("dpage.show-more", notes.length - shown.length), attr: { type: "button" } });
			more.dataset.allnotes = "";
		}
	}

	private drawOldPage(): void {
		const f = this.frame!;
		this.crumbs([
			[this.t("dpage.home"), "home"],
			[this.t("old.title"), null],
		]);
		const groups = f.tasks ? oldDailyTasks(f.tasks, (p) => this.rt.dayOf(p), f.today, (t) => this.justDone.has(t.key)) : [];
		const head = this.body.createDiv({ cls: "sk-home-ph" });
		head.createEl("h1", { text: this.t("old.title") });
		const open = groups.reduce((n, g) => n + g.tasks.filter((t) => !t.done).length, 0);
		if (open) head.createSpan({ cls: "sk-home-sum", text: this.tn("dpage.task-count", open) });
		if (!groups.length) {
			this.body.createDiv({ cls: "sk-home-empty", text: this.t("old.empty") });
			return;
		}
		for (const group of groups) {
			const title = dateLabel(group.day, f.today, f.words);
			const sec = this.section(this.body, `old:${group.path}`, (h) => {
				const b = h.createEl("button", { cls: "sk-home-old-h", text: title, attr: { type: "button", title: group.path } });
				b.dataset.opennote = group.path;
			}, this.tn("dpage.task-count", group.tasks.filter((t) => !t.done).length));
			this.drawTasks(sec, group.tasks);
		}
	}

	private revealHere(): void {
		const page = this.page;
		if (page?.kind !== "domain" || !page.here) return;
		const el = this.byKey(`note:${page.here}`) ?? this.byKey(`sub:${page.here}`);
		if (!el) return;
		this.surface.set(el, "key", true);
		this.roving(el);
		this.surface.reveal(el);
	}

	// ----- navigation -----

	/** Goes to a page, as a step Obsidian's back and forward arrows can return to. */
	go(page: HomePage | null, cursor: string | null = null, focus = true): void {
		if (this.destroyed) return;
		this.host.saveState();
		if (!this.page && page) this.rootScroll = this.scroller.scrollTop;
		if (page) this.inline?.clear();
		this.page = page;
		this.justDone.clear();
		this.allNotes = false;
		this.render({ keepKey: cursor, focus: false });
		this.scroller.scrollTop = page ? 0 : this.rootScroll;
		if (page?.kind === "domain" && page.here && !cursor) this.revealHere();
		const target = cursor ? this.byKey(cursor) : null;
		if (focus && !this.touch) {
			const el = target ?? this.surface.current ?? (page ? this.surface.items()[0] : null);
			if (el) this.surface.focus(el);
			else if (!page && this.inline) this.input.focus({ preventScroll: true });
		} else {
			// With the mouse: no cursor put anywhere, but the keys still reach the tab.
			if (!target) this.surface.clear();
			else this.surface.reveal(target);
			if (!this.touch) this.root.focus({ preventScroll: true });
		}
		this.host.navigate(this.getState());
	}

	private goRoot(cursor: string | null, focus = true): void {
		this.go(null, cursor, focus);
		if (cursor) {
			const el = this.byKey(cursor);
			if (el) this.surface.reveal(el);
		}
	}

	/** Escape on a page: one level up (sub-MOC → domain → Home; tag → Home on Tags). */
	private up(): boolean {
		const page = this.page;
		if (!page) return false;
		const f = this.frame ?? this.makeFrame();
		if (page.kind === "domain") {
			const domain = domainOf(this.world, page.path, f.domains);
			if (domain && domain !== page.path && !f.pulled.has(page.path)) {
				this.go({ kind: "domain", path: domain }, `sub:${page.path}`);
				return true;
			}
			if (this.lens === "tags") this.lens = "domains";
			this.goRoot(this.lens === "map" ? null : `dom:${page.path}`);
			if (this.lens === "map") this.map?.focus();
			return true;
		}
		if (page.kind === "tag") {
			this.lens = "tags";
			void this.rt.setLens("tags");
			this.goRoot(`tag:${foldTag(page.tag)}`);
			return true;
		}
		this.goRoot("chip:old");
		return true;
	}

	/** Runs what an item stands for. */
	private activate(el: HTMLElement, event?: MouseEvent | KeyboardEvent, tab = false): void {
		const act = el.dataset.act;
		const arg = el.dataset.arg ?? "";
		const viaKey = !!event && "key" in event;
		switch (act) {
			case "note":
				this.openNote(arg, null, event, tab);
				return;
			case "task": {
				const task = this.tasksByKey.get(arg);
				if (task) this.openNote(task.path, task.line, event, tab);
				return;
			}
			case "page":
			case "block":
				if (tab) this.openNote(arg, null, event, true);
				else this.go({ kind: "domain", path: arg }, null, viaKey);
				return;
			case "toggle":
				if (this.phoneOpen.has(arg)) this.phoneOpen.delete(arg);
				else this.phoneOpen.add(arg);
				flip(this.body, () => this.render({ keepKey: `dom:${arg}` }));
				return;
			case "daily":
				void this.rt.openDaily(event, (path) => this.openNote(path, null, event, tab));
				return;
			case "due":
				this.host.select("tasks", { scope: "today" });
				return;
			case "brainstorms":
				this.host.select("sessions");
				return;
			case "old":
				this.go({ kind: "old-dailies" }, null, viaKey);
				return;
			case "tag":
				this.go({ kind: "tag", tag: arg }, null, viaKey);
				return;
			case "hidden":
				this.hiddenMenu(el);
				return;
			case "all-tags":
				this.allTags = !this.allTags;
				this.render({ keepKey: "tags-all" });
				return;
		}
	}

	// ----- pins -----

	/** P: pins the note (it flies to the Pins row) or unpins it. */
	async togglePin(path: string, from: HTMLElement | null): Promise<void> {
		const rail = this.rt.rail();
		if (!rail) {
			this.rt.ctx.toast(this.t("pins.need-rail"));
			return;
		}
		if (!this.world.exists(path) || !path.endsWith(".md")) {
			this.rt.ctx.toast(this.t("pins.only-notes"));
			return;
		}
		const name = this.name(path);
		const onHome = !this.page && !this.searching;
		const keep = this.surface.current?.dataset.key ?? null;
		if (rail.isPinned(path)) {
			const chip = onHome ? this.byKey(`pin:${path}`) : null;
			const after = async () => {
				await rail.setPinned(path, false);
				if (onHome) flip(this.body, () => this.render({ keepKey: keep && keep !== `pin:${path}` ? keep : null }));
				this.rt.ctx.toast(this.t("pins.unpinned", { name }), { action: { label: this.t("common.undo"), run: () => void rail.setPinned(path, true) } });
			};
			if (chip && !reduced(this.root)) chip.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.85)" }], { duration: 140, easing: "ease-in", fill: "forwards" }).onfinish = () => void after();
			else await after();
			return;
		}
		const rect = from && from.isConnected ? from.getBoundingClientRect() : null;
		await rail.setPinned(path, true);
		this.rt.ctx.toast(this.t("pins.pinned", { name }), { action: { label: this.t("common.undo"), run: () => void rail.setPinned(path, false) } });
		if (!onHome || this.destroyed) return;
		const still = reduced(this.root) || !rect;
		let chip: HTMLElement | null = null;
		// The new chip waits, invisible, for its copy to land (set inside the redraw so that FLIP leaves it alone).
		flip(this.body, () => {
			this.render({ keepKey: keep });
			chip = this.byKey(`pin:${path}`);
			if (chip && !still) chip.addClass("is-landing");
		});
		if (!chip || still) return;
		const landing: HTMLElement = chip;
		this.flying = true;
		const landed = () => {
			if (!this.flying) return;
			this.flying = false;
			this.catchUp();
		};
		this.later(900, landed);
		const ghost = this.doc.createElement("div");
		ghost.className = "sk-home-chip sk-home-fly-chip";
		const hue = this.hueOf(path);
		if (hue !== null) ghost.style.setProperty("--sk-hue", String(hue));
		else ghost.addClass("is-gray");
		ghost.createSpan({ cls: "sk-home-dot" });
		ghost.createSpan({ cls: "sk-home-chip-text", text: name });
		winOf(this.root).requestAnimationFrame(() =>
			fly(rect!, landing, ghost, () => {
				landing.removeClass("is-landing");
				landing.addClass("is-landed");
				this.later(560, () => {
					landing.removeClass("is-landed");
					landed();
				});
			}),
		);
	}

	// ----- tasks -----

	private async toggleTask(key: string): Promise<void> {
		const task = this.tasksByKey.get(key);
		const tasks = this.rt.tasks();
		if (!task || !tasks) return;
		const done = !task.done;
		const row = this.byKey(`task:${key}`);
		row?.toggleClass("is-done", done);
		row?.querySelector(".sk-home-du")?.removeClass("is-late");
		if (done) this.justDone.add(key);
		const written = (await tasks.setDone({ path: task.path, line: task.line, raw: task.raw }, done)) as TaskInfoLite | null;
		if (!written) {
			row?.toggleClass("is-done", !done);
			this.rt.ctx.toast(this.t("toast.task-gone"));
			return;
		}
		this.rt.ctx.toast(this.t(done ? "toast.checked" : "toast.unchecked"), {
			action: { label: this.t("common.undo"), run: () => void tasks.setDone({ path: written.path, line: written.line, raw: written.raw }, !done) },
		});
	}

	// ----- arrangement -----

	private async arrange(next: ReturnType<HomeRuntime["arrangement"]>, keepKey: string | null, toast?: string): Promise<void> {
		await this.rt.setArrangement(next);
		if (this.destroyed) return;
		if (!this.page) flip(this.body, () => this.render({ keepKey }));
		else this.render();
		if (toast) this.rt.ctx.toast(toast);
	}

	private blockMenu(id: string, event: MouseEvent | KeyboardEvent, anchor?: HTMLElement): void {
		const rt = this.rt;
		const layout = rt.layout();
		const arr = rt.arrangement();
		const block = layout.order.find((b) => b.id === id);
		if (!block) return;
		const name = this.name(id);
		const section = layout.sections.find((s) => s.blocks.some((b) => b.id === id));
		const at = section ? section.blocks.findIndex((b) => b.id === id) : -1;
		const featured = layout.featured?.id === id;
		const group = groupOf(arr, id);
		const key = `dom:${id}`;
		const menu = new Menu();
		menu.addItem((i) => i.setTitle(this.t("menu.up")).setIcon("arrow-up").setDisabled(featured || at <= 0).onClick(() => void this.arrange(moveBlock(arr, layout, id, -1), key)));
		menu.addItem((i) => i.setTitle(this.t("menu.down")).setIcon("arrow-down").setDisabled(featured || at < 0 || !section || at >= section.blocks.length - 1).onClick(() => void this.arrange(moveBlock(arr, layout, id, 1), key)));
		menu.addItem((i) =>
			i
				.setTitle(this.t(featured ? "menu.unfeature" : "menu.feature"))
				.setIcon("star")
				.onClick(() => void this.arrange(feature(arr, featured ? "" : id), key, featured ? undefined : this.t("toast.featured", { name }))),
		);
		const groupItems: Array<{ title: string; icon: string; run: () => void }> = [];
		for (const [g, gName] of arr.groups) {
			if (g === group) continue;
			groupItems.push({ title: this.t("menu.to-group", { group: gName }), icon: "folder", run: () => void this.arrange(setGroup(arr, layout, id, g), key, this.t("toast.grouped", { group: gName })) });
		}
		groupItems.push({
			title: this.t("menu.new-group"),
			icon: "folder-plus",
			run: () =>
				new NameModal(rt.app, this.t("group.new"), "", this.t("group.placeholder"), this.modalLabels(), (value) => {
					const made = newGroup(rt.arrangement(), rt.layout(), id, value);
					if (made.group) void this.arrange(made.arr, key, this.t("toast.grouped", { group: value.trim() }));
				}).open(),
		});
		if (group) {
			const gName = arr.groups.find(([g]) => g === group)?.[1] ?? "";
			groupItems.push({ title: this.t("menu.no-group"), icon: "folder-minus", run: () => void this.arrange(setGroup(arr, layout, id, null), key) });
			groupItems.push({
				title: this.t("menu.rename-group", { group: gName }),
				icon: "pencil",
				run: () =>
					new NameModal(rt.app, this.t("group.rename"), gName, this.t("group.placeholder"), this.modalLabels(), (value) => void this.arrange(renameGroup(rt.arrangement(), group, value), key)).open(),
			});
		}
		submenu(menu, this.t("menu.group"), "folder", groupItems);
		if (block.kind === "domain") {
			const domains = new Set(this.world.domains());
			const subs = this.world.children(id).filter((p) => !this.world.isBrainstorm(p) && this.world.hasChildren(p) && !arr.pulledOut.includes(p) && !domains.has(p));
			if (subs.length) {
				submenu(
					menu,
					this.t("menu.pull-out"),
					"git-branch",
					subs.map((sub) => ({ title: this.name(sub), icon: "network", run: () => void this.arrange(pullOut(arr, layout, sub, id), `dom:${sub}`) })),
				);
			}
		} else {
			menu.addItem((i) => i.setTitle(this.t("menu.put-back", { name: this.name(block.domain) })).setIcon("git-merge").onClick(() => void this.arrange(putBack(arr, id), `dom:${block.domain}`)));
		}
		menu.addSeparator();
		menu.addItem((i) => i.setTitle(this.t("menu.open-note")).setIcon("file-text").onClick(() => this.openNote(id, null)));
		menu.addItem((i) =>
			i
				.setTitle(this.t("menu.hide"))
				.setIcon("eye-off")
				.onClick(() => {
					const next = hide(rt.arrangement(), id);
					const run = async () => {
						await rt.setArrangement(next);
						if (this.page?.kind === "domain" && this.page.path === id) this.goRoot("hidden");
						else if (!this.page) flip(this.body, () => this.render({ keepKey: null }));
						rt.ctx.toast(this.t("toast.hidden", { name }), { action: { label: this.t("common.undo"), run: () => void this.arrange(show(rt.arrangement(), id), key) } });
					};
					const el = !this.page ? this.body.querySelector<HTMLElement>(`[data-blk="${cssEscape(id)}"]`) : null;
					if (el && !reduced(this.root)) el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.97)" }], { duration: 160, easing: "ease-in", fill: "forwards" }).onfinish = () => void run();
					else void run();
				}),
		);
		if (anchor) anchor.setAttr("aria-expanded", "true");
		menu.onHide(() => anchor?.setAttr("aria-expanded", "false"));
		this.showMenu(menu, event, anchor);
	}

	private modalLabels(): { ok: string; cancel: string } {
		return { ok: this.t("common.save"), cancel: this.t("common.cancel") };
	}

	private groupMenu(groupId: string, event: MouseEvent): void {
		const arr = this.rt.arrangement();
		const name = arr.groups.find(([g]) => g === groupId)?.[1];
		if (!name) return;
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle(this.t("menu.rename-group", { group: name }))
				.setIcon("pencil")
				.onClick(() => new NameModal(this.rt.app, this.t("group.rename"), name, this.t("group.placeholder"), this.modalLabels(), (value) => void this.arrange(renameGroup(this.rt.arrangement(), groupId, value), null)).open()),
		);
		menu.addItem((i) => i.setTitle(this.t("menu.delete-group", { group: name })).setIcon("trash-2").onClick(() => void this.arrange(deleteGroup(this.rt.arrangement(), groupId), null)));
		menu.showAtMouseEvent(event);
	}

	private hiddenMenu(anchor: HTMLElement): void {
		const layout = this.rt.layout();
		if (!layout.hidden.length) return;
		const menu = new Menu();
		for (const block of layout.hidden) {
			menu.addItem((i) => i.setTitle(this.t("menu.show", { name: this.name(block.id) })).setIcon("eye").onClick(() => void this.arrange(show(this.rt.arrangement(), block.id), `dom:${block.id}`)));
		}
		if (layout.hidden.length > 1) {
			menu.addSeparator();
			menu.addItem((i) => i.setTitle(this.t("menu.show-all")).setIcon("eye").onClick(() => void this.arrange({ ...this.rt.arrangement(), hidden: [] }, null)));
		}
		this.showMenu(menu, null, anchor);
	}

	private showMenu(menu: Menu, event: MouseEvent | KeyboardEvent | null, anchor?: HTMLElement): void {
		if (event && "clientX" in event && (event.clientX || event.clientY)) {
			menu.showAtMouseEvent(event);
			return;
		}
		const el = anchor ?? (event?.target as HTMLElement | null) ?? this.surface.current ?? this.root;
		const r = el.getBoundingClientRect();
		menu.showAtPosition({ x: r.left, y: r.bottom + 4 }, this.doc);
	}

	// ----- drag (computer) -----

	private onDragStart(e: DragEvent): void {
		const dh = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".sk-home-dh[draggable='true']");
		if (!dh || this.touch) return;
		const id = dh.dataset.arg!;
		this.drag = { id, at: null };
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = "move";
			try {
				e.dataTransfer.setData("text/plain", this.name(id));
			} catch {
				/* some platforms refuse */
			}
		}
		dh.closest(".sk-home-db")?.addClass("is-dragging");
		this.surface.clear();
	}

	private clearDrop(): void {
		this.body.querySelectorAll(".is-drop-b, .is-drop-a, .is-drop-g").forEach((el) => el.removeClass("is-drop-b", "is-drop-a", "is-drop-g"));
	}

	private onDragOver(e: DragEvent): void {
		if (!this.drag) return;
		const target = e.target as HTMLElement | null;
		const db = target?.closest?.<HTMLElement>(".sk-home-db:not(.is-feat)");
		const gt = target?.closest?.<HTMLElement>(".sk-home-gt");
		if (!db && !gt) return;
		e.preventDefault();
		this.clearDrop();
		if (db && db.dataset.blk !== this.drag.id) {
			const r = db.getBoundingClientRect();
			const before = e.clientY < r.top + r.height / 2;
			db.addClass(before ? "is-drop-b" : "is-drop-a");
			this.drag.at = before ? { before: db.dataset.blk! } : { after: db.dataset.blk! };
		} else if (gt) {
			gt.addClass("is-drop-g");
			this.drag.at = { group: gt.dataset.group || null };
		} else this.drag.at = null;
	}

	private onDrop(e: DragEvent): void {
		if (!this.drag) return;
		e.preventDefault();
		const { id, at } = this.drag;
		this.endDrag();
		if (!at) return;
		void this.arrange(dropBlock(this.rt.arrangement(), this.rt.layout(), id, at), `dom:${id}`);
	}

	private endDrag(): void {
		this.drag = null;
		this.clearDrop();
		this.body.querySelectorAll(".is-dragging").forEach((el) => el.removeClass("is-dragging"));
		this.catchUp();
	}

	/** A redraw that waited (drag, panel) happens now. */
	private catchUp(): void {
		if (!this.stale || this.destroyed || this.drag || this.popup || this.flying) return;
		this.later(0, () => this.dataChanged());
	}

	// ----- events -----

	private onClick(e: MouseEvent): void {
		const target = e.target as HTMLElement;
		if (!target?.closest) return;
		if (this.map && this.mapBox?.contains(target)) return;
		const q = target.closest<HTMLElement>("[data-mapq]");
		if (q) return this.toggleMapHelp(q);
		const hb = target.closest<HTMLElement>("[data-hidden]");
		if (hb) return this.hiddenMenu(hb);
		const menuBtn = target.closest<HTMLElement>("[data-menu]");
		if (menuBtn) {
			e.stopPropagation();
			return this.blockMenu(menuBtn.dataset.menu!, e, menuBtn);
		}
		const cb = target.closest<HTMLElement>("[data-check]");
		if (cb) {
			e.stopPropagation();
			void this.toggleTask(cb.dataset.check!);
			return;
		}
		const lens = target.closest<HTMLElement>("[data-lens]");
		if (lens && lens.tagName === "BUTTON") return this.setLens(lens.dataset.lens as HomeLens);
		const tagsel = target.closest<HTMLElement>("[data-tagsel]");
		if (tagsel) {
			this.page = { kind: "tag", tag: tagsel.dataset.tagsel! };
			this.render();
			this.host.navigate(this.getState());
			return;
		}
		const crumb = target.closest<HTMLElement>("[data-crumb]");
		if (crumb) return this.crumb(crumb.dataset.crumb!);
		if (target.closest("[data-up]")) {
			this.up();
			return;
		}
		const on = target.closest<HTMLElement>("[data-opennote]");
		if (on) return this.openNote(on.dataset.opennote!, null, e);
		const om = target.closest<HTMLElement>("[data-onmap]");
		if (om) {
			const path = om.dataset.onmap!;
			const here = this.page?.kind === "domain" ? this.page.here : undefined;
			void this.rt.openMap(path, here);
			return;
		}
		if (target.closest("[data-allnotes]")) {
			this.allNotes = true;
			this.render();
			return;
		}
		const gt = target.closest<HTMLElement>(".sk-home-gt.is-named");
		if (gt?.dataset.group) return this.groupMenu(gt.dataset.group, e);
		const item = target.closest<HTMLElement>("[data-hnav]");
		if (item) this.activate(item, e, e.ctrlKey || e.metaKey);
	}

	private onAuxClick(e: MouseEvent): void {
		if (e.button !== 1) return;
		const item = (e.target as HTMLElement)?.closest?.<HTMLElement>("[data-hnav]");
		if (!item || (this.mapBox && this.mapBox.contains(item))) return;
		const act = item.dataset.act;
		if (act === "note" || act === "task" || act === "page" || act === "block") {
			e.preventDefault();
			this.activate(item, e, true);
		}
	}

	private onContextMenu(e: MouseEvent): void {
		const target = e.target as HTMLElement;
		if (!target?.closest || (this.mapBox && this.mapBox.contains(target))) return;
		const gt = target.closest<HTMLElement>(".sk-home-gt.is-named");
		if (gt?.dataset.group) {
			e.preventDefault();
			return this.groupMenu(gt.dataset.group, e);
		}
		const dh = target.closest<HTMLElement>(".sk-home-dh");
		if (dh?.dataset.arg) {
			e.preventDefault();
			this.blockMenu(dh.dataset.arg, e, dh.querySelector<HTMLElement>("[data-menu]") ?? undefined);
		}
	}

	private crumb(target: string): void {
		if (target === "home") return this.goRoot(null);
		if (target === "tags") {
			this.lens = "tags";
			void this.rt.setLens("tags");
			return this.goRoot(null);
		}
		if (target.startsWith("group:")) {
			if (this.lens !== "domains") {
				this.lens = "domains";
				void this.rt.setLens("domains");
			}
			this.goRoot(null);
			const gt = Array.from(this.body.querySelectorAll<HTMLElement>(".sk-home-gt")).find((g) => g.dataset.group === target.slice(6));
			if (gt) {
				gt.scrollIntoView({ block: "center", behavior: reduced(this.root) ? "auto" : "smooth" });
				gt.addClass("is-flash");
				this.later(1600, () => gt.removeClass("is-flash"));
			}
			return;
		}
		if (target.startsWith("dom:")) this.go({ kind: "domain", path: target.slice(4) });
	}

	private onKey(e: KeyboardEvent): void {
		if (e.defaultPrevented || this.destroyed) return;
		const target = e.target as HTMLElement | null;
		const key = e.key;
		if (this.popup && key === "Escape") {
			e.preventDefault();
			this.closePopup(true);
			return;
		}
		if (isTyping(target)) return;
		const inMap = !!(target && this.mapBox?.contains(target));
		const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
		if (plain && key === "/") {
			e.preventDefault();
			this.toSearch();
			return;
		}
		if (plain && key === "?") {
			e.preventDefault();
			this.toggleHelp(this.foot?.querySelector<HTMLElement>(".sk-home-help") ?? null);
			return;
		}
		// The keyboard on the Home itself (after Esc in the empty search field, or a click on an empty
		// spot): a typed character starts a search, it is not a shortcut (T would open today's note and
		// the rest of the word would land in it).
		if (target === this.root && this.inline && !this.touch && typesInSearch(key, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, composing: e.isComposing })) {
			e.preventDefault();
			this.toSearch();
			this.typeInSearch(key);
			return;
		}
		if (plain && (key === "t" || key === "T")) {
			e.preventDefault();
			void this.rt.openDaily(undefined, (path) => this.openNote(path, null));
			return;
		}
		if (inMap) return;
		const lensBtn = target?.closest?.<HTMLElement>(".sk-home-lens-segm [data-lens]");
		if (lensBtn && plain) {
			const i = LENSES.indexOf(lensBtn.dataset.lens as HomeLens);
			if (key === "ArrowLeft" || key === "ArrowRight") {
				e.preventDefault();
				const j = Math.max(0, Math.min(LENSES.length - 1, i + (key === "ArrowRight" ? 1 : -1)));
				this.setLens(LENSES[j], true);
				return;
			}
			if (key === "ArrowDown") {
				e.preventDefault();
				this.enterLens();
				return;
			}
			return;
		}
		const item = this.current(target);
		if ((e.ctrlKey || e.metaKey) && !e.altKey && key === "Enter") {
			if (item) {
				e.preventDefault();
				this.activate(item, e, true);
			}
			return;
		}
		if ((key === "F10" && e.shiftKey) || key === "ContextMenu") {
			const db = item?.closest<HTMLElement>(".sk-home-db");
			const id = db?.dataset.blk ?? this.body.querySelector<HTMLElement>(".sk-home-ph [data-menu]")?.dataset.menu;
			if (id) {
				e.preventDefault();
				this.blockMenu(id, e, db?.querySelector<HTMLElement>("[data-menu]") ?? this.body.querySelector<HTMLElement>(".sk-home-ph [data-menu]") ?? undefined);
			}
			return;
		}
		if (!plain) return;
		switch (key) {
			case "p":
			case "P":
				if (!item) return;
				e.preventDefault();
				if (item.dataset.pin) void this.togglePin(item.dataset.pin, item);
				else this.rt.ctx.toast(this.t("pins.only-notes"));
				return;
			case "ArrowDown":
			case "ArrowUp":
			case "ArrowLeft":
			case "ArrowRight": {
				e.preventDefault();
				const dir = key.slice(5).toLowerCase() as "up" | "down" | "left" | "right";
				const moved = this.surface.move(dir);
				if (!moved && dir === "up" && !this.page && this.inline && !this.touch) {
					this.surface.clear();
					this.scroller.scrollTo({ top: 0, behavior: reduced(this.root) ? "auto" : "smooth" });
					this.input.focus({ preventScroll: true });
				}
				return;
			}
			case "Enter":
				if (item) {
					e.preventDefault();
					this.activate(item, e);
				}
				return;
			case " ":
				if (item?.dataset.act === "task") {
					e.preventDefault();
					void this.toggleTask(item.dataset.arg!);
				}
				return;
			case "Escape":
				e.preventDefault();
				if (this.page) {
					this.up();
					return;
				}
				if (this.inline && !this.touch) {
					this.surface.clear();
					this.scroller.scrollTo({ top: 0, behavior: reduced(this.root) ? "auto" : "smooth" });
					this.input.focus({ preventScroll: true });
				}
				return;
		}
	}

	/** The item under the cursor, else the focused one. */
	private current(target: HTMLElement | null): HTMLElement | null {
		const hi = this.surface.current;
		if (hi && this.body.contains(hi)) return hi;
		const focused = target?.closest?.<HTMLElement>("[data-hnav]");
		return focused && this.body.contains(focused) ? focused : null;
	}

	private resized(): void {
		if (this.destroyed) return;
		if (this.stale && this.root.isShown()) {
			this.stale = false;
			this.render();
		}
		this.placeThumbs();
		this.surface.repaint(true);
		this.map?.layout();
		try {
			this.inline?.layout();
		} catch {
			/* the search redraws by itself */
		}
	}

	// ----- help bar, "?" panels -----

	private updateHint(): void {
		const el = this.hintEl;
		if (!el) return;
		el.empty();
		const esc = this.t("keys.esc");
		let keys: Array<[string[], string]>;
		if (this.searching) keys = [[["↑", "↓"], "keys.choose"], [["↵"], "keys.open"], [["Tab"], "keys.actions"]];
		else if (this.page) keys = [[[esc], "keys.up"], [["↵"], "keys.open"], [["P"], "keys.pin"]];
		else if (this.lens === "map" && this.rt.layout().order.length) keys = [[["→"], "keys.unfold"], [["↵"], "keys.open"], [[esc], "keys.up"]];
		else keys = [[[this.rt.search() ? "/" : "↑↓"], this.rt.search() ? "keys.search" : "help.move"], [["↵"], "keys.open"], [["P"], "keys.pin"]];
		for (const [combo, label] of keys) {
			const span = el.createSpan();
			for (const k of combo) span.createEl("kbd", { text: k });
			span.createSpan({ text: this.t(label) });
		}
	}

	private openPopup(anchor: HTMLElement | null, cls: string, build: (el: HTMLElement) => void): void {
		this.closePopup();
		const el = this.root.createDiv({ cls: `sk-home-pop ${cls}`, attr: { role: "dialog", tabindex: "-1" } });
		build(el);
		const box = this.root.getBoundingClientRect();
		const a = (anchor ?? this.root).getBoundingClientRect();
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		let x = anchor ? a.right - box.left - w : (box.width - w) / 2;
		if (cls.includes("is-map")) x = a.left - box.left - 12;
		x = Math.max(8, Math.min(box.width - w - 8, x));
		let y = anchor ? a.top - box.top - h - 8 : 40;
		let below = false;
		if (y < 8) {
			y = a.bottom - box.top + 8;
			below = true;
		}
		y = Math.max(8, Math.min(box.height - h - 8, y));
		el.style.left = `${x}px`;
		el.style.top = `${y}px`;
		el.style.transformOrigin = below ? "top left" : "bottom right";
		anchor?.setAttr("aria-expanded", "true");
		const prev = this.doc.activeElement as HTMLElement | null;
		this.popup = {
			el,
			anchor,
			close: () => {
				el.remove();
				anchor?.setAttr("aria-expanded", "false");
				if (prev && prev.isConnected && this.root.contains(prev)) prev.focus({ preventScroll: true });
			},
		};
		el.focus({ preventScroll: true });
	}

	private closePopup(restore = false): void {
		const popup = this.popup;
		this.popup = null;
		if (!popup) return;
		if (restore) popup.close();
		else {
			popup.el.remove();
			popup.anchor?.setAttr("aria-expanded", "false");
		}
		this.catchUp();
	}

	private onOutside(e: PointerEvent): void {
		const popup = this.popup;
		if (!popup) return;
		const target = e.target as Node | null;
		if (target && (popup.el.contains(target) || popup.anchor?.contains(target))) return;
		this.closePopup();
	}

	private toggleHelp(anchor: HTMLElement | null): void {
		if (this.popup?.el.hasClass("is-keys")) {
			this.closePopup(true);
			return;
		}
		const mod = Platform.isMacOS ? "Cmd" : "Ctrl";
		const shift = this.t("keys.shift");
		const esc = this.t("keys.esc");
		this.openPopup(anchor, "is-keys", (el) => {
			const row = (label: string, ...keys: string[]) => {
				const r = el.createDiv({ cls: "sk-home-hrow" });
				r.createSpan({ text: label });
				const k = r.createSpan();
				for (const key of keys) k.createEl("kbd", { text: key });
			};
			el.createEl("h4", { text: this.t("help.home") });
			if (this.rt.search()) row(this.t("help.search-key"), "/");
			row(this.t("help.move"), "↑", "↓", "←", "→");
			row(this.t("help.next-section"), "Tab");
			row(this.t("help.open"), "↵");
			row(this.t("help.open-tab"), mod, "↵");
			row(this.t("help.pin"), "P");
			row(this.t("help.check"), this.t("keys.space"));
			row(this.t("help.daily"), "T");
			row(this.t("help.up"), esc);
			row(this.t("help.arrange"), shift, "F10");
			row(this.t("help.tabs"), Platform.isMacOS ? "Option" : "Alt", "1 2 3");
			el.createEl("h4", { text: this.t("help.map") });
			row(this.t("help.map-column"), "↑", "↓");
			row(this.t("help.map-in"), "→");
			row(this.t("help.map-out"), "←");
			row(this.t("help.open"), "↵");
			row(this.t("help.map-recenter"), "↵ " + this.t("keys.held"));
			row(this.t("help.open-tab"), mod, "↵");
			row(this.t("help.map-up"), esc);
			row(this.t("help.pin"), "P");
			row(this.t("help.map-menu"), shift, "F10");
			const read = el.createDiv({ cls: "sk-home-hrow" });
			read.createSpan({ text: this.t("help.map-read") });
			const b = read.createSpan().createEl("button", { cls: "sk-btn is-ghost is-s", attr: { type: "button" } });
			setIcon(b.createSpan(), "circle-help");
			b.createSpan({ text: this.t("help.read") });
			b.addEventListener("click", () => this.toggleMapHelp(anchor));
			if (this.rt.search()) {
				el.createEl("h4", { text: this.t("help.search") });
				row(this.t("help.s-choose"), "↑", "↓");
				row(this.t("help.open"), "↵");
				row(this.t("help.open-tab"), mod, "↵");
				row(this.t("help.s-insert"), shift, "↵");
				row(this.t("help.s-actions"), "Tab");
				row(this.t("help.s-filter"), "#tag", "in:");
				row(this.t("help.s-remove"), "⌫");
				row(this.t("help.s-close"), esc);
			}
		});
	}

	private toggleMapHelp(anchor: HTMLElement | null): void {
		if (this.popup?.el.hasClass("is-map")) {
			this.closePopup(true);
			return;
		}
		const places = this.rt.ctx.places;
		const home = places.homePath();
		const chosen = !!home && !!this.rt.settings.homePage;
		const folders = splitList(this.rt.settings.ignoredFolders);
		this.openPopup(anchor, "is-map", (el) => {
			el.createEl("h4", { text: this.t("map.panel-title") });
			const ul = el.createEl("ul");
			ul.createEl("li").append(rich(this.t("map.panel-parent")));
			const homeName = home ? this.name(home) : "";
			ul.createEl("li").append(rich(this.t(home ? (chosen ? "map.panel-home-chosen" : "map.panel-home-found") : "map.panel-home-none", { name: homeName })));
			ul.createEl("li").append(rich(this.t("map.panel-orphans")));
			ul.createEl("li").append(rich(folders.length ? this.t("map.panel-ignored", { folders: folders.join(", ") }) : this.t("map.panel-loops")));
			ul.createEl("li").append(rich(this.t("map.panel-write")));
			const f = el.createDiv({ cls: "sk-home-pop-f" });
			const b = f.createEl("button", { cls: "sk-btn is-s", attr: { type: "button" } });
			setIcon(b.createSpan(), "settings");
			b.createSpan({ text: this.t("map.panel-settings") });
			b.addEventListener("click", () => {
				this.closePopup();
				this.rt.ctx.plugin.openSettings("home");
			});
		});
	}
}

/** Backticks become <code>, as in the settings pages. */
function rich(text: string): DocumentFragment {
	const fragment = createFragment();
	text.split(/(`[^`]+`)/).forEach((part) => {
		if (part.startsWith("`") && part.endsWith("`") && part.length > 1) fragment.createEl("code", { text: part.slice(1, -1) });
		else if (part) fragment.appendText(part);
	});
	return fragment;
}

function splitList(text: string): string[] {
	return String(text ?? "")
		.split(",")
		.map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
		.filter(Boolean);
}

function folderOf(path: string): string {
	const at = path.lastIndexOf("/");
	return at > 0 ? path.slice(0, at) : "";
}

/** Tasks with a date first (soonest first), then the others in note order. */
function sortTasks(tasks: TaskInfoLite[]): TaskInfoLite[] {
	return [...tasks].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.path.localeCompare(b.path) || a.line - b.line);
}

function cssEscape(value: string): string {
	return value.replace(/["\\]/g, "\\$&");
}

/** A submenu where Obsidian has them, else the items in a section of the menu. */
function submenu(menu: Menu, title: string, icon: string, items: Array<{ title: string; icon: string; run: () => void }>): void {
	let inline = false;
	menu.addItem((item) => {
		item.setTitle(title).setIcon(icon);
		const sub = (item as unknown as { setSubmenu?(): Menu }).setSubmenu?.();
		if (sub) {
			for (const entry of items) sub.addItem((i) => i.setTitle(entry.title).setIcon(entry.icon).onClick(entry.run));
		} else {
			inline = true;
			item.setDisabled(true);
		}
	});
	if (inline) for (const entry of items) menu.addItem((i) => i.setTitle(entry.title).setIcon(entry.icon).onClick(entry.run));
}

/** The first lines of text of a note (no properties, headings, links or markup), for a card. */
async function excerptOf(app: App, file: TFile): Promise<string> {
	try {
		const text = await app.vault.cachedRead(file);
		const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
		const out: string[] = [];
		for (const raw of body.split(/\r?\n/)) {
			const line = raw.trim();
			if (!line || /^(#|```|---|>|\||!\[)/.test(line)) {
				if (out.length) break;
				continue;
			}
			out.push(
				line
					.replace(/^[-*+]\s+(\[.\]\s+)?/, "")
					.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b ?? a.split("/").pop() ?? a)
					.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
					.replace(/[*_`~=]+/g, "")
					.replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, "$1")
					.trim(),
			);
			if (out.join(" ").length > 220) break;
		}
		return out.join(" ").slice(0, 240);
	} catch {
		return "";
	}
}

/** A small window that asks for a name (a group). */
class NameModal extends Modal {
	constructor(
		app: App,
		private readonly title: string,
		private readonly value: string,
		private readonly placeholder: string,
		private readonly labels: { ok: string; cancel: string },
		private readonly done: (value: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("sk-home-name-modal");
		this.titleEl.setText(this.title);
		const input = this.contentEl.createEl("input", { cls: "sk-home-name-input", attr: { type: "text", placeholder: this.placeholder, spellcheck: "false" } });
		input.value = this.value;
		const buttons = this.contentEl.createDiv({ cls: "sk-home-name-buttons" });
		const cancel = buttons.createEl("button", { cls: "sk-btn is-ghost", text: this.labels.cancel, attr: { type: "button" } });
		const ok = buttons.createEl("button", { cls: "sk-btn is-primary", text: this.labels.ok, attr: { type: "button" } });
		const submit = () => {
			const value = input.value.trim();
			if (!value) {
				input.focus();
				return;
			}
			this.close();
			this.done(value);
		};
		cancel.addEventListener("click", () => this.close());
		ok.addEventListener("click", submit);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.isComposing) {
				e.preventDefault();
				submit();
			}
		});
		input.win.setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
