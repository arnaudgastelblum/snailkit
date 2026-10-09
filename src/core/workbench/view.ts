// The Workbench view: one Obsidian view for the page (main area) and the side panel, with the tabs
// that modules register (Home, Tasks, Brainstorm, and tabs of companion plugins). Each view shows
// one tab at a time: it mounts it in its body, keeps the state of the others, and gives the tab a
// host (layout, opening notes, saving its state, history). The tab bar sits in Obsidian's own view
// header, next to the back and forward arrows, or in a slim row on top where that header is hidden.
import { ItemView, Platform, setIcon, setTooltip, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type { WorkbenchCore } from "./index";
import { openNoteAt } from "./open";
import { altDigit, chooseTab, nthTab, readViewState, reshow, type WorkbenchViewState } from "./state";
import { WORKBENCH_VIEW_TYPE, ZONE_ATTR, type TabState, type WorkbenchLayout, type WorkbenchTab, type WorkbenchTabHost, type WorkbenchTabInstance } from "./types";

/** At this width and more, the Workbench is a page; narrower, a side panel. */
export const PAGE_MIN_WIDTH = 760;
/** Ids of the hidden names of tab bars (one per view). */
let tabsNameId = 0;

function safe<T>(run: () => T, fallback: T, what: string): T {
	try {
		return run();
	} catch (error) {
		console.error(`[Snailkit] workbench: ${what} failed`, error);
		return fallback;
	}
}

export class WorkbenchView extends ItemView {
	/** The tab shown, or null (no tab registered, or not mounted yet). */
	private shown: string | null = null;
	/** The tab asked for (saved state, a click, open()): shown as soon as it is registered. */
	private wanted: string | null = null;
	/** The last state of each tab of this view (what getState() saves). */
	private tabStates: Record<string, TabState> = {};
	private transientFlag = false;
	private mountedTab: WorkbenchTab | null = null;
	private instance: WorkbenchTabInstance | null = null;
	/** Bumped at each mount: a host of an older mount does nothing. */
	private mountId = 0;
	private layout: WorkbenchLayout | null = null;
	private pendingLayout = false;
	private closed = false;
	private opened = false;
	private initTimer = 0;
	private observer: ResizeObserver | null = null;
	private bodyEl: HTMLElement | null = null;
	private tabsHeader: HTMLElement | null = null;
	private ownedHeader: HTMLElement | null = null;
	private tabsEl: HTMLElement | null = null;
	private tabsThumb: HTMLElement | null = null;
	private tabsHint: HTMLElement | null = null;
	private hintTimer = 0;
	/** The "?" help, while shown. */
	private helpEl: HTMLElement | null = null;
	/** A navigation on its way through leaf.setViewState (see navigateTo). */
	private nav: { state: WorkbenchViewState; self: boolean } | null = null;
	private title = "";

	constructor(
		leaf: WorkspaceLeaf,
		private readonly core: WorkbenchCore,
	) {
		super(leaf);
	}

	getViewType(): string {
		return WORKBENCH_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.core.t("workbench.title");
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	get transient(): boolean {
		return this.transientFlag;
	}

	/** The tab shown now. */
	get activeTab(): string | null {
		return this.shown;
	}

	/** The instance of the tab shown now. */
	get current(): WorkbenchTabInstance | null {
		return this.instance;
	}

	// ----- state and history -----

	getState(): Record<string, unknown> {
		const tabs = { ...this.tabStates };
		// While a navigation is on its way, Obsidian records the state left behind: the saved one.
		if (!this.nav && this.shown && this.instance?.getState) {
			const live = safe(() => this.instance!.getState!(), null, "getState");
			if (live && typeof live === "object") tabs[this.shown] = live;
		}
		const state: WorkbenchViewState = { activeTab: this.wanted ?? this.shown ?? "", tabs };
		if (this.transientFlag) state.transient = true;
		return { ...super.getState(), ...state };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const nav = this.nav && this.nav.state === state ? this.nav : null;
		if (nav) {
			this.nav = null;
			result.history = true;
		}
		this.apply(state, nav?.self ?? false);
		await super.setState(state, result);
	}

	/** Obsidian gives the focus to the leaf (setActiveLeaf with focus): the tab puts it where typing goes. */
	setEphemeralState(state: unknown): void {
		super.setEphemeralState(state);
		if (state && typeof state === "object" && (state as { focus?: unknown }).focus === true) this.focusTab();
	}

	private apply(raw: unknown, self: boolean): void {
		const read = readViewState(raw);
		if (read.transient !== null) this.setTransientFlag(read.transient);
		this.tabStates = { ...this.tabStates, ...read.tabs };
		if (read.activeTab) this.wanted = read.activeTab;
		if (!this.opened || this.closed) return;
		if (!this.layout) {
			this.checkLayout(true);
			return;
		}
		const target = chooseTab(this.wanted, this.shown, this.core.ids());
		if (target && target === this.shown && this.instance) {
			if (self) return;
			const step = reshow(read.tabs[target], !!this.instance.setState);
			if (step.action === "set") safe(() => this.instance!.setState!(step.state!), undefined, "setState");
			else if (step.action === "remount") {
				this.tabStates[target] = step.state!;
				this.build(false);
				return;
			}
			this.renderTabs();
			return;
		}
		this.build();
	}

	/** Shows a tab (with a state for it), as a step Obsidian's back and forward arrows can return to. */
	async select(id: string, state?: TabState): Promise<void> {
		if (this.closed || !this.core.get(id)) return;
		if (id === this.shown && !state) {
			// Chosen again while another tab waits for its module: this one stays.
			this.wanted = id;
			return;
		}
		this.dismissHint();
		this.commitLive();
		const tabs = { ...this.tabStates };
		if (state) tabs[id] = { ...state };
		await this.navigateTo({ activeTab: id, tabs, ...(this.transientFlag ? { transient: true } : {}) }, false);
	}

	/** The shown tab went to another state by itself: saved, with a history entry. */
	private async navigateFrom(id: string, state: TabState): Promise<void> {
		if (this.closed || id !== this.shown) return;
		const tabs = { ...this.tabStates, [id]: { ...state } };
		await this.navigateTo({ activeTab: id, tabs, ...(this.transientFlag ? { transient: true } : {}) }, true);
	}

	/**
	 * Goes through leaf.setViewState so that Obsidian records the state left behind in the leaf's
	 * history (its back and forward arrows, Ctrl/Cmd+Alt+arrows). Obsidian only records it for a
	 * view meant for navigation: the view says so while the step is on its way.
	 */
	private async navigateTo(state: WorkbenchViewState, self: boolean): Promise<void> {
		const entry = { state, self };
		this.nav = entry;
		this.navigation = true;
		try {
			await this.leaf.setViewState({ type: WORKBENCH_VIEW_TYPE, state: state as unknown as Record<string, unknown> });
		} catch (error) {
			console.error("[Snailkit] workbench: could not record the step", error);
		} finally {
			this.navigation = this.transientFlag;
		}
		// The leaf was busy (Obsidian ignores the call then): apply the step without history.
		if (this.nav === entry) {
			this.nav = null;
			this.apply(state, self);
		}
		this.app.workspace.requestSaveLayout();
	}

	/** The live state of the shown tab goes into the saved states. */
	private commitLive(): void {
		if (!this.shown || !this.instance?.getState) return;
		const live = safe(() => this.instance!.getState!(), null, "getState");
		if (live && typeof live === "object") this.tabStates[this.shown] = live;
	}

	/** No longer a new tab's Workbench (the startup Workbench reuses one). */
	setTransient(transient: boolean): void {
		if (this.transientFlag === transient) return;
		this.setTransientFlag(transient);
		this.app.workspace.requestSaveLayout();
	}

	/**
	 * A Workbench standing in a new tab is meant for navigation, like a browser's start page: a note
	 * Obsidian opens "here" (file explorer, quick switcher, a link) takes its place, and the back
	 * arrow returns to it. Any other Workbench stays where it is.
	 */
	private setTransientFlag(transient: boolean): void {
		this.transientFlag = transient;
		this.navigation = transient;
	}

	// ----- life cycle -----

	async onOpen(): Promise<void> {
		this.closed = false;
		this.opened = true;
		this.contentEl.addClass("sk-wb-view");
		this.contentEl.tabIndex = -1;
		this.bodyEl = this.contentEl.createDiv({ cls: "sk-wb-body" });
		this.observer = new ResizeObserver(() => this.checkLayout(false));
		this.observer.observe(this.contentEl);
		// Captured: a field of a tab that keeps its keys to itself (Tasks' quick add) still lets Alt+1 ... Alt+9 through.
		this.registerDomEvent(this.containerEl, "keydown", (event) => this.onKey(event), { capture: true });
		// Not captured: the tab handles its keys first (its lists), the zones get what it leaves.
		this.registerDomEvent(this.contentEl, "keydown", (event) => this.onZoneKey(event));
		this.registerDomEvent(this.contentEl, "mousedown", (event) => {
			if (this.helpEl && !this.helpEl.contains(event.target as Node)) this.closeHelp();
		});
		// A layout change waits while the tab is busy (typing); it happens when the focus leaves the
		// field: out of the view, or to another place in it (a field removed while focused sends no focusout).
		const pending = () => {
			window.setTimeout(() => {
				if (this.closed || !this.pendingLayout || this.isBusy()) return;
				this.pendingLayout = false;
				this.checkLayout(false);
			}, 0);
		};
		this.registerDomEvent(this.contentEl, "focusout", pending);
		this.registerDomEvent(this.contentEl, "focusin", pending);
		this.register(() => {
			this.closed = true;
			this.dismissHint();
			this.clearHeaderClasses();
		});
		this.core.attach(this);
		// setState usually follows at once (saved or requested state): the first build waits for it.
		this.initTimer = window.setTimeout(() => {
			if (!this.closed && !this.layout) this.checkLayout(true);
		}, 0);
	}

	async onClose(): Promise<void> {
		this.commitLive();
		this.closed = true;
		this.clearHeaderClasses();
		window.clearTimeout(this.initTimer);
		this.core.detach(this);
		this.dismissHint();
		this.unmount();
		this.observer?.disconnect();
		this.observer = null;
		this.contentEl.empty();
		this.tabsHeader?.remove();
		this.tabsHeader = this.tabsEl = this.tabsThumb = this.bodyEl = null;
	}

	/** Reads the width now (after a reveal) and builds again when the layout changed. */
	syncLayout(): void {
		if (!this.closed && this.opened) this.checkLayout(!this.layout);
	}

	private checkLayout(force: boolean): void {
		if (this.closed) return;
		const width = this.contentEl.clientWidth;
		if (!width && !force) return;
		const layout: WorkbenchLayout = width >= PAGE_MIN_WIDTH ? "page" : "side";
		if (layout !== this.layout && !force && this.layout && this.isBusy()) {
			this.pendingLayout = true;
			return;
		}
		if (layout !== this.layout || force) {
			this.layout = layout;
			// The keyboard stays in the view when it was there (the focused element goes with the old mount).
			const active = this.containerEl.doc.activeElement;
			const had = !!active && this.contentEl.contains(active);
			this.build();
			if (had) this.focusTab();
		} else {
			// Shown again (a background tab brought forward): its header can be told apart now.
			this.placeTabs();
			this.renderTabs();
		}
	}

	private isBusy(): boolean {
		return !!this.instance?.busy && safe(() => !!this.instance!.busy!(), false, "busy");
	}

	/**
	 * The plugin unloads or the tab's module stops: the tab goes away at once, the rest follows soon.
	 * `commit`: its live state is saved first (not when a state was just asked for it).
	 */
	unmount(commit = true): void {
		const instance = this.instance;
		if (instance && commit) this.commitLive();
		this.instance = null;
		this.mountedTab = null;
		this.mountId++;
		if (instance?.destroy) safe(() => instance.destroy!(), undefined, "destroy");
		this.bodyEl?.empty();
	}

	/** Fresh data (core.refresh): the tab bar, then the shown tab (or another one when tabs came or went). */
	refresh(): void {
		if (this.closed || !this.opened || !this.layout) return;
		// The language may have changed (the modules restarted): the title in Obsidian's header follows.
		const title = this.getDisplayText();
		if (title !== this.title) {
			this.title = title;
			(this.leaf as unknown as { updateHeader?(): void }).updateHeader?.();
		}
		const target = chooseTab(this.wanted, this.shown, this.core.ids());
		const tab = target ? this.core.get(target) ?? null : null;
		if (target !== this.shown || tab !== this.mountedTab || !this.instance && tab) {
			this.build();
			return;
		}
		this.renderTabs();
		if (this.instance?.update) safe(() => this.instance!.update!(), undefined, "update");
	}

	/** Mounts the tab to show (again). `commit`: see unmount(). */
	private build(commit = true): void {
		if (this.closed || !this.bodyEl) return;
		this.unmount(commit);
		this.pendingLayout = false;
		const layout = this.layout ?? "side";
		this.contentEl.toggleClass("is-page", layout === "page");
		this.contentEl.toggleClass("is-side", layout === "side");
		if (!this.tabsHeader) {
			this.tabsHeader = createDiv({ cls: "sk-wb-tabs-header" });
			// Named by hidden text: an aria-label would show as Obsidian's tooltip over every tab.
			const name = this.tabsHeader.createSpan({ cls: "sk-wb-sr", text: this.core.t("workbench.title") });
			name.id = `sk-wb-tabs-name-${++tabsNameId}`;
			this.tabsEl = this.tabsHeader.createDiv({ cls: "sk-wb-tabs", attr: { role: "tablist", "aria-labelledby": name.id } });
		}
		const target = chooseTab(this.wanted, this.shown, this.core.ids());
		if (target !== this.shown && this.shown) this.dismissHint();
		this.shown = target;
		this.placeTabs();
		this.renderTabs();
		const tab = target ? this.core.get(target) ?? null : null;
		if (!tab) {
			this.empty();
			return;
		}
		const el = this.bodyEl.createDiv({ cls: "sk-wb-tab", attr: { "data-tab": tab.id, role: "tabpanel" } });
		const mountId = ++this.mountId;
		const live = () => mountId === this.mountId && !this.closed;
		const id = tab.id;
		const isTransient = () => this.transientFlag;
		const host: WorkbenchTabHost = {
			layout,
			leaf: this.leaf,
			get transient() {
				return isTransient();
			},
			state: { ...(this.tabStates[id] ?? {}) },
			open: (path, line, event) => {
				if (!live()) return;
				openNoteAt(this.app, path, line, { event, replace: this.transientFlag ? this.leaf : null }).catch((error) => console.error("[Snailkit] workbench: could not open the note", error));
			},
			refresh: () => {
				if (live()) this.core.refresh();
			},
			saveState: () => {
				if (!live()) return;
				this.commitLive();
				this.app.workspace.requestSaveLayout();
			},
			navigate: (state) => {
				if (live() && state && typeof state === "object") void this.navigateFrom(id, state);
			},
			select: (tabId, state) => {
				if (live()) void this.select(tabId, state);
			},
		};
		this.mountedTab = tab;
		let instance: WorkbenchTabInstance | void = undefined;
		try {
			instance = tab.mount(el, host);
		} catch (error) {
			console.error(`[Snailkit] workbench: the tab "${id}" could not open`, error);
		}
		if (mountId === this.mountId) this.instance = instance || {};
	}

	/** No tab at all: a sentence and the way to the settings. */
	private empty(): void {
		const box = this.bodyEl!.createDiv({ cls: "sk-wb-empty" });
		setIcon(box.createDiv({ cls: "sk-wb-empty-icon" }), "layout-dashboard");
		box.createDiv({ cls: "sk-wb-empty-title", text: this.core.t("workbench.empty.title") });
		box.createDiv({ cls: "sk-wb-empty-text", text: this.core.t("workbench.empty.text") });
		const button = box.createEl("button", { cls: "sk-btn is-primary", text: this.core.t("workbench.empty.action"), attr: { type: "button" } });
		button.addEventListener("click", () => this.core.openSettings());
	}

	/**
	 * The shown tab takes the focus (where typing goes). A tab that does not say where keeps the
	 * focus in the view, so that the keyboard (Alt+1 ... Alt+9) still reaches it. Not on phones:
	 * the keyboard would pop up over the page.
	 */
	focusTab(): void {
		if (this.closed) return;
		if (this.instance?.focus && !Platform.isMobile) safe(() => this.instance!.focus!(), undefined, "focus");
		const active = this.containerEl.doc.activeElement;
		if (!active || !this.containerEl.contains(active)) this.contentEl.focus({ preventScroll: true });
	}

	// ----- tab bar -----

	/**
	 * The tabs live in Obsidian's own view header, next to the back and forward arrows, so they take
	 * no room in the view. Where that header is hidden (side panels, some themes), they sit in a
	 * slim row on top of the view instead. Checked again at each build: the view can move.
	 */
	private placeTabs(): void {
		const tabs = this.tabsHeader;
		if (!tabs) return;
		const header = this.containerEl.querySelector<HTMLElement>(":scope > .view-header");
		// A view that is not drawn (a background tab) cannot tell a hidden header from a missing one:
		// the tabs go to the header for now, and are placed again once the view shows.
		const drawn = this.containerEl.getClientRects().length > 0;
		if (!drawn && tabs.parentElement) return;
		const shown = !!header && (!drawn || header.getBoundingClientRect().height > 0);
		tabs.toggleClass("is-in-header", shown);
		if (shown && header) {
			const left = header.querySelector<HTMLElement>(":scope > .view-header-left");
			if (left) {
				if (left.nextElementSibling !== tabs) left.insertAdjacentElement("afterend", tabs);
			} else if (header.firstElementChild !== tabs) header.prepend(tabs);
		} else if (this.contentEl.firstElementChild !== tabs) this.contentEl.prepend(tabs);
		this.syncHeaderClasses();
	}

	private clearHeaderClasses(): void {
		this.ownedHeader?.removeClass("sk-wb-has-tabs", "sk-wb-has-hint");
		this.ownedHeader = null;
	}

	private syncHeaderClasses(): void {
		const parent = this.tabsHeader?.parentElement;
		const header = !this.closed && parent?.hasClass("view-header") ? parent : null;
		if (this.ownedHeader !== header) this.clearHeaderClasses();
		this.ownedHeader = header;
		header?.toggleClass("sk-wb-has-tabs", !!this.tabsHeader?.hasClass("is-in-header") && !this.tabsHeader.hidden);
		header?.toggleClass("sk-wb-has-hint", !!this.tabsHint && header.contains(this.tabsHint));
	}

	private renderTabs(): void {
		const bar = this.tabsEl;
		const header = this.tabsHeader;
		if (!bar || !header || this.closed) return;
		const tabs = this.core.list();
		header.hidden = tabs.length <= 1;
		this.syncHeaderClasses();
		if (header.hidden) {
			this.dismissHint();
			return;
		}
		const ids = tabs.map((tab) => tab.id).join(" ");
		if (bar.dataset.tabs !== ids) {
			const hadFocus = bar.contains(bar.doc.activeElement);
			bar.empty();
			bar.dataset.tabs = ids;
			this.tabsThumb = bar.createDiv({ cls: "sk-wb-tabs-line", attr: { "aria-hidden": "true" } });
			for (const tab of tabs) {
				const button = bar.createEl("button", { cls: "sk-btn is-ghost is-s sk-wb-tab-button", attr: { type: "button", role: "tab" } });
				button.dataset.tab = tab.id;
				setIcon(button.createSpan({ cls: "sk-wb-tab-icon" }), tab.icon);
				button.createSpan({ cls: "sk-wb-tab-label" });
				button.createSpan({ cls: "sk-wb-tab-count" });
				button.addEventListener("click", () => {
					void this.select(tab.id);
					button.focus();
				});
				button.addEventListener("keydown", (event) => {
					if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
					event.preventDefault();
					event.stopPropagation();
					const list = this.core.ids();
					const offset = event.key === "ArrowRight" ? 1 : -1;
					const next = list[(list.indexOf(tab.id) + offset + list.length) % list.length];
					void this.select(next);
					bar.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
				});
			}
			if (hadFocus) bar.querySelector<HTMLButtonElement>(`[data-tab="${this.shown}"]`)?.focus();
		}
		tabs.forEach((tab, i) => {
			const button = bar.querySelector<HTMLButtonElement>(`[data-tab="${tab.id}"]`);
			if (!button) return;
			if (i < 9) setTooltip(button, `${tab.label} · Alt+${i + 1}`);
			button.setAttr("aria-selected", String(tab.id === this.shown));
			button.tabIndex = tab.id === this.shown ? 0 : -1;
			button.querySelector<HTMLElement>(".sk-wb-tab-label")!.setText(tab.label);
			const countEl = button.querySelector<HTMLElement>(".sk-wb-tab-count")!;
			const count = tab.count ? safe(() => tab.count!(), null, "count") : null;
			countEl.hidden = count == null;
			countEl.setText(count == null ? "" : String(count));
			countEl.toggleClass("is-warn", (tab.countTone ? safe(() => tab.countTone!(), null, "countTone") : null) === "warn");
		});
		const active = this.shown ? bar.querySelector<HTMLButtonElement>(`[data-tab="${this.shown}"]`) : null;
		if (active && this.tabsThumb) {
			this.tabsThumb.style.width = `${active.offsetWidth}px`;
			this.tabsThumb.style.transform = `translateX(${active.offsetLeft}px)`;
		}
		if (!this.core.hintSeen() && this.contentEl.clientWidth > 0) {
			this.core.markHintSeen();
			this.tabsHint = header.createEl("button", { cls: "sk-btn is-s sk-wb-tabs-hint", text: this.core.t("workbench.tabs-hint"), attr: { type: "button" } });
			this.syncHeaderClasses();
			this.tabsHint.addEventListener("click", () => this.dismissHint());
			this.hintTimer = window.setTimeout(() => this.dismissHint(), 8000);
		}
	}

	private dismissHint(): void {
		window.clearTimeout(this.hintTimer);
		this.hintTimer = 0;
		this.tabsHint?.remove();
		this.tabsHint = null;
		this.syncHeaderClasses();
	}

	/**
	 * Alt+1 ... Alt+9: the n-th tab; Alt+Left / Alt+Right: the previous / next tab. From anywhere in
	 * the view, fields included (except Alt+digits on macOS, where Option types).
	 */
	private onKey(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		const typing = !!target && (target.matches?.("input, textarea") || target.isContentEditable);
		if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
			const ids = this.core.ids();
			if (ids.length < 2 || !this.shown) return;
			event.preventDefault();
			event.stopPropagation();
			const next = ids[(ids.indexOf(this.shown) + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length];
			void this.select(next).then(() => {
				if (this.shown === next) this.focusTab();
			});
			return;
		}
		const digit = altDigit(event, { mac: Platform.isMacOS, typing });
		if (digit === null) return;
		const id = nthTab(this.core.ids(), digit);
		if (!id) return;
		event.preventDefault();
		event.stopPropagation();
		void this.select(id).then(() => {
			if (this.shown === id) this.focusTab();
		});
	}

	// ----- keyboard zones (see ZONE_ATTR in types.ts) -----

	/** The zones of the shown tab, in reading order, visible ones only. */
	private zones(): HTMLElement[] {
		const panel = this.bodyEl?.querySelector<HTMLElement>(`.sk-wb-tab[data-tab="${this.shown ?? ""}"]`);
		if (!panel) return [];
		return Array.from(panel.querySelectorAll<HTMLElement>(`[${ZONE_ATTR}]`)).filter((zone) => zone.getClientRects().length > 0);
	}

	/** Tab between zones, arrows between the items of a zone, "?" for the help. */
	private onZoneKey(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
		const target = event.target as HTMLElement;
		const field = target.matches("input, textarea, select") || target.isContentEditable;
		if (this.helpEl && (event.key === "Escape" || event.key === "?")) {
			event.preventDefault();
			this.closeHelp();
			return;
		}
		if (event.key === "?" && !field) {
			event.preventDefault();
			this.showHelp();
			return;
		}
		if (event.key === "Tab") {
			if (target.matches("textarea") || target.isContentEditable || target.closest("[data-sk-own-tab]")) return;
			const zones = this.zones();
			if (!zones.length) return;
			const at = zones.findIndex((zone) => zone.contains(target));
			const step = event.shiftKey ? -1 : 1;
			const next = at < 0 ? (step > 0 ? 0 : zones.length - 1) : (at + step + zones.length) % zones.length;
			event.preventDefault();
			this.focusZone(zones[next]);
			return;
		}
		const vertical = event.key === "ArrowDown" || event.key === "ArrowUp";
		const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
		if ((!vertical && !horizontal) || field) return;
		const zone = target.closest<HTMLElement>(`[${ZONE_ATTR}]`);
		if (!zone || (horizontal && !zone.hasAttribute("data-sk-zone-grid"))) return;
		const items = Array.from(zone.querySelectorAll<HTMLElement>("[data-sk-item]")).filter((item) => item.getClientRects().length > 0);
		if (!items.length) return;
		const at = items.findIndex((item) => item === target || item.contains(target));
		const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
		const next = at < 0 ? items[0] : items[Math.min(items.length - 1, Math.max(0, at + (forward ? 1 : -1)))];
		event.preventDefault();
		next.focus();
		next.scrollIntoView({ block: "nearest" });
	}

	/** Its chosen element, else its first item, else its first focusable one, else the zone itself; a short glow shows where. */
	private focusZone(zone: HTMLElement): void {
		const focusable = 'input:not([disabled]), button:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"]), [data-sk-item]';
		const el = zone.querySelector<HTMLElement>("[data-sk-zone-focus]") ?? zone.querySelector<HTMLElement>("[data-sk-item]") ?? zone.querySelector<HTMLElement>(focusable) ?? zone;
		if (el === zone && !zone.hasAttribute("tabindex")) zone.tabIndex = -1;
		el.focus();
		el.scrollIntoView({ block: "nearest" });
		zone.removeClass("is-zone-flash");
		void zone.offsetWidth;
		zone.addClass("is-zone-flash");
		window.setTimeout(() => zone.removeClass("is-zone-flash"), 700);
	}

	/** The keys of the Workbench, then those of the shown tab. */
	private showHelp(): void {
		this.closeHelp();
		const t = (key: string) => this.core.t(key);
		const help = this.contentEl.createDiv({ cls: "sk-wb-help", attr: { role: "dialog", tabindex: "-1" } });
		const title = help.createDiv({ cls: "sk-wb-help-title", text: t("workbench.help.title") });
		title.id = `sk-wb-help-${Date.now()}`;
		help.setAttr("aria-labelledby", title.id);
		const section = (name: string, rows: Array<[string, string]>) => {
			if (!rows.length) return;
			help.createDiv({ cls: "sk-wb-help-sec", text: name });
			const list = help.createDiv({ cls: "sk-wb-help-list" });
			for (const [keys, label] of rows) {
				const row = list.createDiv({ cls: "sk-wb-help-row" });
				const cell = row.createDiv({ cls: "sk-wb-help-keys" });
				for (const part of keys.split(" ")) cell.createEl("kbd", { text: part });
				row.createDiv({ cls: "sk-wb-help-label", text: label });
			}
		};
		section(t("workbench.title"), [
			["Alt+1 Alt+2 Alt+3", t("workbench.help.tabs")],
			["Alt+← Alt+→", t("workbench.help.cycle")],
			["Tab Shift+Tab", t("workbench.help.zones")],
			["↑ ↓", t("workbench.help.items")],
			["Enter", t("workbench.help.open")],
			["?", t("workbench.help.help")],
		]);
		const tab = this.shown ? this.core.get(this.shown) : undefined;
		let own: Array<[string, string]> = [];
		try {
			own = this.current?.keys?.() ?? [];
		} catch (error) {
			console.error("[Snailkit] workbench: keys() failed", error);
		}
		if (tab) section(tab.label, own);
		help.createDiv({ cls: "sk-wb-help-foot", text: t("workbench.help.anywhere") });
		this.helpEl = help;
		help.focus();
	}

	private closeHelp(): void {
		if (!this.helpEl) return;
		this.helpEl.remove();
		this.helpEl = null;
		this.focusTab();
	}
}
