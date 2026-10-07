// Calendar: a month of daily notes, with dots for notes and open tasks, opening or creating the
// note of a day, keyboard and wheel navigation.
import { Keymap, MarkdownView, moment, Notice, setIcon } from "obsidian";
import type { HoverParent, HoverPopover, TFile } from "obsidian";
import type { Moment } from "moment";
import { asElement, dur, reducedMotion, SPRING } from "../../rail/motion";
import type { PanelContext, PanelDefinition, PanelInstance } from "../../types";
import { DailyIndex, getDailyConfig, getOrCreateDailyNote, localeData, monthGrid, parseDailyPath, weekStartOf } from "./daily";
import type { CalendarDay, DailyConfig } from "./daily";

const KEY_FORMAT = "YYYY-MM-DD";
/** Wheel travel (pixels) that turns a month; a pause this long between events ends a gesture. */
const WHEEL_STEP = 40;
const WHEEL_GESTURE_GAP_MS = 200;
/** Exit half of the month slide. */
const SLIDE_OUT_MS = 110;

interface Month {
	year: number;
	month: number;
}

interface Nav extends Month {
	dir: number;
	then?: () => void;
}

const keyOf = (m: Moment): string => m.format(KEY_FORMAT);
const parseKey = (key: string): Moment => moment(key, KEY_FORMAT, true);
const monthOfKey = (key: string): Month => {
	const m = parseKey(key);
	return { year: m.year(), month: m.month() };
};
const capitalize = (s: string): string => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);

/**
 * Calendar: a month of daily notes. Neutral dot = the day has a note, accent corner dot = open
 * tasks, filled accent = today, ring = the note you are on. Click opens the day's note (creating it
 * if needed), keyboard moves a roving focus, the month slides in the direction you travel.
 */
class CalendarPanel implements PanelInstance {
	private win: Window;
	private rootEl: HTMLElement;
	private monthBtn: HTMLElement;
	private monthNameEl: HTMLElement;
	private yearEl: HTMLElement;
	private viewportEl: HTMLElement;
	private gridEl: HTMLElement;
	private confirmEl: HTMLElement | null = null;
	private footTextEl: HTMLElement;
	private legendEl: HTMLElement;
	private legendTaskEl: HTMLElement;

	private cfg: DailyConfig;
	private cfgSig: string;
	private index: DailyIndex;
	private unsubscribe: () => void;

	private shown: Month;
	private days: CalendarDay[] = [];
	private cells = new Map<string, HTMLElement>();
	private layoutSig = "";
	/** Roving focus: the one day with tabindex 0. */
	private focusKey: string;
	/** Day of the note this view shows, when it is a daily note. */
	private currentKey: string | null;
	private todayKey: string;
	private hoverKey: string | null = null;
	private pendingKey: string | null = null;

	private nav: Nav | null = null;
	private outAnim: Animation | null = null;
	private wheelAcc = 0;
	/** Time of the last wheel event (gesture boundary), and whether this gesture already turned a month. */
	private wheelLastEvent = 0;
	private wheelUsed = false;
	/** False once the panel is hiding or destroyed: a creation still in flight must not navigate. */
	private live = true;
	private busy = false;
	private hoverParent: HoverParent = { hoverPopover: null };
	private cleanups: (() => void)[] = [];
	private destroyed = false;

