// The Workbench of the core: the tabs modules registered, the open Workbench views, and the entry
// points modules share (open, refresh, automatic opening). The view itself is in view.ts.
import type { App, WorkspaceLeaf } from "obsidian";
import type SnailkitPlugin from "../../main";
import { HINT_WORKBENCH_TABS } from "../settings";
import { AutoOpener } from "./auto-open";
import { BUILT_IN_TABS, isSideLeaf, sortTabs, TAB_ID_RE } from "./state";
import { WORKBENCH_VIEW_TYPE, type AutoOpenMode, type ModuleWorkbench, type TabState, type WorkbenchOpenOptions, type WorkbenchTab, type WorkbenchTabInstance } from "./types";
import { WorkbenchView } from "./view";

export { WORKBENCH_VIEW_TYPE, TAB_ORDER } from "./types";
export { BUILT_IN_TABS, isSideLeaf } from "./state";

/** Many refresh() calls in a row draw once, this soon. */
const REFRESH_MS = 50;

/** The shown tabs are drawn again this often, so that relative times ("5 min ago") and "today" follow the clock. */
export const TICK_MS = 60_000;

/** One per plugin: the registered tabs, in their display order, and the open Workbenches. */
export class WorkbenchCore {
	private readonly tabs = new Map<string, { tab: WorkbenchTab; seq: number }>();
	private seq = 0;
	private autoOpen: AutoOpenMode = "never";
	private readonly views = new Set<WorkbenchView>();
	private plugin: SnailkitPlugin | null = null;
	private refreshTimer = 0;
	private lastActive: WorkspaceLeaf | null = null;
	private opener: AutoOpener | null = null;
	private disposed = false;

	/** Registers the view and follows the workspace. `startup`: Obsidian is starting (not a plugin update or a reactivation). */
	start(plugin: SnailkitPlugin, startup: boolean): void {
		this.plugin = plugin;
		this.disposed = false;
		plugin.registerView(WORKBENCH_VIEW_TYPE, (leaf) => new WorkbenchView(leaf, this));
		const workspace = plugin.app.workspace;
		plugin.registerEvent(workspace.on("active-leaf-change", (leaf) => {
			if (leaf?.view.getViewType() === WORKBENCH_VIEW_TYPE) this.lastActive = leaf;
		}));
		this.opener = new AutoOpener(plugin, this, startup);
		// For every tab, whichever modules run (it used to come with the Tasks module only).
		plugin.registerInterval(window.setInterval(() => {
			if (this.views.size) this.refresh();
		}, TICK_MS));
	}

	get app(): App {
		return this.plugin!.app;
	}

	// ----- registry -----

	/** Registered tabs, sorted by order, then by arrival. */
	list(): WorkbenchTab[] {
		return sortTabs([...this.tabs.values()]);
	}

	ids(): string[] {
		return this.list().map((tab) => tab.id);
	}

	get(id: string): WorkbenchTab | undefined {
		return this.tabs.get(id)?.tab;
	}

	addTab(tab: WorkbenchTab): () => void {
		if (this.disposed || !tab || typeof tab.id !== "string" || !TAB_ID_RE.test(tab.id) || this.tabs.has(tab.id) || typeof tab.mount !== "function") return () => undefined;
		const id = tab.id;
		this.tabs.set(id, { tab, seq: this.seq++ });
		this.refresh();
		let removed = false;
		return () => {
			if (removed) return;
			removed = true;
			if (this.tabs.get(id)?.tab !== tab) return;
			this.tabs.delete(id);
			// The tab's module may be stopping: its instances go at once, the views redraw soon.
			for (const view of this.views) if (view.activeTab === id) view.unmount();
			this.refresh();
		};
	}

	/** A tab of a companion plugin (Tasks API addViewTab): never one of Snailkit's own ids. */
	addCompanionTab(tab: WorkbenchTab): () => void {
		if (!tab || BUILT_IN_TABS.includes(tab.id)) return () => undefined;
		return this.addTab(tab);
	}

	// ----- views -----

	/** @internal A view opened. */
	attach(view: WorkbenchView): void {
		this.views.add(view);
	}

	/** @internal A view closed. */
	detach(view: WorkbenchView): void {
		this.views.delete(view);
		if (this.lastActive === view.leaf) this.lastActive = null;
	}

