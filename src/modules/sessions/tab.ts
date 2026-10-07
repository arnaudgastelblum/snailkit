// The Brainstorms tab of the Workbench (a view of the core, there with or without the Tasks
// module): a sorting desk. A timeline, a search, filters and contexts, the list (pinned first,
// then newest first), and, when the Workbench is a page, the detail of the selected brainstorm on
// the right: where it stands, its tasks, what is left to decide, the ideas without follow-up, and
// the actions (open, pin, context, archive, delete). In the side panel and on phones, the list
// alone, the actions in a menu.
// The data comes from the runtime; the logic lives in atelier.ts.
import { MarkdownView, Menu, Platform, Scope, setIcon, TFile } from "obsidian";
import { ago, contextsOf, FILTERS, filterCounts, filterSessions, layoutTimeline, searchable, stateOf, tabCount, tabTone, type SessionFilter, type SessionInfo } from "./atelier";
import { capsule } from "./capsule";
import { hhmm, isTagName, type SummaryQuestion } from "./logic";
import type { SessionsRuntime } from "./runtime";
import type { ViewTab, ViewTabHost, ViewTabInstance } from "./types";

const TIMELINE_KEY = "snailkit-sessions-timeline";

/** The tab as the Workbench knows it, and the views it has mounted. */
export class SessionsTab {
	private readonly views = new Set<TabView>();
	private timer = 0;
	private lastCount: number | null = null;

	constructor(private rt: SessionsRuntime) {}

	definition(): ViewTab {
		return {
			id: "sessions",
			icon: "zap",
			label: this.rt.ctx.t("tab.label"),
			count: () => tabCount(this.rt.sessionInfos()),
			countTone: () => tabTone(this.rt.sessionInfos()),
			mount: (el, host) => {
				const view: TabView = new TabView(this.rt, el, host, () => this.views.delete(view));
				this.views.add(view);
				return view;
			},
		};
	}

	/** A session changed: the views redraw soon, the count of the tab follows. */
	changed(): void {
		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			if (this.rt.stopped) return;
			this.rt.notifyChange();
			for (const view of this.views) view.host.refresh();
			const count = tabCount(this.rt.sessionInfos());
			if (count !== this.lastCount) {
				this.lastCount = count;
				this.rt.refreshWorkbench();
			}
		}, 200);
	}

	/** A session was renamed: the selection follows it. */
	renamed(from: string, to: string): void {
		for (const view of this.views) view.renamed(from, to);
	}

	destroyAll(): void {
		window.clearTimeout(this.timer);
		for (const view of [...this.views]) view.destroy();
	}
}

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

class TabView implements ViewTabInstance {
	private filter: SessionFilter = "all";
	private context: string | null = null;
	private query = "";
	/** The selected session (its detail on the right, page layout). */
	private selected: string | null = null;
	/** The session whose deletion waits for a confirmation. */
	private confirming: string | null = null;
	/** A rename field or the context window is open: redraws wait. */
	private editing = false;
	private pending = false;
	private root: HTMLElement;
	private main: HTMLElement;
	private search: HTMLInputElement;
	private timeline: HTMLElement;
	private track: HTMLElement;
	private tip: HTMLElement;
	private filtersEl: HTMLElement;
	private thumb: HTMLElement;
	private contextsEl: HTMLElement;
	private resize: ResizeObserver | null = null;
	private list: HTMLElement;
	private detail: HTMLElement | null = null;
	private timelineBtn: HTMLElement;
	private showTimeline: boolean;
	private first = true;
	private destroyed = false;
	private pop: { el: HTMLElement; close: () => void } | null = null;
	private longPress = 0;
	private timers = new Set<number>();
	/** Ctrl/Cmd+F is an Obsidian hotkey: while the tab has the focus, ours goes first. */
	private keyScope: Scope;
	private scoped = false;
	/** Page layout on a computer: list and detail side by side. */
	private readonly desk: boolean;