	constructor(
		private ctx: PanelContext,
		private body: HTMLElement,
	) {
		this.win = body.win ?? window;
		const { app } = ctx;
		this.cfg = getDailyConfig(app, ctx.settings);
		this.cfgSig = this.sigOf(this.cfg);
		this.index = new DailyIndex(app, () => this.cfg);
		this.unsubscribe = this.index.onChange(() => this.onIndexChange());

		this.todayKey = keyOf(moment());
		const file = ctx.view.file;
		this.currentKey = file ? parseDailyPath(file.path, this.cfg) : null;
		this.focusKey = this.currentKey ?? this.todayKey;
		this.shown = monthOfKey(this.focusKey);

		this.rootEl = body.createDiv("sk-note-rail-cal");

		const bar = this.rootEl.createDiv("sk-note-rail-cal-bar");
		this.monthBtn = bar.createEl("button", { cls: "sk-btn is-ghost sk-note-rail-cal-month", attr: { type: "button", "aria-label": ctx.t("calendar.back-today") } });
		this.monthNameEl = this.monthBtn.createEl("b");
		this.yearEl = this.monthBtn.createSpan();
		const todayBtn = bar.createEl("button", { cls: "sk-btn is-s sk-note-rail-cal-today", text: ctx.t("calendar.today"), attr: { type: "button" } });
		const prev = bar.createEl("button", { cls: "sk-btn is-ghost is-icon is-s sk-note-rail-cal-nav", attr: { type: "button", "aria-label": ctx.t("calendar.previous") } });
		setIcon(prev, "chevron-left");
		const next = bar.createEl("button", { cls: "sk-btn is-ghost is-icon is-s sk-note-rail-cal-nav", attr: { type: "button", "aria-label": ctx.t("calendar.next") } });
		setIcon(next, "chevron-right");

		this.viewportEl = this.rootEl.createDiv("sk-note-rail-cal-viewport");
		this.gridEl = this.viewportEl.createDiv({ cls: "sk-note-rail-cal-grid", attr: { role: "grid" } });

		// The footer: what the hovered day holds, and a small legend.
		const foot = this.body.doc.createDocumentFragment();
		this.footTextEl = foot.createSpan("sk-note-rail-cal-foot-text");
		const legend = (this.legendEl = foot.createSpan("sk-note-rail-cal-legend"));
		legend.createSpan({ cls: "sk-note-rail-cal-legend-item", text: ctx.t("calendar.legend-note") }).prepend(this.body.doc.createElement("i"));
		this.legendTaskEl = legend.createSpan({ cls: "sk-note-rail-cal-legend-item is-task", text: ctx.t("calendar.legend-tasks") });
		this.legendTaskEl.prepend(this.body.doc.createElement("i"));
		ctx.setFooter(foot);

		this.listen(this.monthBtn, "click", () => this.goToday(false));
		this.listen(todayBtn, "click", () => this.goToday(true));
		this.listen(prev, "click", () => this.shiftMonth(-1));
		this.listen(next, "click", () => this.shiftMonth(1));
		this.listen(this.gridEl, "click", (e) => this.onClick(e as MouseEvent));
		this.listen(this.gridEl, "auxclick", (e) => this.onAuxClick(e as MouseEvent));
		this.listen(this.gridEl, "mouseover", (e) => this.onMouseOver(e as MouseEvent));
		// Leaving the grid: back to the focused day if the keyboard is in it, else to the month summary.
		this.listen(this.gridEl, "mouseleave", () => this.setHover(this.gridEl.contains(this.body.doc.activeElement) ? this.focusKey : null));
		this.listen(this.gridEl, "focusin", (e) => {
			const cell = asElement(e.target)?.closest<HTMLElement>(".sk-note-rail-day");
			if (cell?.dataset.key) this.setHover(cell.dataset.key);
		});
		this.listen(this.gridEl, "focusout", () => this.setHover(null));
		this.listen(this.viewportEl, "wheel", (e) => this.onWheel(e as WheelEvent), { passive: false });
		this.listen(this.rootEl, "keydown", (e) => this.onKeyDown(e as KeyboardEvent));
		// Window capture runs before the rail's document listener: Esc closes the confirmation first.
		this.listen(this.win, "keydown", (e) => this.onWindowKeyDown(e as KeyboardEvent), true);

		this.renderMonth(0, true);
		this.updateHeader();

		// Opened from the keyboard, the rail focuses the first button (the month title): hand the
		// focus to the roving day instead, like a date picker.
		queueMicrotask(() => {
			if (this.destroyed) return;
			if (this.body.doc.activeElement === this.monthBtn) this.focusCell(this.focusKey);
		});
	}

	// ---- config ------------------------------------------------------------

	private sigOf(cfg: DailyConfig): string {
		return `${cfg.folder}\n${cfg.format}`;
	}