	/** Redraws the tab bars and calls update() of the shown tabs, soon. */
	refresh(): void {
		if (this.disposed) return;
		window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			for (const view of [...this.views]) {
				try {
					view.refresh();
				} catch (error) {
					console.error("[Snailkit] workbench: refresh failed", error);
				}
			}
		}, REFRESH_MS);
	}

	instances(tabId: string): WorkbenchTabInstance[] {
		const out: WorkbenchTabInstance[] = [];
		for (const view of this.views) if (view.activeTab === tabId && view.current) out.push(view.current);
		return out;
	}

	/** Workbench leaves, main area first. */
	leaves(): WorkspaceLeaf[] {
		if (!this.plugin) return [];
		const all = this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE);
		return [...all.filter((leaf) => !isSideLeaf(this.app, leaf)), ...all.filter((leaf) => isSideLeaf(this.app, leaf))];
	}

	private find(where: "auto" | "page" | "side"): WorkspaceLeaf | null {
		const all = this.leaves();
		const fits = (leaf: WorkspaceLeaf) => where === "auto" || isSideLeaf(this.app, leaf) === (where === "side");
		if (this.lastActive && all.includes(this.lastActive) && fits(this.lastActive)) return this.lastActive;
		return all.find(fits) ?? null;
	}

	/** The view of a Workbench leaf (loaded when it was deferred), or null. */
	async viewOf(leaf: WorkspaceLeaf): Promise<WorkbenchView | null> {
		await (leaf as unknown as { loadIfDeferred?(): Promise<void> }).loadIfDeferred?.();
		return leaf.view instanceof WorkbenchView ? leaf.view : null;
	}

	async open(options: WorkbenchOpenOptions = {}): Promise<WorkbenchTabInstance | null> {
		if (this.disposed || !this.plugin) return null;
		const workspace = this.app.workspace;
		const where = options.where ?? "auto";
		const focus = options.focus !== false;
		const tab = options.tab && this.get(options.tab) ? options.tab : undefined;
		let leaf = this.find(where);
		if (leaf) {
			const view = await this.viewOf(leaf);
			if (!view) return null;
			if (tab) await view.select(tab, options.state);
			else if (options.state && view.activeTab) await view.select(view.activeTab, options.state);
		} else {
			leaf = where === "side" ? workspace.getRightLeaf(false) : workspace.getLeaf("tab");
			if (!leaf) return null;
			const tabs: Record<string, TabState> = tab && options.state ? { [tab]: { ...options.state } } : {};
			await leaf.setViewState({ type: WORKBENCH_VIEW_TYPE, active: focus, state: { activeTab: tab ?? options.tab ?? "", tabs } });
		}
		if (this.disposed) return null;
		await workspace.revealLeaf(leaf);
		const view = await this.viewOf(leaf);
		if (!view) return null;
		view.syncLayout();
		if (focus) {
			workspace.setActiveLeaf(leaf, { focus: true });
			view.focusTab();
		}
		return view.current;
	}

	// ----- automatic opening -----

	/** The Workbench's own setting (data.workbench.autoOpen), set by the plugin when it loads or changes. */
	setAutoOpen(mode: AutoOpenMode): void {
		this.autoOpen = mode;
	}

	/** The setting, or "never" while no tool has a tab: an empty Workbench never opens by itself. */
	get autoOpenMode(): AutoOpenMode {
		return this.tabs.size ? this.autoOpen : "never";
	}

	/** Home when it is on, else the first tab. */
	get autoOpenTab(): string {
		return this.tabs.has("home") ? "home" : (this.ids()[0] ?? "home");
	}

	/** The modules started and the workspace is ready: the startup Workbench, when asked for. */
	ready(): void {
		this.opener?.ready();
	}

	// ----- for the view -----

	t(key: string): string {
		return this.plugin ? this.plugin.t(key) : key;
	}

	/** Snailkit's settings, on the Workbench's page. */
	openSettings(): void {
		this.plugin?.openSettings("workbench");
	}

	hintSeen(): boolean {
		return !this.plugin || this.plugin.data.hints.includes(HINT_WORKBENCH_TABS);
	}

	markHintSeen(): void {
		const plugin = this.plugin;
		if (!plugin || plugin.data.hints.includes(HINT_WORKBENCH_TABS)) return;
		plugin.data.hints.push(HINT_WORKBENCH_TABS);
		plugin.saveData(plugin.data).catch((error) => console.error("[Snailkit] workbench: could not save", error));
	}

	/** The plugin unloads. */
	dispose(): void {
		this.disposed = true;
		window.clearTimeout(this.refreshTimer);
		this.opener?.dispose();
		this.opener = null;
		for (const view of this.views) view.unmount();
		this.tabs.clear();
		this.lastActive = null;
	}
}

/**
 * The module's view of the Workbench: what it adds is removed by `register` when it stops. The
 * tabs still registered are kept in a set that one cleanup empties: a tab removed by hand leaves
 * nothing behind (a companion plugin may add and remove tabs many times while Tasks runs).
 */
export function moduleWorkbench(core: WorkbenchCore, register: (cleanup: () => unknown) => void): ModuleWorkbench {
	const added = new Set<() => void>();
	let ownsTabs = false;
	let stopped = false;
	return {
		addTab: (tab) => {
			if (stopped) return () => undefined;
			const remove = core.addTab(tab);
			// Refused (bad or taken id, plugin unloaded): nothing to clean up.
			if (!tab || core.get(tab.id) !== tab) return remove;
			const once = () => {
				if (!added.delete(once)) return;
				remove();
			};
			added.add(once);
			if (!ownsTabs) {
				ownsTabs = true;
				register(() => {
					stopped = true;
					for (const each of [...added]) each();
				});
			}
			return once;
		},
		hasTab: (id) => !!core.get(id),
		open: (options) => core.open(options),
		refresh: () => core.refresh(),
		instances: (tabId) => core.instances(tabId),
	};
}
