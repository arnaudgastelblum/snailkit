import type { TFile } from "obsidian";
import type { SessionEntry } from "./atelier";
import type { Learned, LearnedVerbs } from "./logic";

export interface SessionsSettings {
	/** Folder of new sessions; empty: where Obsidian puts new notes. */
	folder: string;
	/** Note linked on the second line of new sessions (its name, without brackets); empty: none. */
	parent: string;
	/** Where catching tasks works: idea sessions only, or every note. */
	scope: "sessions" | "all";
	/** Pale dots in the margin next to likely tasks and questions. */
	dots: boolean;
	/** The page of a finished brainstorm: the theme's secondary background, a veil of the accent color, or none. */
	sealedBackground: "theme" | "accent" | "none";
	/** Paths of the idea sessions (followed through renames). */
	sessions: string[];
	/** When each session began ([path, ms]): kept here, a synced copy of the note may get another file date. */
	created: Array<[string, number]>;
	/** Words of posed task titles and the tag chosen for them. */
	learned: Learned;
	/** First words of sentences: raised when one is made a task, lowered when a dotted one is not (likely tasks). */
	verbs: LearnedVerbs;
	/** Tags chosen recently, most recent first. */
	recentTags: string[];
	/** Pinned sessions, the last pinned first (followed through renames). */
	pinned: string[];
	/** Archived sessions: hidden from the list, the note untouched (followed through renames). */
	archived: string[];
	/** Free sentences kept as ideas while sorting, by note: [path, prints] (see `fingerprint`), never sorted again. */
	kept: Array<[string, string[]]>;
}

export const DEFAULTS: SessionsSettings = {
	folder: "",
	parent: "",
	scope: "sessions",
	dots: true,
	sealedBackground: "theme",
	sessions: [],
	created: [],
	learned: [],
	verbs: [],
	recentTags: [],
	pinned: [],
	archived: [],
	kept: [],
};

/** Published as the "sessions" service while the module is on (the rail's lightning button uses it). */
export interface SessionsService {
	version: 1;
	/** An idea session, open or closed. */
	isSession(file: TFile): boolean;
	isClosed(file: TFile): boolean;
	/** Creates a session and opens it. */
	start(): Promise<void>;
	/** Opens the summary, which offers to close the session. */
	close(file: TFile): void;
	reopen(file: TFile): void;
	/** Open sessions that still hold tasks without a tag or lines kept to decide. */
	pending(): number;
	/** Every session with its state and counts, newest first (from what the module already read, no new read of the vault). */
	list(): SessionEntry[];
	/** Called (soon, once per burst) when sessions change; returns an unsubscribe function. */
	onChange(callback: () => void): () => void;
}

/** What the module reads from Tag colors, when it is on. */
export interface TagColorsService {
	version: 1;
	classes(tag: string): string;
}

/** What the module reads from the "places" service (published by the core, always there). */
export interface PlacesService {
	version: 1;
	placeOf(file: TFile): { area: TFile | null };
}

// ----- The Workbench (a view of the core, src/core/workbench): what this module's tab uses of it.
// A subset of WorkbenchTab and WorkbenchTabHost (src/core/workbench/types.ts). -----

export interface ViewTabHost {
	/** "page" (large) or "side" (narrow side panel). */
	readonly layout: "page" | "side";
	/** Opens a note at a line (or its top): Ctrl/Cmd for a new tab. */
	open(path: string, line: number | null, event?: MouseEvent | KeyboardEvent): void;
	/** Asks the Workbench to call `update()` of this tab soon. */
	refresh(): void;
}

export interface ViewTabInstance {
	update?(): void;
	destroy?(): void;
	/** The Workbench was revealed or this tab chosen: put the focus where the keyboard acts. */
	focus?(): void;
	/** True while the user edits something in the tab: a layout change waits. */
	busy?(): boolean;
}

export interface ViewTab {
	id: string;
	icon: string;
	label: string;
	count?(): number | null;
	/** "warn" paints the count orange. */
	countTone?(): "warn" | null;
	mount(el: HTMLElement, host: ViewTabHost): ViewTabInstance | void;
}

/** What this module reads from the Tasks module's service, when it is on. */
export interface TasksWorkbench {
	version: 1;
	/** The task at that place now, or null (tagged tasks only). */
	find?(location: { path: string; line: number; raw: string }): unknown;
	/** Checks or unchecks a task found by `find`. */
	setDone?(location: { path: string; line: number; raw: string }, done: boolean): Promise<unknown>;
	chime?(): void;
}
