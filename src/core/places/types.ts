// Contracts of "places": where each note belongs. One rule for the note rail's area pill, the
// Home's domains and pages, the Map and Search:
// - a note has at most one parent: the note named by its "up" (or "parent", "parents", "moc",
//   "mocs") property, else the first [[link]] within the first lines of its text;
// - following parents up gives the chain (a loop or a very deep chain stops there);
// - the home page is the top note holding more than half of the linked notes (or the one chosen
//   in the Home module's settings); a note's area (the rail's pill) is the level just below it,
//   else the top note;
// - the domains (Home, Map, Search) are the home page's children that have children, or without
//   a home page the top notes that have children;
// - notes in ignored folders have no parent and are nobody's parent;
// - nothing is ever written in the notes.
// Published by the core as the "places" service (always on). Version 1 kept: placeOf and hueOf
// are unchanged, the other methods are additions.
import type { TFile } from "obsidian";

/** Where a note belongs: its parents (nearest first) and its area (null when it has no parent). */
export interface Place {
	chain: TFile[];
	area: TFile | null;
}

/** Options set by the Home module while it runs; the defaults keep the rule as it always was. */
export interface PlacesOptions {
	/** Path of the home page, or "" to detect it (a top note holding more than half of the linked notes). */
	home: string;
	/** Folders whose notes stay out (vault paths, no leading or trailing slash). */
	ignoredFolders: string[];
}

export const DEFAULT_PLACES_OPTIONS: PlacesOptions = { home: "", ignoredFolders: [] };

export interface PlacesService {
	version: 1;
	/** Parents and area of a note, read fresh from the metadata cache (as the rail always did). */
	placeOf(file: TFile): Place;
	/** A stable hue (0-359) for a note path: the color of a domain. */
	hueOf(path: string): number;

	/** The parent of a note under the rule, or null. */
	parentOf(file: TFile): TFile | null;
	/** The home page (detected or chosen), or null. */
	homePath(): string | null;
	/** Direct children of a note (notes whose parent it is), sorted by path. Empty for an unknown path. */
	childrenOf(path: string): TFile[];
	hasChildren(path: string): boolean;
	/**
	 * The domains. Below a home page: its children that have children. Without one: the top notes
	 * (no parent) that have children. A tree that does not hang from the home page holds no domain
	 * (placeOf still gives its top note as the area). Sorted by name.
	 */
	domains(): TFile[];
	/** True when the path is in an ignored folder (PlacesOptions; Obsidian's "Excluded files" are Search's business). */
	isIgnored(path: string): boolean;
	/** Called (soon, once per burst) when parents may have changed. Returns an unsubscribe function. */
	onChange(callback: () => void): () => void;
}
