// Settings of the Home module. The arrangement of the domains lives here (data.json), never in
// the notes. Recently opened notes are per device (app.saveLocalStorage), not in the settings.
import type { AutoOpenMode } from "../../core/workbench/types";
import type { MapState } from "../../ui/map/types";

export interface HomeSettings {
	/** When the Workbench opens by itself, on the Home tab. Phones follow the same setting. */
	openWorkbench: AutoOpenMode;
	/** Root of the Map and the domains: a note path, or "" to detect the home page. */
	homePage: string;
	/** Folders left out of the Map, the domains and the rail's area (comma separated vault paths). */
	ignoredFolders: string;
	/** The Home's view, the last one chosen: "domains", "map" or "tags". */
	lens: string;

	// The arrangement of the domains (user data, kept by "Reset to defaults"). Every entry is a
	// vault path, followed through renames and dropped when the note is deleted.
	/** Domains the user moved, in their order; the others follow, most recently active first. */
	domainOrder: string[];
	/** The featured domain (first, full width), or "". */
	featured: string;
	/** The user's groups, in order: [group id, name]. */
	groups: Array<[string, string]>;
	/** Which group each domain is in: [domain path, group id]. */
	domainGroups: Array<[string, string]>;
	/** Domains hidden from the Home and the Map (discretion). */
	hidden: string[];
	/** Sub-MOCs shown as their own block, out of their domain. */
	pulledOut: string[];
}

export const DEFAULTS: HomeSettings = {
	openWorkbench: "startup-and-new-tabs",
	homePage: "",
	ignoredFolders: "",
	lens: "domains",
	domainOrder: [],
	featured: "",
	groups: [],
	domainGroups: [],
	hidden: [],
	pulledOut: [],
};

/** Settings that hold the user's data rather than preferences. */
export const KEEP_ON_RESET: Array<keyof HomeSettings & string> = ["domainOrder", "featured", "groups", "domainGroups", "hidden", "pulledOut"];

/** The Home's three views of the domains. */
export type HomeLens = "domains" | "map" | "tags";

/** A page of the Home tab, shown in place of the Home with a breadcrumb (Escape goes up). */
export type HomePage =
	/** A domain or sub-MOC; `here`: the note the user came from, under the cursor. */
	| { kind: "domain"; path: string; here?: string }
	| { kind: "tag"; tag: string }
	/** Open tasks left in daily notes before today. */
	| { kind: "old-dailies" };

/** What the Home tab keeps in the saved workspace (and in Obsidian's back and forward history). */
export interface HomeTabState {
	page: HomePage | null;
	lens?: HomeLens;
	scroll?: number;
	map?: MapState;
	/** Key of the item under the cursor. */
	cursor?: string;
}
