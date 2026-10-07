// Contracts of the services that modules share (ctx.provide / ctx.service), for the services
// that the Workbench work added or uses. A module reads a service with ctx.service<T>(name),
// asks again each time (it comes and goes with its module), checks `version === 1`, and treats
// optional methods as possibly missing. Companion plugins reach the same objects through
// app.plugins.plugins.snailkit.api.service(name).
// These shapes are shared by several modules: change them only together with every user.
import type { Editor, TFile } from "obsidian";

export type { Place, PlacesService } from "./places/types";

// ----- "home": the Home module (Home tab of the Workbench) -----

export interface HomeService {
	version: 1;
	/** The Workbench on the Home tab, its search field focused (on a computer). */
	open(): Promise<void>;
	/**
	 * The page of the domain or sub-MOC nearest to this note (the note itself when it is one),
	 * the note marked "you are here". False when the note has no place (no parent).
	 */
	openPlace(file: TFile): Promise<boolean>;
	/** The page of a domain or sub-MOC note. False when the note is neither. */
	openDomain(path: string): Promise<boolean>;
	/** The page of a tag (without "#"): its tasks, then its notes. */
	openTag(tag: string): Promise<boolean>;
	/** The Home on its Map, centered on this note (the home page when missing). */
	openMap(path?: string): Promise<void>;
}

// ----- "note-rail": the Note rail module -----

/** Where daily notes live and how they are named (moment format). */
export interface DailyConfigShape {
	/** Folder without leading or trailing slash, "" for the vault root. */
	folder: string;
	format: string;
	/** Template note path, "" for none. */
	template: string;
}

export interface VaultPinFolder {
	id: string;
	name: string;
	pins: string[];
}

export interface VaultPinGroups {
	loose: string[];
	folders: VaultPinFolder[];
}

export interface NoteRailService {
	version: 1;
	/** Vault pins (the Bookmarks panel's "Vault" list), vault paths in their order. */
	vaultPins(): string[];
	isPinned(path: string): boolean;
	/** Pins a note to the vault (at the end) or unpins it. Saved in the Note rail settings. */
	setPinned(path: string, pinned: boolean): Promise<void>;
	/** Detached snapshot; loose pins first, then ordered folders and their ordered pins. */
	listPins(): VaultPinGroups;
	removePin(path: string): Promise<void>;
	/** Final zero-based index in the destination; null means loose. Missing destinations are ignored. */
	movePin(path: string, index: number, folderId?: string | null): Promise<void>;
	/** Empty names return null. IDs survive renames. */
	createPinFolder(name: string): Promise<string | null>;
	renamePinFolder(id: string, name: string): Promise<void>;
	/** Appends the folder's pins to the loose list, in order. */
	deletePinFolder(id: string): Promise<void>;
	movePinFolder(id: string, index: number): Promise<void>;
	/** Called when the vault pins change. Returns an unsubscribe function. */
	onPinsChange(callback: () => void): () => void;
	/** Where daily notes are: the Calendar settings over Obsidian's Daily notes plugin. */
	dailyConfig(): DailyConfigShape;
}

// ----- "search": the Search module -----

export type SearchFilter = "all" | "notes" | "tasks" | "brainstorms";

/** The note the user came from: Shift+Enter inserts a link to the chosen result there. */
export interface SearchSource {
	file: TFile;
	/** Its editor when it is open in one: the link goes at the cursor (else at the end of the note). */
	editor?: Editor | null;
}

export interface SearchOpenOptions {
	/** Text already typed in the field. */
	query?: string;
	/**
	 * The floating window grows from this element (the rail's magnifier) and opens in its window
	 * (ownerDocument, for popout windows). Missing: centered in the active window.
	 */
	anchor?: HTMLElement | null;
	/** Missing: the last Markdown view that had the focus. */
	from?: SearchSource | null;
}

/**
 * The Home's search field, drawn by Search. The caller owns the field and the elements; Search
 * listens to the field, draws inside `results`, `tokens` and `preview`, and never touches the
 * rest of the page.
 */