	constructor(private rt: SessionsRuntime, el: HTMLElement, readonly host: ViewTabHost, private onDestroy: () => void) {
		const t = (k: string) => rt.ctx.t(k);
		this.desk = host.layout === "page" && !Platform.isPhone;
		this.root = el.createDiv({ cls: "sk-sessions-tab", attr: { "data-layout": host.layout } });
		// Focusable (not in the Tab order): the Workbench gives it the focus, so "/" and Ctrl/Cmd+F reach the tab.
		this.root.tabIndex = -1;
		this.root.toggleClass("is-phone", Platform.isPhone);
		this.root.toggleClass("is-desk", this.desk);
		this.main = this.desk ? this.root.createDiv({ cls: "sk-sessions-desk-main" }) : this.root;
		const top = this.desk ? this.main.createDiv({ cls: "sk-sessions-desk-top" }) : this.root;

		const head = top.createDiv({ cls: "sk-sessions-tab-head" });
		const searchBox = head.createDiv({ cls: "sk-sessions-tab-search" });
		setIcon(searchBox.createSpan({ cls: "sk-sessions-tab-search-icon" }), "search");
		this.search = searchBox.createEl("input", { attr: { type: "search", placeholder: t("tab.search"), "aria-label": t("tab.search"), spellcheck: "false" } });
		if (this.desk) searchBox.createEl("kbd", { cls: "sk-sessions-kbd", text: "/" });
		const narrow = host.layout === "side";
		this.timelineBtn = head.createEl("button", { cls: "sk-btn is-ghost is-icon sk-sessions-tl-toggle", attr: { type: "button" } });
		setIcon(this.timelineBtn, "chart-no-axes-gantt");
		this.timelineBtn.addEventListener("click", () => {
			this.showTimeline = !this.showTimeline;
			try {
				rt.app.saveLocalStorage(TIMELINE_KEY, this.showTimeline ? "shown" : "hidden");
			} catch {
				/* not kept */
			}
			this.render();
		});
		// A soft button: the Workbench keeps its one primary action for itself.
		const add = head.createEl("button", { cls: "sk-btn sk-sessions-tab-new" + (narrow ? " is-icon" : ""), attr: { type: "button", "aria-label": t("tab.new") } });
		setIcon(add, "zap");
		if (!narrow) add.createSpan({ text: t("tab.new") });
		add.addEventListener("click", () => void rt.startSession());

		let saved: unknown = null;
		try {
			saved = rt.app.loadLocalStorage(TIMELINE_KEY);
		} catch {
			/* none */
		}
		const tall = (el.ownerDocument.defaultView?.innerHeight ?? 900) >= 640;
		this.showTimeline = saved === "shown" ? true : saved === "hidden" ? false : tall;

		this.timeline = top.createDiv({ cls: "sk-sessions-tl", attr: { role: "group", "aria-label": t("tab.timeline") } });
		this.track = this.timeline.createDiv({ cls: "sk-sessions-tl-track" });
		this.tip = this.root.createDiv({ cls: "sk-sessions-tl-tip" });

		const bar = top.createDiv({ cls: "sk-sessions-tab-bar" });
		this.filtersEl = bar.createDiv({ cls: "sk-segm sk-sessions-tab-filters", attr: { role: "tablist" } });
		this.thumb = this.filtersEl.createDiv({ cls: "sk-segm-thumb" });
		this.contextsEl = bar.createDiv({ cls: "sk-sessions-contexts", attr: { role: "group", "aria-label": t("tab.contexts") } });
		this.list = this.main.createDiv({ cls: "sk-sessions-tab-list", attr: { role: "listbox", "aria-label": t("tab.list") } });
		if (this.desk) {
			this.helpBar(this.main.createDiv({ cls: "sk-sessions-desk-foot" }));
			this.detail = this.root.createDiv({ cls: "sk-sessions-detail", attr: { role: "region", "aria-label": t("desk.label") } });
		}
		if (typeof ResizeObserver === "function") {
			this.resize = new ResizeObserver(() => this.placeThumb(false));
			this.resize.observe(this.filtersEl);
		}

		this.search.addEventListener("input", () => {
			this.query = this.search.value;
			this.render();
		});
		this.search.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				if (this.search.value) {
					this.search.value = "";
					this.query = "";
					this.render();
				} else this.search.blur();
			} else if (e.key === "ArrowDown" || e.key === "Enter") {
				e.preventDefault();
				this.focusRow(0);
			}
		});
		this.root.addEventListener("keydown", (e) => {
			const typing = e.target instanceof HTMLInputElement || (e.target instanceof HTMLElement && e.target.isContentEditable);
			if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f")) {
				e.preventDefault();
				e.stopPropagation();
				this.search.focus();
				this.search.select();
			}
		});
		this.list.addEventListener("keydown", (e) => this.onListKey(e));
		this.keyScope = new Scope(rt.app.scope);
		this.keyScope.register(["Mod"], "f", () => {
			this.search.focus();
			this.search.select();
			return false;
		});
		// F2 is Obsidian's "Rename file": in the list, it renames the brainstorm under the cursor.
		this.keyScope.register([], "F2", (e) => {
			const row = (this.doc.activeElement as HTMLElement | null)?.closest?.(".sk-sessions-row") as HTMLElement | null;
			const path = row?.dataset.path ?? (this.desk && this.detail?.contains(this.doc.activeElement) ? this.selected : null);
			if (!path || e.target instanceof HTMLInputElement) return;
			this.startRename(path);
			return false;
		});
		this.root.addEventListener("focusin", () => this.syncScope());
		this.root.addEventListener("focusout", () => this.later(() => this.syncScope(), 0));
		this.render();
	}

	update(): void {
		if (!this.destroyed) this.render();
	}

	/** A rename field or the context window is open: a change of layout of the Workbench waits for it. */
	busy(): boolean {
		return !this.destroyed && this.editing;
	}

	/** The Workbench was revealed or this tab chosen: the keyboard acts on the tab ("/", Ctrl/Cmd+F). */
	focus(): void {
		if (this.destroyed || this.root.contains(this.doc.activeElement)) return;
		this.root.focus({ preventScroll: true });
	}

	renamed(from: string, to: string): void {
		if (this.selected === from) this.selected = to;
		if (this.confirming === from) this.confirming = to;
		const row = this.rowOf(from);
		if (row) {
			row.dataset.path = to;
			row.dataset.focusKey = `row:${to}`;
		}
	}

	private later(fn: () => void, ms: number): void {
		const id = window.setTimeout(() => {
			this.timers.delete(id);
			if (!this.destroyed) fn();
		}, ms);
		this.timers.add(id);
	}

	private syncScope(): void {
		const want = !this.destroyed && this.root.isConnected && this.root.contains(this.doc.activeElement);
		if (want === this.scoped) return;
		this.scoped = want;
		if (want) this.rt.app.keymap.pushScope(this.keyScope);
		else this.rt.app.keymap.popScope(this.keyScope);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.pop?.close();
		for (const id of this.timers) window.clearTimeout(id);
		window.clearTimeout(this.longPress);
		if (this.scoped) this.rt.app.keymap.popScope(this.keyScope);
		this.scoped = false;
		this.resize?.disconnect();
		this.root.remove();
		this.onDestroy();
	}

	// ----- drawing -----

	private get doc(): Document {
		return this.root.ownerDocument;
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.rt.ctx.t(key, vars);
	}

	private info(path: string): SessionInfo | null {
		return this.rt.sessionInfos().find((s) => s.path === path) ?? null;
	}

	private shown(all: SessionInfo[] = this.rt.sessionInfos()): SessionInfo[] {
		return filterSessions(all, this.filter, this.query, this.context);
	}

	/**
	 * Draws everything again. The control that had the focus (a filter, a bubble, a row) gets it
	 * back, or the closest one when it is gone; then our keyboard scope follows where the focus is.
	 * While a rename field or the context window is open, the redraw waits for it to close.
	 */
	private render(): void {
		if (this.destroyed) return;
		if (this.editing) {
			this.pending = true;
			return;
		}
		this.pending = false;
		const before = this.doc.activeElement as HTMLElement | null;
		const had = !!before && this.root.contains(before);
		const key = had ? before!.dataset.focusKey ?? null : null;
		const all = this.rt.sessionInfos();
		const contexts = contextsOf(all.filter((s) => (this.filter === "archived" ? s.archived : !s.archived)));
		if (this.context && !contexts.some((c) => c.toLowerCase() === this.context!.toLowerCase())) this.context = null;
		const shown = this.shown(all);
		if (this.desk && (!this.selected || !shown.some((s) => s.path === this.selected))) this.selected = shown[0]?.path ?? null;
		if (this.confirming && !all.some((s) => s.path === this.confirming)) this.confirming = null;
		this.renderFilters(all);
		this.renderContexts(contexts);
		this.timeline.toggleClass("is-hidden", !this.showTimeline);
		this.timelineBtn.toggleClass("is-on", this.showTimeline);
		this.timelineBtn.setAttr("aria-label", this.t(this.showTimeline ? "tab.timeline-hide" : "tab.timeline-show"));
		this.timelineBtn.setAttr("aria-pressed", String(this.showTimeline));
		if (this.showTimeline) this.renderTimeline(all.filter((s) => (this.filter === "archived" ? true : !s.archived)), new Set(shown.map((s) => s.path)));
		this.renderList(all, shown);
		this.renderDetail();
		if (had && !this.root.contains(this.doc.activeElement)) {
			const same = key ? (Array.from(this.root.querySelectorAll("[data-focus-key]")) as HTMLElement[]).find((el) => el.dataset.focusKey === key) : null;
			if (same) same.focus({ preventScroll: true });
			else if (key?.startsWith("row:") || key?.startsWith("det:")) this.focusRow(this.selectedIndex());
			else this.search.focus({ preventScroll: true });
		}
		this.syncScope();
	}

	private selectedIndex(): number {
		const rows = this.rows();
		return Math.max(0, rows.findIndex((r) => r.dataset.path === this.selected));
	}

	/** The filters as a segmented control: the thumb slides under the active one. */
	private renderFilters(all: SessionInfo[]): void {
		const counts = filterCounts(all);
		for (const el of Array.from(this.filtersEl.children)) if (el !== this.thumb) el.remove();
		for (const f of FILTERS) {
			if (f === "archived" && !counts.archived && this.filter !== "archived") continue;
			const b = this.filtersEl.createEl("button", { cls: `sk-btn sk-sessions-filter is-${f}`, attr: { type: "button", role: "tab", "aria-selected": String(f === this.filter), "data-focus-key": `filter:${f}` } });
			b.createSpan({ text: this.t(`tab.filter-${f}`) });
			b.createSpan({ cls: "sk-sessions-filter-count", text: String(counts[f]) });
			b.addEventListener("click", () => {
				this.filter = f;
				this.render();
			});
		}
		this.placeThumb(!this.thumbPlaced);
	}
	private thumbPlaced = false;

	/** Moves the thumb under the active filter; `snap` moves it at once (first drawing, resize). */
	private placeThumb(snap: boolean): void {
		if (this.destroyed) return;
		const active = this.filtersEl.querySelector('.sk-sessions-filter[aria-selected="true"]') as HTMLElement | null;
		if (!active || !active.offsetWidth) return;
		const thumb = this.thumb;
		if (snap) thumb.style.transition = "none";
		thumb.style.width = `${active.offsetWidth}px`;
		thumb.style.transform = `translateX(${active.offsetLeft}px)`;
		if (snap) {
			void thumb.offsetWidth;
			thumb.style.transition = "";
		}
		this.thumbPlaced = true;
	}

	/** Chips of the contexts present: All, then each one. Hidden when no session has a context. */
	private renderContexts(contexts: string[]): void {
		const el = this.contextsEl;
		el.empty();
		el.toggleClass("is-empty", !contexts.length);
		if (!contexts.length) return;
		const chip = (label: string | null) => {
			const on = label === null ? this.context === null : this.context?.toLowerCase() === label.toLowerCase();
			const b = el.createEl("button", { cls: "sk-btn is-s sk-sessions-ctx-chip" + (on ? " is-on" : ""), attr: { type: "button", "aria-pressed": String(on), "data-focus-key": `ctx:${label ?? ""}` } });
			if (label === null) b.createSpan({ text: this.t("tab.all-contexts") });
			else {
				b.createSpan({ cls: "sk-sessions-ctx-hash", text: "#" });
				b.createSpan({ text: label });
				const cls = this.rt.tagClasses(label);
				if (cls) b.addClasses(cls.split(/\s+/).filter(Boolean));
			}
			b.addEventListener("click", () => {
				this.context = label;
				this.render();
			});
		};
		chip(null);
		for (const c of contexts) chip(c);
	}

	private renderTimeline(all: SessionInfo[], shown: Set<string>): void {
		const perDay = this.host.layout === "page" && !Platform.isPhone ? 30 : 20;
		const tl = layoutTimeline(all, Date.now(), perDay, 21, this.timeline.clientWidth);
		const keep = this.timeline.scrollLeft;
		const atEnd = this.first || keep + this.timeline.clientWidth >= this.track.scrollWidth - 4;
		this.track.empty();
		this.track.style.width = `${tl.width}px`;
		this.track.style.height = `${tl.height + 38}px`;
		this.track.createDiv({ cls: "sk-sessions-tl-axis" });
		const label = new Intl.DateTimeFormat(this.rt.ctx.lang, { day: "numeric", month: "short" });
		for (const d of tl.days) {
			const tick = this.track.createDiv({ cls: "sk-sessions-tl-tick" + (d.month ? " is-month" : "") + (d.label ? " is-label" : "") });
			tick.style.left = `${d.x}px`;
			if (d.label && !d.today) tick.createSpan({ cls: "sk-sessions-tl-date", text: label.format(d.date).replace(/\.$/, "") });
		}
		const today = this.track.createDiv({ cls: "sk-sessions-tl-today" });
		today.style.left = `${tl.now}px`;
		today.createSpan({ cls: "sk-sessions-tl-date", text: this.t("tab.today") });
		const byPath = new Map(all.map((s) => [s.path, s]));
		tl.bubbles.forEach((b, i) => {
			const s = byPath.get(b.path)!;
			// Its own tip shows on hover; the description is for screen readers only (an aria-label would add Obsidian's tooltip).
			const el = this.track.createEl("button", { cls: `sk-sessions-bubble is-${b.state}`, attr: { type: "button", "data-focus-key": `bubble:${b.path}` } });
			el.createSpan({ cls: "sk-sessions-sr", text: this.describe(s) });
			el.style.left = `${b.x - b.r}px`;
			el.style.bottom = `${30 + b.y - b.r}px`;
			el.style.width = el.style.height = `${2 * b.r}px`;
			el.style.animationDelay = this.first ? `${Math.min(600, i * 25)}ms` : "0ms";
			el.toggleClass("is-dim", !shown.has(b.path));
			el.toggleClass("is-selected", this.desk && this.selected === b.path);
			el.addEventListener("click", (e) => {
				if (this.desk && !(e.ctrlKey || e.metaKey) && shown.has(b.path)) {
					this.select(b.path, true);
					return;
				}
				this.host.open(b.path, null, e);
			});
			const show = () => this.showTip(el, s);
			el.addEventListener("pointerenter", show);
			el.addEventListener("focus", show);
			el.addEventListener("pointerleave", () => this.tip.removeClass("is-shown"));
			el.addEventListener("blur", () => this.tip.removeClass("is-shown"));
		});
		this.timeline.scrollLeft = atEnd ? this.track.scrollWidth : keep;
		this.first = false;
	}

	private showTip(el: HTMLElement, s: SessionInfo): void {
		this.tip.empty();
		this.tip.createDiv({ cls: "sk-sessions-tl-tip-title", text: s.title });
		this.tip.createDiv({ cls: "sk-sessions-tl-tip-counts", text: this.counts(s) });
		const r = el.getBoundingClientRect();
		const box = this.root.getBoundingClientRect();
		this.tip.addClass("is-shown");
		const w = this.tip.offsetWidth;
		const left = Math.max(4, Math.min(box.width - w - 4, r.left - box.left + r.width / 2 - w / 2));
		this.tip.style.left = `${left}px`;
		this.tip.style.top = `${r.top - box.top - this.tip.offsetHeight - 8}px`;
	}

	/** "5 ideas · 1/3 tasks · 1 to decide" (the last part only when lines wait). */
	private counts(s: SessionInfo): string {
		const { ctx } = this.rt;
		const parts = [ctx.tn("ideas", s.ideas)];
		if (s.tasks) parts.push(ctx.tn("desk.tasks-done", s.tasks, { done: s.done ?? 0 }));
		if (s.undecided) parts.push(ctx.tn("decide", s.undecided));
		return parts.join(" · ");
	}

	private describe(s: SessionInfo): string {
		return `${s.title}, ${this.counts(s)}, ${this.t(`tab.state-${stateOf(s)}`)}`;
	}

	private renderList(all: SessionInfo[], shown: SessionInfo[]): void {
		const scroll = this.list.scrollTop;
		this.list.empty();
		if (!all.length) {
			this.list.createDiv({ cls: "sk-sessions-tab-empty", text: this.t("tab.empty") });
			return;
		}
		if (!shown.length) {
			this.list.createDiv({ cls: "sk-sessions-tab-empty", text: this.t(this.filter === "archived" ? "tab.none-archived" : "tab.none") });
			return;
		}
		const date = new Intl.DateTimeFormat(this.rt.ctx.lang, { weekday: "short", day: "numeric", month: "short" });
		const pinned = shown.some((s) => s.pin !== null && s.pin !== undefined);
		let section: "pinned" | "rest" | null = null;
		const focusable = this.desk ? this.selected : shown[0].path;
		for (const s of shown) {
			const isPinned = s.pin !== null && s.pin !== undefined;
			if (pinned && section !== (isPinned ? "pinned" : "rest")) {
				section = isPinned ? "pinned" : "rest";
				const h = this.list.createDiv({ cls: "sk-sessions-section", attr: { role: "presentation" } });
				if (isPinned) setIcon(h.createSpan({ cls: "sk-sessions-section-icon" }), "pin");
				h.createSpan({ text: this.t(isPinned ? "tab.pinned" : "tab.recent") });
			}
			this.row(s, date, s.path === focusable);
		}
		this.list.scrollTop = scroll;
	}

	private row(s: SessionInfo, date: Intl.DateTimeFormat, tabbable: boolean): void {
		const state = stateOf(s);
		const selected = this.desk && this.selected === s.path;
		const row = this.list.createDiv({
			cls: `sk-sessions-row is-${state}` + (selected ? " is-selected" : "") + (s.archived ? " is-archived" : ""),
			attr: { role: "option", tabindex: tabbable ? "0" : "-1", "aria-selected": String(selected), "data-path": s.path, "data-focus-key": `row:${s.path}` },
		});
		const dot = row.createSpan({ cls: "sk-sessions-row-dot" });
		if (state === "triage") dot.setAttr("aria-label", this.t("tab.state-triage"));
		const main = row.createDiv({ cls: "sk-sessions-row-main" });
		const titleLine = main.createDiv({ cls: "sk-sessions-row-title" });
		if (s.pin !== null && s.pin !== undefined) setIcon(titleLine.createSpan({ cls: "sk-sessions-row-pin", attr: { "aria-label": this.t("tab.pinned") } }), "pin");
		titleLine.createSpan({ cls: "sk-sessions-row-name", text: s.title });
		const meta = main.createDiv({ cls: "sk-sessions-row-meta" });
		meta.createSpan({ text: `${date.format(s.created)} · ${hhmm(new Date(s.created))}` });
		meta.createSpan({ cls: "sk-sessions-row-counts", text: this.counts(s) });
		if (s.context) {
			const ctx = (this.desk ? row : meta).createDiv({ cls: "sk-sessions-row-ctx" });
			ctx.appendChild(capsule(this.doc, s.context, this.rt.tagClasses(s.context)));
		}
		if (!this.desk) {
			const more = row.createEl("button", { cls: "sk-btn is-ghost is-icon is-s sk-sessions-row-more", attr: { type: "button", "aria-label": this.t("tab.more"), tabindex: "-1" } });
			setIcon(more, "more-horizontal");
			more.addEventListener("click", (e) => {
				e.stopPropagation();
				this.menu(s.path, e);
			});
		}
		if (this.confirming === s.path && !this.desk) this.confirmStrip(row.createDiv({ cls: "sk-sessions-row-confirm" }), s);

		row.addEventListener("click", (e) => {
			if (Date.now() < this.suppressClick) return;
			if ((e.target as HTMLElement).closest(".sk-sessions-row-confirm, input")) return;
			if (this.desk && !(e.ctrlKey || e.metaKey)) this.select(s.path, true);
			else this.host.open(s.path, null, e);
		});
		if (this.desk) row.addEventListener("dblclick", (e) => this.host.open(s.path, null, e));
		row.addEventListener("focus", () => {
			if (this.desk && this.selected !== s.path) this.select(s.path, false);
		});
		row.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this.menu(s.path, e);
		});
		// A long press opens the menu on touch screens (a click does not follow).
		row.addEventListener("pointerdown", (e) => {
			if (e.pointerType !== "touch") return;
			const x = e.clientX;
			const y = e.clientY;
			window.clearTimeout(this.longPress);
			const cancel = () => window.clearTimeout(this.longPress);
			const move = (m: PointerEvent) => {
				if (Math.hypot(m.clientX - x, m.clientY - y) > 10) cancel();
			};
			row.addEventListener("pointermove", move);
			row.addEventListener("pointerup", cancel, { once: true });
			row.addEventListener("pointercancel", cancel, { once: true });
			this.longPress = window.setTimeout(() => {
				row.removeEventListener("pointermove", move);
				this.suppressClick = Date.now() + 600;
				this.menu(s.path, null, row);
			}, 500);
		});
	}
	private suppressClick = 0;

	private rows(): HTMLElement[] {
		return Array.from(this.list.querySelectorAll(".sk-sessions-row")) as HTMLElement[];
	}

	private rowOf(path: string): HTMLElement | null {
		return this.rows().find((r) => r.dataset.path === path) ?? null;
	}

	private focusRow(i: number): void {
		const rows = this.rows();
		if (!rows.length) return;
		const target = rows[Math.max(0, Math.min(rows.length - 1, i))];
		for (const r of rows) r.setAttr("tabindex", r === target ? "0" : "-1");
		target.focus();
		target.scrollIntoView({ block: "nearest" });
	}

	/** Selects a session (page layout): its row is marked and the detail follows. */
	private select(path: string, focus: boolean): void {
		if (!this.desk) return;
		if (this.selected !== path) {
			this.selected = path;
			if (this.confirming && this.confirming !== path) this.confirming = null;
			for (const r of this.rows()) {
				const on = r.dataset.path === path;
				r.toggleClass("is-selected", on);
				r.setAttr("aria-selected", String(on));
				r.setAttr("tabindex", on ? "0" : "-1");
			}
			for (const b of Array.from(this.track.querySelectorAll(".sk-sessions-bubble")) as HTMLElement[]) b.toggleClass("is-selected", b.dataset.focusKey === `bubble:${path}`);
			this.renderDetail();
		}
		if (focus) {
			const row = this.rowOf(path);
			row?.focus({ preventScroll: true });
			row?.scrollIntoView({ block: "nearest" });
		}
	}

	private onListKey(e: KeyboardEvent): void {
		if (e.target instanceof HTMLInputElement) return;
		const rows = this.rows();
		const i = rows.indexOf(this.doc.activeElement as HTMLElement);
		if (i < 0) return;
		const path = rows[i].dataset.path!;
		const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
		const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
		let handled = true;
		if (e.key === "ArrowDown") this.focusRow(i + 1);
		else if (e.key === "ArrowUp") {
			if (i === 0) this.search.focus();
			else this.focusRow(i - 1);
		} else if (e.key === "Home") this.focusRow(0);
		else if (e.key === "End") this.focusRow(rows.length - 1);
		else if (e.key === "Enter") this.host.open(path, null, e);
		else if (e.key === "Escape" && this.confirming) {
			this.confirming = null;
			this.render();
		} else if (plain && k === "p") this.pin(path);
		else if (plain && k === "e") this.archive(path);
		else if (plain && k === "c") this.openContext(path, this.desk ? this.detail?.querySelector<HTMLElement>(".sk-sessions-det-ctx") ?? rows[i] : rows[i]);
		else if (plain && e.key === "F2") this.startRename(path);
		else if (plain && e.key === "Delete") this.askDelete(path);
		else handled = false;
		if (handled) {
			e.preventDefault();
			e.stopPropagation();
		}
	}

	// ----- actions -----

	private menu(path: string, e: MouseEvent | null, anchor?: HTMLElement): void {
		const s = this.info(path);
		if (!s) return;
		const menu = new Menu();
		menu.addItem((i) => i.setTitle(this.t("desk.open")).setIcon("file-pen-line").onClick(() => this.host.open(path, null)));
		menu.addSeparator();
		const pinned = s.pin !== null && s.pin !== undefined;
		menu.addItem((i) => i.setTitle(this.t(pinned ? "desk.unpin" : "desk.pin")).setIcon(pinned ? "pin-off" : "pin").onClick(() => this.pin(path)));
		menu.addItem((i) => i.setTitle(this.t("desk.context")).setIcon("hash").onClick(() => this.openContext(path, this.rowOf(path) ?? this.root)));
		menu.addItem((i) => i.setTitle(this.t("desk.rename")).setIcon("pencil").onClick(() => this.startRename(path)));
		menu.addItem((i) => i.setTitle(this.t(s.archived ? "desk.unarchive" : "desk.archive")).setIcon(s.archived ? "archive-restore" : "archive").onClick(() => this.archive(path)));
		menu.addSeparator();
		menu.addItem((i) => {
			i.setTitle(this.t("desk.delete")).setIcon("trash-2").onClick(() => this.askDelete(path));
			(i as unknown as { setWarning?(w: boolean): void }).setWarning?.(true);
		});
		if (e) menu.showAtMouseEvent(e);
		else if (anchor) {
			const r = anchor.getBoundingClientRect();
			menu.showAtPosition({ x: r.left + 16, y: r.bottom });
		}
	}

	private pin(path: string): void {
		const on = this.rt.togglePin(path);
		this.rt.ctx.toast(this.t(on ? "desk.pinned" : "desk.unpinned"));
		this.render();
	}

	/** The neighbour that takes the selection when `path` leaves the list. */
	private neighbour(path: string): string | null {
		const shown = this.shown();
		const i = shown.findIndex((s) => s.path === path);
		if (i < 0) return this.selected;
		return shown[i + 1]?.path ?? shown[i - 1]?.path ?? null;
	}

	private archive(path: string): void {
		const hadFocus = this.root.contains(this.doc.activeElement);
		const next = this.neighbour(path);
		const file = this.fileOf(path);
		const on = this.rt.toggleArchive(path);
		if (this.selected === path) this.selected = next;
		this.rt.ctx.toast(this.t(on ? "desk.archived" : "desk.unarchived"), {
			action: { label: this.t("common.undo"), run: () => {
				// The note may have been renamed or moved since: its current path; nothing if it is gone.
				if (!file || this.fileOf(file.path) !== file || this.destroyed) return;
				this.rt.setArchived(file.path, !on);
				this.selected = file.path;
				this.render();
			} },
		});
		this.render();
		if (hadFocus) this.focusRow(this.selectedIndex());
	}

	private fileOf(path: string): TFile | null {
		const file = this.rt.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	private askDelete(path: string): void {
		this.confirming = path;
		if (this.desk) this.select(path, false);
		this.render();
		const yes = this.root.querySelector<HTMLElement>(".sk-sessions-confirm-yes");
		yes?.focus();
	}

	private confirmStrip(el: HTMLElement, s: SessionInfo): void {
		el.addClass("sk-sessions-confirm");
		el.setAttr("role", "alertdialog");
		el.createDiv({ cls: "sk-sessions-confirm-text", text: this.t("desk.delete-ask", { title: s.title }) });
		const actions = el.createDiv({ cls: "sk-sessions-confirm-actions" });
		const no = actions.createEl("button", { cls: "sk-btn is-ghost is-s", text: this.t("common.cancel"), attr: { type: "button" } });
		const yes = actions.createEl("button", { cls: "sk-btn is-s sk-sessions-confirm-yes", attr: { type: "button" } });
		setIcon(yes, "trash-2");
		yes.createSpan({ text: this.t("desk.delete-yes") });
		const cancel = () => {
			this.confirming = null;
			this.render();
			this.focusRow(this.selectedIndex());
		};
		no.addEventListener("click", (e) => {
			e.stopPropagation();
			cancel();
		});
		yes.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.remove(s.path);
		});
		el.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				cancel();
			}
		});
	}

	private async remove(path: string): Promise<void> {
		const next = this.neighbour(path);
		const hadFocus = this.root.contains(this.doc.activeElement);
		this.confirming = null;
		try {
			await this.rt.trashSession(path);
			this.rt.ctx.toast(this.t("desk.deleted"));
		} catch (error) {
			this.rt.ctx.toast(error instanceof Error ? error.message : String(error));
		}
		if (this.selected === path) this.selected = next;
		this.render();
		if (hadFocus) this.focusRow(this.selectedIndex());
	}

	/** A field in place of the title (the detail's, else the row's): Enter renames, Esc leaves it. */
	private startRename(path: string): void {
		const s = this.info(path);
		const file = this.fileOf(path);
		if (!s || !file) return;
		const host = (this.desk && this.selected === path ? this.detail?.querySelector<HTMLElement>(".sk-sessions-det-title") : null) ?? this.rowOf(path)?.querySelector<HTMLElement>(".sk-sessions-row-name");
		if (!host) return;
		this.pop?.close();
		const input = this.doc.createElement("input");
		input.type = "text";
		input.className = "sk-sessions-rename";
		input.value = s.title;
		input.spellcheck = false;
		input.setAttr("aria-label", this.t("desk.rename"));
		host.replaceWith(input);
		this.editing = true;
		input.focus();
		input.select();
		let done = false;
		const finish = async (save: boolean) => {
			if (done) return;
			done = true;
			const name = input.value.trim();
			this.editing = false;
			// Bound to the note it was opened on: if that note was renamed, moved or deleted meanwhile, the edit is dropped.
			const same = this.fileOf(path) === file && file.path === path;
			if (save && same && name && name !== s.title) {
				const error = await this.rt.renameSession(file.path, name);
				if (error) this.rt.ctx.toast(error);
			}
			this.render();
			this.focusRow(this.selectedIndex());
		};
		input.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter") {
				e.preventDefault();
				void finish(true);
			} else if (e.key === "Escape") {
				e.preventDefault();
				void finish(false);
			}
		});
		input.addEventListener("click", (e) => e.stopPropagation());
		input.addEventListener("blur", () => void finish(true));
	}

	/** The context window: the contexts already used, a field to name a new one, and "remove". */
	private openContext(path: string, anchor: HTMLElement): void {
		const s = this.info(path);
		if (!s) return;
		this.pop?.close();
		const current = s.context ?? null;
		const all = this.rt.contexts();
		const pop = this.root.createDiv({ cls: "sk-sessions-pop", attr: { role: "dialog", "aria-label": this.t("desk.context") } });
		const field = pop.createDiv({ cls: "sk-sessions-pop-field" });
		field.createSpan({ cls: "sk-sessions-ctx-hash", text: "#" });
		const input = field.createEl("input", { attr: { type: "text", placeholder: this.t("desk.context-placeholder"), spellcheck: "false", "aria-label": this.t("desk.context-placeholder") } });
		const list = pop.createDiv({ cls: "sk-sessions-pop-list", attr: { role: "listbox" } });
		let active = Math.max(0, current ? all.findIndex((c) => c.toLowerCase() === current.toLowerCase()) : 0);
		type Choice = { label: string; tag: string | null; kind: "pick" | "create" | "remove" };
		let choices: Choice[] = [];
		const draw = () => {
			const typed = input.value.trim().replace(/^#/, "");
			const q = searchable(typed);
			choices = all.filter((c) => !q || searchable(c).includes(q)).map((c) => ({ label: c, tag: c, kind: "pick" as const }));
			if (typed && isTagName(typed) && !all.some((c) => c.toLowerCase() === typed.toLowerCase())) choices.push({ label: this.t("desk.context-create", { tag: `#${typed}` }), tag: typed, kind: "create" });
			if (current && !typed) choices.push({ label: this.t("desk.context-remove"), tag: null, kind: "remove" });
			active = Math.max(0, Math.min(active, choices.length - 1));
			list.empty();
			if (!choices.length) list.createDiv({ cls: "sk-sessions-pop-none", text: this.t(all.length ? "desk.context-nomatch" : "desk.context-none") });
			choices.forEach((c, i) => {
				const item = list.createDiv({ cls: `sk-sessions-pop-item is-${c.kind}` + (i === active ? " is-active" : ""), attr: { role: "option", "aria-selected": String(i === active) } });
				if (c.kind === "pick") {
					item.appendChild(capsule(this.doc, c.label, this.rt.tagClasses(c.label)));
					if (current && current.toLowerCase() === c.label.toLowerCase()) setIcon(item.createSpan({ cls: "sk-sessions-pop-check" }), "check");
				} else {
					setIcon(item.createSpan({ cls: "sk-sessions-pop-icon" }), c.kind === "create" ? "plus" : "x");
					item.createSpan({ text: c.label });
				}
				item.addEventListener("pointerdown", (e) => e.preventDefault());
				item.addEventListener("click", () => void apply(c));
			});
		};
		const close = (refocus = true) => {
			if (this.pop?.el !== pop) return;
			this.pop = null;
			this.doc.removeEventListener("pointerdown", outside, true);
			pop.remove();
			this.editing = false;
			if (this.pending) this.render();
			if (refocus) this.focusRow(this.selectedIndex());
		};
		const apply = async (c: Choice) => {
			close();
			if (c.kind !== "remove" && current && c.tag?.toLowerCase() === current.toLowerCase()) return;
			try {
				await this.rt.setContext(path, c.tag);
			} catch (error) {
				this.rt.ctx.toast(error instanceof Error ? error.message : String(error));
			}
		};
		const outside = (e: PointerEvent) => {
			if (!pop.contains(e.target as Node)) close(false);
		};
		input.addEventListener("input", () => {
			active = 0;
			draw();
		});
		input.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				if (choices.length) active = (active + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
				draw();
			} else if (e.key === "Enter") {
				e.preventDefault();
				if (choices[active]) void apply(choices[active]);
			} else if (e.key === "Escape") {
				e.preventDefault();
				close();
			}
		});
		draw();
		this.pop = { el: pop, close: () => close(false) };
		this.editing = true;
		this.doc.addEventListener("pointerdown", outside, true);
		// Under the anchor, kept inside the tab.
		const box = this.root.getBoundingClientRect();
		const r = anchor.getBoundingClientRect();
		const w = pop.offsetWidth;
		pop.style.left = `${Math.max(8, Math.min(box.width - w - 8, r.left - box.left))}px`;
		const below = r.bottom - box.top + 6;
		const h = pop.offsetHeight;
		pop.style.top = `${below + h > this.root.clientHeight && r.top - box.top - h - 6 > 0 ? r.top - box.top - h - 6 : below}px`;
		input.focus();
	}

	/** Opens the note at a line kept to decide and catches it as a task; when the line moved, only opens the note there. */
	private async toTask(path: string, q: SummaryQuestion, e: MouseEvent): Promise<void> {
		const file = this.fileOf(path);
		if (!file) return;
		this.host.open(path, q.line, e);
		const started = Date.now();
		const tryCatch = () => {
			const view = this.rt.app.workspace.getActiveViewOfType(MarkdownView);
			if (view?.file === file) {
				// catchAt finds the line again in the editor (q.raw) just before rewriting it; when it moved away or is gone, nothing is rewritten.
				void this.rt.catchAt(file, q.line, q.start, q.end, q.raw);
				return;
			}
			if (Date.now() - started < 2000) window.setTimeout(tryCatch, 60);
		};
		window.setTimeout(tryCatch, reduced() ? 0 : 60);
	}

	// ----- the detail (page layout) -----

	private renderDetail(): void {
		const el = this.detail;
		if (!el) return;
		const scroller = el.querySelector(".sk-sessions-det-scroll");
		const scroll = scroller?.scrollTop ?? 0;
		const sameSession = el.dataset.path === (this.selected ?? "");
		el.empty();
		el.dataset.path = this.selected ?? "";
		const s = this.selected ? this.info(this.selected) : null;
		if (!s) {
			const empty = el.createDiv({ cls: "sk-sessions-det-empty" });
			setIcon(empty.createDiv({ cls: "sk-sessions-det-empty-icon" }), "zap");
			empty.createDiv({ text: this.t("desk.empty") });
			return;
		}
		const { ctx } = this.rt;
		const data = this.rt.detailOf(s.path);
		const body = el.createDiv({ cls: "sk-sessions-det-scroll" + (sameSession ? "" : " is-entering") });

		const titleRow = body.createDiv({ cls: "sk-sessions-det-title-row" });
		const title = titleRow.createEl("h2", { cls: "sk-sessions-det-title", text: s.title });
		title.addEventListener("click", () => this.startRename(s.path));
		const edit = titleRow.createEl("button", { cls: "sk-btn is-ghost is-icon is-s sk-sessions-det-edit", attr: { type: "button", "aria-label": this.t("desk.rename-key"), "data-focus-key": "det:rename" } });
		setIcon(edit, "pencil");
		edit.addEventListener("click", () => this.startRename(s.path));

		const meta = body.createDiv({ cls: "sk-sessions-det-meta" });
		const state = stateOf(s);
		meta.createSpan({ cls: `sk-sessions-det-state is-${state}`, text: this.t(`tab.state-${state}`) });
		if (s.archived) meta.createSpan({ cls: "sk-sessions-det-state is-archived", text: this.t("tab.filter-archived") });
		const ctxBtn = meta.createEl("button", { cls: "sk-sessions-det-ctx" + (s.context ? "" : " is-empty"), attr: { type: "button", "aria-label": this.t("desk.context-key"), "data-focus-key": "det:ctx" } });
		if (s.context) ctxBtn.appendChild(capsule(this.doc, s.context, this.rt.tagClasses(s.context)));
		else {
			setIcon(ctxBtn.createSpan({ cls: "sk-sessions-det-ctx-icon" }), "hash");
			ctxBtn.createSpan({ text: this.t("desk.context-add") });
		}
		ctxBtn.addEventListener("click", () => this.openContext(s.path, ctxBtn));
		const rtf = new Intl.RelativeTimeFormat(ctx.lang, { numeric: "auto" });
		const now = Date.now();
		body.createDiv({ cls: "sk-sessions-det-age", text: this.t("desk.age", { started: rtf.format(...ago(s.created, now)), edited: rtf.format(...ago(s.modified ?? s.created, now)) }) });

		const tri = data?.triage;
		const progress = body.createDiv({ cls: "sk-sessions-det-progress" });
		if (tri && tri.sorted !== null) {
			const label = progress.createDiv({ cls: "sk-sessions-det-progress-label" });
			label.createSpan({ text: this.t("desk.sorted", { n: tri.sorted }) });
			if (tri.sorted < 100) label.createSpan({ cls: "sk-sessions-det-progress-left", text: ctx.tn("desk.left", tri.untagged + tri.undecided) });
			const bar = progress.createDiv({ cls: "sk-sessions-det-bar", attr: { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(tri.sorted) } });
			const fill = bar.createDiv({ cls: "sk-sessions-det-bar-fill" + (tri.sorted === 100 ? " is-full" : "") });
			fill.style.width = `${tri.sorted}%`;
		} else progress.createDiv({ cls: "sk-sessions-det-progress-label is-none", text: this.t("desk.nothing-to-sort") });

		const stats = body.createDiv({ cls: "sk-sessions-det-stats" });
		const stat = (value: string, key: string, warn = false) => {
			const box = stats.createDiv({ cls: "sk-sessions-det-stat" + (warn ? " is-warn" : "") });
			box.createDiv({ cls: "sk-sessions-det-stat-n", text: value });
			box.createDiv({ cls: "sk-sessions-det-stat-l", text: this.t(key) });
		};
		stat(String(s.ideas), "desk.stat-ideas");
		stat(`${tri?.done ?? 0}/${tri?.tasks ?? 0}`, "desk.stat-tasks");
		stat(String(tri?.undecided ?? 0), "desk.stat-decide", !!tri?.undecided && !s.closed);
		stat(String(tri?.untagged ?? 0), "desk.stat-untagged", !!tri?.untagged && !s.closed);
		stat(String(tri?.orphans.length ?? 0), "desk.stat-orphans");

		if (data) {
			const tasks = data.summary.tasks;
			if (tasks.length) {
				const sec = this.section(body, "desk.tasks", tasks.length);
				for (const task of tasks) {
					const row = sec.createDiv({ cls: "sk-sessions-det-task" + (task.done ? " is-done" : "") });
					const box = row.createEl("button", { cls: "sk-sessions-det-check", attr: { type: "button", role: "checkbox", "aria-checked": String(task.done), "aria-label": task.title } });
					setIcon(box, "check");
					box.addEventListener("click", () => {
						row.toggleClass("is-done", !task.done);
						box.setAttr("aria-checked", String(!task.done));
						void this.rt.setTaskDone(s.path, task.line, task.raw, !task.done);
					});
					const text = row.createEl("button", { cls: "sk-sessions-det-line", attr: { type: "button" } });
					text.createSpan({ cls: "sk-sessions-det-line-text", text: task.title });
					text.addEventListener("click", (e) => this.host.open(s.path, task.line, e));
					if (task.tag) row.appendChild(capsule(this.doc, task.tag, this.rt.tagClasses(task.tag)));
					else if (!task.done) row.createSpan({ cls: "sk-sessions-det-notag", text: this.t("desk.no-tag") });
				}
			}
			const decide = data.summary.questions.filter((q) => q.explicit);
			if (decide.length) {
				const sec = this.section(body, "desk.decide", decide.length);
				for (const q of decide) {
					const row = sec.createDiv({ cls: "sk-sessions-det-decide" });
					row.createSpan({ cls: "sk-sessions-det-qmark", text: "?" });
					const text = row.createEl("button", { cls: "sk-sessions-det-line", attr: { type: "button" } });
					text.createSpan({ cls: "sk-sessions-det-line-text", text: q.text });
					text.addEventListener("click", (e) => this.host.open(s.path, q.line, e));
					const make = row.createEl("button", { cls: "sk-btn is-ghost is-s sk-sessions-det-make", attr: { type: "button", "aria-label": this.t("desk.to-task-tip") } });
					setIcon(make, "arrow-right");
					make.createSpan({ text: this.t("desk.to-task") });
					make.addEventListener("click", (e) => void this.toTask(s.path, q, e));
				}
			}
			const orphans = data.triage.orphans;
			if (orphans.length) {
				const sec = this.section(body, "desk.orphans", orphans.length);
				for (const o of orphans) {
					const row = sec.createEl("button", { cls: "sk-sessions-det-orphan", attr: { type: "button" } });
					row.createSpan({ cls: "sk-sessions-det-line-text", text: o.text });
					row.addEventListener("click", (e) => this.host.open(s.path, o.line, e));
				}
			}
		}
		body.scrollTop = sameSession ? scroll : 0;

		const foot = el.createDiv({ cls: "sk-sessions-det-foot" });
		if (this.confirming === s.path) {
			this.confirmStrip(foot.createDiv(), s);
			return;
		}
		const open = foot.createEl("button", { cls: "sk-btn is-primary sk-sessions-det-open", attr: { type: "button", "data-focus-key": "det:open" } });
		setIcon(open, "file-pen-line");
		open.createSpan({ text: this.t("desk.open") });
		open.createEl("kbd", { text: "↵" });
		open.addEventListener("click", (e) => this.host.open(s.path, null, e));
		const pinned = s.pin !== null && s.pin !== undefined;
		const tool = (icon: string, label: string, run: () => void, cls = "") => {
			const b = foot.createEl("button", { cls: "sk-btn is-ghost is-icon " + cls, attr: { type: "button", "aria-label": label, "data-focus-key": `det:${icon}` } });
			setIcon(b, icon);
			b.addEventListener("click", run);
			return b;
		};
		tool("pin", this.t(pinned ? "desk.unpin-key" : "desk.pin-key"), () => this.pin(s.path), pinned ? "is-on" : "");
		const hash = tool("hash", this.t("desk.context-key"), () => this.openContext(s.path, hash));
		tool(s.archived ? "archive-restore" : "archive", this.t(s.archived ? "desk.unarchive-key" : "desk.archive-key"), () => this.archive(s.path));
		foot.createDiv({ cls: "sk-sessions-det-foot-gap" });
		tool("trash-2", this.t("desk.delete-key"), () => this.askDelete(s.path), "sk-sessions-det-delete");
	}

	private section(parent: HTMLElement, key: string, n: number): HTMLElement {
		const sec = parent.createDiv({ cls: "sk-sessions-det-section" });
		const h = sec.createDiv({ cls: "sk-sessions-det-h" });
		h.createSpan({ text: this.t(key) });
		h.createSpan({ cls: "sk-sessions-det-h-n", text: String(n) });
		return sec;
	}

	/** The discreet key bar under the list (page layout), like the Tasks tab's. */
	private helpBar(foot: HTMLElement): void {
		const hint = (keys: string[], label: string) => {
			const span = foot.createSpan();
			for (const k of keys) span.createEl("kbd", { cls: "sk-sessions-kbd", text: k });
			span.appendText(" " + label);
		};
		hint(["↑", "↓"], this.t("desk.key-move"));
		hint(["↵"], this.t("desk.key-open"));
		hint(["P"], this.t("desk.key-pin"));
		hint(["C"], this.t("desk.key-context"));
		hint(["E"], this.t("desk.key-archive"));
		hint(["F2"], this.t("desk.key-rename"));
		hint([this.t("desk.key-del")], this.t("desk.key-delete"));
		hint(["/"], this.t("desk.key-search"));
	}
}
