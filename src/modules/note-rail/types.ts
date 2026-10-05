// Settings of the module and the contract between the rail and its panels.
import type { App, MarkdownView } from "obsidian";
import type { Lang, Vars } from "../../i18n";

/** Every panel the rail can host, in their default order. */
export type PanelId = "toc" | "bookmarks" | "tasks" | "calendar";
export const PANEL_IDS: PanelId[] = ["toc", "bookmarks", "tasks", "calendar"];

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
	/** Slide the text column aside when an open panel would cover it. */
	makeRoom: boolean;

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
	/** Rail: the area of the note as a colored initial, above the panel buttons. */
	showPlace: boolean;
	/** Rail: a button opening today's daily note. */
	showToday: boolean;
	/** Bookmarks: how many times the tip card was shown (3 = never again). */
	bookmarksTips: number;

	/** Tasks: also list the open tasks of the notes pinned to this note. */
	tasksIncludePinned: boolean;
	/** Tasks: also list the open tasks of the vault pins. */
	tasksIncludeVaultPins: boolean;
	/** Tasks: open task count as a badge on the rail button. */
	tasksBadge: boolean;

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
}

export interface PanelInstance {
	/** Rebuild the content (note edited, metadata or settings changed). */
	refresh(): void;
	/** Called right before the card hides. Contents restores the scroll unless reason is "commit". */
	onHide?(reason: HideReason): void;
	/** A mouse pointer left the card (it stays open). */
	onPointerLeave?(): void;
	destroy(): void;
}

export interface PanelDefinition {
	id: PanelId;
	/** Lucide icon of the rail button. The title is the string `panel.<id>`. */
	icon: string;
	/** False hides the rail button for this note. */
	isAvailable(env: RailEnv, view: MarkdownView): boolean;
	/** Optional small number shown as a badge on the rail button. */
	badge?(env: RailEnv, view: MarkdownView): number | null;
	/** Builds the panel content inside `body`. Called each time the panel opens. */
	create(ctx: PanelContext, body: HTMLElement): PanelInstance;
}