	/** Settings changed or the current note changed: re-read the config, re-render in place. */
	refresh(): void {
		if (this.destroyed) return;
		const cfg = getDailyConfig(this.ctx.app, this.ctx.settings);
		const sig = this.sigOf(cfg);
		this.cfg = cfg;
		if (sig !== this.cfgSig) {
			// Another folder or format: start a fresh index rather than trusting an invalidation.
			this.cfgSig = sig;
			this.unsubscribe();
			this.index.destroy();
			this.index = new DailyIndex(this.ctx.app, () => this.cfg);
			this.unsubscribe = this.index.onChange(() => this.onIndexChange());
		}
		const file = this.ctx.view.file;
		this.currentKey = file ? parseDailyPath(file.path, cfg) : null;
		const layout = this.layoutSignature();
		if (layout !== this.layoutSig) this.renderMonth(0, false);
		else this.updateMarks();
		this.updateHeader();
	}

	private layoutSignature(): string {
		return `${this.weekStart()}|${this.ctx.settings.calendarWeekNumbers}`;
	}

	private onIndexChange(): void {
		if (this.destroyed) return;
		this.updateMarks();
		this.updateHeader();
	}

	// ---- rendering -----------------------------------------------------------

	/**
	 * Build the grid of `this.shown`. `dir` slides it in from that side (0 = no slide),
	 * `entrance` staggers the cells in (first open only).
	 */
	private renderMonth(dir: number, entrance: boolean): void {
		const weekStart = this.weekStart();
		const weeks = this.ctx.settings.calendarWeekNumbers;
		this.layoutSig = this.layoutSignature();
		this.todayKey = keyOf(moment());
		const hadFocus = this.gridEl.contains(this.body.doc.activeElement);

		this.days = monthGrid(this.shown.year, this.shown.month, weekStart, this.todayKey);
		this.cells.clear();
		this.gridEl.empty();
		this.gridEl.toggleClass("has-weeks", weeks);

		// Keep the roving focus inside the month on display.
		if (!this.days.some((d) => d.key === this.focusKey && d.inMonth)) {
			const pick = this.days.find((d) => d.inMonth && d.key === this.todayKey) ?? this.days.find((d) => d.inMonth);
			if (pick) this.focusKey = pick.key;
		}

		const head = this.gridEl.createDiv({ cls: "sk-note-rail-cal-row sk-note-rail-cal-head", attr: { role: "row" } });
		if (weeks) head.createSpan({ cls: "sk-note-rail-cal-wk", text: this.ctx.t("calendar.week"), attr: { "aria-hidden": "true" } });
		const names = localeData(this.ctx.lang).weekdaysMin();
		for (let i = 0; i < 7; i++) {
			const wd = (weekStart + i) % 7;
			head.createSpan({ cls: "sk-note-rail-cal-dow", text: names[wd], attr: { role: "columnheader" } });
		}

		const animated: HTMLElement[] = [];
		for (let w = 0; w < 6; w++) {
			const row = this.gridEl.createDiv({ cls: "sk-note-rail-cal-row", attr: { role: "row" } });
			const week = this.days.slice(w * 7, w * 7 + 7);
			if (!week.length) break;
			if (weeks) {
				// The ISO week of a row is the one of its Thursday (rows starting on Sunday included).
				const thu = week.find((d) => d.weekday === 4) ?? week[0];
				animated.push(row.createSpan({ cls: "sk-note-rail-cal-wk", text: String(thu.isoWeek), attr: { "aria-hidden": "true" } }));
			}
			for (const day of week) {
				const cell = row.createEl("button", {
					cls: "sk-btn is-ghost is-s sk-note-rail-day",
					attr: { type: "button", role: "gridcell", tabindex: "-1", "data-key": day.key },
				});
				cell.toggleClass("is-out", !day.inMonth);
				cell.toggleClass("is-weekend", day.weekday === 0 || day.weekday === 6);
				cell.createEl("i", "sk-note-rail-day-bg");
				cell.createEl("b", { text: String(day.day) });
				cell.createEl("i", "sk-note-rail-day-dot");
				cell.createEl("i", "sk-note-rail-day-tk");
				this.cells.set(day.key, cell);
				animated.push(cell);
			}
		}
		this.updateMarks();
		this.cells.get(this.focusKey)?.setAttribute("tabindex", "0");
		if (hadFocus) this.focusCell(this.focusKey);

		if (reducedMotion(this.win)) return;
		if (entrance) {
			animated.forEach((el, i) => {
				// Diagonal sweep: row and column both add a little delay.
				const col = i % (weeks ? 8 : 7);
				const row = Math.floor(i / (weeks ? 8 : 7));
				el.style.setProperty("--i", String(row + col * 0.5));
				el.addClass("sk-note-rail-cal-in");
				el.addEventListener("animationend", () => {
					el.removeClass("sk-note-rail-cal-in");
					el.style.removeProperty("--i");
				}, { once: true });
			});
		} else if (dir && typeof this.gridEl.animate === "function") {
			this.gridEl.animate(
				[{ opacity: 0, transform: `translateX(${dir * 22}px)` }, { opacity: 1, transform: "none" }],
				{ duration: 420, easing: SPRING },
			);
		}
	}

