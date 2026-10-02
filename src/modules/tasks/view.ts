// The task list. One view for both places: a compact list in a side panel, and navigator +
// list + details when it gets a page-wide leaf. Everything it changes is written in the notes.
import { ItemView, Menu, type WorkspaceLeaf } from "obsidian";
import { richText } from "../../ui/settings-page";
import { capsule, checkbox, colorFor, icon, kbd, renderInline, tagDot, TagSuggestModal } from "./components";
import {
	addDays, buildTree, countTasks, dueState, findNode, inScope, matchesQuery, nextWeek, passesPriority,
	sortTasks, todayGroups, upcomingGroups, type TagNode,
} from "./group";
import type { TasksHub } from "./hub";
import { PRIORITIES } from "./parse";
import { parseQuickAdd } from "./quick-add";
import { VIEW_TYPE, type Priority, type Task } from "./types";

const PAGE_MIN_WIDTH = 760;
const SORT_MODES = ["notes", "priority", "due"] as const;

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
	/** Property of the details whose choices are unfolded. */
	editProp: string | null;
	propsFor: string | null;
}

function noteName(path: string): string {
	return path.replace(/^.*\//, "").replace(/\.md$/i, "");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class TasksView extends ItemView {
	private layout: Layout | null = null;
	private readonly st: ViewState = { scope: "all", query: "", sel: null, open: null, adding: null, editProp: null, propsFor: null };
	private pending = false;
	private pendingLayout = false;
	private animating = 0;
	private freshKey: string | null = null;
	private dragKey: string | null = null;
	private observer: ResizeObserver | null = null;
	private navEl: HTMLElement | null = null;
	private headEl: HTMLElement | null = null;
	private listEl: HTMLElement | null = null;
	private footEl: HTMLElement | null = null;
	private detailEl: HTMLElement | null = null;
	private searchInput: HTMLInputElement | null = null;
	private countEl: HTMLElement | null = null;
	private scopeEl: HTMLElement | null = null;
	private hubTitleEl: HTMLElement | null = null;
	private subEl: HTMLElement | null = null;
	private sortLabel: HTMLElement | null = null;
	private filterBtn: HTMLElement | null = null;
	/** What the details showed last time, so their entrance animation plays only on a change. */
	private shownDetail: string | null = null;
	private shownProp: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly hub: TasksHub,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.t("module.name");
	}

	getIcon(): string {
		return "list-checks";
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.hub.ctx.t(key, vars);
	}

	private get settings() {
		return this.hub.ctx.settings;
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass("sk-tasks-view");
		this.contentEl.tabIndex = -1;
		this.observer = new ResizeObserver(() => this.checkLayout(false));
		this.observer.observe(this.contentEl);
		this.registerDomEvent(this.contentEl, "keydown", (event) => void this.onKey(event));
		// A refresh waits while a field has the focus; it runs when the focus leaves.
		this.registerDomEvent(this.contentEl, "focusout", () => {
			window.setTimeout(() => {
				if (!this.contentEl.isConnected || this.isEditing()) return;
				if (this.pendingLayout) {
					this.pendingLayout = false;
					this.checkLayout(false);
				}
				if (this.pending) this.refresh();
			}, 0);
		});
		this.checkLayout(true);
	}

	async onClose(): Promise<void> {
		this.observer?.disconnect();
		this.observer = null;
		this.contentEl.doc.body.removeClass("sk-tasks-dnd");
		this.contentEl.empty();
	}

	private checkLayout(force: boolean): void {
		const width = this.contentEl.clientWidth;
		if (!width && !force) return;
		const layout: Layout = width >= PAGE_MIN_WIDTH ? "page" : "side";
		if (layout !== this.layout && !force && this.isEditing()) {
			this.pendingLayout = true;
			return;
		}
		if (layout !== this.layout || force) {
			this.layout = layout;
			this.build();
		}
	}

	private isEditing(): boolean {
		const active = this.contentEl.doc.activeElement as HTMLElement | null;
		return (
			!!active &&
			this.contentEl.contains(active) &&
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
		return this.hub.index.open().filter((t) => matchesQuery(t, this.st.query) && passesPriority(t, filter));
	}

	private sorted(tasks: readonly Task[]): Task[] {
		return sortTasks(tasks, this.settings.sortMode);
	}

	private visibleKeys(): string[] {
		return Array.from(this.contentEl.querySelectorAll<HTMLElement>(".sk-tasks-row[data-key]"), (row) => row.dataset.key!);
	}

	private rowOf(key: string): HTMLElement | null {
		return this.listEl?.querySelector<HTMLElement>(`.sk-tasks-row[data-key="${CSS.escape(key)}"]`) ?? null;
	}

	// ----- skeleton -----

	build(): void {
		const el = this.contentEl;
		el.empty();
		el.toggleClass("is-page", this.layout === "page");
		el.toggleClass("is-side", this.layout === "side");
		const hub = el.createDiv({ cls: `sk-tasks-hub sk-tasks-${this.layout ?? "side"}` });
		if (this.layout === "page") {
			this.navEl = hub.createDiv({ cls: "sk-tasks-nav" });
			const center = hub.createDiv({ cls: "sk-tasks-center" });
			this.headEl = center.createDiv({ cls: "sk-tasks-page-head" });
			this.listEl = center.createDiv({ cls: "sk-tasks-list" });
			this.footEl = center.createDiv({ cls: "sk-tasks-foot" });
			this.detailEl = hub.createDiv({ cls: "sk-tasks-detail" });
		} else {
			this.navEl = null;
			this.detailEl = null;
			this.headEl = hub.createDiv({ cls: "sk-tasks-side-head" });
			this.listEl = hub.createDiv({ cls: "sk-tasks-list" });
			this.footEl = hub.createDiv({ cls: "sk-tasks-foot" });
		}
		this.renderHead();
		this.renderFoot();
		this.pending = false;
		this.refresh();
	}

	refresh(): void {
		if (!this.listEl) return;
		// Wait for an edit or a completion animation to finish.
		if (this.isEditing() || this.animating) {
			this.pending = true;
			return;
		}
		this.pending = false;
		const scroll = this.listEl.scrollTop;
		const addInput = this.listEl.querySelector<HTMLInputElement>(".sk-tasks-add input");
		const adding = addInput && this.contentEl.doc.activeElement === addInput ? { value: addInput.value, pos: addInput.selectionStart ?? 0 } : null;
		if (this.st.sel && !this.hub.index.get(this.st.sel)) this.st.sel = null;
		if (this.st.open && !this.hub.index.get(this.st.open)) this.st.open = null;
		if (!(this.layout === "page" ? this.st.sel : this.st.open)) this.shownDetail = null;
		if (!this.st.editProp) this.shownProp = null;
		this.updateHead();
		if (this.navEl) this.renderNav();
		this.renderList();
		if (this.detailEl) this.renderDetail();
		this.listEl.scrollTop = scroll;
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
		const button = parent.createEl("button", { cls: "sk-tasks-icon-btn clickable-icon", attr: { "aria-label": label } });
		icon(button, name);
		button.addEventListener("click", onClick);
		return button;
	}

	private renderHead(): void {
		const head = this.headEl!;
		head.empty();
		this.filterBtn = this.countEl = this.scopeEl = this.hubTitleEl = this.subEl = this.sortLabel = null;
		if (this.layout === "side") {
			const top = head.createDiv({ cls: "sk-tasks-side-top" });
			const title = top.createDiv({ cls: "sk-tasks-title" });
			title.createSpan({ text: this.t("module.name") });
			this.countEl = title.createSpan({ cls: "sk-tasks-count" });
			this.iconButton(top, "arrow-up-down", this.t("sort.label"), (e) => this.sortMenu(e));
			this.filterBtn = this.iconButton(top, "list-filter", this.t("filter.label"), (e) => this.filterMenu(e));
			this.filterBtn.addClass("sk-tasks-filter-btn");
			this.iconButton(top, "maximize-2", this.t("action.page"), () => void this.hub.activate("page"));
			this.iconButton(top, "plus", this.t("action.new-key"), () => this.startAdd(null));
			this.searchBox(head);
			this.scopeEl = head.createDiv({ cls: "sk-tasks-scopes" });
		} else {
			const titleRow = head.createDiv({ cls: "sk-tasks-ph-title" });
			this.hubTitleEl = titleRow.createDiv({ cls: "sk-tasks-ph-name" });
			this.subEl = titleRow.createDiv({ cls: "sk-tasks-ph-sub" });
			const tools = head.createDiv({ cls: "sk-tasks-ph-tools" });
			this.searchBox(tools);
			const chips = tools.createDiv({ cls: "sk-tasks-fchips" });
			for (const p of [...PRIORITIES, "none"]) {
				const chip = chips.createEl("button", { cls: "sk-tasks-fchip" + (this.settings.priorityFilter.includes(p) ? " is-on" : "") });
				chip.dataset.prio = p;
				icon(chip, p === "none" ? "flag-off" : "flag", "sk-tasks-fl-" + p);
				chip.createSpan({ text: this.t("prio." + p) });
				chip.addEventListener("click", () => void this.togglePriorityFilter(p));
			}
			const sort = tools.createEl("button", { cls: "sk-tasks-btn-ghost" });
			icon(sort, "arrow-up-down");
			this.sortLabel = sort.createSpan();
			sort.addEventListener("click", (e) => this.sortMenu(e));
			const add = tools.createEl("button", { cls: "sk-tasks-btn-accent" });
			icon(add, "plus");
			add.createSpan({ text: this.t("action.new") });
			kbd(add, "N");
			add.addEventListener("click", () => this.startAdd(null));
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
				this.contentEl.focus();
			}
			if (e.key === "Enter" || e.key === "ArrowDown") {
				e.preventDefault();
				this.contentEl.focus();
				this.moveSel(1);
			}
		});
		this.searchInput = input;
	}

	private updateHead(): void {
		const open = this.hub.index.open();
		const c = countTasks(open, this.today());
		const filter = this.settings.priorityFilter;
		this.filterBtn?.toggleClass("is-active", filter.length > 0);
		if (this.layout === "side") {
			this.countEl?.setText(String(c.all));
			const scopes = this.scopeEl!;
			scopes.empty();
			for (const [id, n] of [["all", c.all], ["today", c.today], ["upcoming", c.upcoming]] as const) {
				const button = scopes.createEl("button", { cls: "sk-tasks-scope" + (this.st.scope === id ? " is-on" : "") });
				button.createSpan({ text: this.t("scope." + id) });
				if (n) button.createSpan({ cls: "sk-tasks-scope-n" + (id === "today" && c.overdue ? " is-warn" : ""), text: String(n) });
				button.addEventListener("click", () => this.setScope(id));
				if (id === "today") this.dropTarget(button, { due: true });
			}
			if (this.st.scope.startsWith("tag:")) {
				const tag = this.st.scope.slice(4);
				const button = scopes.createEl("button", { cls: "sk-tasks-scope is-on is-tag", attr: { "aria-label": this.t("scope.all") } });
				capsule(button, tag, this.hub);
				icon(button, "x");
				button.addEventListener("click", () => this.setScope("all"));
			}
		} else {
			const scope = this.st.scope;
			const title = this.hubTitleEl!;
			title.empty();
			if (scope.startsWith("tag:")) capsule(title, scope.slice(4), this.hub, "sk-tasks-cap-lg");
			else title.createEl("h1", { text: this.t("title." + scope) });
			const sub = this.subEl!;
			sub.empty();
			const n = scope.startsWith("tag:")
				? open.filter((t) => inScope(t.primary, scope.slice(4))).length
				: scope === "today"
					? c.today
					: scope === "upcoming"
						? c.upcoming
						: c.all;
			sub.createSpan({ text: this.hub.ctx.tn("head.open", n) });
			if (c.overdue) sub.createSpan({ cls: "sk-tasks-od", text: " · " + this.hub.ctx.tn("head.overdue", c.overdue) });
			const dueToday = c.today - c.overdue;
			if (dueToday) sub.createSpan({ cls: "sk-tasks-td", text: " · " + this.hub.ctx.tn("head.today", dueToday) });
			this.sortLabel?.setText(this.t("sort." + this.sortMode()));
			this.headEl?.querySelectorAll<HTMLElement>(".sk-tasks-fchip").forEach((chip) => chip.toggleClass("is-on", filter.includes(chip.dataset.prio ?? "")));
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

	private setScope(scope: string): void {
		this.st.scope = scope;
		this.st.adding = null;
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
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(this.t("filter.focus"))
				.setIcon("hash")
				.onClick(() => new TagSuggestModal(this.hub, null, this.t("tag.focus-placeholder"), (tag) => this.setScope("tag:" + tag)).open()),
		);
		menu.showAtMouseEvent(event);
	}

	// ----- navigator (page) -----

	private renderNav(): void {
		const nav = this.navEl!;
		nav.empty();
		const c = countTasks(this.hub.index.open(), this.today());
		const item = (id: string, iconName: string, n: number, warn = false) => {
			const it = nav.createDiv({ cls: "sk-tasks-nav-item" + (this.st.scope === id ? " is-on" : "") });
			icon(it, iconName);
			it.createSpan({ cls: "sk-tasks-nav-label", text: this.t("title." + id) });
			if (n) it.createSpan({ cls: "sk-tasks-n" + (warn ? " is-warn" : ""), text: String(n) });
			it.addEventListener("click", () => this.setScope(id));
			return it;
		};
		item("all", "layers", c.all);
		this.dropTarget(item("today", "sun", c.today, c.overdue > 0), { due: true });
		item("upcoming", "calendar", c.upcoming);
		nav.createDiv({ cls: "sk-tasks-nav-sec", text: this.t("nav.tags") });
		const walk = (node: TagNode) => {
			const it = nav.createDiv({ cls: "sk-tasks-nav-item sk-tasks-nav-tag" + (this.st.scope === "tag:" + node.tag ? " is-on" : "") });
			it.style.setProperty("--sk-tasks-depth", String(node.depth));
			if (node.depth === 0) capsule(it, node.tag, this.hub, "sk-tasks-cap-nav");
			else {
				const chip = it.createSpan({ cls: "sk-tasks-nav-chip sk-tasks-sec" + (node.depth > 1 ? " is-deep" : ""), text: node.name });
				colorFor(chip, node.tag, this.hub);
			}
			it.createSpan({ cls: "sk-tasks-n", text: String(node.count) });
			it.addEventListener("click", () => this.setScope("tag:" + node.tag));
			this.dropTarget(it, { tag: node.tag });
			node.children.forEach(walk);
		};
		buildTree(this.hub.index.open()).forEach(walk);
		nav.createDiv({ cls: "sk-tasks-nav-foot", text: this.t("nav.hint") });
	}

	// ----- list -----

	private renderList(): void {
		const list = this.listEl!;
		list.empty();
		const scope = this.st.scope;
		const tasks = this.filtered();
		const today = this.today();
		if (this.st.adding === "" && !scope.startsWith("tag:")) this.addRow(list, null);
		if (scope === "today") {
			const groups = todayGroups(tasks, today);
			if (groups.overdue.length) this.smartGroup(list, "overdue", this.t("group.overdue"), "alert-circle", groups.overdue);
			if (groups.today.length || !groups.overdue.length) this.smartGroup(list, "today", this.t("group.today"), "sun", groups.today);
			if (!groups.overdue.length && !groups.today.length) this.empty(list, "sun", "empty.today");
			return;
		}
		if (scope === "upcoming") {
			const days = upcomingGroups(tasks, today);
			for (const day of days) this.smartGroup(list, "day", this.hub.formatDate(day.date, "format.day"), "calendar", day.tasks, this.hub.dueText(day.date));
			if (!days.length) this.empty(list, "calendar", "empty.upcoming");
			return;
		}
		let pool = tasks;
		if (scope.startsWith("tag:")) pool = tasks.filter((t) => inScope(t.primary, scope.slice(4)));
		const tree = buildTree(pool);
		if (scope.startsWith("tag:")) {
			const root = scope.slice(4);
			const node = findNode(tree, root);
			if (node) this.tagGroup(list, node, 0, this.layout === "page");
			else if (this.st.adding !== null) this.addRow(list, root);
		} else tree.forEach((node) => this.tagGroup(list, node, 0));
		if (!pool.length) {
			if (this.st.query || this.settings.priorityFilter.length) {
				this.empty(list, "search", "empty.search", () => {
					this.st.query = "";
					if (this.searchInput) this.searchInput.value = "";
					this.settings.priorityFilter = [];
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
		if (onClear) box.createEl("button", { cls: "sk-tasks-link", text: this.t("empty.clear") }).addEventListener("click", onClear);
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
					this.settings.collapsed = buildTree(this.hub.index.open()).map((n) => n.tag);
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

	private row(parent: HTMLElement, t: Task, showTag: boolean): HTMLElement {
		const today = this.today();
		const row = parent.createDiv({
			cls: "sk-tasks-row" + (t.priority ? " p-" + t.priority : "") + (this.st.sel === t.key ? " is-sel" : "") + (this.freshKey === t.key ? " is-new" : ""),
		});
		row.dataset.key = t.key;
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
		const meta = (this.layout === "page" ? row : main).createDiv({ cls: "sk-tasks-row-meta" });
		const state = dueState(t.due, today);
		if (this.layout === "page") {
			if (showTag) capsule(title, t.primary, this.hub, "sk-tasks-cap-sm");
			this.subtaskCount(meta.createSpan({ cls: "sk-tasks-m-icons" }), t);
			const note = meta.createSpan({ cls: "sk-tasks-m-note" });
			icon(note, "file-text");
			note.createEl("b", { text: noteName(t.path) });
			const due = meta.createSpan({ cls: "sk-tasks-m-due" + (state ? " is-" + state : "") });
			if (t.due) due.appendText(this.hub.dueText(t.due));
		} else {
			if (t.due) {
				const due = meta.createSpan({ cls: "sk-tasks-m-due is-" + state });
				icon(due, state === "overdue" ? "alert-circle" : "calendar");
				due.appendText(this.hub.dueText(t.due));
			}
			if (showTag) capsule(meta, t.primary, this.hub, "sk-tasks-cap-xs");
			this.subtaskCount(meta, t);
			const note = meta.createSpan({ cls: "sk-tasks-m-note" });
			icon(note, "file-text");
			note.createEl("b", { text: noteName(t.path) });
		}
		const actions = row.createDiv({ cls: "sk-tasks-row-act" });
		this.iconButton(actions, "arrow-up-right", this.t("row.open"), (e) => {
			e.stopPropagation();
			void this.hub.writer.openTask(t);
		});
		this.iconButton(actions, "more-horizontal", this.t("row.more"), (e) => {
			e.stopPropagation();
			this.taskMenu(e, t);
		});
		row.addEventListener("click", () => this.select(t.key, true));
		row.addEventListener("dblclick", (e) => {
			if ((e.target as HTMLElement).closest(".sk-tasks-row-title")) this.inlineRename(t);
			else void this.hub.writer.openTask(t);
		});
		row.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			this.select(t.key, false);
			this.taskMenu(e, t);
		});
		this.dragSource(row, t);
		if (this.layout === "side" && this.st.open === t.key) this.inlineDetail(parent, t);
		return row;
	}

	private subtaskCount(parent: HTMLElement, t: Task): void {
		if (!t.subtasks.length) return;
		const span = parent.createSpan({ attr: { "aria-label": this.t("detail.subtasks") } });
		icon(span, "list-checks");
		span.appendText(`${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}`);
	}

	private select(key: string, toggleOpen: boolean): void {
		const was = this.st.sel;
		this.st.sel = key;
		if (this.layout === "side" && toggleOpen) this.st.open = this.st.open === key && was === key ? null : key;
		this.refresh();
		this.rowOf(key)?.scrollIntoView({ block: "nearest" });
		if (!this.isEditing()) this.contentEl.focus({ preventScroll: true });
	}

	private moveSel(delta: number): void {
		const keys = this.visibleKeys();
		if (!keys.length) return;
		const i = this.st.sel ? keys.indexOf(this.st.sel) : -1;
		const next = keys[Math.max(0, Math.min(keys.length - 1, i < 0 ? 0 : i + delta))];
		if (this.layout === "side" && this.st.open) this.st.open = next;
		this.select(next, false);
	}

	private taskMenu(event: MouseEvent, t: Task): void {
		const today = this.today();
		const menu = new Menu();
		menu.addItem((item) => item.setTitle(this.t("menu.open")).setIcon("arrow-up-right").onClick(() => void this.hub.writer.openTask(t)));
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
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(this.t("menu.due-today")).setIcon("sun").onClick(() => void this.hub.setDue(t, today)));
		menu.addItem((item) => item.setTitle(this.t("menu.due-tomorrow")).setIcon("sunrise").onClick(() => void this.hub.setDue(t, addDays(today, 1))));
		menu.addItem((item) => item.setTitle(this.t("menu.due-next-week")).setIcon("calendar").onClick(() => void this.hub.setDue(t, nextWeek(today))));
		if (t.due) menu.addItem((item) => item.setTitle(this.t("menu.due-clear")).setIcon("calendar-x").onClick(() => void this.hub.setDue(t, null)));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(this.t("menu.rename")).setIcon("pencil").onClick(() => this.inlineRename(t)));
		menu.addItem((item) => item.setTitle(this.t("menu.move")).setIcon("hash").onClick(() => this.pickTag(t)));
		menu.showAtMouseEvent(event);
	}

	/** Renames and keeps the task selected (its key changes with its words). */
	private async rename(t: Task, title: string): Promise<void> {
		const expected = this.hub.writer.keyAfterRename(t, title);
		const sel = this.st.sel === t.key;
		const open = this.st.open === t.key;
		if (sel) this.st.sel = expected;
		if (open) this.st.open = expected;
		const key = (await this.hub.rename(t, title)) ?? t.key;
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
		const input = createEl("input", { type: "text", cls: "sk-tasks-rename" });
		input.value = t.title;
		text.replaceWith(input);
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

	private pickTag(t: Task): void {
		new TagSuggestModal(this.hub, t.primary, this.t("tag.move-placeholder"), (tag) => void this.hub.retag(t, tag)).open();
	}

	private async complete(t: Task, rowEl?: HTMLElement): Promise<void> {
		const row = rowEl ?? this.rowOf(t.key);
		this.animating++;
		try {
			await this.completeAnimation(row);
		} finally {
			this.animating--;
		}
		await this.hub.complete(t);
		if (!this.animating) this.refresh();
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
				dot.style.setProperty("--a", `${i * 36 + (i % 2) * 12}deg`);
				dot.style.setProperty("--d", `${i % 2 ? 19 : 26}px`);
			}
		}
		const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		if (reduced) return;
		await sleep(520);
		row.style.height = row.offsetHeight + "px";
		row.addClass("is-leaving");
		window.requestAnimationFrame(() => {
			row.style.height = "0px";
		});
		await sleep(320);
	}

	// ----- quick add -----

	startAdd(tag: string | null): void {
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
		const row = parent.createDiv({ cls: "sk-tasks-row sk-tasks-add" });
		checkbox(row);
		const main = row.createDiv({ cls: "sk-tasks-row-main" });
		const input = main.createEl("input", { type: "text", attr: { placeholder: this.t(tag ? "add.placeholder" : "add.placeholder-tag") } });
		const target = this.hub.writer.newTaskTarget();
		const hint = main.createDiv({ cls: "sk-tasks-add-hint" });
		hint.append(richText(this.t(tag ? "add.hint" : "add.hint-tag", { note: noteName(target.path), tomorrow: this.t("quick.tomorrow") })));
		const scopeDue = this.st.scope === "today" ? this.today() : null;
		input.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Escape") {
				e.preventDefault();
				this.st.adding = null;
				input.blur();
				this.refresh();
				this.contentEl.focus();
			}
			if (e.key === "Enter" && input.value.trim()) {
				e.preventDefault();
				const q = parseQuickAdd(input.value, this.today(), this.hub.dayWords());
				input.value = "";
				if (!q.text) return;
				void this.hub.writer
					.addTask(q.text, tag ?? "inbox", q.priority, q.due ?? scopeDue)
					.then((added) => {
						if (added) this.freshKey = added.key;
						this.refresh();
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
				const active = this.contentEl.doc.activeElement as HTMLElement | null;
				if (this.st.adding !== null && !active?.closest(".sk-tasks-add") && !this.isEditing()) {
					this.st.adding = null;
					this.refresh();
				}
			}, 150);
		});
		return row;
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
		capsule(crumbs, t.primary, this.hub, "sk-tasks-cap-sm");
		crumbs.createSpan({ text: "/" });
		crumbs.createEl("b", { text: noteName(t.path) });
		const open = head.createEl("button", { cls: "sk-tasks-btn-ghost" });
		icon(open, "arrow-up-right");
		open.createSpan({ text: this.t("menu.open") });
		open.addEventListener("click", () => void this.hub.writer.openTask(t));
		this.iconButton(head, "x", this.t("detail.close"), () => {
			this.st.sel = null;
			this.refresh();
		});
		this.detailBody(detail.createDiv({ cls: "sk-tasks-det-body" + this.entering(t.key) }), t);
	}

	private inlineDetail(parent: HTMLElement, t: Task): void {
		this.detailBody(parent.createDiv({ cls: "sk-tasks-inline-det" + this.entering(t.key) }), t);
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
		if (this.layout === "page") checkbox(titleRow).addEventListener("click", () => void this.complete(t));
		const title = titleRow.createDiv({ cls: "sk-tasks-det-title", attr: { contenteditable: "true", spellcheck: "false", "aria-label": this.t("detail.rename") } });
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
			const cap = capsule(value, t.primary, hub);
			cap.addClass("is-clickable");
			cap.setAttr("aria-label", this.t("menu.move"));
			cap.addEventListener("click", () => this.pickTag(t));
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
					const button = seg.createEl("button", { cls: t.priority === p ? "is-on" : "" });
					icon(button, p ? "flag" : "flag-off", "sk-tasks-fl-" + (p ?? "none"));
					button.createSpan({ text: this.t("prio." + (p ?? "none")) });
					button.addEventListener("click", choose(() => hub.setPriority(t, p)));
				}
			},
		);

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
					const button = quick.createEl("button", { cls: "sk-tasks-chip" + (t.due === due ? " is-on" : ""), text: label });
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
					const clear = quick.createEl("button", { cls: "sk-tasks-chip sk-tasks-chip-ghost" });
					icon(clear, "x");
					clear.appendText(this.t("due.clear"));
					clear.addEventListener("click", choose(() => hub.setDue(t, null)));
				}
			},
		);

		prop("note", "file-text", (value) => {
			const link = value.createEl("button", { cls: "sk-tasks-src-link" });
			link.createEl("b", { text: noteName(t.path) });
			link.createSpan({ cls: "sk-tasks-ln", text: this.t("detail.line", { line: t.line + 1 }) });
			icon(link, "arrow-up-right");
			link.addEventListener("click", () => void hub.writer.openTask(t));
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
				box.addEventListener("click", () => void hub.writer.toggleSubtask(t, sub));
			}
		}
	}

	// ----- drag and drop -----

	private dragSource(row: HTMLElement, t: Task): void {
		row.addEventListener("dragstart", (e) => {
			this.dragKey = t.key;
			e.dataTransfer?.setData("text/plain", t.title);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
			window.setTimeout(() => row.addClass("is-dragging"), 0);
			this.contentEl.doc.body.addClass("sk-tasks-dnd");
		});
		row.addEventListener("dragend", () => {
			row.removeClass("is-dragging");
			this.contentEl.doc.body.removeClass("sk-tasks-dnd");
			this.clearDrop();
			this.dragKey = null;
		});
	}

	/** A place to drop a task: `tag` moves it to that tag, `due` schedules it for today. */
	private dropTarget(el: HTMLElement, what: { tag?: string; due?: boolean }): void {
		const accepts = () => {
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
			if (!t || !accepts()) return;
			if (what.tag) void this.hub.retag(t, what.tag);
			if (what.due) void this.hub.setDue(t, this.today());
		});
	}

	private clearDrop(): void {
		this.contentEl.querySelectorAll(".is-drop-into").forEach((el) => el.removeClass("is-drop-into"));
	}

	// ----- keyboard -----

	private async onKey(e: KeyboardEvent): Promise<void> {
		const target = e.target as HTMLElement;
		if (target.matches?.("input, textarea") || target.isContentEditable) return;
		const key = e.key;
		if ((e.ctrlKey || e.metaKey) && !e.altKey && key.toLowerCase() === "z" && this.hub.canUndo()) {
			e.preventDefault();
			await this.hub.undo();
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const action = this.keyAction(key, this.hub.index.get(this.st.sel));
		if (!action) return;
		e.preventDefault();
		e.stopPropagation();
		await action();
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
				if (this.layout === "page") return () => this.hub.writer.openTask(t);
				return () => {
					this.st.open = this.st.open === t.key ? null : t.key;
					this.refresh();
				};
			case "o":
				return () => this.hub.writer.openTask(t);
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
