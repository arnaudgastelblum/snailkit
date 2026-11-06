// Settings of the module and the contract between the rail and its panels.
import type { App, MarkdownView, TFile } from "obsidian";
import type { RegisteredNoteAction } from "../../core/note-actions";
import type { PlacesService } from "../../core/places/types";
import type { Lang, Vars } from "../../i18n";

/** The panels a user can show or hide: the three rail buttons, and the Calendar row of the Snailkit menu. */
export type PanelId = "toc" | "bookmarks" | "tasks" | "calendar";
export const PANEL_IDS: PanelId[] = ["toc", "bookmarks", "tasks", "calendar"];
/** The panels with a rail button the user can order (Calendar lives in the Snailkit menu). */
export type ButtonId = "toc" | "tasks" | "bookmarks";
export const BUTTON_IDS: ButtonId[] = ["toc", "tasks", "bookmarks"];
/**
 * Every panel the rail can open: the four above, the Snailkit menu (top of the rail) and its
 * Brainstorms sub-panel, the area panel (the colored pill) and the Actions panel (bottom).
 */
export type RailPanelId = PanelId | "session" | "menu" | "place" | "actions" | "callout";

export interface NoteRailSettings {
	/** Which rail buttons are shown. */
	showToc: boolean;
	showBookmarks: boolean;
	showTasks: boolean;
	showCalendar: boolean;
	/** Order of the rail buttons (panel ids). Unknown ids are ignored, missing ones are appended. */
	buttonOrder: string[];
	/** Which top corner of the note pane the rail sits in on a computer: "left" or "right". */
	position: string;
	/** Same, on phones and tablets: "right" by default (the left corner holds the sidebar button). */
	mobilePosition: string;
	/** Rail opacity while the pointer is outside the note pane, 0.2 to 1. */
	restOpacity: number;
	/** On a computer, resting the pointer on a rail button opens its panel (a click keeps it open). */
	openOnHover: boolean;

	/** Contents: scroll the note to a heading while hovering it, return on leave. */
	tocHoverPreview: boolean;
	/** Contents: how long the pointer rests on a heading before the preview, in ms. */
	tocHoverDelay: number;
	/** Contents: deepest heading level listed (1 to 6). */
	tocMaxLevel: number;

	/** Bookmarks: frontmatter property holding the pins of a note (a list of "[[links]]"). */
	pinsKey: string;
	/** Bookmarks: vault-wide pins, vault paths in display order. Kept in sync on rename and delete. */
	vaultPins: string[];
	vaultPinFolders: import("../../core/services").VaultPinFolder[];
	/** Rail: the area of the note as a colored initial, opening the panel of its parents and children. */
	showPlace: boolean;
	/** Bookmarks: how many times the tip card was shown (3 = never again). */
	bookmarksTips: number;

	/** Tasks: also list the open tasks of the notes pinned to this note. */
	tasksIncludePinned: boolean;
	/** Tasks: also list the open tasks of the vault pins. */
	tasksIncludeVaultPins: boolean;
	/** Tasks: open task count as a badge on the rail button. */
	tasksBadge: boolean;
	/** Tasks: the badge also counts overdue tasks (orange then). Off: today only. */
	badgeOverdue: boolean;

	/** Calendar: "monday", "sunday" or "language" (the first day of the week of Snailkit's language). */
	calendarWeekStart: string;
	calendarWeekNumbers: boolean;
	calendarTaskDots: boolean;
	calendarConfirmCreate: boolean;
	/** Calendar: overrides of the core Daily notes settings. Empty = the core setting. */
	calendarFolder: string;
	calendarFormat: string;
	calendarTemplate: string;
}

/** Why a panel is being hidden. "commit" = the user clicked something that navigates. */
export type HideReason = "commit" | "leave" | "switch" | "escape" | "outside" | "file-change" | "unload";

