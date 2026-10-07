// Contract of the Map: a mind map of the vault, growing from left to right (a tree on phones and
// narrow views). It knows nothing of Obsidian files: the caller (the Home tab) gives it nodes
// through a MapSource and receives what the user does through MapEvents. Plain DOM, no
// Obsidian helpers (icons come through options.icon), so that it runs in popout windows and in
// a test page. Behavior: DEV-PLAN.md, lot "map".
// These shapes are shared by two lots: change them only together with every user.

export type MapNodeKind = "root" | "domain" | "sub" | "note" | "brainstorm" | "drawing";

export interface MapNode {
	/** Stable id, the note's vault path. */
	id: string;
	/** What the node shows (a dated note shows its title without the date). */
	label: string;
	/** Full title for the tooltip and screen readers, when it differs from the label. */
	title?: string;
	/** Head of the node: root (home icon), domain (colored initial), sub (tree icon), note (dot), brainstorm (bolt), drawing (square). */
	kind: MapNodeKind;
	/** Hue of the node's domain (0-359), null for neutral gray. */
	hue: number | null;
	hasChildren: boolean;
	/** First column under the home page only: the group label shown above the first node of each group. */
	group?: string | null;
}

/** Where the Map reads its nodes. Called often: keep it cheap (the caller caches). */
export interface MapSource {
	/** The node, or null when it is gone. */
	node(id: string): MapNode | null;
	/** Children in display order (the Map shows 8 at most, then "N more"). */
	children(id: string): MapNode[];
	/** The parent's id, null on the vault's root (for going up and the breadcrumbs). */
	parent(id: string): string | null;
}

/** Texts of the Map, already translated (the caller's strings). */
export interface MapStrings {
	/** "2 more". */
	more(count: number): string;
	/** Screen readers: "2 more, open the page of {name}". */
	moreLabel(count: number, parentLabel: string): string;
	/** "Recenter here". */
	recenter: string;
	/** Tooltip of the recenter button: "Recenter here · double-click". */
	recenterTip: string;
	/** Screen readers: name of the tree ("Map of your notes"). */
	tree: string;
	/** Screen readers: name of the breadcrumbs. */
	breadcrumbs: string;
	/** Phones: the back button of the breadcrumbs. */
	back: string;
	/** Phones: the "open" button at the end of a row that has children. */
	open: string;
}

/** Where the Map stands: what the caller saves and gives back. */
export interface MapState {
	/** The node shown as the root (the home page until the user recenters). */
	root: string;
	/** The unfolded branch under the root, first column first (4 ids at most). */
	chain: string[];
	/** The node that had the cursor, or null. */
	focus: string | null;
}

export interface MapOptions {
	source: MapSource;
	/** The vault's root: where the Map starts and where "up" ends (the home page, or the first domain). */
	home: string;
	/** A saved state to start from; missing: root = home, the branch of `current` unfolded. */
	state?: MapState | null;
	/** The last opened note: a thin ring, and its branch unfolded at first. */
	current?: string | null;
	strings: MapStrings;
	/** Draws a Lucide icon into an element (the caller passes Obsidian's setIcon). */
	icon(el: HTMLElement, name: string): void;
	/** "auto" (default): columns when the container is at least 600 px wide on a computer, else the tree. */
	mode?: "auto" | "columns" | "tree";
}

export interface MapEvents {
	/**
	 * Opens a note. "same": click (after the 220 ms double-click window), Enter, a tap on a row
	 * without children; "tab": Ctrl/Cmd click, middle click, Ctrl/Cmd+Enter.
	 */
	open(id: string, how: "same" | "tab", event?: MouseEvent | KeyboardEvent): void;
	/** "N more" (or the caller's menu): show the full list of that node's children (its domain page). */
	openPage(id: string): void;
	/** P on a node: the caller flies `from` to its Pins row and pins the note. */
	pin(id: string, from: HTMLElement): void;
	/** Right click, Shift+F10, the menu key, a long press on phones: the caller shows its menu (it may call handle.recenter). */
	menu(id: string, event: MouseEvent | KeyboardEvent): void;
	/** Whether a node can be dragged up or down among its siblings (mouse, columns). */
	canMove?(id: string): boolean;
	/** A dragged node was dropped before `beforeId` (null: after the last sibling): the caller saves the order and redraws. */
	move?(id: string, beforeId: string | null): void;
	/** Whether a dragged node may be dropped onto `target` to hang under it (no loop, not its parent already). */
	canDrop?(id: string, target: string): boolean;
	/** A dragged node was dropped onto `target` (the middle of it): the caller makes it its parent. */
	drop?(id: string, target: string): void;
	/** Escape on the vault's root: the caller takes the focus back (its search field). */
	escape?(): void;
	/** The root or the unfolded branch changed: the caller saves the state. */
	change?(state: MapState): void;
}

export interface MapHandle {
	/** The data changed: redraw, keeping the root, the branch and the focus where they still exist. */
	update(): void;
	/** Makes a node the root (double-click, Enter held, the caller's "Recenter here" or "See on the map"). */
	recenter(id: string): void;
	/** The focus on the last node that had the cursor, else the root. */
	focus(): void;
	/** The container's size changed (columns or tree, column widths). */
	layout(): void;
	getState(): MapState;
	/**
	 * Unfolds the branch that shows this node (recentering when it is deeper than the columns).
	 * False when the node is not under the root or not among the shown children.
	 */
	reveal(id: string): boolean;
	/**
	 * A text field in place of the node's name (the node revealed first). Enter or leaving the field
	 * calls commit (resolve false to keep the field open), Escape calls cancel. False when the node
	 * cannot be shown.
	 */
	edit(id: string, options: MapEdit): boolean;
	/** Removes everything it added (DOM, listeners, timers, animations). */
	destroy(): void;
}

/** The inline name field of MapHandle.edit. */
export interface MapEdit {
	/** The text in the field at first (selected). */
	value: string;
	/** Screen readers: what the field is for ("Name of the new note"). */
	label: string;
	commit(value: string): boolean | void | Promise<boolean | void>;
	cancel(): void;
}

/** Fixed numbers of the Map (DEV-PLAN.md, from the validated mock-up). */
export const MAP_LIMITS = {
	/** Levels under the root (columns, or levels of the tree). */
	depth: 4,
	/** Columns shown beside the full root: a fourth one folds the root into a pill. */
	columns: 3,
	/** Width of the folded root, px. */
	rootPill: 30,
	/** Children shown per node before "N more". */
	children: 8,
	/** Height of the columns view, px. */
	height: 340,
	/** Tallest the columns view grows when "N more" opens (about 20 rows); longer columns scroll. */
	maxHeight: 640,
	rowStep: 30,
	nodeHeight: 28,
	rootMinWidth: 104,
	columnMin: 132,
	columnMax: 240,
	gapMax: 44,
	/** Below this width (px), the tree. */
	treeBelow: 600,
	treeRow: 44,
	treeIndent: 20,
	/** ms */
	hoverIntent: 90,
	safetyTriangle: 250,
	doubleClick: 220,
	holdToRecenter: 450,
	longPress: 500,
	/** Dragging over a folded node this long unfolds it, ms. */
	springOpen: 800,
} as const;