	/** Dots, today, current note, count and footer: cheap, in place, keeps focus and hover. */
	private updateMarks(): void {
		const today = keyOf(moment());
		this.todayKey = today;
		const showTasks = this.ctx.settings.calendarTaskDots;
		this.rootEl.toggleClass("hide-tasks", !showTasks);
		this.legendTaskEl.toggle(showTasks);
		for (const day of this.days) {
			const cell = this.cells.get(day.key);
			if (!cell) continue;
			const file = this.index.get(day.key);
			const tasks = file && showTasks ? this.index.openTasks(day.key) : 0;
			cell.toggleClass("has-note", !!file);
			cell.toggleClass("has-tasks", tasks > 0);
			cell.toggleClass("is-today", day.key === today);
			cell.toggleClass("is-current", day.key === this.currentKey);
			cell.toggleClass("is-pending", day.key === this.pendingKey);
			if (day.key === today) cell.setAttribute("aria-current", "date");
			else cell.removeAttribute("aria-current");
		}
		this.updateFooter();
	}

	private updateHeader(): void {
		const cfg = this.cfg;
		const folder = cfg.folder || this.ctx.t("calendar.root");
		this.ctx.setSubtitle(`${folder} · ${cfg.format}`);
		this.ctx.setCount(this.days.filter((d) => d.inMonth && this.index.get(d.key)).length);
		this.monthNameEl.setText(this.monthName());
		this.yearEl.setText(String(this.shown.year));
	}

	private monthName(): string {
		// Standalone form (a month without a day): nominative in languages that decline month names.
		const date = new Date(this.shown.year, this.shown.month, 1);
		return capitalize(new Intl.DateTimeFormat(this.ctx.lang, { month: "long" }).format(date));
	}

	private weekStart(): number {
		return weekStartOf(this.ctx.settings.calendarWeekStart, this.ctx.lang);
	}

	// ---- footer ----------------------------------------------------------------

	private setHover(key: string | null): void {
		if (this.hoverKey === key) return;
		this.hoverKey = key;
		this.updateFooter();
	}

	private updateFooter(): void {
		const key = this.pendingKey ?? this.hoverKey;
		let text: string;
		if (key && key === this.pendingKey) text = `${this.dayLabel(key)} · ${this.ctx.t("calendar.confirm-keys")}`;
		else if (key) text = this.describe(key);
		else {
			const inMonth = this.days.filter((d) => d.inMonth);
			const notes = inMonth.filter((d) => this.index.get(d.key)).length;
			const showTasks = this.ctx.settings.calendarTaskDots;
			const withTasks = showTasks ? inMonth.filter((d) => this.index.get(d.key) && this.index.openTasks(d.key) > 0).length : 0;
			text = !notes
				? this.ctx.t("calendar.no-notes")
				: this.ctx.tn("calendar.notes", notes) + (showTasks ? ` · ${this.ctx.tn("calendar.with-tasks", withTasks)}` : "");
		}
		if (this.footTextEl.getText() !== text) this.footTextEl.setText(text);
		// A day's description needs the room: the legend steps aside meanwhile.
		this.legendEl.toggleClass("is-hidden", !!key);
		this.footTextEl.toggleClass("has-legend", !key);
	}