/** What the rail and every panel get from the module (translations, settings, shared names). */
export interface RailEnv {
	readonly app: App;
	readonly settings: NoteRailSettings;
	readonly lang: Lang;
	t(key: string, vars?: Vars): string;
	tn(key: string, count: number, vars?: Vars): string;
	/** Changes the settings (for panel-owned data such as vault pins), saves, every rail redraws. */
	updateSettings(mutate: (settings: NoteRailSettings) => void): Promise<void>;
	/** Source name for Obsidian's page preview (Ctrl or Cmd hover). */
	readonly hoverSource: string;
	/** Another module's shared object (see ModuleContext.service), or undefined while it is off. */
	service<T>(name: string): T | undefined;
	/** Overdue and today's open tasks of the vault, while the Tasks module is on; null otherwise. */
	vaultTasks(): VaultTaskCounts | null;
	/** Opens the Workbench of the Tasks module (a tab, a scope). False when the Tasks module is off. */
	openWorkbench(options?: WorkbenchOptions): boolean;
	/** True when the Workbench has that tab right now (its module is on). */
	hasWorkbenchTab(tab: string): boolean;
	/** Where notes belong (the core's rule): parents, children, the home page. */
	readonly places: PlacesService;
	/** What the running modules can do with the open note (ModuleContext.addNoteAction). */
	noteActions(): RegisteredNoteAction[];
	/** Obsidian's settings, on Snailkit's page. */
	openSettings(): void;
}

export interface VaultTaskCounts {
	overdue: number;
	today: number;
}

export interface WorkbenchOptions {
	tab?: string;
	scope?: "all" | "today";
}

/** What the rail uses of the Tasks module's "tasks" service (newer parts are optional). */
export interface TasksService {
	version: 1;
	getTasks(options?: { includeDone?: boolean }): Array<{ due: string | null; done: boolean }>;
	on(event: "change", callback: () => void): () => void;
	openWorkbench?(options?: WorkbenchOptions): Promise<void>;
	/** The "task checked" sound, when the user turned it on. */
	chime?(): void;
}

/** One idea session as the "sessions" service lists it. */
export interface SessionEntry {
	path: string;
	title: string;
	created: number;
	state: "open" | "to-sort" | "closed";
	tasks: number;
	undecided: number;
}

/** What the rail uses of the Idea sessions module's "sessions" service. */
export interface SessionsService {
	version: 1;
	isSession(file: TFile): boolean;
	isClosed(file: TFile): boolean;
	start(): Promise<void>;
	close(file: TFile): void;
	reopen(file: TFile): void;
	pending(): number;
	/** Every session with its state and counts (newer modules only). */
	list?(): SessionEntry[];
	/** Called when sessions change; returns an unsubscribe function (newer modules only). */
	onChange?(callback: () => void): () => void;
}

/**
 * The rail owns the panel card (header with title, count, subtitle and pin, progress bar, footer,
 * animations, Esc, outside click). A panel only fills the body and the footer.
 */
export interface PanelContext extends RailEnv {
	readonly view: MarkdownView;
	/** Close the panel. Pass "commit" after a navigation so panels do not undo it. */
	close(reason?: HideReason): void;
	/** Replace the footer (short hint line, plain text or a small fragment). Empty string hides it. */
	setFooter(content: string | DocumentFragment): void;
	setSubtitle(text: string): void;
	/** Small count next to the title. Null hides it. */
	setCount(count: number | null): void;
	/** Thin progress bar under the header, 0 to 1. Null hides it. */
	setProgress(progress: number | null): void;
	/** True while the user pinned the panel open. */
	isPinned(): boolean;
	/** Replace this panel by another one in the same card (the Snailkit menu going to Calendar). */
	openPanel(id: RailPanelId, fromKeyboard?: boolean): void;
	/** The rail button this panel grew from (an anchor for what opens next to it), or null. */
	railButton(): HTMLElement | null;
}

export interface PanelInstance {
	/** Rebuild the content (note edited, metadata or settings changed). */
	refresh(): void;
	/** Called right before the card hides. Contents restores the scroll unless reason is "commit". */
	onHide?(reason: HideReason): void;
	/** A mouse pointer left the card (it stays open). */
	onPointerLeave?(): void;
	/** The overdue and today's tasks of the vault changed (Tasks module). */
	onVaultTasks?(): void;
	destroy(): void;
}

export interface PanelDefinition {
	id: RailPanelId;
	/** Lucide icon of the rail button. The title is the string `panel.<id>`. */
	icon: string;
	/** A sub-panel: reached from this panel, whose rail button stays lit, with a back arrow in the header. */
	parent?: RailPanelId;
	/** False hides the rail button for this note. */
	isAvailable(env: RailEnv, view: MarkdownView): boolean;
	/** Optional small number shown as a badge on the rail button. */
	badge?(env: RailEnv, view: MarkdownView): number | null;
	/** "warn" paints the badge orange. */
	badgeTone?(env: RailEnv, view: MarkdownView): "warn" | null;
	/** Builds the panel content inside `body`. Called each time the panel opens. */
	create(ctx: PanelContext, body: HTMLElement): PanelInstance;
}
