// The Tasks tab of the Workbench: the task list. One tab for both places: a compact list in a side
// panel, and navigator + list + details when the Workbench is a page. Everything it changes is
// written in the notes. The Workbench (src/core/workbench) owns the view, the tab bar and the
// layout; this tab owns everything inside its root, div.sk-tasks-view.
import { Menu, Platform, Scope, type WorkspaceLeaf } from "obsidian";
import { openTagPicker, type TagPickerHandle } from "../../ui/tag-picker";

/** A tag the task lines read back (the grammar of the Tasks API). */
const TAG_NAME = /^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u;
import { cssColor, dayClear, dayProgress, dust, fly, glide, odometer, plusOne, pop, spark, wave } from "../../ui/playful";
import type { TabState, WorkbenchTabHost, WorkbenchTabInstance } from "../../core/workbench/types";
import { richText } from "../../ui/settings-page";
import { capsule, checkbox, colorFor, descriptionPreview, icon, kbd, renderInline, tagDot } from "./components";
import {
	addDays, buildTree, countTasks, dueState, findNode, inScope, matchesQuery, moveInOrder, nextWeek, passesPriority,
	sortTasks, todayGroups, upcomingGroups, type TagNode, declaredFlags, flagCounts, hasFlag, isParked, parkingOf,
} from "./group";
import type { ViewAction } from "./api";
import type { TasksHub } from "./hub";
import { TaskNoteView } from "./task-note-view";
import { RenameTagModal } from "./rename-tag";
import { TAG_RENAMED_EVENT } from "../../core/services";
import type { TagRenameResult } from "../../core/tags/rename";
import { PRIORITIES } from "./parse";
import { parseQuickAdd } from "./quick-add";
import type { Priority, Task } from "./types";

const SORT_MODES = ["notes", "priority", "due", "manual"] as const;

type Layout = "page" | "side";

interface ViewState {
	/** "all", "today", "upcoming" or "tag:<tag>". */
	scope: string;
	query: string;
	/** Selected task key (details shown in the page layout). */
	sel: string | null;
	/** Task whose details are unfolded under its row (side layout). */
	open: string | null;
	/** Quick add row: null = closed, "" = at the top, else the tag of its group. */
	adding: string | null;
	/** Text typed in the quick add row and not added yet (kept through redraws and tab changes). */
	draft: string;
	/** Property of the details whose choices are unfolded. */
	editProp: string | null;
	/** Phone: the panel open under the filter bar, or null. */
	panel?: "tag" | "prio" | "type" | null;
	/** Phone: the search field is shown. */
	searching?: boolean;
	/** Phone: the tasks just added from the add row (newest first), to see them land. */
	justAdded?: string[];
	propsFor: string | null;
}