	/** "Fri, Oct 2" in Snailkit's language (year added outside the current year, "Today" for today). */
	private dayLabel(key: string): string {
		const m = parseKey(key);
		const sameYear = m.year() === moment().year();
		const label = new Intl.DateTimeFormat(this.ctx.lang, { weekday: "short", month: "short", day: "numeric", year: sameYear ? undefined : "numeric" }).format(m.toDate());
		return key === this.todayKey ? this.ctx.t("calendar.today-label", { date: label }) : label;
	}

	/** "Fri, Oct 2 · 3 open tasks" (footer). No aria-label on the cells: Obsidian would show it as a tooltip. */
	private describe(key: string): string {
		const label = this.dayLabel(key);
		const file = this.index.get(key);
		if (!file) return `${label} · ${this.ctx.t("calendar.no-note")}`;
		const tasks = this.ctx.settings.calendarTaskDots ? this.index.openTasks(key) : 0;
		return `${label} · ${tasks ? this.ctx.tn("calendar.open-tasks", tasks) : this.ctx.t("calendar.daily-note")}`;
	}

	// ---- navigation ----------------------------------------------------------

	private shiftMonth(delta: number): void {
		const base = this.nav ?? this.shown;
		const m = moment([base.year, base.month, 1]).add(delta, "month");
		this.goTo({ year: m.year(), month: m.month() });
	}

