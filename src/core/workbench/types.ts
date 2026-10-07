// Contracts of the Workbench, a view of Snailkit's core: one view type, with tabs that modules
// add (Home, Tasks, Brainstorm) and that companion plugins add through the Tasks API
// (addViewTab, kept as it was). A module reaches it as `ctx.workbench`; whatever it adds there
// goes away when the module stops.
// These shapes are shared by several modules: change them only together with every user.
import type { WorkspaceLeaf } from "obsidian";

/**
 * View type of the Workbench. It keeps the name of the Tasks module's former task list, so
 * that workspaces Obsidian saved with that list (page or side panel) still open.
 */
export const WORKBENCH_VIEW_TYPE = "snailkit-tasks";

/** Place of the built-in tabs (smaller first). Tabs without an order come after them, in arrival order. */
export const TAB_ORDER = { home: 10, tasks: 20, sessions: 30, other: 100 } as const;

/** "page" when the view is at least 760 px wide (main area), "side" when narrower (side panel). */
export type WorkbenchLayout = "page" | "side";

/** When the Workbench opens by itself (setting of the Home module). */
export type AutoOpenMode = "never" | "startup" | "startup-and-new-tabs";

/** What a tab keeps in the saved workspace: small, JSON only. */
export type TabState = Record<string, unknown>;

/** What a mounted tab gets from the Workbench around it. */
export interface WorkbenchTabHost {
	readonly layout: WorkbenchLayout;
	/** The Workbench's leaf (one of possibly several Workbenches). */
	readonly leaf: WorkspaceLeaf;
	/**
	 * True when this Workbench stands in a new tab (Ctrl/Cmd+T, last tab closed): opening a note
	 * from it replaces it in the same tab, like a browser's start page (not once the tab is pinned).
	 */
	readonly transient: boolean;
	/** The state saved for this tab in this leaf ({} when none): its last getState(), or what open() asked for. */
	readonly state: TabState;
	/**
	 * Opens a note at a line (0-based), or at its top with null. Reuses a tab that shows the note,
	 * else replaces the most recent note (a new tab with Ctrl/Cmd, or from the Workbench in the
	 * main area); in a transient Workbench, the note takes its place, unless its tab is pinned.
	 */
	open(path: string, line: number | null, event?: MouseEvent | KeyboardEvent): void;
	/** Asks the Workbench to redraw the tab bar (counts) and call update() of the shown tab, soon. */
	refresh(): void;
	/** The tab's state changed (scroll, selection): the workspace is saved, no history entry. */
	saveState(): void;
	/**
	 * The tab went somewhere else (a page, a scope): the state is saved and Obsidian's back and
	 * forward arrows can return to the previous one (they call setState of the tab).
	 */
	navigate(state: TabState): void;
	/** Shows another tab of this Workbench, with a state for it (for example Tasks on "today"). */
	select(tabId: string, state?: TabState): void;
}

/** A tab while it is shown. Every method is optional. */
export interface WorkbenchTabInstance {
	/** Fresh data (vault changed, refresh()): redraw, keeping focus and scroll. */
	update?(): void;
	/** The tab is hidden, the layout changed, the tab or its module went away. */
	destroy?(): void;
	/** What to keep in the workspace (and to give back as host.state on the next mount). */
	getState?(): TabState;
	/** Go to this state while shown (open() with a state, back and forward). Without it, the tab is mounted again. */
	setState?(state: TabState): void;
	/** The Workbench was revealed or this tab chosen: put the focus where typing goes. */
	focus?(): void;
	/** True while the user edits something in the tab: a layout change waits until the focus leaves it. */
	busy?(): boolean;
}

export interface WorkbenchTab {
	/** Unique id, a-z and "-". "home", "tasks" and "sessions" belong to their modules. */
	id: string;
	/** Lucide icon. */
	icon: string;
	/** Already translated. */
	label: string;
	/** Place among the tabs (see TAB_ORDER); TAB_ORDER.other when missing. */
	order?: number;
	/** Small count next to the label, or null. */
	count?(): number | null;
	/** "warn" paints the count orange. */
	countTone?(): "warn" | null;
	/** Builds the tab in `el` (empty) when it is shown. */
	mount(el: HTMLElement, host: WorkbenchTabHost): WorkbenchTabInstance | void;
}

export interface WorkbenchOpenOptions {
	/** Tab to show. Missing or not registered: the tab shown last in that Workbench, else the first. */
	tab?: string;
	/** State for that tab: given to setState() of the shown tab, or as host.state when it mounts. */
	state?: TabState;
	/** "auto" (default): the most recently active Workbench, else a new page. "page" / "side": one there, else a new one. */
	where?: "auto" | "page" | "side";
	/** Makes the Workbench the active leaf and calls focus() of the tab (default true). */
	focus?: boolean;
}

/** What a module gets as `ctx.workbench`. */
export interface ModuleWorkbench {
	/** Adds a tab to every Workbench. Removed by the returned function, or when the module stops. Invalid or taken ids: a no-op remover. */
	addTab(tab: WorkbenchTab): () => void;
	hasTab(id: string): boolean;
	/** Reveals or opens a Workbench on a tab. Resolves to the shown tab's instance (null when none could show). */
	open(options?: WorkbenchOpenOptions): Promise<WorkbenchTabInstance | null>;
	/** Redraws the tab bars and calls update() of the shown tabs, soon (many calls in a row draw once). */
	refresh(): void;
	/** Instances of a tab shown right now (one per Workbench that shows it). */
	instances(tabId: string): WorkbenchTabInstance[];
	/**
	 * Opening by itself, owned by the Home module: at app startup (first tab, pinned, never twice),
	 * and in new empty tabs with "startup-and-new-tabs". Back to "never" when the module stops.
	 */
	setAutoOpen(mode: AutoOpenMode, tabId: string): void;
}