function noteName(path: string): string {
	return path.replace(/^.*\//, "").replace(/\.md$/i, "");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** What a Workbench leaf's list showed (search, selection, quick add) when its tab was last mounted. */
type Memory = Pick<ViewState, "scope" | "query" | "sel" | "open" | "adding" | "draft" | "editProp" | "propsFor"> & {
	/** Where the cursor was in the quick add row, and whether that row had the focus. */
	caret: { start: number; end: number; focused: boolean } | null;
};
const memories = new WeakMap<WorkspaceLeaf, Memory>();

export class TasksTab implements WorkbenchTabInstance {
	private closed = false;
	private readonly layout: Layout;
	/** The root of the tab (it used to be the view's content element). */
	private readonly rootEl: HTMLElement;
	/**
	 * Tasks picked together (Ctrl/Cmd+click, Shift+click, Shift+arrows, Ctrl/Cmd+A): acted on at once
	 * from two. Each key keeps the place it had when picked: a key that now names another task (a
	 * twin renumbered) is dropped, never acted on.
	 */
	private readonly picked = new Map<string, { path: string; raw: string }>();
	/** Where a range starts (the last task clicked or reached by the arrows); focus never moves it. */
	private anchor: string | null = null;
	/** Keys being dragged together (the picked tasks), or empty. */
	private dragKeys: string[] = [];
	private readonly st: ViewState = { scope: "all", query: "", sel: null, open: null, adding: null, draft: "", editProp: null, propsFor: null };
	private pending = false;
	private animating = 0;
	private freshKey: string | null = null;
	/** The task whose added line just landed on it: it glows a moment (kept through redraws). */
	private landedKey: string | null = null;
	private dragKey: string | null = null;
	private readonly cleanups: Array<() => void> = [];
	/** F2 is Obsidian's "Rename file": while the list has the focus, it renames the selected task. */
	private readonly keyScope: Scope;
	private scoped = false;
	private navEl: HTMLElement | null = null;
	/** The tag being dragged in the navigator to reorder it (a task drag uses dragKey). */
	private dragTag: string | null = null;
	private headEl: HTMLElement | null = null;
	private listEl: HTMLElement | null = null;
	private footEl: HTMLElement | null = null;
	private detailEl: HTMLElement | null = null;
	private searchInput: HTMLInputElement | null = null;
	private countEl: HTMLElement | null = null;
	private scopeEl: HTMLElement | null = null;
	private hubTitleEl: HTMLElement | null = null;
	private subEl: HTMLElement | null = null;
	/** "N done today", with the ring of the day. */
	private doneEl: HTMLElement | null = null;
	/** The count shown last (it rolls only when it changes). */
	private doneShown: number | null = null;
	/**
	 * Phone: one line of soft buttons (Tag, Priority, Type, search); a tap unfolds its panel under
	 * the bar, a second tap folds it. The button says what is on ("#home", "High +1", "Focus").
	 */
	private renderPhoneBar(open: readonly Task[]): void {
		const bar = this.phoneBar;
		const panel = this.phonePanel;
		if (!bar || !panel) return;
		bar.empty();
		const scope = this.st.scope;
		const prio = this.settings.priorityFilter;
		const flag = scope.startsWith("flag:") ? scope.slice(5) : this.flagOn();
		const button = (id: "tag" | "prio" | "type", iconName: string, label: string, on: boolean, clear: (() => void) | null) => {
			const b = bar.createEl("button", { cls: "sk-tasks-pbtn" + (on ? " is-on" : "") + (this.st.panel === id ? " is-open" : ""), attr: { type: "button", "aria-expanded": String(this.st.panel === id) } });
			icon(b, iconName);
			b.createSpan({ cls: "sk-tasks-pbtn-l", text: label });
			if (on && clear) {
				const x = b.createSpan({ cls: "sk-tasks-pbtn-x", attr: { role: "button", "aria-label": this.t("filter.clear") } });
				icon(x, "x");
				x.addEventListener("click", (e) => {
					e.stopPropagation();
					this.st.panel = null;
					clear();
				});
			} else icon(b, "chevron-down", "sk-tasks-pbtn-chev");
			b.addEventListener("click", () => {
				this.st.panel = this.st.panel === id ? null : id;
				this.renderPhoneBar(this.hub.index.open());
			});
		};
		const tag = scope.startsWith("tag:") ? scope.slice(4) : null;
		button("tag", "hash", tag ? tag.split("/").pop() ?? tag : this.t("scope.tag"), !!tag, () => this.setScope("all"));
		const prioLabel = prio.length ? this.t("prio." + prio[0]) + (prio.length > 1 ? ` +${prio.length - 1}` : "") : this.t("filter.priority");
		button("prio", "flag", prioLabel, prio.length > 0, () => {
			this.settings.priorityFilter = [];
			void this.hub.ctx.saveSettings();
			this.refresh();
		});
		if (this.flags().length) button("type", flag ? this.flagIcon(flag) : "zap", flag ? this.flagLabel(flag) : this.t("filter.type"), !!flag, () => {
			if (scope.startsWith("flag:")) this.setScope("all");
			else this.toggleFlagFilter(flag!);
		});
		const search = bar.createEl("button", { cls: "sk-tasks-pbtn is-icon" + (this.st.searching || this.st.query ? " is-on" : ""), attr: { type: "button", "aria-label": this.t("search.placeholder") } });
		icon(search, "search");
		search.addEventListener("click", () => {
			this.st.searching = !(this.st.searching || this.st.query);
			if (!this.st.searching && this.st.query) {
				this.st.query = "";
				if (this.searchInput) this.searchInput.value = "";
				this.refresh();
			}
			this.renderPhoneBar(this.hub.index.open());
			if (this.st.searching) this.searchInput?.focus();
		});
		this.rootEl.toggleClass("is-searching", !!(this.st.searching || this.st.query));

		// The panel: unfolds under the bar (height animated by the grid row), content of the button open.
		const box = panel.parentElement!;
		box.toggleClass("is-open", !!this.st.panel);
		panel.empty();
		if (this.st.panel === "tag") {
			const grid = panel.createDiv({ cls: "sk-tasks-pgrid" });
			const all = grid.createEl("button", { cls: "sk-tasks-popt" + (!tag ? " is-on" : ""), attr: { type: "button" } });
			icon(all, "layers");
			all.createSpan({ text: this.t("scope.all") });
			all.addEventListener("click", () => {
				this.st.panel = null;
				this.setScope("all");
			});
			// One line per tag of the first level, its nested tags after it.
			let line = grid;
			const walk = (node: TagNode) => {
				if (!node.depth) line = grid.createDiv({ cls: "sk-tasks-pline" });
				const b = line.createEl("button", { cls: "sk-tasks-popt is-tag" + (tag === node.tag ? " is-on" : "") + (node.depth ? " is-sub" : ""), attr: { type: "button" } });
				capsule(b, node.depth ? node.name : node.tag, this.hub);
				b.createSpan({ cls: "sk-tasks-popt-n", text: String(node.count) });
				b.addEventListener("click", () => {
					this.st.panel = null;
					this.setScope("tag:" + node.tag);
				});
				node.children.forEach(walk);
			};
			this.tagTree(open).forEach(walk);
		} else if (this.st.panel === "prio") {
			const grid = panel.createDiv({ cls: "sk-tasks-pgrid is-two" });
			for (const p of [...PRIORITIES, "none"]) {
				const on = prio.includes(p);
				const b = grid.createEl("button", { cls: "sk-tasks-popt" + (on ? " is-on" : ""), attr: { type: "button", "aria-pressed": String(on) } });
				icon(b, p === "none" ? "flag-off" : "flag", "sk-tasks-fl-" + p);
				b.createSpan({ text: this.t("prio." + p) });
				b.addEventListener("click", () => void this.togglePriorityFilter(p));
			}
		} else if (this.st.panel === "type") {
			const grid = panel.createDiv({ cls: "sk-tasks-pgrid is-two" });
			const counts = flagCounts(open, this.flags());
			for (const f of this.chipFlags()) {
				const on = this.flagOn() === f && !scope.startsWith("flag:");
				const b = grid.createEl("button", { cls: "sk-tasks-popt" + (on ? " is-on" : ""), attr: { type: "button", "aria-pressed": String(on) } });
				icon(b, this.flagIcon(f), "sk-tasks-flag-" + f);
				b.createSpan({ text: this.flagLabel(f) });
				b.createSpan({ cls: "sk-tasks-popt-n", text: String(counts[f] ?? 0) });
				b.addEventListener("click", () => {
					this.st.panel = null;
					if (scope.startsWith("flag:")) this.setScope("all");
					this.toggleFlagFilter(f);
				});
			}
			// Waiting, Someday: lists of their own, out of the day.
			for (const f of this.parking()) {
				const on = scope === "flag:" + f;
				const b = grid.createEl("button", { cls: "sk-tasks-popt is-list" + (on ? " is-on" : ""), attr: { type: "button" } });
				icon(b, this.flagIcon(f));
				b.createSpan({ text: this.flagLabel(f) });
				b.createSpan({ cls: "sk-tasks-popt-n", text: String(counts[f] ?? 0) });
				b.addEventListener("click", () => {
					this.st.panel = null;
					this.setScope(on ? "all" : "flag:" + f);
				});
			}
		}
	}

	/** The card of what was done today, open under the pill, and how it closes. */
	private donePop: { el: HTMLElement; off: () => void } | null = null;

	private closeDonePop(): void {
		this.donePop?.off();
		this.donePop?.el.remove();
		this.donePop = null;
	}

	/** The tasks checked today (stamped with today's date), in the order of the index. */
	private doneTodayTasks(): Task[] {
		const today = this.today();
		return this.hub.index.list.filter((t) => t.done && t.doneDate === today);
	}

	/** Under the pill of the day: what was done today; a task opens its note, Reopen unchecks it. */
	private toggleDonePop(pill: HTMLElement): void {
		if (this.donePop) {
			this.closeDonePop();
			return;
		}
		const doc = this.rootEl.doc;
		const el = doc.body.createDiv({ cls: "sk-tasks-donepop" + (Platform.isPhone ? " is-phone" : ""), attr: { role: "dialog" } });
		const fill = () => {
			el.empty();
			const tasks = this.doneTodayTasks();
			const head = el.createDiv({ cls: "sk-tasks-donepop-head" });
			icon(head, "check-circle-2");
			head.createSpan({ text: this.hub.ctx.tn("done.today", tasks.length) });
			if (!tasks.length) {
				el.createDiv({ cls: "sk-tasks-donepop-empty", text: this.t("done.none") });
				return;
			}
			const list = el.createDiv({ cls: "sk-tasks-donepop-list" });
			for (const t of tasks) {
				const row = list.createDiv({ cls: "sk-tasks-donepop-row" });
				const open = row.createEl("button", { cls: "sk-tasks-donepop-open", attr: { type: "button" } });
				icon(open, "check");
				const text = open.createSpan({ cls: "sk-tasks-donepop-text" });
				renderInline(text, t.title);
				if (t.primary) capsule(open, t.primary, this.hub, "sk-tasks-cap-sm");
				open.addEventListener("click", (e) => {
					this.closeDonePop();
					void this.openTask(t, e);
				});
				const back = row.createEl("button", { cls: "sk-btn is-ghost is-s sk-tasks-donepop-back", attr: { type: "button" } });
				icon(back, "rotate-ccw");
				back.createSpan({ text: this.t("done.reopen") });
				back.addEventListener("click", () => {
					back.disabled = true;
					void this.hub.writer.setDone(t, false).then(() => {
						if (this.closed) return;
						this.refresh();
						fill();
					});
				});
			}
		};
		fill();
		// Under the pill, inside the window; on a phone, the width of the screen.
		const r = pill.getBoundingClientRect();
		const win = doc.win;
		const width = Platform.isPhone ? win.innerWidth - 24 : Math.min(360, win.innerWidth - 24);
		el.style.width = `${width}px`;
		el.style.left = `${Math.max(12, Math.min(win.innerWidth - width - 12, r.right - width))}px`;
		el.style.top = `${r.bottom + 8}px`;
		const outside = (e: MouseEvent) => {
			if (!el.contains(e.target as Node) && !pill.contains(e.target as Node)) this.closeDonePop();
		};
		const key = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			this.closeDonePop();
			pill.focus();
		};
		doc.addEventListener("mousedown", outside, true);
		doc.addEventListener("keydown", key, true);
		this.donePop = {
			el,
			off: () => {
				doc.removeEventListener("mousedown", outside, true);
				doc.removeEventListener("keydown", key, true);
			},
		};
	}

	/** A long press just opened a menu: the tap that follows does nothing. */
	private suppressClick = 0;
		/** Phone: the filter bar (Tag, Priority, Type, search) and the panel it opens. */
	private phoneBar: HTMLElement | null = null;
	private phonePanel: HTMLElement | null = null;
	/** The flags the chips were built for (they are rebuilt when the settings change them). */
	private chipSig = "";
	/** The tag picker open from this tab, closed with it. */
	private tagPop: TagPickerHandle | null = null;
	/** Tasks being checked right now (a second click or X on the same task does nothing). */
	private readonly checking = new Set<string>();
	private sortLabel: HTMLElement | null = null;
	private filterBtn: HTMLElement | null = null;
	/** Buttons of other plugins (ViewAction), drawn again at each refresh. */
	private extEl: HTMLElement | null = null;
	/** What the details showed last time, so their entrance animation plays only on a change. */
	private shownDetail: string | null = null;
	private shownProp: string | null = null;
	private notePreview: TaskNoteView | null = null;

	constructor(
		private readonly hub: TasksHub,
		private readonly el: HTMLElement,
		private readonly host: WorkbenchTabHost,
	) {
		this.layout = host.layout;
		const scope = host.state.scope;
		if (typeof scope === "string" && scope) this.st.scope = scope;
		const memory = memories.get(host.leaf);
		let caret: Memory["caret"] = null;
		if (memory) {
			const { scope: was, caret: kept, ...rest } = memory;
			Object.assign(this.st, rest);
			// Shown again on another scope: the quick add row closes, as when the scope changes here.
			if (was === this.st.scope) caret = kept;
			else {
				this.st.adding = null;
				this.st.draft = "";
			}
		}
		el.addClass("sk-tasks-tab");
		this.rootEl = el.createDiv({ cls: "sk-tasks-view" });
		this.rootEl.tabIndex = -1;
		this.listen(this.rootEl, "keydown", (event) => void this.onKey(event));
		this.keyScope = new Scope(hub.ctx.app.scope);
		this.keyScope.register([], "F2", (event) => {
			const target = event.target as HTMLElement | null;
			const t = this.hub.index.get(this.st.sel);
			if (target?.closest("[data-sk-zone=nav], [data-sk-zone=toolbar]")) return;
			if (!t || target?.matches?.("input, textarea") || target?.isContentEditable) return;
			this.inlineRename(t);
			return false;
		});
		this.listen(this.rootEl, "focusin", () => this.syncScope());
		// A refresh waits while a field has the focus; it runs when the focus leaves.
		this.listen(this.rootEl, "focusout", () => {
			window.setTimeout(() => {
				this.syncScope();
				if (this.closed || !this.rootEl.isConnected || this.isEditing()) return;
				if (this.pending) this.refresh();
			}, 0);
		});
		this.build();
		if (caret) this.restoreCaret(caret);
	}

	private listen<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void): void {
		el.addEventListener(type, handler);
		this.cleanups.push(() => el.removeEventListener(type, handler));
	}

	/** Opens the note at the task line; from a transient Workbench (a new tab), in its place. */
	private openTask(t: Task, event?: MouseEvent | KeyboardEvent): Promise<void> {
		return this.hub.writer.openTask(t, event, this.host.transient ? this.host.leaf : null);
	}

	// ----- the Workbench's side (WorkbenchTabInstance) -----

	getState(): TabState {
		return { scope: this.st.scope };
	}

	setState(state: TabState): void {
		if (typeof state.scope === "string" && state.scope && state.scope !== this.st.scope) this.setScope(state.scope);
	}

	update(): void {
		this.refresh();
	}

	/** Typing in a field of the list: a layout change of the Workbench waits. */
	busy(): boolean {
		return this.isEditing();
	}

	private zoneItem(el: HTMLElement): void {
		el.setAttr("data-sk-item", "");
		el.tabIndex = 0;
		if (!el.hasAttribute("role")) el.setAttr("role", "button");
		el.addEventListener("keydown", (e) => {
			if (e.key !== "Enter" || e.target !== el) return;
			e.preventDefault();
			e.stopPropagation();
			el.click();
		});
	}

	keys(): Array<[string, string]> {
		return [
			["↑ ↓ / J K", this.t("keyboard.move")],
			["Enter", this.t("keyboard.open")],
			["X / Space", this.t("keyboard.done")],
			["T", this.t("keyboard.today")],
			["0 1 2 3", this.t("keyboard.priority")],
			["M", this.t("keyboard.tag")],
			["F2", this.t("keyboard.rename")],
			["Del", this.t("keyboard.delete")],
			["Ctrl / Shift + click", this.t("keyboard.pick")],
			["Shift+↑ ↓", this.t("keyboard.pick-more")],
			["N", this.t("keyboard.new")],
			["/", this.t("keyboard.search")],
			["Alt+↑ ↓", this.t("keyboard.reorder")],
		];
	}

	/** The Workbench was revealed or this tab chosen: the keyboard acts on the list. */
	focus(): void {
		if (this.closed) return;
		const active = this.rootEl.doc.activeElement;
		if (active && this.rootEl.contains(active)) return;
		this.rootEl.focus({ preventScroll: true });
	}

	/** Our keys go first while the focus is in the list. */
	private syncScope(): void {
		const want = !this.closed && this.rootEl.isConnected && this.rootEl.contains(this.rootEl.doc.activeElement);
		if (want === this.scoped) return;
		this.scoped = want;
		if (want) this.hub.ctx.app.keymap.pushScope(this.keyScope);
		else this.hub.ctx.app.keymap.popScope(this.keyScope);
	}

	destroy(): void {
		if (this.closed) return;
		this.closed = true;
		this.closeDonePop();
		this.el.removeClass("sk-tasks-tab");
		this.tagPop?.close();
		this.tagPop = null;
		this.notePreview?.unload();
		this.notePreview = null;
		if (this.scoped) this.hub.ctx.app.keymap.popScope(this.keyScope);
		this.scoped = false;
		const { scope, query, sel, open, adding, draft, editProp, propsFor } = this.st;
		memories.set(this.host.leaf, { scope, query, sel, open, adding, draft, editProp, propsFor, caret: this.caret() });
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.rootEl.doc.body.removeClass("sk-tasks-dnd");
		this.rootEl.remove();
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.hub.ctx.t(key, vars);
	}

	private get settings() {
		return this.hub.ctx.settings;
	}

	private isEditing(): boolean {
		const active = this.rootEl.doc.activeElement as HTMLElement | null;
		return (
			!!active &&
			this.rootEl.contains(active) &&
			active !== this.searchInput &&
			!active.closest(".sk-tasks-add") &&
			(active.matches("input, textarea") || active.isContentEditable)
		);
	}

	// ----- data -----

	private today(): string {
		return this.hub.today();
	}

	private filtered(): Task[] {
		const filter = this.settings.priorityFilter;
		// The Waiting and Someday lists show all their tasks, whatever the chip on.
		const flag = this.st.scope.startsWith("flag:") ? null : this.flagOn();
		return this.hub.index.open().filter((t) => matchesQuery(t, this.st.query) && passesPriority(t, filter) && (!flag || hasFlag(t, flag)));
	}

	/** The flags of the settings (priorities left out). */
	private flags(): string[] {
		return declaredFlags(this.settings.flagTags);
	}

	/** Flags that take a task out of the day (waiting, someday): an entry of their own in the navigator. */
	private parking(): string[] {
		return parkingOf(this.flags());
	}

	/** Flags offered as chips over the list (quick, deep, the user's own). */
	private chipFlags(): string[] {
		const parking = this.parking();
		return this.flags().filter((f) => !parking.includes(f));
	}

	/** The flag chip on, when it is still a declared flag. */
	private flagOn(): string | null {
		const f = this.settings.flagFilter;
		return f && this.chipFlags().includes(f) ? f : null;
	}

	/** The flags as chips: how a task is done (quick, deep, the user's own), one at a time. Rebuilt when the flags change. */
	private flagChips(chips: HTMLElement): void {
		chips.querySelectorAll(".sk-tasks-flagchip").forEach((c) => c.remove());
		this.chipSig = this.chipFlags().join("|");
		for (const f of this.chipFlags()) {
			const chip = chips.createEl("button", { cls: "sk-btn is-s sk-tasks-fchip sk-tasks-flagchip", attr: { type: "button", "aria-pressed": "false" } });
			chip.dataset.flag = f;
			icon(chip, this.flagIcon(f), "sk-tasks-flag-" + f);
			chip.createSpan({ text: this.flagLabel(f) });
			chip.createSpan({ cls: "sk-tasks-flagchip-n" });
			chip.addEventListener("click", () => this.toggleFlagFilter(f));
		}
	}

	/** Counts of the day: tasks waiting on someone or kept for some day leave Today and Upcoming. */
	private dayCounts(open: readonly Task[]): ReturnType<typeof countTasks> {
		const parking = this.parking();
		const c = countTasks(open.filter((t) => !isParked(t, parking)), this.today());
		return { ...c, all: open.length };
	}

	flagLabel(flag: string): string {
		return ["quick", "deep", "waiting", "someday"].includes(flag) ? this.t("flag." + flag) : "#" + flag;
	}

	flagIcon(flag: string): string {
		return ({ quick: "zap", deep: "target", waiting: "hourglass", someday: "cloud" } as Record<string, string>)[flag] ?? "hash";
	}

	/** A flag chip on or off. Playful: the rows that leave turn to dust, the others close ranks. */
	private toggleFlagFilter(flag: string): void {
		const next = this.settings.flagFilter === flag ? "" : flag;
		const list = this.listEl;
		const playful = this.hub.playful(this.rootEl.win);
		const apply = () => {
			const before = new Map<string, number>();
			list?.querySelectorAll<HTMLElement>(".sk-tasks-row[data-key]").forEach((r) => before.set(r.dataset.key!, r.getBoundingClientRect().top));
			this.settings.flagFilter = next;
			void this.hub.ctx.saveSettings();
			this.refresh();
			if (!playful || !list) return;
			let k = 0;
			list.querySelectorAll<HTMLElement>(".sk-tasks-row[data-key]").forEach((r) => {
				const was = before.get(r.dataset.key!);
				if (was === undefined) {
					r.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 300, delay: k++ * 25, fill: "backwards" });
					return;
				}
				const dy = was - r.getBoundingClientRect().top;
				if (Math.abs(dy) < 1) return;
				r.animate([{ transform: `translateY(${dy}px)` }, { transform: `translateY(${-Math.sign(dy) * 3}px)`, offset: 0.7 }, { transform: "none" }], { duration: 460, delay: k++ * 26, easing: "cubic-bezier(0.25, 1, 0.35, 1)", fill: "backwards" });
			});
		};
		if (!playful || !next || !list) {
			apply();
			return;
		}
		const leaving = Array.from(list.querySelectorAll<HTMLElement>(".sk-tasks-row[data-key]")).filter((r) => {
			const t = this.hub.index.get(r.dataset.key ?? null);
			return t && !hasFlag(t, next);
		});
		const faint = cssColor(this.rootEl, "--text-faint", "#999");
		leaving.forEach((r, i) => {
			this.rootEl.win.setTimeout(() => dust(this.rootEl.doc, r.getBoundingClientRect(), faint), i * 30);
			r.animate([{ opacity: 1, filter: "blur(0px)", transform: "none" }, { opacity: 0, filter: "blur(3px)", transform: "translateX(14px)" }], { duration: 300, delay: i * 30, fill: "forwards", easing: "ease-in" });
		});
		this.rootEl.win.setTimeout(apply, leaving.length ? Math.min(300 + leaving.length * 30, 700) : 0);
	}

	/** Untagged tasks of recent notes, with the search and the priority filter applied. */
	private untaggedShown(): Task[] {
		const filter = this.settings.priorityFilter;
		const flag = this.flagOn();
		return this.hub.index.untagged.filter((t) => matchesQuery(t, this.st.query) && passesPriority(t, filter) && (!flag || hasFlag(t, flag)));
	}

	private sorted(tasks: readonly Task[]): Task[] {
		return sortTasks(tasks, this.settings.sortMode, this.settings.taskOrder);
	}

	private visibleKeys(): string[] {
		return Array.from(this.rootEl.querySelectorAll<HTMLElement>(".sk-tasks-row[data-key]"), (row) => row.dataset.key!);
	}

	private rowOf(key: string): HTMLElement | null {
		return this.listEl?.querySelector<HTMLElement>(`.sk-tasks-row[data-key="${CSS.escape(key)}"]`) ?? null;
	}

	// ----- skeleton -----

	build(): void {
		if (this.closed) return;
		this.pending = false;
		this.navEl = this.headEl = this.listEl = this.footEl = this.detailEl = this.searchInput = this.extEl = null;
		const el = this.rootEl;
		el.empty();
		el.toggleClass("is-page", this.layout === "page");
		el.toggleClass("is-side", this.layout === "side");
		// On a phone: a lighter head (no title, no page button), one big New task button on top.
		el.toggleClass("is-phone", Platform.isPhone);
		const hub = el.createDiv({ cls: `sk-tasks-hub sk-tasks-${this.layout ?? "side"}` });
		if (this.layout === "page") {
			this.navEl = hub.createDiv({ cls: "sk-tasks-nav", attr: { "data-sk-zone": "nav" } });
			const center = hub.createDiv({ cls: "sk-tasks-center" });
			this.headEl = center.createDiv({ cls: "sk-tasks-page-head", attr: { "data-sk-zone": "toolbar" } });
			this.listEl = center.createDiv({ cls: "sk-tasks-list", attr: { "data-sk-zone": "list" } });
			this.footEl = center.createDiv({ cls: "sk-tasks-foot" });
			this.detailEl = hub.createDiv({ cls: "sk-tasks-detail", attr: { "data-sk-zone": "detail" } });
		} else {
			this.navEl = null;
			this.detailEl = null;
			this.headEl = hub.createDiv({ cls: "sk-tasks-side-head" });
			this.listEl = hub.createDiv({ cls: "sk-tasks-list", attr: { "data-sk-zone": "list" } });
			this.footEl = hub.createDiv({ cls: "sk-tasks-foot" });
		}
		this.renderHead();
		this.renderFoot();
		this.pending = false;
		this.refresh();
	}

	refresh(): void {
		if (this.closed) return;
		if (!this.listEl) return;
		// Wait for an edit or a completion animation to finish.
		if (this.isEditing() || this.animating) {
			this.pending = true;
			return;
		}
		this.pending = false;
		this.notePreview?.detach();
		const focusedScope = this.rootEl.doc.activeElement?.closest<HTMLElement>("[data-scope]")?.dataset.scope;
		const focusedRow = this.rootEl.doc.activeElement?.closest<HTMLElement>(".sk-tasks-row[data-key]")?.dataset.key;
		const focusedEarlier = !!this.rootEl.doc.activeElement?.closest(".sk-tasks-grp-earlier .sk-tasks-grp-toggle");
		const scroll = this.listEl.scrollTop;
		const addInput = this.listEl.querySelector<HTMLInputElement>(".sk-tasks-add input");
		const adding = addInput && this.rootEl.doc.activeElement === addInput ? { value: addInput.value, pos: addInput.selectionStart ?? 0 } : null;
		if (this.st.sel && !this.hub.index.get(this.st.sel)) this.st.sel = null;
		if (this.st.open && !this.hub.index.get(this.st.open)) this.st.open = null;
		if (!(this.layout === "page" ? this.st.sel : this.st.open)) this.shownDetail = null;
		if (!this.st.editProp) this.shownProp = null;
		this.updateHead();
		if (this.navEl) this.renderNav();
		this.renderList();
		// A tag with no group on screen yet (no task, another view): the add row stays on top, with that tag.
		if (this.st.adding !== null && this.listEl) {
			const want = this.st.adding;
			const placed = Array.from(this.listEl.querySelectorAll<HTMLElement>(".sk-tasks-add"));
			if (!placed.some((r) => (r.dataset.tag ?? "") === want)) {
				for (const r of placed) r.remove();
				this.listEl.prepend(this.addRow(this.listEl, want || null));
			}
		}
		this.reconcilePicked();
		if (this.layout === "side") {
			this.listEl.removeAttribute("data-sk-zone");
			const entry = this.rowOf(this.st.sel ?? "") ?? this.listEl.querySelector<HTMLElement>(".sk-tasks-row[data-key]");
			if (entry) {
				// Keep the inline detail outside the list zone without moving it.
				const zone = entry.parentElement!.createDiv({ attr: { "data-sk-zone": "list" } });
				entry.before(zone);
				zone.appendChild(entry);
				entry.setAttr("data-sk-zone-focus", "");
				entry.tabIndex = 0;
			} else this.listEl.setAttr("data-sk-zone", "list");
		}
		if (this.detailEl) this.renderDetail();
		if (this.notePreview && !this.rootEl.contains(this.notePreview.el)) {
			this.notePreview.unload();
			this.notePreview = null;
		}
		this.listEl.scrollTop = scroll;
		if (focusedRow && this.st.sel) this.rowOf(this.st.sel)?.focus({ preventScroll: true });
		if (focusedEarlier) this.listEl.querySelector<HTMLElement>(".sk-tasks-grp-earlier .sk-tasks-grp-toggle")?.focus({ preventScroll: true });
		if (focusedScope) Array.from(this.rootEl.querySelectorAll<HTMLElement>("[data-scope]")).find((item) => item.dataset.scope === focusedScope)?.focus({ preventScroll: true });
		this.rootEl.querySelectorAll<HTMLElement>("[data-sk-zone] button").forEach((button) => button.setAttr("data-sk-item", ""));
		if (adding) {
			const input = this.listEl.querySelector<HTMLInputElement>(".sk-tasks-add input");
			if (input) {
				input.value = adding.value;
				input.focus();
				input.setSelectionRange(adding.pos, adding.pos);
			}
		}
		// The arrival animation of a new task plays once.
		if (this.freshKey && this.listEl.querySelector(".sk-tasks-row.is-new")) this.freshKey = null;
	}

	// ----- header -----

	private iconButton(parent: HTMLElement, name: string, label: string, onClick: (event: MouseEvent) => void): HTMLElement {
		const button = parent.createEl("button", { cls: "sk-btn is-ghost is-icon is-s", attr: { "aria-label": label } });
		icon(button, name);
		button.addEventListener("click", onClick);
		return button;
	}

	private renderHead(): void {
		const head = this.headEl!;
		head.empty();
		this.filterBtn = this.countEl = this.scopeEl = this.hubTitleEl = this.subEl = this.sortLabel = this.extEl = this.doneEl = null;
		this.doneShown = null;
		if (this.layout === "side") {
			const toolbar = head.createDiv({ attr: { "data-sk-zone": "toolbar" } });
			const top = toolbar.createDiv({ cls: "sk-tasks-side-top" });
			const title = top.createDiv({ cls: "sk-tasks-title" });
			title.createSpan({ text: this.t("view.title") });
			this.countEl = title.createSpan({ cls: "sk-tasks-count" });
			this.doneEl = this.donePill(top);
			this.iconButton(top, "arrow-up-down", this.t("sort.label"), (e) => this.sortMenu(e));
			this.filterBtn = this.iconButton(top, "list-filter", this.t("filter.label"), (e) => this.filterMenu(e));
			this.filterBtn.addClass("sk-tasks-filter-btn");
			this.extEl = top.createDiv({ cls: "sk-tasks-ext" });
			this.iconButton(top, "maximize-2", this.t("action.page"), () => void this.hub.activate("page", { tasks: true })).addClass("sk-tasks-page-btn");
			if (!Platform.isPhone) {
				// New task: the one filled button of the head, with its words, easy to find.
				const add = top.createEl("button", { cls: "sk-btn is-primary is-s sk-tasks-new-btn", attr: { type: "button", "aria-label": this.t("action.new-key") } });
				icon(add, "plus");
				add.createSpan({ cls: "sk-tasks-new-label", text: this.t("action.new") });
				add.addEventListener("click", () => this.startAdd(null));
			}
			if (Platform.isPhone) {
				// A round button floats above the list: New task, always at hand, never in the way.
				const fab = this.rootEl.createEl("button", { cls: "sk-tasks-fab", attr: { type: "button", "aria-label": this.t("action.new") } });
				icon(fab, "plus");
				fab.addEventListener("click", () => {
					this.st.panel = null;
					this.startAdd(null);
				});
				this.searchBox(toolbar.createDiv({ cls: "sk-tasks-phone-search" }));
			} else this.searchBox(toolbar);
			this.scopeEl = head.createDiv({ cls: "sk-tasks-scopes", attr: { "data-sk-zone": "nav" } });
			if (Platform.isPhone) {
				this.phoneBar = head.createDiv({ cls: "sk-tasks-pbar" });
				this.phonePanel = head.createDiv({ cls: "sk-tasks-ppanel" }).createDiv({ cls: "sk-tasks-ppanel-in" });
			}
		} else {
			const titleRow = head.createDiv({ cls: "sk-tasks-ph-title" });
			this.hubTitleEl = titleRow.createDiv({ cls: "sk-tasks-ph-name" });
			this.subEl = titleRow.createDiv({ cls: "sk-tasks-ph-sub" });
			this.doneEl = this.donePill(titleRow);
			const tools = head.createDiv({ cls: "sk-tasks-ph-tools" });
			this.searchBox(tools);
			const chips = tools.createDiv({ cls: "sk-tasks-fchips" });
			for (const p of [...PRIORITIES, "none"]) {
				const chip = chips.createEl("button", { cls: "sk-btn is-s sk-tasks-fchip" + (this.settings.priorityFilter.includes(p) ? " is-on" : "") });
				chip.dataset.prio = p;
				icon(chip, p === "none" ? "flag-off" : "flag", "sk-tasks-fl-" + p);
				chip.createSpan({ text: this.t("prio." + p) });
				chip.addEventListener("click", () => void this.togglePriorityFilter(p));
			}
			this.flagChips(chips);
			this.extEl = tools.createDiv({ cls: "sk-tasks-ext" });
			const sort = tools.createEl("button", { cls: "sk-btn is-ghost" });
			icon(sort, "arrow-up-down");
			this.sortLabel = sort.createSpan();
			sort.addEventListener("click", (e) => this.sortMenu(e));
			// New task lives on top of the navigator; without one (a narrow page), it stays here.
			if (!this.navEl) {
				const add = tools.createEl("button", { cls: "sk-btn is-primary" });
				icon(add, "plus");
				add.createSpan({ text: this.t("action.new") });
				kbd(add, "N");
				add.addEventListener("click", () => this.startAdd(null));
			}
		}
	}

	private searchBox(parent: HTMLElement): void {
		const box = parent.createDiv({ cls: "sk-tasks-search" });
		icon(box, "search");
		const input = box.createEl("input", { type: "text", attr: { placeholder: this.t("search.placeholder"), spellcheck: "false" } });
		input.value = this.st.query;
		kbd(box, "/");
		input.addEventListener("input", () => {
			this.st.query = input.value;
			this.refresh();
		});
		input.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				input.value = "";
				this.st.query = "";
				this.refresh();
				this.rootEl.focus();
			}
			if (e.key === "Enter" || e.key === "ArrowDown") {
				e.preventDefault();
				this.rootEl.focus();
				this.moveSel(1);
			}
		});
		this.searchInput = input;
	}

	private renderActions(): void {
		const box = this.extEl;
		if (!box) return;
		box.empty();
		for (const get of this.hub.viewActions) {
			let action: ViewAction | null = null;
			try {
				action = get();
			} catch (error) {
				console.error("[Snailkit] tasks: a view action failed", error);
			}
			if (!action) continue;
			const run = action.onClick.bind(action);
			const state = action.state ? " is-" + action.state : "";
			const button =
				this.layout === "page"
					? box.createEl("button", { cls: "sk-btn is-ghost sk-tasks-ext-btn" + (action.text ? "" : " is-icon") + state, attr: { "aria-label": action.label } })
					: box.createEl("button", { cls: "sk-btn is-ghost is-icon is-s sk-tasks-ext-btn" + state, attr: { "aria-label": action.label } });
			icon(button, action.icon);
			if (this.layout === "page" && action.text) button.createSpan({ text: action.text });
			button.addEventListener("click", () => {
				try {
					run();
				} catch (error) {
					console.error("[Snailkit] tasks: a view action failed", error);
				}
			});
		}
	}

	/** The pill of the day: a ring that fills as the tasks due are done, and the count rolling. */
	private donePill(parent: HTMLElement): HTMLElement {
		const pill = parent.createDiv({ cls: "sk-tasks-done", attr: { role: "button", tabindex: "0" } });
		// A click shows what was done today (and lets a task be reopened).
		pill.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleDonePop(pill);
		});
		pill.addEventListener("keydown", (e) => {
			if (e.key !== "Enter" && e.key !== " ") return;
			e.preventDefault();
			this.toggleDonePop(pill);
		});
		const svg = pill.createSvg("svg", { cls: "sk-tasks-ring", attr: { viewBox: "0 0 30 30", "aria-hidden": "true" } });
		svg.createSvg("circle", { cls: "sk-tasks-ring-track", attr: { cx: "15", cy: "15", r: "12" } });
		svg.createSvg("circle", { cls: "sk-tasks-ring-fill", attr: { cx: "15", cy: "15", r: "12" } });
		svg.createSvg("path", { cls: "sk-tasks-ring-tick", attr: { d: "M10 15.5l3.2 3.2 6.8-7" } });
		pill.createSpan({ cls: "sk-tasks-done-n" });
		pill.createSpan({ cls: "sk-tasks-done-l" });
		pill.createSpan({ cls: "sk-wb-sr sk-tasks-done-sr" });
		return pill;
	}

	private updateDone(): void {
		const pill = this.doneEl;
		if (!pill) return;
		const done = this.hub.doneToday();
		const due = this.hub.stillDue();
		pill.toggleClass("is-empty", !done && !due);
		const n = pill.querySelector<HTMLElement>(".sk-tasks-done-n")!;
		odometer(n, done, this.doneShown !== null && this.doneShown !== done && this.hub.playful(this.rootEl.win));
		this.doneShown = done;
		pill.querySelector(".sk-tasks-done-l")!.setText(this.hub.ctx.tn("done.today", done).replace(String(done), "").trim());
		pill.querySelector(".sk-tasks-done-sr")!.setText(this.hub.ctx.tn("done.today", done));
		const ring = pill.querySelector<SVGCircleElement>(".sk-tasks-ring-fill")!;
		const c = 2 * Math.PI * 12;
		ring.style.strokeDasharray = String(c);
		ring.style.strokeDashoffset = String(c * (1 - dayProgress(done, due)));
		pill.toggleClass("is-full", done > 0 && due === 0);
	}

	private updateHead(): void {
		this.renderActions();
		this.updateDone();
		const open = this.hub.index.open();
		const c = this.dayCounts(open);
		const filter = this.settings.priorityFilter;
		this.filterBtn?.toggleClass("is-active", filter.length > 0 || !!this.flagOn());
		const chipBox = this.headEl?.querySelector<HTMLElement>(".sk-tasks-fchips");
		if (chipBox && this.chipFlags().join("|") !== this.chipSig) this.flagChips(chipBox);
		this.headEl?.querySelectorAll<HTMLElement>(".sk-tasks-flagchip").forEach((chip) => {
			const f = chip.dataset.flag ?? "";
			chip.toggleClass("is-on", this.flagOn() === f);
			chip.setAttr("aria-pressed", String(this.flagOn() === f));
			const n = chip.querySelector(".sk-tasks-flagchip-n");
			if (n) n.setText(String(flagCounts(open, [f])[f] ?? 0));
		});
		if (this.layout === "side") {
			this.countEl?.setText(String(c.all));
			const scopes = this.scopeEl!;
			scopes.empty();
			for (const [id, n] of [["all", c.all], ["today", c.today], ["upcoming", c.upcoming]] as const) {
				const button = scopes.createEl("button", { cls: "sk-tasks-scope" + (this.st.scope === id ? " is-on" : "") });
				button.dataset.scope = id;
				button.createSpan({ text: this.t("scope." + id) });
				if (n) button.createSpan({ cls: "sk-tasks-scope-n" + (id === "today" && c.overdue && this.settings.overdueFirst ? " is-warn" : ""), text: String(n) });
				button.addEventListener("click", () => this.setScope(id));
				if (id === "today") this.dropTarget(button, { due: true });
			}
			if (Platform.isPhone) this.renderPhoneBar(open);
			else if (!this.st.scope.startsWith("tag:") && !this.st.scope.startsWith("flag:")) {
				// One tag only: the shared picker, then the list of that tag and its sub-tags.
				const pick = scopes.createEl("button", { cls: "sk-tasks-scope sk-tasks-scope-tag" });
				icon(pick, "hash");
				pick.createSpan({ text: this.t("scope.tag") });
				pick.addEventListener("click", () => this.chooseTag(pick, null, [], (tag) => this.setScope("tag:" + tag.toLowerCase())));
			}
			if (this.st.scope.startsWith("tag:") && !Platform.isPhone) {
				const tag = this.st.scope.slice(4);
				const button = scopes.createEl("button", { cls: "sk-tasks-scope is-on is-tag", attr: { "aria-label": this.t("scope.all") } });
				capsule(button, tag, this.hub);
				icon(button, "x");
				button.addEventListener("click", () => this.setScope("all"));
			}
			if (this.st.scope.startsWith("flag:") && !Platform.isPhone) {
				const f = this.st.scope.slice(5);
				const button = scopes.createEl("button", { cls: "sk-tasks-scope is-on is-tag", attr: { "aria-label": this.t("scope.all") } });
				icon(button, this.flagIcon(f));
				button.createSpan({ text: this.flagLabel(f) });
				icon(button, "x");
				button.addEventListener("click", () => this.setScope("all"));
			}
		} else {
			const scope = this.st.scope;
			const title = this.hubTitleEl!;
			title.empty();
			if (scope.startsWith("tag:")) capsule(title, scope.slice(4), this.hub, "sk-tasks-cap-lg");
			else if (scope.startsWith("flag:")) title.createEl("h1", { text: this.flagLabel(scope.slice(5)) });
			else title.createEl("h1", { text: this.t("title." + scope) });
			const sub = this.subEl!;
			sub.empty();
			const n = scope.startsWith("tag:")
				? open.filter((t) => inScope(t.primary, scope.slice(4))).length
				: scope === "today"
					? c.today
					: scope === "upcoming"
						? c.upcoming
						: scope === "untagged"
							? this.hub.index.untagged.length
							: scope.startsWith("flag:")
								? open.filter((t) => hasFlag(t, scope.slice(5))).length
								: c.all;
			sub.createSpan({ text: this.hub.ctx.tn("head.open", n) });
			const dueToday = scope.startsWith("flag:") ? 0 : c.today - c.overdue;
			if (scope.startsWith("flag:")) {
				// A list out of the day: no counts of the day here.
			} else if (this.settings.overdueFirst) {
				if (c.overdue) sub.createSpan({ cls: "sk-tasks-od", text: " · " + this.hub.ctx.tn("head.overdue", c.overdue) });
				if (dueToday) sub.createSpan({ cls: "sk-tasks-td", text: " · " + this.hub.ctx.tn("head.today", dueToday) });
			} else {
				// Today first; what waits since earlier is said after it, without warning colors.
				if (dueToday) sub.createSpan({ cls: "sk-tasks-td", text: " · " + this.hub.ctx.tn("head.today", dueToday) });
				if (c.overdue) sub.createSpan({ cls: "sk-tasks-earlier", text: " · " + this.hub.ctx.tn("head.earlier", c.overdue) });
			}
			this.sortLabel?.setText(this.t("sort." + this.sortMode()));
			this.headEl?.querySelectorAll<HTMLElement>(".sk-tasks-fchip:not(.sk-tasks-flagchip)").forEach((chip) => chip.toggleClass("is-on", filter.includes(chip.dataset.prio ?? "")));
		}
	}

	private sortMode(): string {
		return (SORT_MODES as readonly string[]).includes(this.settings.sortMode) ? this.settings.sortMode : "notes";
	}

	private renderFoot(): void {
		const foot = this.footEl!;
		foot.empty();
		const hint = (keys: string[], label: string) => {
			const span = foot.createSpan();
			keys.forEach((key) => kbd(span, key));
			span.appendText(" " + label);
		};
		hint(["↑", "↓"], this.t("keys.move"));
		hint(["X"], this.t("keys.done"));
		hint(["↵"], this.t(this.layout === "page" ? "keys.open" : "keys.details"));
		hint(["1", "2", "3"], this.t("keys.priority"));
		if (this.layout === "page") {
			hint(["M"], this.t("keys.tag"));
			hint(["N"], this.t("keys.new"));
		}
	}

	/** Shows the tasks of one tag (and its sub-tags), as a click on that tag would. */
	showTag(tag: string): void {
		this.setScope("tag:" + tag.replace(/^#/, "").toLowerCase());
	}

	setScope(scope: string): void {
		this.st.scope = scope;
		this.host.saveState();
		this.st.adding = null;
		this.st.draft = "";
		this.refresh();
	}

	private sortMenu(event: MouseEvent): void {
		const menu = new Menu();
		for (const mode of SORT_MODES) {
			menu.addItem((item) =>
				item
					.setTitle(this.t("sort." + mode))
					.setChecked(this.sortMode() === mode)
					.onClick(async () => {
						this.settings.sortMode = mode;
						await this.hub.ctx.saveSettings();
					}),
			);
		}
		menu.showAtMouseEvent(event);
	}

	private async togglePriorityFilter(p: string): Promise<void> {
		const filter = this.settings.priorityFilter;
		this.settings.priorityFilter = filter.includes(p) ? filter.filter((x) => x !== p) : [...filter, p];
		await this.hub.ctx.saveSettings();
	}

	private filterMenu(event: MouseEvent): void {
		const menu = new Menu();
		for (const p of [...PRIORITIES, "none"]) {
			menu.addItem((item) =>
				item
					.setTitle(this.t("prio." + p))
					.setChecked(this.settings.priorityFilter.includes(p))
					.onClick(() => void this.togglePriorityFilter(p)),
			);
		}
		const flags = this.chipFlags();
		if (flags.length) menu.addSeparator();
		for (const f of flags) menu.addItem((item) => item.setTitle(this.flagLabel(f)).setIcon(this.flagIcon(f)).setChecked(this.flagOn() === f).onClick(() => this.toggleFlagFilter(f)));
		// Waiting, Someday: lists of their own (the side panel has no navigator).
		const parking = this.parking();
		if (parking.length) menu.addSeparator();
		for (const f of parking) menu.addItem((item) => item.setTitle(this.flagLabel(f)).setIcon(this.flagIcon(f)).setChecked(this.st.scope === "flag:" + f).onClick(() => this.setScope("flag:" + f)));
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(this.t("filter.focus"))
				.setIcon("hash")
				.onClick(() => this.chooseTag(this.filterBtn ?? this.rootEl, null, [], (tag) => this.setScope("tag:" + tag.toLowerCase()))),
		);
		menu.showAtMouseEvent(event);
	}

	// ----- navigator (page) -----

	private renderNav(): void {
		const nav = this.navEl!;
		nav.empty();
		const open = this.hub.index.open();
		const c = this.dayCounts(open);
		const item = (id: string, iconName: string, n: number, warn = false, label = this.t("title." + id)) => {
			const it = nav.createDiv({ cls: "sk-tasks-nav-item" + (this.st.scope === id ? " is-on" : "") });
			this.zoneItem(it);
			it.dataset.scope = id;
			icon(it, iconName);
			it.createSpan({ cls: "sk-tasks-nav-label", text: label });
			if (n) it.createSpan({ cls: "sk-tasks-n" + (warn ? " is-warn" : ""), text: String(n) });
			it.addEventListener("click", () => this.setScope(id));
			return it;
		};
		// New task on top of the navigator, as New brainstorm in the Brainstorms tab.
		const add = nav.createEl("button", { cls: "sk-btn is-primary sk-tasks-nav-new", attr: { type: "button" } });
		this.zoneItem(add);
		icon(add, "plus");
		add.createSpan({ text: this.t("action.new") });
		kbd(add, "N");
		add.addEventListener("click", () => this.startAdd(null));
		item("all", "layers", c.all);
		this.dropTarget(item("today", "sun", c.today, c.overdue > 0 && this.settings.overdueFirst), { due: true });
		item("upcoming", "calendar", c.upcoming);
		// Waiting on someone, kept for some day: out of the day, one place each to look at them.
		for (const f of this.parking()) item("flag:" + f, this.flagIcon(f), open.filter((t) => hasFlag(t, f)).length, false, this.flagLabel(f)).addClass("is-flag");
		nav.createDiv({ cls: "sk-tasks-nav-sec", text: this.t("nav.tags") });
		const walk = (node: TagNode) => {
			const it = nav.createDiv({ cls: "sk-tasks-nav-item sk-tasks-nav-tag" + (this.st.scope === "tag:" + node.tag ? " is-on" : "") });
			this.zoneItem(it);
			it.dataset.scope = "tag:" + node.tag;
			it.setCssProps({ "--sk-tasks-depth": String(node.depth) });
			if (node.depth === 0) capsule(it, node.tag, this.hub, "sk-tasks-cap-nav");
			else {
				const chip = it.createSpan({ cls: "sk-tasks-nav-chip sk-tasks-sec" + (node.depth > 1 ? " is-deep" : ""), text: node.name });
				colorFor(chip, node.tag, this.hub);
			}
			it.createSpan({ cls: "sk-tasks-n", text: String(node.count) });
			it.addEventListener("click", () => this.setScope("tag:" + node.tag));
			it.addEventListener("contextmenu", (event) => this.tagMenu(event, node.tag));
			this.dropTarget(it, { tag: node.tag });
			this.tagDrag(it, node.tag);
			node.children.forEach(walk);
		};
		this.tagTree(this.hub.index.open()).forEach(walk);
		// Untagged tasks of recent notes: a quiet entry, only when there are some.
		const loose = this.hub.index.untagged.length;
		if (loose) item("untagged", "circle-dashed", loose).addClass("is-untagged");
		nav.createDiv({ cls: "sk-tasks-nav-foot", text: this.t("nav.hint") });
	}

	/** The tag tree of these tasks, in the order the user gave the tags. */
	private tagTree(tasks: readonly Task[]): TagNode[] {
		return buildTree(tasks, this.settings.tagOrder);
	}

	/** The tags shown next to `tag` in the navigator (same parent), in their current order. */
	private siblingsOf(tag: string): string[] {
		const parent = tag.includes("/") ? tag.slice(0, tag.lastIndexOf("/")) : null;
		const tree = this.tagTree(this.hub.index.open());
		const level = parent ? (findNode(tree, parent)?.children ?? []) : tree;
		return level.map((n) => n.tag);
	}

	/** Puts `tag` before or after `target` (siblings only), saved in the settings. */
	private async placeTag(tag: string, target: string, after: boolean): Promise<void> {
		const siblings = this.siblingsOf(tag);
		if (!siblings.includes(target)) return;
		this.settings.tagOrder = moveInOrder(this.settings.tagOrder, siblings, tag, target, after);
		await this.hub.ctx.saveSettings();
	}

	/** Dragging a tag in the navigator reorders it among its siblings: the line shows where it lands. */
	private tagDrag(it: HTMLElement, tag: string): void {
		it.draggable = true;
		it.addEventListener("dragstart", (e) => {
			if (this.dragKey) return;
			this.dragTag = tag;
			e.dataTransfer?.setData("text/plain", "#" + tag);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
			window.setTimeout(() => it.addClass("is-dragging"), 0);
		});
		it.addEventListener("dragend", () => {
			it.removeClass("is-dragging");
			this.dragTag = null;
			this.clearTagDrop();
		});
		const side = (e: DragEvent) => e.clientY > it.getBoundingClientRect().top + it.getBoundingClientRect().height / 2;
		it.addEventListener("dragover", (e) => {
			const from = this.dragTag;
			if (!from || from === tag || !this.siblingsOf(from).includes(tag)) return;
			e.preventDefault();
			const after = side(e);
			if (it.hasClass(after ? "is-drop-after" : "is-drop-before")) return;
			this.clearTagDrop();
			it.addClass(after ? "is-drop-after" : "is-drop-before");
		});
		it.addEventListener("dragleave", (e) => {
			if (!it.contains(e.relatedTarget as Node | null)) it.removeClass("is-drop-before", "is-drop-after");
		});
		it.addEventListener("drop", (e) => {
			const from = this.dragTag;
			if (!from) return;
			e.preventDefault();
			e.stopPropagation();
			this.clearTagDrop();
			if (from !== tag) void this.placeTag(from, tag, side(e));
		});
	}

	private clearTagDrop(): void {
		this.rootEl.querySelectorAll(".is-drop-before, .is-drop-after").forEach((el) => el.removeClass("is-drop-before", "is-drop-after"));
	}

	/** Right click on a tag of the navigator: move it up or down, rename it in the whole vault. */
	private tagMenu(event: MouseEvent, tag: string): void {
		event.preventDefault();
		const siblings = this.siblingsOf(tag);
		const i = siblings.indexOf(tag);
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(this.t("menu.focus")).setIcon("crosshair").onClick(() => this.setScope("tag:" + tag)));
		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle(this.t("menu.tag-up")).setIcon("arrow-up").setDisabled(i <= 0).onClick(() => void this.placeTag(tag, siblings[i - 1], false)),
		);
		menu.addItem((item) =>
			item
				.setTitle(this.t("menu.tag-down"))
				.setIcon("arrow-down")
				.setDisabled(i < 0 || i >= siblings.length - 1)
				.onClick(() => void this.placeTag(tag, siblings[i + 1], true)),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(this.t("menu.tag-rename"))
				.setIcon("pencil")
				.onClick(() => new RenameTagModal(this.hub, tag, (to, result, merges) => void this.tagRenamed(tag, to, result, merges)).open()),
		);
		menu.showAtMouseEvent(event);
	}

	/**
	 * The vault was renamed from `from` to `to`: what the list keeps about tags follows (order,
	 * folded groups, flag tags, the tag shown), other tools hear it (Tags moves its colors), and a
	 * toast offers Undo.
	 */
	private async tagRenamed(from: string, to: string, result: TagRenameResult, merges: boolean): Promise<void> {
		const before = { tagOrder: [...this.settings.tagOrder], collapsed: [...this.settings.collapsed], flagTags: this.settings.flagTags };
		const scope = this.st.scope;
		const map = (tag: string) => (tag === from ? to : tag.startsWith(from + "/") ? to + tag.slice(from.length) : tag);
		const unique = (tags: string[]) => tags.filter((tag, i) => tags.indexOf(tag) === i);
		this.settings.tagOrder = unique(this.settings.tagOrder.map(map));
		this.settings.collapsed = unique(this.settings.collapsed.map(map));
		this.settings.flagTags = this.settings.flagTags
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => (part.startsWith("#") ? "#" + map(part.slice(1).toLowerCase()) : map(part.toLowerCase())))
			.join(", ");
		if (scope.startsWith("tag:")) this.setScope("tag:" + map(scope.slice(4)));
		await this.hub.ctx.saveSettings();
		this.hub.ctx.app.workspace.trigger(TAG_RENAMED_EVENT, { from, to });
		this.hub.ctx.toast(this.hub.ctx.tn("rename-tag.done", result.files, { from, to }), {
			action: {
				label: this.t("rename-tag.undo"),
				run: () => {
					void (async () => {
						await result.undo();
						Object.assign(this.settings, before);
						if (this.st.scope === "tag:" + to) this.setScope(scope);
						await this.hub.ctx.saveSettings();
						if (!merges) this.hub.ctx.app.workspace.trigger(TAG_RENAMED_EVENT, { from: to, to: from });
					})();
				},
			},
		});
	}

	// ----- list -----

	private renderList(): void {
		const list = this.listEl!;
		list.empty();
		const scope = this.st.scope;
		const parking = this.parking();
		const all = this.filtered();
		// Waiting on someone or kept for some day: not in the day (their own entry shows them).
		const tasks = scope === "today" || scope === "upcoming" ? all.filter((t) => !isParked(t, parking)) : all;
		const today = this.today();
		if (this.st.adding === "" && !scope.startsWith("tag:") && !scope.startsWith("flag:")) this.addRow(list, null);
		if (scope === "today") {
			const first = this.settings.overdueFirst;
			const groups = todayGroups(tasks, today, first);
			if (first) {
				if (groups.overdue.length) this.smartGroup(list, "overdue", this.t("group.overdue"), "alert-circle", groups.overdue);
				if (groups.today.length || !groups.overdue.length) this.smartGroup(list, "today", this.t("group.today"), "sun", groups.today);
			} else {
				if (groups.today.length) this.smartGroup(list, "today", this.t("group.today"), "sun", groups.today);
				else if (groups.overdue.length) this.empty(list, "sun", "empty.today-clear");
				if (groups.overdue.length) this.earlierGroup(list, groups.overdue);
			}
			if (!groups.overdue.length && !groups.today.length) this.empty(list, "sun", "empty.today");
			return;
		}
		if (scope === "upcoming") {
			const days = upcomingGroups(tasks, today);
			for (const day of days) this.smartGroup(list, "day", this.hub.formatDate(day.date, "format.day"), "calendar", day.tasks, this.hub.dueText(day.date));
			if (!days.length) this.empty(list, "calendar", "empty.upcoming");
			return;
		}
		if (scope === "untagged") {
			const loose = this.untaggedShown();
			if (loose.length && !Platform.isPhone) this.untaggedGroup(list, loose);
			else this.empty(list, "check-circle-2", "empty.untagged");
			return;
		}
		let pool = tasks;
		if (scope.startsWith("tag:")) pool = tasks.filter((t) => inScope(t.primary, scope.slice(4)));
		if (scope.startsWith("flag:")) pool = tasks.filter((t) => hasFlag(t, scope.slice(5)));
		const tree = this.tagTree(pool);
		if (scope.startsWith("tag:")) {
			const root = scope.slice(4);
			const node = findNode(tree, root);
			if (node) this.tagGroup(list, node, 0, this.layout === "page");
			else if (this.st.adding !== null) this.addRow(list, this.st.adding || root);
		} else tree.forEach((node) => this.tagGroup(list, node, 0));
		const loose = scope === "all" ? this.untaggedShown() : [];
		if (loose.length && !Platform.isPhone) this.untaggedGroup(list, loose);
		if (!pool.length && scope.startsWith("flag:") && !this.st.query && !this.settings.priorityFilter.length) {
			this.empty(list, this.flagIcon(scope.slice(5)), "empty.flag");
			return;
		}
		if (!pool.length && !loose.length) {
			if (this.st.query || this.settings.priorityFilter.length || this.flagOn()) {
				this.empty(list, "search", "empty.search", () => {
					this.st.query = "";
					if (this.searchInput) this.searchInput.value = "";
					this.settings.priorityFilter = [];
					this.settings.flagFilter = "";
					void this.hub.ctx.saveSettings();
					this.refresh();
				});
			} else if (this.st.adding === null) this.empty(list, "check-circle-2", "empty.all");
		}
	}

	private empty(parent: HTMLElement, iconName: string, key: string, onClear?: () => void): void {
		const box = parent.createDiv({ cls: "sk-tasks-empty" });
		icon(box.createDiv({ cls: "sk-tasks-empty-ic" }), iconName);
		box.createDiv({ cls: "sk-tasks-empty-t", text: this.t(key + ".title") });
		box.createDiv({ cls: "sk-tasks-empty-s", text: this.t(key + ".sub") });
		if (onClear) box.createEl("button", { cls: "sk-btn is-ghost is-s", text: this.t("empty.clear") }).addEventListener("click", onClear);
	}

	private smartGroup(parent: HTMLElement, kind: string, label: string, iconName: string, tasks: Task[], sub?: string): void {
		const group = parent.createDiv({ cls: `sk-tasks-grp sk-tasks-grp-${kind}` });
		const head = group.createDiv({ cls: "sk-tasks-grp-h" });
		icon(head, iconName, "sk-tasks-grp-ic");
		head.createSpan({ cls: "sk-tasks-grp-lbl", text: label });
		head.createSpan({ cls: "sk-tasks-grp-count", text: String(tasks.length) });
		if (sub) head.createSpan({ cls: "sk-tasks-grp-sub", text: sub });
		if (kind === "today") this.dropTarget(group, { due: true });
		const body = group.createDiv({ cls: "sk-tasks-grp-body" });
		for (const t of tasks) this.row(body, t, true);
	}

	/** Open tasks without a tag (recent notes): at the bottom of All, each with a button to give it one. */
	private untaggedGroup(parent: HTMLElement, tasks: Task[]): void {
		const group = parent.createDiv({ cls: "sk-tasks-grp sk-tasks-grp-untagged" });
		const head = group.createDiv({ cls: "sk-tasks-grp-h" });
		icon(head, "circle-dashed", "sk-tasks-grp-ic");
		head.createSpan({ cls: "sk-tasks-grp-lbl", text: this.t("group.untagged") });
		head.createSpan({ cls: "sk-tasks-grp-count", text: String(tasks.length) });
		head.createSpan({ cls: "sk-tasks-grp-sub", text: this.t("group.untagged-sub") });
		const body = group.createDiv({ cls: "sk-tasks-grp-body" });
		for (const t of this.sorted(tasks)) this.row(body, t, false);
	}

	/**
	 * The shared tag picker (the one of the Brainstorm capture) under `anchor`, a sheet on a phone:
	 * starts on `current`, offers the tags of `near` first. A flag (#high, a flag tag of the settings)
	 * marks a task, it never groups it: refused with a word.
	 */
	private chooseTag(anchor: HTMLElement, current: string | null, near: string[], onChoose: (tag: string) => void, onCancel?: () => void): void {
		this.tagPop?.close();
		// Where the focus goes back when the picker closes without a tag (the row, the field, the list).
		const back = () => {
			if (this.closed) return;
			if (onCancel) onCancel();
			else this.rootEl.focus({ preventScroll: true });
		};
		const handle = openTagPicker(anchor, {
			t: (key, vars) => this.hub.ctx.t(key, vars),
			colors: (tag) => this.hub.tagClasses(tag),
			// Flags mark a task, they never group it: not offered. The current tag first, even nested.
			sources: { all: () => this.hub.index.allTags().filter((x) => !this.hub.index.flags().has(x.replace(/^#/, "").toLowerCase())), near: () => near, chosen: () => current },
			want: current,
			onChoose: (raw) => {
				if (this.tagPop === handle) this.tagPop = null;
				if (this.closed) return;
				const tag = raw.replace(/^#/, "");
				if (this.hub.index.flags().has(tag.toLowerCase())) {
					this.hub.ctx.toast(this.t("tag.is-flag", { tag }));
					back();
					return;
				}
				// What the task lines can read back as a tag (a letter, a digit or _ first).
				if (!TAG_NAME.test(tag)) {
					this.hub.ctx.toast(this.t("tag.invalid", { tag }));
					back();
					return;
				}
				onChoose(tag);
			},
			onCancel: () => {
				if (this.tagPop === handle) this.tagPop = null;
				back();
			},
		});
		this.tagPop = handle;
	}

	/** The tags of the task's note, offered first. */
	private nearTags(path: string): string[] {
		return [...new Set(this.hub.index.list.filter((x) => x.path === path).map((x) => x.primary).filter(Boolean))];
	}

	/** The shared tag picker under `anchor`: the chosen tag is written in the task's line. */
	private tagUntagged(t: Task, anchor: HTMLElement): void {
		this.chooseTag(anchor, null, this.nearTags(t.path), (tag) => void this.hub.retag(t, tag));
	}

	/**
	 * What waits since earlier, below today: folded by default (remembered), neutral colors, and
	 * three actions that move every task of the block at once (one Undo for all).
	 */
	private earlierGroup(parent: HTMLElement, tasks: Task[]): void {
		const open = this.settings.earlierOpen || !!this.st.query;
		const group = parent.createDiv({ cls: "sk-tasks-grp sk-tasks-grp-earlier" + (open ? "" : " is-collapsed") });
		const head = group.createDiv({ cls: "sk-tasks-grp-h" });
		const toggle = head.createDiv({ cls: "sk-tasks-grp-toggle", attr: { "aria-expanded": String(open), "data-focus-key": "earlier" } });
		// An item of the list's zone (Tab, arrows), like the rows; Enter or Space folds or unfolds.
		this.zoneItem(toggle);
		icon(toggle, "chevron-down", "sk-tasks-grp-chev");
		toggle.createSpan({ cls: "sk-tasks-grp-lbl", text: this.t("group.earlier") });
		toggle.createSpan({ cls: "sk-tasks-grp-count", text: String(tasks.length) });
		const flip = () => {
			// The list is drawn again; refresh() gives the focus back to the toggle.
			this.settings.earlierOpen = !this.settings.earlierOpen;
			void this.hub.ctx.saveSettings();
			this.refresh();
		};
		toggle.addEventListener("click", flip);
		toggle.addEventListener("keydown", (e) => {
			if (e.key !== " ") return;
			e.preventDefault();
			flip();
		});
		const acts = head.createDiv({ cls: "sk-tasks-grp-acts" });
		const today = this.today();
		const act = (key: string, due: string | null) => {
			const b = acts.createEl("button", { cls: "sk-btn is-ghost is-s", text: this.t(key), attr: { type: "button" } });
			b.addEventListener("click", (e) => {
				e.stopPropagation();
				void this.hub.setDueAll(tasks, due);
			});
		};
		act("earlier.today", today);
		act("earlier.tomorrow", addDays(today, 1));
		act("earlier.clear", null);
		if (!open) return;
		const body = group.createDiv({ cls: "sk-tasks-grp-body" });
		for (const t of tasks) this.row(body, t, true, true);
	}

	private tagGroup(parent: HTMLElement, node: TagNode, depth: number, headless = false): void {
		const collapsed = this.settings.collapsed.includes(node.tag) && !this.st.query;
		const group = parent.createDiv({
			cls: "sk-tasks-grp sk-tasks-lvl-" + Math.min(depth, 2) + (depth ? " is-sub sk-tasks-sec" : "") + (collapsed ? " is-collapsed" : ""),
		});
		if (depth) colorFor(group, node.tag, this.hub);
		this.dropTarget(group, { tag: node.tag });
		if (!headless) {
			// The root keeps its capsule; below it, a section only says what it adds to its parent.
			const head = group.createDiv({ cls: "sk-tasks-grp-h", attr: { role: "button", "aria-expanded": String(!collapsed) } });
			icon(head, "chevron-down", "sk-tasks-grp-chev");
			if (depth === 0) capsule(head, node.tag, this.hub);
			else {
				tagDot(head, node.tag, this.hub);
				head.createSpan({ cls: "sk-tasks-grp-name", text: node.name });
			}
			head.createSpan({ cls: "sk-tasks-grp-count", text: String(node.count) });
			head.createSpan({ cls: "sk-tasks-grp-rule" });
			const add = this.iconButton(head, "plus", this.t("group.add"), (e) => {
				e.stopPropagation();
				this.startAdd(node.tag);
			});
			add.addClass("sk-tasks-grp-add");
			head.addEventListener("click", () => void this.toggleCollapse(node.tag));
			head.addEventListener("contextmenu", (e) => this.groupMenu(e, node.tag));
		}
		if (collapsed) return;
		const body = group.createDiv({ cls: "sk-tasks-grp-body" });
		if (this.st.adding === node.tag) this.addRow(body, node.tag);
		for (const t of this.sorted(node.own)) this.row(body, t, false);
		for (const child of node.children) this.tagGroup(body, child, depth + 1);
	}

	private async toggleCollapse(tag: string): Promise<void> {
		const collapsed = this.settings.collapsed;
		this.settings.collapsed = collapsed.includes(tag) ? collapsed.filter((x) => x !== tag) : [...collapsed, tag];
		await this.hub.ctx.saveSettings();
	}

	private groupMenu(event: MouseEvent, tag: string): void {
		event.preventDefault();
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(this.t("menu.focus")).setIcon("crosshair").onClick(() => this.setScope("tag:" + tag)));
		menu.addItem((item) => item.setTitle(this.t("menu.add")).setIcon("plus").onClick(() => this.startAdd(tag)));
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(this.t("menu.fold-all"))
				.setIcon("chevrons-down-up")
				.onClick(async () => {
					this.settings.collapsed = this.tagTree(this.hub.index.open()).map((n) => n.tag);
					await this.hub.ctx.saveSettings();
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle(this.t("menu.unfold-all"))
				.setIcon("chevrons-up-down")
				.onClick(async () => {
					this.settings.collapsed = [];
					await this.hub.ctx.saveSettings();
				}),
		);
		menu.showAtMouseEvent(event);
	}

	// ----- rows -----

	/** A task row. `since`: in the block of what waits since earlier, its date says how long, without warning colors. */
	private row(parent: HTMLElement, t: Task, showTag: boolean, since = false): HTMLElement {
		const today = this.today();
		const row = parent.createDiv({
			cls: "sk-tasks-row" + (t.priority ? " p-" + t.priority : "") + (this.st.sel === t.key ? " is-sel" : "") + (this.freshKey === t.key ? " is-new" : "") + (this.landedKey === t.key ? " is-landed" : ""),
		});
		row.dataset.key = t.key;
		row.tabIndex = this.st.sel === t.key ? 0 : -1;
		row.setAttr("data-sk-item", "");
		if (this.st.sel === t.key) row.setAttr("data-sk-zone-focus", "");
		row.addEventListener("focus", () => {
			if (this.st.sel === t.key) return;
			this.st.sel = t.key;
			this.listEl?.querySelectorAll<HTMLElement>(".sk-tasks-row[data-key]").forEach((item) => {
				const on = item === row;
				item.toggleClass("is-sel", on);
				item.toggleAttribute("data-sk-zone-focus", on);
				item.tabIndex = on ? 0 : -1;
			});
			if (this.detailEl) this.renderDetail();
		});
		row.draggable = true;
		icon(row, "grip-vertical", "sk-tasks-grip");
		const box = checkbox(row);
		box.setAttr("aria-label", this.t("menu.done"));
		box.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.complete(t, row);
		});
		const main = row.createDiv({ cls: "sk-tasks-row-main" });
		const title = main.createDiv({ cls: "sk-tasks-row-title" });
		renderInline(title.createSpan({ cls: "sk-tasks-txt" }), t.title);
		if (!t.primary) {
			const tagBtn = title.createEl("button", { cls: "sk-tasks-notag", attr: { type: "button", "aria-label": this.t("row.tag") } });
			icon(tagBtn, "tag");
			tagBtn.appendText(this.t("row.tag-short"));
			tagBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.tagUntagged(t, tagBtn);
			});
		}
		descriptionPreview(main, t.description);
		const meta = (this.layout === "page" ? row : main).createDiv({ cls: "sk-tasks-row-meta" });
		const state = since ? "since" : dueState(t.due, today);
		const dueWords = (due: string) => (since ? this.hub.sinceText(due) : this.hub.dueText(due));
		if (this.layout === "page") {
			if (showTag && t.primary) capsule(title, t.primary, this.hub, "sk-tasks-cap-sm");
			const icons = meta.createSpan({ cls: "sk-tasks-m-icons" });
			this.subtaskCount(icons, t);
			this.flagMarks(icons, t);
			this.taskNoteMarker(icons, t);
			const note = meta.createSpan({ cls: "sk-tasks-m-note" });
			icon(note, "file-text");
			this.sessionMarker(note, t.path);
			note.createEl("b", { text: noteName(t.path) });
			const due = meta.createSpan({ cls: "sk-tasks-m-due" + (state ? " is-" + state : "") });
			if (t.due) due.appendText(dueWords(t.due));
		} else {
			if (t.due) {
				const due = meta.createSpan({ cls: "sk-tasks-m-due is-" + state });
				icon(due, state === "overdue" ? "alert-circle" : since ? "clock" : "calendar");
				due.appendText(dueWords(t.due));
			}
			if (showTag && t.primary) capsule(meta, t.primary, this.hub, "sk-tasks-cap-xs");
			this.subtaskCount(meta, t);
			this.flagMarks(meta, t);
			this.taskNoteMarker(meta, t);
			const note = meta.createSpan({ cls: "sk-tasks-m-note" });
			icon(note, "file-text");
			this.sessionMarker(note, t.path);
			note.createEl("b", { text: noteName(t.path) });
		}
		const actions = row.createDiv({ cls: "sk-tasks-row-act" });
		this.iconButton(actions, "arrow-up-right", this.t("row.open"), (e) => {
			e.stopPropagation();
			void this.openTask(t, e);
		});
		this.iconButton(actions, "more-horizontal", this.t("row.more"), (e) => {
			e.stopPropagation();
			this.taskMenu(e, t);
		});
		if (this.picked.has(t.key)) row.addClass("is-picked");
		row.addEventListener("click", (e) => {
			if (Date.now() < this.suppressClick) return;
			this.onRowClick(t.key, e);
		});
		if (Platform.isPhone) this.longPress(row, t);
		row.addEventListener("dblclick", (e) => {
			if ((e.target as HTMLElement).closest(".sk-tasks-row-title")) this.inlineRename(t);
			else void this.openTask(t, e);
		});
		row.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			// A long press on a phone may also send this event: one menu only.
			if (Date.now() < this.suppressClick) return;
			if (Platform.isPhone) this.suppressClick = Date.now() + 700;
			if (this.picked.size >= 2 && this.picked.has(t.key)) {
				this.pickMenu(e);
				return;
			}
			this.select(t.key, false);
			this.taskMenu(e, t);
		});
		this.dragSource(row, t);
		this.taskDrop(row, t);
		if (this.layout === "side" && this.st.open === t.key) this.inlineDetail(parent, t);
		return row;
	}

	/**
	 * Phone: a long press on a task opens its menu (the one of the three dots), where the finger is.
	 * The row sinks a little while pressed; a move, a scroll or lifting the finger early cancels it,
	 * and the tap that follows the menu does nothing.
	 */
	private longPress(row: HTMLElement, t: Task): void {
		row.addEventListener("pointerdown", (e) => {
			if (e.pointerType !== "touch" || (e.target as HTMLElement).closest("button, input, textarea, a")) return;
			const x = e.clientX;
			const y = e.clientY;
			const win = row.win;
			let timer = 0;
			const sink = win.setTimeout(() => row.addClass("is-pressing"), 120);
			const stop = () => {
				win.clearTimeout(timer);
				win.clearTimeout(sink);
				row.removeClass("is-pressing");
				row.removeEventListener("pointermove", move);
				row.removeEventListener("pointerup", stop);
				row.removeEventListener("pointercancel", stop);
			};
			const move = (m: PointerEvent) => {
				if (Math.hypot(m.clientX - x, m.clientY - y) > 10) stop();
			};
			row.addEventListener("pointermove", move);
			row.addEventListener("pointerup", stop);
			row.addEventListener("pointercancel", stop);
			timer = win.setTimeout(() => {
				stop();
				if (Date.now() < this.suppressClick) return;
				this.suppressClick = Date.now() + 700;
				const at = new MouseEvent("contextmenu", { clientX: x, clientY: y });
				if (this.picked.size >= 2 && this.picked.has(t.key)) this.pickMenu(at);
				else this.taskMenu(at, t);
			}, 480);
		});
	}

	/** The declared flags of a task, small and quiet: an icon and its word. */
	private flagMarks(parent: HTMLElement, t: Task): void {
		for (const f of this.flags()) {
			if (!hasFlag(t, f)) continue;
			const mark = parent.createSpan({ cls: "sk-tasks-flagmark sk-tasks-flag-" + f });
			icon(mark, this.flagIcon(f));
			mark.appendText(this.flagLabel(f));
		}
	}

	private subtaskCount(parent: HTMLElement, t: Task): void {
		if (!t.subtasks.length) return;
		const span = parent.createSpan({ attr: { "aria-label": this.t("detail.subtasks") } });
		icon(span, "list-checks");
		span.appendText(`${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}`);
	}

	// ----- several tasks at once -----

	private pick(key: string): void {
		const t = this.hub.index.get(key);
		if (t) this.picked.set(key, { path: t.path, raw: t.raw });
	}

	/**
	 * After each drawing of the list: only the tasks shown, still open and still the same task stay
	 * picked (a scope or a search that hides them, a task checked or renamed elsewhere: it leaves).
	 * Then the bar goes on top of the list when two or more remain.
	 */
	private reconcilePicked(): void {
		const list = this.listEl;
		if (!list) return;
		const shown = new Set(this.visibleKeys());
		for (const [key, ref] of [...this.picked]) {
			const t = this.hub.index.get(key);
			if (!shown.has(key) || !t || t.done || t.path !== ref.path || t.raw !== ref.raw) this.picked.delete(key);
		}
		if (this.picked.size < 2) this.picked.clear();
		list.querySelectorAll<HTMLElement>(".sk-tasks-row[data-key]").forEach((row) => row.toggleClass("is-picked", this.picked.has(row.dataset.key ?? "")));
		if (this.picked.size >= 2) {
			this.pickBar(list);
			const bar = list.querySelector(".sk-tasks-pickbar");
			if (bar) list.prepend(bar);
		}
	}

	private pickedTasks(): Task[] {
		return [...this.picked.keys()].map((key) => this.hub.index.get(key)).filter((t): t is Task => !!t);
	}

	private clearPicked(): void {
		if (!this.picked.size) return;
		this.picked.clear();
		this.refresh();
	}

	/** Ctrl/Cmd+click adds or removes a task; Shift+click takes the range from the selected one; a plain click selects one. */
	private onRowClick(key: string, e: MouseEvent): void {
		// The click already focused the row (and made it the selected one): the anchor says where it started.
		const from = this.anchor && this.anchor !== key && this.hub.index.get(this.anchor) ? this.anchor : null;
		if (e.ctrlKey || e.metaKey) {
			if (!this.picked.size && from) this.pick(from);
			if (this.picked.has(key)) this.picked.delete(key);
			else this.pick(key);
			this.st.sel = key;
			this.anchor = key;
			this.refresh();
			this.rowOf(key)?.focus({ preventScroll: true });
			return;
		}
		if (e.shiftKey && from) {
			this.pickRange(from, key, true);
			return;
		}
		this.picked.clear();
		this.anchor = key;
		this.select(key, true);
	}

	/** Picks every shown task between `from` and `to` (the selection moves to `to`). */
	private pickRange(from: string, to: string, replace: boolean): void {
		const keys = this.visibleKeys();
		const a = keys.indexOf(from);
		const b = keys.indexOf(to);
		if (a < 0 || b < 0) return;
		if (replace) this.picked.clear();
		for (const key of keys.slice(Math.min(a, b), Math.max(a, b) + 1)) this.pick(key);
		// The start stays the anchor: another Shift+click changes the range from the same task.
		this.anchor = from;
		this.st.sel = to;
		this.refresh();
		this.rowOf(to)?.focus({ preventScroll: true });
	}

	/** Shift+Up/Down: the selection grows (or shrinks back) by one row. */
	private extendPick(delta: number): void {
		const keys = this.visibleKeys();
		if (!keys.length) return;
		const at = this.st.sel ? keys.indexOf(this.st.sel) : -1;
		const next = keys[Math.max(0, Math.min(keys.length - 1, at < 0 ? 0 : at + delta))];
		if (this.st.sel) this.pick(this.st.sel);
		if (this.picked.has(next) && this.picked.size > 1) this.picked.delete(this.st.sel ?? "");
		this.pick(next);
		this.st.sel = next;
		this.refresh();
		this.rowOf(next)?.focus({ preventScroll: true });
	}

	/** The bar over the list while several tasks are picked: what can be done to all of them. */
	private pickBar(list: HTMLElement): void {
		const tasks = this.pickedTasks();
		const today = this.today();
		const bar = list.createDiv({ cls: "sk-tasks-pickbar", attr: { role: "toolbar", "aria-label": this.t("pick.bar") } });
		bar.createSpan({ cls: "sk-tasks-pickbar-n", text: this.hub.ctx.tn("pick.count", tasks.length) });
		const act = (iconName: string, key: string, run: (e: MouseEvent) => void, cls = "") => {
			const b = bar.createEl("button", { cls: "sk-btn is-ghost is-s" + cls, attr: { type: "button" } });
			icon(b, iconName);
			b.createSpan({ text: this.t(key) });
			b.addEventListener("click", (e) => {
				e.stopPropagation();
				run(e);
			});
			return b;
		};
		const after = (work: Promise<void>) => void work.then(() => this.clearPicked());
		act("check", "pick.done", () => after(this.hub.completeAll(tasks)));
		act("sun", "pick.today", () => after(this.hub.setDueAll(tasks, today)));
		act("sunrise", "pick.tomorrow", () => after(this.hub.setDueAll(tasks, addDays(today, 1))));
		act("calendar-x", "pick.no-date", () => after(this.hub.setDueAll(tasks, null)));
		act("flag", "pick.priority", (e) => this.priorityMenu(e, tasks));
		act("hash", "pick.tag", () => this.pickTagAll(tasks));
		act("trash-2", "pick.delete", () => after(this.hub.deleteAll(tasks)), " is-danger");
		const x = bar.createEl("button", { cls: "sk-btn is-ghost is-icon is-s sk-tasks-pickbar-x", attr: { type: "button", "aria-label": this.t("pick.clear") } });
		icon(x, "x");
		x.addEventListener("click", (e) => {
			e.stopPropagation();
			this.clearPicked();
		});
	}

	private priorityMenu(e: MouseEvent, tasks: Task[]): void {
		const menu = new Menu();
		for (const p of [...PRIORITIES, null]) {
			menu.addItem((item) => item.setTitle(this.t("menu.prio-" + (p ?? "none"))).setIcon(p ? "flag" : "flag-off").onClick(() => void this.hub.setPriorityAll(tasks, p).then(() => this.clearPicked())));
		}
		menu.showAtMouseEvent(e);
	}

	/** One tag for all the picked tasks (the tag picker of a single task, here for all). */
	private pickTagAll(tasks: Task[]): void {
		const anchor = this.rootEl.querySelector<HTMLElement>(".sk-tasks-pickbar") ?? this.rootEl;
		this.chooseTag(anchor, null, [], (tag) => void this.hub.retagAll(tasks, tag).then(() => this.clearPicked()));
	}

	/** Right click on a picked task: the actions for all of them. */
	private pickMenu(e: MouseEvent): void {
		const tasks = this.pickedTasks();
		const today = this.today();
		const done = (work: Promise<void>) => void work.then(() => this.clearPicked());
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(this.hub.ctx.tn("pick.count", tasks.length)).setIsLabel(true));
		menu.addItem((item) => item.setTitle(this.t("pick.done")).setIcon("check").onClick(() => done(this.hub.completeAll(tasks))));
		menu.addSeparator();
		for (const p of [...PRIORITIES, null]) menu.addItem((item) => item.setTitle(this.t("menu.prio-" + (p ?? "none"))).setIcon(p ? "flag" : "flag-off").onClick(() => done(this.hub.setPriorityAll(tasks, p))));
		const flags = this.flags();
		if (flags.length) {
			menu.addSeparator();
			// All of them have it: off for all; else on for all.
			for (const f of flags) {
				const all = tasks.every((x) => hasFlag(x, f));
				menu.addItem((item) => item.setTitle(this.flagLabel(f)).setIcon(this.flagIcon(f)).setChecked(all).onClick(() => done(this.hub.setFlagAll(tasks, f, !all))));
			}
		}
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(this.t("menu.due-today")).setIcon("sun").onClick(() => done(this.hub.setDueAll(tasks, today))));
		menu.addItem((item) => item.setTitle(this.t("menu.due-tomorrow")).setIcon("sunrise").onClick(() => done(this.hub.setDueAll(tasks, addDays(today, 1)))));
		menu.addItem((item) => item.setTitle(this.t("menu.due-next-week")).setIcon("calendar").onClick(() => done(this.hub.setDueAll(tasks, nextWeek(today)))));
		menu.addItem((item) => item.setTitle(this.t("menu.due-clear")).setIcon("calendar-x").onClick(() => done(this.hub.setDueAll(tasks, null))));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(this.t("menu.move")).setIcon("hash").onClick(() => this.pickTagAll(tasks)));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(this.t("pick.delete")).setIcon("trash-2").setWarning(true).onClick(() => done(this.hub.deleteAll(tasks))));
		menu.showAtMouseEvent(e);
	}

	private select(key: string, toggleOpen: boolean): void {
		const was = this.st.sel;
		this.st.sel = key;
		if (this.layout === "side" && toggleOpen) this.st.open = this.st.open === key && was === key ? null : key;
		this.refresh();
		this.rowOf(key)?.scrollIntoView({ block: "nearest" });
		if (!this.isEditing()) (this.rootEl.doc.activeElement?.matches(".sk-tasks-row[data-key]") ? this.rowOf(key) ?? this.rootEl : this.rootEl).focus({ preventScroll: true });
	}

	private moveSel(delta: number): void {
		const keys = this.visibleKeys();
		if (!keys.length) return;
		const i = this.st.sel ? keys.indexOf(this.st.sel) : -1;
		const next = keys[Math.max(0, Math.min(keys.length - 1, i < 0 ? 0 : i + delta))];
		if (this.layout === "side" && this.st.open) this.st.open = next;
		this.anchor = next;
		this.select(next, false);
		this.rowOf(next)?.focus({ preventScroll: true });
	}

	private taskMenu(event: MouseEvent, t: Task): void {
		const today = this.today();
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(this.t("menu.open")).setIcon("arrow-up-right").onClick(() => void this.openTask(t)));
		menu.addItem((item) => item.setTitle(this.t("menu.done")).setIcon("check").onClick(() => void this.complete(t)));
		menu.addSeparator();
		for (const p of [...PRIORITIES, null]) {
			menu.addItem((item) =>
				item
					.setTitle(this.t("menu.prio-" + (p ?? "none")))
					.setIcon(p ? "flag" : "flag-off")
					.setChecked(t.priority === p)
					.onClick(() => void this.hub.setPriority(t, p)),
			);
		}
		const flags = this.flags();
		if (flags.length) {
			menu.addSeparator();
			for (const f of flags) menu.addItem((item) => item.setTitle(this.flagLabel(f)).setIcon(this.flagIcon(f)).setChecked(hasFlag(t, f)).onClick(() => void this.hub.setFlag(t, f, !hasFlag(t, f))));
		}
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(this.t("menu.due-today")).setIcon("sun").onClick(() => void this.hub.setDue(t, today)));
		menu.addItem((item) => item.setTitle(this.t("menu.due-tomorrow")).setIcon("sunrise").onClick(() => void this.hub.setDue(t, addDays(today, 1))));
		menu.addItem((item) => item.setTitle(this.t("menu.due-next-week")).setIcon("calendar").onClick(() => void this.hub.setDue(t, nextWeek(today))));
		if (t.due) menu.addItem((item) => item.setTitle(this.t("menu.due-clear")).setIcon("calendar-x").onClick(() => void this.hub.setDue(t, null)));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(this.t("menu.rename")).setIcon("pencil").onClick(() => this.inlineRename(t)));
		menu.addItem((item) => item.setTitle(this.t("menu.move")).setIcon("hash").onClick(() => this.pickTag(t)));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(this.t("menu.delete")).setIcon("trash-2").setWarning(true).onClick(() => void this.deleteTask(t)));
		menu.showAtMouseEvent(event);
	}

	/** Deletes a task (Undo in the toast); the selection moves to the next one. */
	private async deleteTask(t: Task): Promise<void> {
		if (this.st.sel === t.key) {
			this.moveSel(1);
			if (this.st.sel === t.key) this.st.sel = null;
		}
		if (this.st.open === t.key) this.st.open = null;
		await this.hub.deleteTask(t);
	}

	/** Renames and keeps the task selected (its key changes with its words). */
	private async rename(t: Task, title: string): Promise<void> {
		const expected = this.hub.writer.keyAfterRename(t, title);
		const sel = this.st.sel === t.key;
		const open = this.st.open === t.key;
		if (sel) this.st.sel = expected;
		if (open) this.st.open = expected;
		const key = (await this.hub.rename(t, title)) ?? t.key;
		// The task keeps its place in "My order" under its new key.
		if (key !== t.key && this.settings.taskOrder.includes(t.key)) {
			this.settings.taskOrder = this.settings.taskOrder.map((k) => (k === t.key ? key : k));
			await this.hub.ctx.saveSettings();
		}
		if (sel) this.st.sel = key;
		if (open) this.st.open = key;
		if (this.st.propsFor === t.key || this.st.propsFor === expected) this.st.propsFor = key;
		this.refresh();
	}

	/** Rename in the list: double click on the title, F2 or the menu. */
	private inlineRename(t: Task): void {
		const row = this.rowOf(t.key);
		const text = row?.querySelector(".sk-tasks-row-title .sk-tasks-txt");
		if (!row || !text) return;
		row.draggable = false;
		// A text area that grows with the title, so a long one is read whole while editing. The
		// task stays one line in the note: Enter saves, line breaks become spaces.
		const input = createEl("textarea", { cls: "sk-tasks-rename", attr: { rows: "1", spellcheck: "false" } });
		input.value = t.title;
		text.replaceWith(input);
		const fit = () => {
			input.setCssProps({ "--sk-tasks-rename-h": "auto" });
			input.setCssProps({ "--sk-tasks-rename-h": `${input.scrollHeight + 2}px` });
		};
		input.addEventListener("input", fit);
		fit();
		input.focus();
		input.select();
		let finished = false;
		const finish = (save: boolean) => {
			if (finished) return;
			finished = true;
			const value = input.value.replace(/\s+/g, " ").trim();
			input.blur();
			input.disabled = true;
			if (save && value && value !== t.title) void this.rename(t, value);
			else this.refresh();
		};
		input.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter") {
				e.preventDefault();
				finish(true);
			}
			if (e.key === "Escape") {
				e.preventDefault();
				finish(false);
			}
		});
		input.addEventListener("blur", () => finish(true));
		input.addEventListener("click", (e) => e.stopPropagation());
		input.addEventListener("dblclick", (e) => e.stopPropagation());
	}

	/** Another tag for a task: the shared picker, starting on its tag, under `anchor` (else its row). */
	private pickTag(t: Task, anchor?: HTMLElement): void {
		const at = anchor ?? this.rowOf(t.key) ?? this.rootEl;
		this.chooseTag(
			at,
			t.primary || null,
			this.nearTags(t.path),
			(tag) => {
				if (tag.toLowerCase() !== (t.primary ?? "").toLowerCase()) void this.hub.retag(t, tag);
			},
			() => (this.rowOf(t.key) ?? this.rootEl).focus({ preventScroll: true }),
		);
	}

	private async complete(t: Task, rowEl?: HTMLElement): Promise<void> {
		const row = rowEl ?? this.rowOf(t.key);
		if (row?.isConnected && this.doneEl && this.hub.playful(this.rootEl.win)) return this.completePlayful(t, row);
		this.animating++;
		try {
			await this.completeAnimation(row);
		} finally {
			this.animating--;
		}
		await this.hub.complete(t);
		if (!this.animating) this.refresh();
	}

	/**
	 * Playful: the box squashes and fills, a thin wave and a few strokes leave it, the title is struck,
	 * then a capsule of it flies into "done today", which rolls one up; the next task's box breathes.
	 * The sound is played at the click and climbs while tasks are checked one after another.
	 */
	private async completePlayful(t: Task, row: HTMLElement): Promise<void> {
		if (this.checking.has(t.key)) return;
		this.checking.add(t.key);
		const doc = this.rootEl.doc;
		const accent = cssColor(this.rootEl, "--sk-accent", "#7f6df2");
		const today = this.today();
		// The end of the day only comes when tasks were due today and this check clears them.
		const dueBefore = this.hub.stillDue();
		this.hub.checkSound();
		const step = this.hub.runStep;
		row.addClass("is-done");
		const box = row.querySelector<HTMLElement>(".sk-tasks-cb");
		if (box) {
			box.setAttr("aria-checked", "true");
			const r = box.getBoundingClientRect();
			wave(doc, r.left + r.width / 2, r.top + r.height / 2);
			spark(doc, r.left + r.width / 2, r.top + r.height / 2, 10, accent);
		}
		// Counted until the flight and the write are both over: no redraw (and no roll) before it lands.
		this.animating++;
		let written = false;
		try {
			await sleep(430);
			const title = row.querySelector<HTMLElement>(".sk-tasks-txt");
			const target = this.doneEl;
			// The pill shows before it is measured (hidden while nothing was done or due today).
			target?.removeClass("is-empty");
			const to = target?.isConnected ? target.getBoundingClientRect() : null;
			const landed = title && to && to.width > 0 ? fly(doc, title.textContent ?? t.title, title.getBoundingClientRect(), to) : Promise.resolve();
			row.style.height = row.offsetHeight + "px";
			row.addClass("is-leaving");
			this.rootEl.win.requestAnimationFrame(() => {
				row.style.removeProperty("height");
				row.addClass("is-collapsed");
			});
			const writing = this.hub.complete(t, true);
			await sleep(320);
			[written] = await Promise.all([writing, landed]);
		} finally {
			this.animating--;
			this.checking.delete(t.key);
		}
		if (!this.closed && !this.animating) this.refresh();
		// The tab went away meanwhile, or nothing was written: no landing, no scene.
		if (this.closed || !written) return;
		// It landed: the count rolls (refresh), the pill pops, "+1" rises, a soft knock.
		const pill = this.doneEl;
		if (pill?.isConnected) {
			const pr = pill.getBoundingClientRect();
			pop(pill);
			plusOne(doc, pr.left + 22, pr.top - 6, step);
			spark(doc, pr.left + 15, pr.top + pr.height / 2, 7 + step * 2, accent);
		}
		this.hub.land(this.rootEl.win);
		const next = this.listEl?.querySelector<HTMLElement>(".sk-tasks-row[data-key] .sk-tasks-cb");
		next?.animate([{ boxShadow: "0 0 0 0 transparent" }, { boxShadow: `0 0 0 6px ${cssColor(this.rootEl, "--sk-accent-wash", "rgba(127,109,242,0.15)")}`, offset: 0.5 }, { boxShadow: "0 0 0 0 transparent" }], { duration: 1100, easing: "ease-in-out" });
		// The last task due today was just checked: the small scene, once a day.
		if (t.due === today && dueBefore > 0 && this.hub.stillDue() === 0 && this.hub.takeDayClear()) {
			if (pill?.isConnected) pill.animate([{ transform: "scale(1)" }, { transform: "scale(1.16)", offset: 0.4 }, { transform: "scale(1)" }], { duration: 900, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.2)" });
			this.hub.dayClearSound(this.rootEl.win);
			void dayClear(doc, { title: this.t("day.clear-title"), sub: this.t("day.clear-sub") }, accent);
		}
	}

	/** The box pops, dots burst out of it, the title is struck, then the row slides away and folds. */
	private async completeAnimation(row: HTMLElement | null): Promise<void> {
		if (!row?.isConnected) return;
		row.addClass("is-done");
		const box = row.querySelector<HTMLElement>(".sk-tasks-cb");
		if (box) {
			box.setAttr("aria-checked", "true");
			const burst = box.createSpan({ cls: "sk-tasks-burst" });
			for (let i = 0; i < 10; i++) {
				const dot = burst.createEl("i");
				dot.setCssProps({ "--a": `${i * 36 + (i % 2) * 12}deg` });
				dot.setCssProps({ "--d": `${i % 2 ? 19 : 26}px` });
			}
		}
		const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		if (reduced) return;
		await sleep(520);
		row.style.height = row.offsetHeight + "px";
		row.addClass("is-leaving");
		window.requestAnimationFrame(() => {
			row.style.removeProperty("height");
			row.addClass("is-collapsed");
		});
		await sleep(320);
	}

	// ----- quick add -----

	startAdd(tag: string | null): void {
		// Waiting and Someday have no row to add: a new task is written from All.
		if (this.st.scope.startsWith("flag:")) this.setScope("all");
		const scope = this.st.scope;
		if (tag === null && scope.startsWith("tag:")) tag = scope.slice(4);
		if (tag && this.settings.collapsed.includes(tag)) {
			this.settings.collapsed = this.settings.collapsed.filter((x) => x !== tag);
			void this.hub.ctx.saveSettings();
		}
		this.st.adding = tag ?? "";
		this.refresh();
		const input = this.listEl?.querySelector<HTMLInputElement>(".sk-tasks-add input");
		if (input) {
			input.focus();
			input.scrollIntoView({ block: "nearest" });
		}
	}

	private addRow(parent: HTMLElement, tag: string | null): HTMLElement {
		const row = parent.createDiv({ cls: "sk-tasks-row sk-tasks-add", attr: { "data-tag": tag ?? "" } });
		checkbox(row);
		const main = row.createDiv({ cls: "sk-tasks-row-main" });
		// The tag of the new task, as everywhere: a capsule (or "tag"), the shared picker on a click.
		const line = main.createDiv({ cls: "sk-tasks-add-line" });
		const tagBtn = line.createEl("button", { cls: "sk-tasks-add-tag" + (tag ? "" : " is-empty"), attr: { type: "button", "aria-label": this.t("add.choose-tag") } });
		if (tag) capsule(tagBtn, tag, this.hub);
		else {
			icon(tagBtn, "tag");
			tagBtn.createSpan({ text: this.t("row.tag-short") });
		}
		tagBtn.addEventListener("mousedown", (e) => e.preventDefault());
		tagBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const caret = { start: input.selectionStart ?? input.value.length, end: input.selectionEnd ?? input.value.length };
			const again = () => {
				const live = this.listEl?.querySelector<HTMLInputElement>(".sk-tasks-add input");
				if (!live) return;
				live.focus({ preventScroll: true });
				const n = live.value.length;
				live.setSelectionRange(Math.min(caret.start, n), Math.min(caret.end, n));
			};
			this.chooseTag(
				tagBtn,
				tag,
				[],
				(chosen) => {
					this.startAdd(chosen);
					again();
				},
				again,
			);
		});
		const input = line.createEl("input", { type: "text", attr: { "data-sk-own-tab": "", placeholder: this.t(tag ? "add.placeholder" : "add.placeholder-tag") } });
		input.value = this.st.draft;
		input.addEventListener("input", () => {
			this.st.draft = input.value;
		});
		if (Platform.isPhone && this.st.justAdded?.length) {
			// What was just added lands here, newest on top: no doubt it was written.
			const landed = main.createDiv({ cls: "sk-tasks-landed" });
			this.st.justAdded.forEach((text, i) => {
				const item = landed.createDiv({ cls: "sk-tasks-landed-it" + (i === 0 ? " is-fresh" : "") });
				icon(item, "check");
				item.createSpan({ text });
			});
		}
		const target = this.hub.writer.newTaskTarget();
		const hint = main.createDiv({ cls: "sk-tasks-add-hint" });
		hint.append(richText(this.t(tag ? "add.hint" : "add.hint-tag", { note: noteName(target.path), tomorrow: this.t("quick.tomorrow") })));
		const scopeDue = this.st.scope === "today" ? this.today() : null;
		input.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Escape") {
				e.preventDefault();
				this.st.adding = null;
				this.st.draft = "";
				this.st.justAdded = [];
				input.blur();
				this.refresh();
				this.rootEl.focus();
			}
			if (e.key === "Enter" && input.value.trim()) {
				e.preventDefault();
				const q = parseQuickAdd(input.value, this.today(), this.hub.dayWords());
				input.value = "";
				this.st.draft = "";
				if (!q.text) return;
				const text = q.text;
				// Where the line was typed, for it to glide to its row once written (computer).
				const box = row.getBoundingClientRect();
				const field = input.getBoundingClientRect();
				const from = new DOMRect(box.left, field.top - 8, box.width, field.height + 16);
				void this.hub.writer
					.addTask(text, tag ?? "inbox", q.priority, q.due ?? scopeDue)
					.then((added) => {
						// The index's key, found by the line: a task of the same name elsewhere gets "#2".
						const key = added ? (this.hub.index.open().find((t) => t.path === added.path && t.line === added.line)?.key ?? added.key) : null;
						if (key) this.freshKey = key;
						if (added && Platform.isPhone) this.st.justAdded = [text, ...(this.st.justAdded ?? [])].slice(0, 3);
						this.refresh();
						if (key && !Platform.isPhone) void this.landAdded(key, text, from, field.left - box.left);
					})
					.catch((error) => {
						console.error("[Snailkit] tasks: could not add the task", error);
						this.hub.ctx.toast(this.t("notice.add-failed"));
					});
			}
		});
		// Closes the empty row when the focus really left it (a refresh rebuilds the row).
		input.addEventListener("blur", () => {
			if (input.value.trim()) return;
			window.setTimeout(() => {
				const active = this.rootEl.doc.activeElement as HTMLElement | null;
				const picking = !!this.rootEl.doc.querySelector(".sk-tag-picker-pop");
				if (this.st.adding !== null && !picking && !active?.closest(".sk-tasks-add") && !this.isEditing()) {
					this.st.adding = null;
					this.st.draft = "";
					this.st.justAdded = [];
					this.refresh();
				}
			}, 150);
		});
		return row;
	}

	/**
	 * A task was just added: the typed line glides from the add row to its row in the list, which then
	 * glows. The list does not scroll (the add row stays in view for the next one): a row below or above
	 * what is shown gets the line gliding to that edge and fading there. Not on screen at all (filtered
	 * out, another view): the count pops.
	 */
	private async landAdded(key: string, text: string, from: DOMRect, inset: number): Promise<void> {
		if (!this.hub.playful(this.rootEl.win)) return;
		const row = this.rowOf(key);
		const r = row?.getBoundingClientRect();
		if (!row || !r || r.height === 0 || !this.listEl) {
			if (this.countEl?.isConnected) pop(this.countEl);
			return;
		}
		// A row out of sight: the list scrolls to it while the line travels, then comes back to the add row.
		const listEl = this.listEl;
		const list = listEl.getBoundingClientRect();
		const before = listEl.scrollTop;
		const shown = r.top >= list.top && r.bottom <= list.bottom;
		const max = listEl.scrollHeight - listEl.clientHeight;
		const target = shown ? before : Math.max(0, Math.min(max, before + r.top - list.top - (list.height - r.height) / 2));
		const to = new DOMRect(r.left, r.top - (target - before), r.width, r.height);
		// No redraw while it travels: the row it aims at stays where it is.
		this.animating++;
		row.removeClass("is-new");
		row.addClass("is-landing");
		try {
			if (!shown) listEl.scrollTo({ top: target, behavior: "smooth" });
			await glide(this.rootEl.doc, text, from, inset, to);
			row.removeClass("is-landing");
			row.addClass("is-landed");
			this.landedKey = key;
			window.setTimeout(() => {
				if (this.landedKey === key) this.landedKey = null;
			}, 1800);
			if (!shown) {
				await sleep(900);
				// Back to the add row, unless the list was scrolled by hand meanwhile.
				if (Math.abs(listEl.scrollTop - target) < 4) {
					listEl.scrollTo({ top: before, behavior: "smooth" });
					await sleep(450);
				}
			}
		} finally {
			row.removeClass("is-landing");
			this.animating--;
		}
		if (this.pending && !this.animating) this.refresh();
	}

	/** The cursor of the quick add row, kept when the tab goes away (another tab, a layout change). */
	private caret(): Memory["caret"] {
		const input = this.listEl?.querySelector<HTMLInputElement>(".sk-tasks-add input");
		if (!input || this.st.adding === null) return null;
		const end = input.value.length;
		return { start: input.selectionStart ?? end, end: input.selectionEnd ?? end, focused: this.rootEl.doc.activeElement === input };
	}

	/** Puts the cursor back in the quick add row, and the focus when the row had it. */
	private restoreCaret(caret: NonNullable<Memory["caret"]>): void {
		const input = this.listEl?.querySelector<HTMLInputElement>(".sk-tasks-add input");
		if (!input) return;
		const length = input.value.length;
		const start = Math.min(caret.start, length);
		input.setSelectionRange(start, Math.max(start, Math.min(caret.end, length)));
		if (caret.focused) input.focus({ preventScroll: true });
	}

	// ----- details -----

	private renderDetail(): void {
		const detail = this.detailEl!;
		detail.empty();
		const t = this.hub.index.get(this.st.sel);
		detail.parentElement?.toggleClass("has-sel", !!t);
		if (!t) {
			const box = detail.createDiv({ cls: "sk-tasks-det-empty" });
			icon(box.createDiv({ cls: "sk-tasks-empty-ic" }), "mouse-pointer-click");
			box.createDiv({ cls: "sk-tasks-empty-t", text: this.t("detail.empty.title") });
			box.createDiv({ cls: "sk-tasks-empty-s", text: this.t("detail.empty.sub") });
			return;
		}
		const head = detail.createDiv({ cls: "sk-tasks-det-head" });
		const crumbs = head.createDiv({ cls: "sk-tasks-crumbs" });
		if (t.primary) capsule(crumbs, t.primary, this.hub, "sk-tasks-cap-sm");
		else crumbs.createSpan({ cls: "sk-tasks-crumb-notag", text: this.t("group.untagged") });
		crumbs.createSpan({ text: "/" });
		crumbs.createEl("b", { text: noteName(t.path) });
		const open = head.createEl("button", { cls: "sk-btn is-ghost" });
		icon(open, "arrow-up-right");
		open.createSpan({ text: this.t("menu.open") });
		open.addEventListener("click", () => void this.openTask(t));
		this.iconButton(head, "x", this.t("detail.close"), () => {
			this.st.sel = null;
			this.refresh();
		});
		this.detailBody(detail.createDiv({ cls: "sk-tasks-det-body" + this.entering(t.key) }), t);
	}

	private inlineDetail(parent: HTMLElement, t: Task): void {
		this.detailBody(parent.createDiv({ cls: "sk-tasks-inline-det" + this.entering(t.key), attr: { "data-sk-zone": "detail" } }), t);
	}

	/** " is-entering" the first time the details of this task are drawn. */
	private entering(key: string): string {
		if (this.shownDetail === key) return "";
		this.shownDetail = key;
		return " is-entering";
	}

	private detailBody(body: HTMLElement, t: Task): void {
		const hub = this.hub;
		const today = this.today();
		if (this.st.propsFor !== t.key) {
			this.st.propsFor = t.key;
			this.st.editProp = null;
		}

		// Title: rendered Markdown; editing shows the Markdown of the title.
		const titleRow = body.createDiv({ cls: "sk-tasks-det-title-row" + (t.priority ? " p-" + t.priority : "") });
		if (this.layout === "page") {
			const done = checkbox(titleRow);
			this.zoneItem(done);
			done.addEventListener("click", () => void this.complete(t));
		}
		const title = titleRow.createDiv({ cls: "sk-tasks-det-title", attr: { contenteditable: "true", tabindex: "0", "data-sk-item": "", spellcheck: "false", "aria-label": this.t("detail.rename") } });
		renderInline(title, t.title);
		icon(titleRow, "pencil", "sk-tasks-det-edit").addEventListener("click", () => title.focus());
		title.addEventListener("focus", () => title.setText(t.title));
		title.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter") {
				e.preventDefault();
				title.blur();
			}
			if (e.key === "Escape") {
				title.setText(t.title);
				title.blur();
			}
		});
		title.addEventListener("blur", () => {
			const value = (title.textContent ?? "").replace(/\s+/g, " ").trim();
			title.empty();
			renderInline(title, t.title);
			if (value && value !== t.title) void this.rename(t, value);
			else if (this.pending) this.refresh();
		});

		if (t.description) {
			const description = body.createDiv({ cls: "sk-tasks-det-description" });
			const label = description.createDiv({ cls: "sk-tasks-prop-l" });
			icon(label, "align-left");
			label.createSpan({ text: this.t("detail.description") });
			description.createDiv({ cls: "sk-tasks-description-text", text: t.description });
		}

		// Properties: the current value; a click unfolds the choices in place.
		const props = body.createDiv({ cls: "sk-tasks-props" });
		const prop = (id: string, iconName: string, showValue: (el: HTMLElement) => void, editor?: (el: HTMLElement) => void) => {
			const isOpen = this.st.editProp === id;
			const label = props.createDiv({ cls: "sk-tasks-prop-l" });
			icon(label, iconName);
			label.createSpan({ text: this.t("prop." + id) });
			const value = props.createDiv({ cls: "sk-tasks-prop-v" + (editor ? " is-editable" : "") + (isOpen ? " is-open" : "") });
			showValue(value);
			if (!editor) return;
			this.zoneItem(value);
			icon(value, "chevron-down", "sk-tasks-prop-chev");
			value.addEventListener("click", (e) => {
				if ((e.target as HTMLElement).closest(".sk-tasks-cap, input, button")) return;
				this.st.editProp = isOpen ? null : id;
				this.refresh();
			});
			if (!isOpen) return;
			const entering = this.shownProp !== t.key + "/" + id;
			this.shownProp = t.key + "/" + id;
			editor(props.createDiv({ cls: "sk-tasks-prop-edit" + (entering ? " is-entering" : "") }));
		};
		const choose = (run: () => Promise<void>) => () => {
			this.st.editProp = null;
			void run();
		};

		prop("tag", "hash", (value) => {
			if (!t.primary) {
				const add = value.createEl("button", { cls: "sk-tasks-notag", attr: { type: "button" } });
				icon(add, "tag");
				add.appendText(this.t("row.tag-short"));
				this.zoneItem(add);
				add.addEventListener("click", () => this.tagUntagged(t, add));
				return;
			}
			const cap = capsule(value, t.primary, hub);
			cap.addClass("is-clickable");
			this.zoneItem(cap);
			cap.setAttr("aria-label", this.t("menu.move"));
			cap.addEventListener("click", () => this.pickTag(t, cap));
		});

		prop(
			"priority",
			"flag",
			(value) => {
				if (!t.priority) {
					value.createSpan({ cls: "sk-tasks-prop-none", text: this.t("prio.none") });
					return;
				}
				const span = value.createSpan({ cls: "sk-tasks-prop-val" });
				icon(span, "flag", "sk-tasks-fl-" + t.priority);
				span.appendText(this.t("prio." + t.priority));
			},
			(editor) => {
				const seg = editor.createDiv({ cls: "sk-tasks-pseg" });
				for (const p of [...PRIORITIES, null] as Array<Priority | null>) {
					const button = seg.createEl("button", { cls: "sk-btn is-s sk-tasks-chip" + (t.priority === p ? " is-on" : "") });
					icon(button, p ? "flag" : "flag-off", "sk-tasks-fl-" + (p ?? "none"));
					button.createSpan({ text: this.t("prio." + (p ?? "none")) });
					button.addEventListener("click", choose(() => hub.setPriority(t, p)));
				}
			},
		);

		const flags = this.flags();
		if (flags.length) {
			prop("flags", "zap", (value) => {
				const row = value.createDiv({ cls: "sk-tasks-flagrow" });
				for (const f of flags) {
					const on = hasFlag(t, f);
					const b = row.createEl("button", { cls: "sk-btn is-s sk-tasks-chip sk-tasks-flag-" + f + (on ? " is-on" : ""), attr: { type: "button", "aria-pressed": String(on) } });
					icon(b, this.flagIcon(f));
					b.createSpan({ text: this.flagLabel(f) });
					this.zoneItem(b);
					b.addEventListener("click", () => void hub.setFlag(t, f, !on));
				}
			});
		}

		prop(
			"due",
			"calendar",
			(value) => {
				if (!t.due) {
					value.createSpan({ cls: "sk-tasks-prop-none", text: this.t("prop.no-date") });
					return;
				}
				value.createSpan({
					cls: "sk-tasks-prop-val sk-tasks-due-val is-" + dueState(t.due, today),
					text: `${hub.formatDate(t.due, "format.detail")} · ${hub.dueText(t.due)}`,
				});
			},
			(editor) => {
				const quick = editor.createDiv({ cls: "sk-tasks-due-quick" });
				const chip = (label: string, due: string) => {
					const button = quick.createEl("button", { cls: "sk-btn is-s sk-tasks-chip" + (t.due === due ? " is-on" : ""), text: label });
					button.addEventListener("click", choose(() => hub.setDue(t, due)));
				};
				chip(this.t("due.today"), today);
				chip(this.t("due.tomorrow"), addDays(today, 1));
				chip(this.t("due.next-week"), nextWeek(today));
				const picker = quick.createEl("input", { type: "date", cls: "sk-tasks-date" });
				picker.value = t.due ?? "";
				picker.addEventListener("change", () => {
					if (picker.value) choose(() => hub.setDue(t, picker.value))();
				});
				if (t.due) {
					const clear = quick.createEl("button", { cls: "sk-btn is-ghost is-s" });
					icon(clear, "x");
					clear.appendText(this.t("due.clear"));
					clear.addEventListener("click", choose(() => hub.setDue(t, null)));
				}
			},
		);

		prop("note", "file-text", (value) => {
			const link = value.createEl("button", { cls: "sk-btn is-ghost is-s sk-tasks-src-link" });
			link.createEl("b", { text: noteName(t.path) });
			link.createSpan({ cls: "sk-tasks-ln", text: this.t("detail.line", { line: t.line + 1 }) });
			icon(link, "arrow-up-right");
			link.addEventListener("click", () => void this.openTask(t));
		});

		if (t.subtasks.length) {
			const head = body.createDiv({ cls: "sk-tasks-sec-head" });
			icon(head, "list-checks");
			head.createSpan({ text: this.t("detail.subtasks") });
			head.createSpan({ cls: "sk-tasks-faint", text: `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` });
			const list = body.createDiv({ cls: "sk-tasks-subtasks" });
			for (const sub of t.subtasks) {
				const item = list.createDiv({ cls: "sk-tasks-sub" + (sub.done ? " is-done" : "") });
				const box = checkbox(item, "sk-tasks-cb-sm");
				box.setAttr("aria-checked", String(sub.done));
				renderInline(item.createSpan({ cls: "sk-tasks-txt" }), sub.text);
				this.zoneItem(box);
				box.addEventListener("click", () => void hub.writer.toggleSubtask(t, sub));
			}
		}
		if (this.notePreview && this.notePreview.task.key !== t.key) {
			this.notePreview.unload();
			this.notePreview = null;
		}
		if (!this.notePreview) {
			if (!hub.taskNotes) return;
			this.notePreview = new TaskNoteView(hub, hub.taskNotes, t);
			this.notePreview.mount(body, t);
			this.notePreview.load();
		} else this.notePreview.mount(body, t);
	}

	// ----- drag and drop -----

	private dragSource(row: HTMLElement, t: Task): void {
		row.addEventListener("dragstart", (e) => {
			this.dragKey = t.key;
			this.dragKeys = this.picked.size >= 2 && this.picked.has(t.key) ? [...this.picked.keys()] : [];
			e.dataTransfer?.setData("text/plain", t.title);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
			window.setTimeout(() => row.addClass("is-dragging"), 0);
			this.rootEl.doc.body.addClass("sk-tasks-dnd");
		});
		row.addEventListener("dragend", () => {
			row.removeClass("is-dragging");
			this.rootEl.doc.body.removeClass("sk-tasks-dnd");
			this.clearDrop();
			this.dragKey = null;
			this.dragKeys = [];
		});
	}

	/** A place to drop a task: `tag` moves it to that tag, `due` schedules it for today. */
	private dropTarget(el: HTMLElement, what: { tag?: string; due?: boolean }): void {
		const accepts = () => {
			if (this.dragKeys.length >= 2) return true;
			const t = this.hub.index.get(this.dragKey);
			return !!t && (what.due ? t.due !== this.today() : what.tag !== t.primary);
		};
		el.addEventListener("dragover", (e) => {
			if (!this.dragKey) return;
			e.preventDefault();
			e.stopPropagation();
			if (!accepts()) return;
			if (el.hasClass("is-drop-into")) return;
			this.clearDrop();
			el.addClass("is-drop-into");
		});
		el.addEventListener("dragleave", (e) => {
			if (!el.contains(e.relatedTarget as Node | null)) el.removeClass("is-drop-into");
		});
		el.addEventListener("drop", (e) => {
			if (!this.dragKey) return;
			e.preventDefault();
			e.stopPropagation();
			this.clearDrop();
			const t = this.hub.index.get(this.dragKey);
			if (!t) return;
			// Several picked tasks dragged together: all of them move.
			if (this.dragKeys.length >= 2) {
				const tasks = this.dragKeys.map((key) => this.hub.index.get(key)).filter((x): x is Task => !!x);
				if (what.tag) void this.hub.retagAll(tasks, what.tag).then(() => this.clearPicked());
				if (what.due) void this.hub.setDueAll(tasks, this.today()).then(() => this.clearPicked());
				return;
			}
			if (!accepts()) return;
			if (what.tag) void this.hub.retag(t, what.tag);
			if (what.due) void this.hub.setDue(t, this.today());
		});
	}

	/** The tasks of `t`'s tag as the list shows them now. */
	private groupKeys(t: Task): string[] {
		const pool = t.primary ? this.hub.index.open() : this.hub.index.untagged;
		return this.sorted(pool.filter((x) => x.primary === t.primary)).map((x) => x.key);
	}

	/**
	 * Puts the task `key` before or after `target` (same tag). The list switches to "My order"
	 * (said once in a toast); keys of tasks no longer open are dropped from the saved order.
	 */
	private async placeTask(key: string, target: string, after: boolean): Promise<void> {
		const t = this.hub.index.get(key);
		if (!t) return;
		const live = new Set([...this.hub.index.open(), ...this.hub.index.untagged].map((x) => x.key));
		const order = this.settings.taskOrder.filter((k) => live.has(k));
		this.settings.taskOrder = moveInOrder(order, this.groupKeys(t), key, target, after);
		const switched = this.sortMode() !== "manual";
		if (switched) this.settings.sortMode = "manual";
		await this.hub.ctx.saveSettings();
		if (switched) this.hub.ctx.toast(this.t("sort.now-manual"));
	}

	/** Alt+Up / Alt+Down: one place up or down within its tag. */
	private async nudgeTask(t: Task, step: -1 | 1): Promise<void> {
		const keys = this.groupKeys(t);
		const i = keys.indexOf(t.key);
		const target = keys[i + step];
		if (i < 0 || !target) return;
		await this.placeTask(t.key, target, step > 0);
	}

	/** A task row accepts another task of the same tag dragged onto it: a line shows where it lands. */
	private taskDrop(row: HTMLElement, t: Task): void {
		const accepts = () => {
			const dragged = this.hub.index.get(this.dragKey);
			return !!dragged && dragged.key !== t.key && dragged.primary === t.primary;
		};
		const side = (e: DragEvent) => {
			const box = row.getBoundingClientRect();
			return e.clientY > box.top + box.height / 2;
		};
		row.addEventListener("dragover", (e) => {
			if (!this.dragKey || !accepts()) return;
			e.preventDefault();
			e.stopPropagation();
			const after = side(e);
			if (row.hasClass(after ? "is-drop-after" : "is-drop-before")) return;
			this.clearTagDrop();
			row.addClass(after ? "is-drop-after" : "is-drop-before");
		});
		row.addEventListener("dragleave", (e) => {
			if (!row.contains(e.relatedTarget as Node | null)) row.removeClass("is-drop-before", "is-drop-after");
		});
		row.addEventListener("drop", (e) => {
			if (!this.dragKey || !accepts()) return;
			e.preventDefault();
			e.stopPropagation();
			this.clearTagDrop();
			void this.placeTask(this.dragKey, t.key, side(e));
		});
	}

	private clearDrop(): void {
		this.rootEl.querySelectorAll(".is-drop-into").forEach((el) => el.removeClass("is-drop-into"));
	}

	// ----- keyboard -----

	/** A small notebook on tasks that have their own note. */
	private taskNoteMarker(parent: HTMLElement, t: Task): void {
		if (!t.noteLink) return;
		const marker = icon(parent, "notebook-pen", "sk-tasks-has-note");
		marker.setAttr("aria-label", this.t("note.title"));
	}

	private sessionMarker(parent: HTMLElement, path: string): void {
		if (!this.hub.isSession(path)) return;
		const marker = icon(parent, "zap", "sk-tasks-session");
		marker.setAttr("aria-label", this.t("row.session"));
		marker.setAttr("title", this.t("row.session"));
	}

	private async onKey(e: KeyboardEvent): Promise<void> {
		if (e.defaultPrevented) return;
		const target = e.target as HTMLElement;
		const zone = target.closest<HTMLElement>("[data-sk-zone]");
		if (zone && zone.dataset.skZone !== "list" && !["/", "n"].includes(e.key.toLowerCase())) return;
		if (target !== this.rootEl && target !== this.listEl && !target.matches(".sk-tasks-row[data-key]") && !["/", "n"].includes(e.key.toLowerCase())) return;
		if (target.matches?.("input, textarea") || target.isContentEditable) return;
		const key = e.key;
		if ((e.ctrlKey || e.metaKey) && !e.altKey && key.toLowerCase() === "z" && this.hub.canUndo()) {
			e.preventDefault();
			await this.hub.undo();
			return;
		}
		// Alt+Up / Alt+Down: the selected task moves within its tag ("My order").
		if (e.altKey && !e.ctrlKey && !e.metaKey && (key === "ArrowUp" || key === "ArrowDown")) {
			const t = this.hub.index.get(this.st.sel);
			if (!t) return;
			e.preventDefault();
			e.stopPropagation();
			await this.nudgeTask(t, key === "ArrowUp" ? -1 : 1);
			return;
		}
		// Ctrl/Cmd+A: every task shown is picked.
		if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && key.toLowerCase() === "a") {
			e.preventDefault();
			e.stopPropagation();
			const keys = this.visibleKeys();
			if (keys.length < 2) return;
			for (const k of keys) this.pick(k);
			this.refresh();
			return;
		}
		// Shift+Up/Down: several tasks.
		if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (key === "ArrowUp" || key === "ArrowDown")) {
			e.preventDefault();
			e.stopPropagation();
			this.extendPick(key === "ArrowUp" ? -1 : 1);
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const many = this.picked.size >= 2 ? this.pickAction(key) : null;
		if (many) {
			e.preventDefault();
			e.stopPropagation();
			await many();
			return;
		}
		const action = this.keyAction(key, this.hub.index.get(this.st.sel));
		if (!action) return;
		e.preventDefault();
		e.stopPropagation();
		await action();
	}

	/** What a key does to the picked tasks, or null (then it acts as usual, on the selected one). */
	private pickAction(key: string): (() => unknown) | null {
		const tasks = this.pickedTasks();
		const today = this.today();
		switch (key.length === 1 ? key.toLowerCase() : key) {
			case "Escape":
				return () => this.clearPicked();
			case "x":
			case " ":
				return () => this.hub.completeAll(tasks).then(() => this.clearPicked());
			case "Delete":
				return () => this.hub.deleteAll(tasks).then(() => this.clearPicked());
			case "t":
				return () => this.hub.setDueAll(tasks, today).then(() => this.clearPicked());
			case "m":
				return () => this.pickTagAll(tasks);
			case "0":
			case "1":
			case "2":
			case "3":
				return () => this.hub.setPriorityAll(tasks, ([null, "high", "medium", "low"] as const)[+key]).then(() => this.clearPicked());
			default:
				return null;
		}
	}

	/** What a key does in the list, or null to let Obsidian have it. */
	private keyAction(key: string, t: Task | null): (() => unknown) | null {
		const lower = key.length === 1 ? key.toLowerCase() : key;
		if (lower === "ArrowDown" || lower === "j") return () => this.moveSel(1);
		if (lower === "ArrowUp" || lower === "k") return () => this.moveSel(-1);
		if (lower === "/") return () => this.searchInput?.focus();
		if (lower === "n") return () => this.startAdd(null);
		if (lower === "z" && this.hub.canUndo()) return () => this.hub.undo();
		if (lower === "Escape") {
			return () => {
				this.st.open = null;
				if (this.layout === "page") this.st.sel = null;
				this.refresh();
			};
		}
		if (!t) return null;
		const today = this.today();
		switch (lower) {
			case "x":
			case " ":
				return () => {
					this.moveSel(1);
					if (this.st.sel === t.key) this.st.sel = null;
					return this.complete(t);
				};
			case "Enter":
				if (this.layout === "page") return () => this.openTask(t);
				return () => {
					this.st.open = this.st.open === t.key ? null : t.key;
					this.refresh();
				};
			case "Delete":
				return () => this.deleteTask(t);
			case "o":
				return () => this.openTask(t);
			case "m":
				return () => this.pickTag(t);
			case "F2":
				return () => this.inlineRename(t);
			case "t":
				return () => this.hub.setDue(t, t.due === today ? null : today);
			case "0":
			case "1":
			case "2":
			case "3":
				return () => this.hub.setPriority(t, ([null, "high", "medium", "low"] as const)[+lower]);
			default:
				return null;
		}
	}
}