	/** Show `target`, sliding from the side of travel. Rapid calls retarget the slide in flight. */
	private goTo(target: Month, then?: () => void): void {
		const from = this.nav ?? this.shown;
		const diff = (target.year - from.year) * 12 + target.month - from.month;
		const cur = (target.year - this.shown.year) * 12 + target.month - this.shown.month;
		if (!cur && !this.nav) {
			then?.();
			return;
		}
		this.cancelConfirm();
		this.nav = { ...target, dir: Math.sign(cur || diff), then };
		if (reducedMotion(this.win) || typeof this.gridEl.animate !== "function") {
			this.applyNav();
			return;
		}
		if (this.outAnim) return;
		const dir = this.nav.dir;
		this.outAnim = this.gridEl.animate(
			[{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-dir * 22}px)` }],
			{ duration: SLIDE_OUT_MS, easing: "ease-in", fill: "forwards" },
		);
		this.outAnim.onfinish = () => {
			this.outAnim?.cancel();
			this.outAnim = null;
			if (!this.destroyed) this.applyNav();
		};
		const label = this.monthBtn;
		if (typeof label.animate === "function") {
			label.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateY(${-dir * 6}px)` }], { duration: SLIDE_OUT_MS, easing: "ease-in", fill: "forwards" })
				.onfinish = function (this: Animation) { this.cancel(); };
		}
	}

	private applyNav(): void {
		const nav = this.nav;
		this.nav = null;
		if (!nav) return;
		this.shown = { year: nav.year, month: nav.month };
		const dir = nav.dir;
		this.renderMonth(dir, false);
		this.updateHeader();
		if (dir && !reducedMotion(this.win) && typeof this.monthBtn.animate === "function") {
			this.monthBtn.animate([{ opacity: 0, transform: `translateY(${dir * 6}px)` }, { opacity: 1, transform: "none" }], { duration: 360, easing: SPRING });
		}
		nav.then?.();
	}

	/** Today button: back to today's month, then pulse today. Month title: just go back. */
	private goToday(ping: boolean): void {
		const today = keyOf(moment());
		const target = monthOfKey(today);
		const travels = !!this.nav || target.year !== this.shown.year || target.month !== this.shown.month;
		// Through setRoving: the old cell gives up its tab stop before the key changes.
		this.setRoving(today);
		this.goTo(target, () => {
			this.setRoving(today);
			if (!ping) return;
			// After a slide, let the month settle before the pulse.
			this.win.setTimeout(() => {
				const cell = this.cells.get(today);
				if (this.destroyed || !cell) return;
				cell.removeClass("is-ping");
				void cell.offsetWidth;
				cell.addClass("is-ping");
			}, travels ? dur(160, this.win) : 0);
		});
	}

	private onWheel(e: WheelEvent): void {
		const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
		if (!delta) return;
		e.preventDefault();
		const now = Date.now();
		// A pause ends the gesture: the next one starts from zero and may turn a month again.
		if (now - this.wheelLastEvent > WHEEL_GESTURE_GAP_MS) {
			this.wheelAcc = 0;
			this.wheelUsed = false;
		}
		this.wheelLastEvent = now;
		if (this.wheelUsed) return;
		this.wheelAcc += e.deltaMode === 1 ? delta * 16 : e.deltaMode === 2 ? delta * 400 : delta;
		if (Math.abs(this.wheelAcc) < WHEEL_STEP) return;
		// One month per gesture, so trackpad inertia never runs through a year.
		this.wheelUsed = true;
		const step = Math.sign(this.wheelAcc);
		this.wheelAcc = 0;
		this.shiftMonth(step);
	}

	// ---- focus -----------------------------------------------------------------

	private setRoving(key: string): void {
		this.cells.get(this.focusKey)?.setAttribute("tabindex", "-1");
		this.focusKey = key;
		this.cells.get(key)?.setAttribute("tabindex", "0");
	}

	private focusCell(key: string): void {
		this.setRoving(key);
		this.cells.get(key)?.focus({ preventScroll: true });
	}

	/** Move the focused day; leaving the month slides to the next one and keeps the focus. */
	private moveFocus(key: string): void {
		const target = monthOfKey(key);
		const sameMonth = target.year === this.shown.year && target.month === this.shown.month && !this.nav;
		if (sameMonth) {
			this.focusCell(key);
			return;
		}
		this.setRoving(key);
		this.goTo(target, () => this.focusCell(key));
	}

	// ---- events ----------------------------------------------------------------

	private cellKey(target: EventTarget | null): string | null {
		const cell = asElement(target)?.closest<HTMLElement>(".sk-note-rail-day");
		return cell && this.gridEl.contains(cell) ? cell.dataset.key ?? null : null;
	}

	private onClick(e: MouseEvent): void {
		const key = this.cellKey(e.target);
		if (!key) return;
		this.setRoving(key);
		void this.activate(key, e);
	}

	private onAuxClick(e: MouseEvent): void {
		if (e.button !== 1) return;
		const key = this.cellKey(e.target);
		if (!key) return;
		e.preventDefault();
		void this.activate(key, e);
	}

	private onMouseOver(e: MouseEvent): void {
		const key = this.cellKey(e.target);
		this.setHover(key);
		const file = key ? this.index.get(key) : null;
		const cell = key ? this.cells.get(key) : null;
		if (!file || !cell) return;
		this.ctx.app.workspace.trigger("hover-link", {
			event: e,
			source: this.ctx.hoverSource,
			hoverParent: this.hoverParent,
			targetEl: cell,
			linktext: file.path,
			sourcePath: this.ctx.view.file?.path ?? "",
		});
	}

	private onKeyDown(e: KeyboardEvent): void {
		const target = asElement(e.target);
		if (!target || this.confirmEl?.contains(target)) return;
		const inGrid = this.gridEl.contains(target);
		const mod = e.ctrlKey || e.metaKey || e.altKey;
		const base = parseKey(this.focusKey);
		let next: Moment | null = null;
		switch (e.key) {
			case "ArrowLeft":
				if (inGrid && !mod) next = base.clone().subtract(1, "day");
				break;
			case "ArrowRight":
				if (inGrid && !mod) next = base.clone().add(1, "day");
				break;
			case "ArrowUp":
				if (inGrid && !mod) next = base.clone().subtract(1, "week");
				break;
			case "ArrowDown":
				if (inGrid && !mod) next = base.clone().add(1, "week");
				break;
			case "PageUp":
				next = base.clone().subtract(1, e.shiftKey ? "year" : "month");
				break;
			case "PageDown":
				next = base.clone().add(1, e.shiftKey ? "year" : "month");
				break;
			case "Home":
				if (inGrid) next = base.clone().subtract((base.day() - this.weekStart() + 7) % 7, "day");
				break;
			case "End":
				if (inGrid) next = base.clone().add(6 - ((base.day() - this.weekStart() + 7) % 7), "day");
				break;
			case "t":
			case "T":
				if (!mod) {
					e.preventDefault();
					const today = keyOf(moment());
					if (inGrid) this.moveFocus(today);
					else this.goToday(true);
					return;
				}
				break;
			case "Enter":
			case " ":
				if (inGrid && !e.altKey) {
					e.preventDefault();
					// The day the key was pressed on, not a remembered one.
					void this.activate(this.cellKey(target) ?? this.focusKey, e);
					return;
				}
				break;
		}
		if (!next) return;
		e.preventDefault();
		e.stopPropagation();
		if (inGrid) this.moveFocus(keyOf(next));
		else this.goTo({ year: next.year(), month: next.month() }, () => this.setRoving(keyOf(next!)));
	}

	private onWindowKeyDown(e: KeyboardEvent): void {
		if (e.key !== "Escape" || !this.confirmEl) return;
		// Same rules as the rail's Esc: from inside the panel, or from this note while no modal,
		// menu or suggestion popup is open. Anything else keeps its Escape.
		const panel = this.rootEl.closest(".sk-note-rail-panel");
		const target = asElement(e.target);
		const inPanel = !!(panel && target && panel.contains(target));
		if (!inPanel) {
			// A modal (command palette...) may close itself on this very Escape before we see it:
			// its removed input, or an already handled event, means the key was not for us.
			if (e.defaultPrevented || !target?.isConnected) return;
			if (target.closest(".modal-container, .menu, .suggestion-container, .prompt")) return;
			if (this.body.doc.querySelector(".modal-container, .menu, .suggestion-container")) return;
			if (this.ctx.app.workspace.getActiveViewOfType(MarkdownView) !== this.ctx.view) return;
			// Focus must be in this note's view (or nowhere), not in another pane or a sidebar.
			if (target !== this.body.doc.body && !this.ctx.view.containerEl.contains(target)) return;
		}
		e.preventDefault();
		e.stopPropagation();
		this.cancelConfirm(true);
	}

	// ---- open / create -------------------------------------------------------

	/** Open the day's note, or create it (after an inline confirmation when the setting asks). */
	private async activate(key: string, evt: MouseEvent | KeyboardEvent): Promise<void> {
		if (this.busy) return;
		const file = this.index.get(key);
		if (file) {
			await this.open(file, evt);
			return;
		}
		if (this.ctx.settings.calendarConfirmCreate) {
			const newTab = Keymap.isModEvent(evt);
			this.askCreate(key, () => void this.create(key, newTab));
			return;
		}
		await this.create(key, Keymap.isModEvent(evt));
	}

	private async create(key: string, newTab: ReturnType<typeof Keymap.isModEvent>): Promise<void> {
		if (this.busy || !this.live) return;
		this.busy = true;
		this.cells.get(key)?.addClass("is-busy");
		try {
			const file = await getOrCreateDailyNote(this.ctx.app, key, this.cfg);
			// Closed or unloaded while the note was being written: keep the note, do not navigate.
			if (!this.live) return;
			await this.openIn(file, newTab);
			if (this.live) this.ctx.close("commit");
		} catch (err) {
			console.error("[Snailkit] note-rail: could not create the daily note", err);
			new Notice(this.ctx.t("calendar.create-error", { date: key }));
		} finally {
			this.busy = false;
			this.cells.get(key)?.removeClass("is-busy");
		}
	}

	private async open(file: TFile, evt: MouseEvent | KeyboardEvent): Promise<void> {
		const newTab = Keymap.isModEvent(evt);
		if (!newTab && this.ctx.view.file?.path === file.path) {
			this.ctx.close("commit");
			return;
		}
		if (!this.live) return;
		try {
			await this.openIn(file, newTab);
			if (this.live) this.ctx.close("commit");
		} catch (err) {
			console.error("[Snailkit] note-rail:", err);
			new Notice(this.ctx.t("panel.open-error", { name: file.basename }));
		}
	}

	private async openIn(file: TFile, newTab: ReturnType<typeof Keymap.isModEvent>): Promise<void> {
		const leaf = newTab ? this.ctx.app.workspace.getLeaf(newTab) : this.ctx.view.leaf;
		await leaf.openFile(file);
	}

	/** Small inline confirmation over the bottom of the grid (never a native dialog). */
	private askCreate(key: string, onYes: () => void): void {
		this.cancelConfirm();
		this.pendingKey = key;
		const el = this.rootEl.createDiv({ cls: "sk-note-rail-cal-confirm", attr: { role: "alertdialog", "aria-live": "polite" } });
		this.confirmEl = el;
		const text = el.createDiv("sk-note-rail-cal-confirm-text");
		setIcon(text.createSpan("sk-note-rail-cal-confirm-icon"), "calendar-plus");
		// "Create the note for **Friday, October 2**?", the date in bold wherever the language puts it.
		const words = text.createSpan();
		const [before, after] = this.ctx.t("calendar.confirm").split("{date}");
		words.appendText(before ?? "");
		words.createEl("b", { text: new Intl.DateTimeFormat(this.ctx.lang, { weekday: "long", month: "long", day: "numeric" }).format(parseKey(key).toDate()) });
		words.appendText(after ?? "");
		const actions = el.createDiv("sk-note-rail-cal-confirm-actions");
		const cancel = actions.createEl("button", { cls: "sk-btn is-ghost is-s", text: this.ctx.t("common.cancel"), attr: { type: "button" } });
		const yes = actions.createEl("button", { cls: "sk-btn is-primary is-s", text: this.ctx.t("common.create"), attr: { type: "button" } });
		cancel.addEventListener("click", () => this.cancelConfirm(true));
		yes.addEventListener("click", () => {
			this.cancelConfirm(false);
			onYes();
		});
		el.addEventListener("keydown", (e) => {
			if (e.key === "Tab") {
				// Keep the focus between the two buttons.
				e.preventDefault();
				(this.body.doc.activeElement === yes ? cancel : yes).focus();
			}
		});
		this.updateMarks();
		yes.focus({ preventScroll: true });
		// In a short pane the body scrolls: bring the confirmation into view.
		el.scrollIntoView({ block: "nearest" });
	}

	private cancelConfirm(restoreFocus = false): void {
		const el = this.confirmEl;
		if (!el) return;
		const hadFocus = el.contains(this.body.doc.activeElement);
		this.confirmEl = null;
		const key = this.pendingKey;
		this.pendingKey = null;
		if (key) this.cells.get(key)?.removeClass("is-pending");
		el.addClass("is-leaving");
		if (reducedMotion(this.win)) el.remove();
		else this.win.setTimeout(() => el.remove(), 180);
		this.updateFooter();
		if (restoreFocus && hadFocus) this.focusCell(this.focusKey);
	}

	// ---- teardown --------------------------------------------------------------

	onHide(): void {
		this.live = false;
	}

	private listen(target: EventTarget, type: string, fn: (e: Event) => void, options?: boolean | AddEventListenerOptions): void {
		target.addEventListener(type, fn, options);
		this.cleanups.push(() => target.removeEventListener(type, fn, options));
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.live = false;
		this.outAnim?.cancel();
		this.outAnim = null;
		this.nav = null;
		for (const c of this.cleanups) c();
		this.cleanups = [];
		this.unsubscribe();
		this.index.destroy();
		const pop = this.hoverParent.hoverPopover as (HoverPopover & { hide?: () => void }) | null;
		pop?.hide?.();
		this.hoverParent.hoverPopover = null;
		this.cells.clear();
		this.body.empty();
	}
}

export const calendarPanel: PanelDefinition = {
	id: "calendar",
	icon: "calendar-days",
	isAvailable: () => true,
	create: (ctx, body) => new CalendarPanel(ctx, body),
};