export interface InlineSearchHost {
	/** The field (placeholder, focus and size are the caller's). */
	readonly input: HTMLInputElement;
	/** Empty element under the field: chips (All, Notes, Tasks, Brainstorms) and result rows. */
	readonly results: HTMLElement;
	/** Empty element in the field's row, before the input: the #tag and in:domain filters as tokens. */
	readonly tokens?: HTMLElement | null;
	/** Empty element in the right margin for the preview (computer, wide enough), or null. Search fills it and moves it vertically. */
	readonly preview?: HTMLElement | null;
	/** A query starts (true): the caller fades its page out; the field is empty again (false): the page comes back. */
	onActive(active: boolean): void;
	/** Escape in an empty field. */
	onEscape?(): void;
	/** Down arrow in an empty field: the caller moves into its page. */
	onLeave?(): void;
	/** Opens a note the caller's way (the Workbench's host.open); Search opens it itself when missing. */
	openNote?(path: string, line: number | null, event?: MouseEvent | KeyboardEvent): void;
	/** Where Shift+Enter inserts a link. Missing: the last Markdown view that had the focus. */
	source?(): SearchSource | null;
}

export interface InlineSearch {
	/** True while a query (or a filter) is present. */
	readonly active: boolean;
	/** Sets the text as if typed. */
	setQuery(text: string): void;
	/** Empties the field and the results (the page comes back). */
	clear(): void;
	/** The caller's layout changed (width, preview element shown or hidden). */
	layout(): void;
	/** Removes listeners and what Search drew. The field stays. */
	destroy(): void;
}

export type SearchResultKind = "note" | "section" | "task" | "brainstorm" | "domain" | "tag" | "content";

export interface SearchResult {
	kind: SearchResultKind;
	/** What the row shows first: note title, heading, task title, tag (without "#")... */
	title: string;
	/** The note it opens; null for tags. */
	path: string | null;
	/** 0-based line for sections, tasks and content; null for the top of the note. */
	line: number | null;
	/** Hue of the note's domain (places), null without one. */
	hue: number | null;
	/** "Domain › nearest sub-MOC" (places), "" without. */
	trail: string;
	/** Matched ranges in `title`, [from, to) offsets, for highlighting. */
	ranges: Array<[number, number]>;
	/** Content results: the text around the match. */
	snippet?: string;
	/** Higher is better; only meaningful inside a group. */
	score: number;
}

export interface SearchGroup {
	kind: SearchResultKind;
	results: SearchResult[];
}

export interface SearchService {
	version: 1;
	/** The floating search (full screen on phones). */
	open(options?: SearchOpenOptions): void;
	/** Draws the search in the caller's field and elements (the Home tab). */
	attach(host: InlineSearchHost): InlineSearch;
	/**
	 * Groups in their fixed order (notes, sections, tasks, brainstorms, domains, tags, content),
	 * empty groups left out, at most `limit` results per group (default: the display limits).
	 * Content results come from the index when it is ready, else from a direct read.
	 */
	query(text: string, options?: { filter?: SearchFilter; limit?: number }): Promise<SearchGroup[]>;
}

// ----- What Home and Search read from existing services (subsets of their version 1) -----

/** "tasks" (src/modules/tasks/api.ts, TasksApi): the part Home and Search use. */
export interface TasksReader {
	version: 1;
	isReady(): boolean;
	getTasks(options?: { includeDone?: boolean }): TaskInfoLite[];
	on(event: "change", callback: () => void): () => void;
	setDone(location: { path: string; line: number; raw: string }, done: boolean): Promise<unknown>;
	openWorkbench?(options?: { tab?: string; scope?: "all" | "today" }): Promise<void>;
}

export interface TaskInfoLite {
	path: string;
	/** 0-based. */
	line: number;
	raw: string;
	key: string;
	title: string;
	plainTitle: string;
	/** Group tag, lowercased, without "#". */
	tag: string;
	tags: string[];
	priority: "high" | "medium" | "low" | null;
	/** "YYYY-MM-DD" or null. */
	due: string | null;
	done: boolean;
}

/** "sessions" (src/modules/sessions/types.ts, SessionsService): the part Home and Search use. */
export interface SessionsReader {
	version: 1;
	isSession(file: TFile): boolean;
	list?(): Array<{ path: string; title: string; created: number; state: "open" | "to-sort" | "closed"; tasks: number; undecided: number }>;
	onChange?(callback: () => void): () => void;
}

/** "tag-colors": classes that set --sk-tag-r-bg/-fg and --sk-tag-l-bg/-fg for a tag. */
export interface TagColorsReader {
	version: 1;
	classes(tag: string): string;
}

// ----- "snailkit:tag-renamed": a tag was renamed in the whole vault -----

/**
 * Workspace event triggered after a tag was renamed in every note (`from` and its sub-tags now
 * read `to`). Tools that keep something per tag (Tags: the chosen colors) follow it.
 */
export const TAG_RENAMED_EVENT = "snailkit:tag-renamed";
export interface TagRenamedEvent {
	from: string;
	to: string;
}
