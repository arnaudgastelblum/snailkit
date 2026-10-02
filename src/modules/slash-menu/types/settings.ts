// Persisted configuration. Everything here is saved by loadData()/saveData(),
// so keep it plain JSON (no class instances, no functions).

export const SETTINGS_VERSION = 1;

/** How a callout folds: not foldable, foldable and open (`+`), foldable and closed (`-`). */
export type CalloutFold = "none" | "open" | "closed";

/** Line-level Markdown blocks the "block" action can turn the current line into. */
export type BlockKind = "text" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "bullet" | "numbered" | "todo" | "quote";

export interface CommandActionConfig {
	type: "command";
	/** Stable Obsidian command id, e.g. `editor:toggle-bold` or `my-plugin:create-table`. */
	commandId: string;
}

export interface MarkdownActionConfig {
	type: "markdown";
	/** Markdown with {{variables}}. `{{cursor}}` marks where the cursor lands (first occurrence). */
	template: string;
}

export interface CalloutActionConfig {
	type: "callout";
	/** Callout type written between the brackets, e.g. `warning`, `faq`. */
	calloutType: string;
	/** Default title; empty means no title (Obsidian then shows the type name). */
	title: string;
	fold: CalloutFold;
	/** Optional body, supports {{variables}}. Empty puts the cursor in an empty body line. */
	content: string;
}

export interface BlockActionConfig {
	type: "block";
	block: BlockKind;
}


export interface NewNoteActionConfig {
	type: "new-note";
	/** Filename template (without extension), supports {{variables}}. */
	nameTemplate: string;
	/** Folder path; empty uses Obsidian's "Default location for new notes". */
	folder: string;
	/** Insert a link to the new note at the cursor. */
	insertLink: boolean;
	/** Open the new note in a new tab. */
	openInNewTab: boolean;
}

export type ActionConfig = CommandActionConfig | MarkdownActionConfig | CalloutActionConfig | BlockActionConfig | NewNoteActionConfig;
export type ActionTypeId = ActionConfig["type"];

/** One entry of the slash menu. */
export interface SlashItem {
	customized?: boolean;
	/** Unique, stable id (never shown). Built-ins use `builtin:*`, user items a random id. */
	id: string;
	enabled: boolean;
	pinned: boolean;
	/** Display name in the menu. Renaming never touches the underlying command. */
	name: string;
	description: string;
	/** Lucide icon id (as accepted by setIcon), empty for none. */
	icon: string;
	/** Id of a SlashCategory. */
	categoryId: string;
	/** Extra words that help search ("draw", "diagram"). */
	keywords: string[];
	/** Alternative names; matched with higher priority than keywords. */
	aliases: string[];
	action: ActionConfig;
}

export interface SlashCategory {
	customized?: boolean;
	id: string;
	name: string;
	hidden: boolean;
}

export type UnavailableDisplay = "hide" | "dim";


export interface SlashMenuSettings {
	version: number;

	// General
	triggerChar: string;
	/** Only open the menu when the trigger is at line start or after whitespace. */
	triggerAfterSpaceOnly: boolean;
	showDescriptions: boolean;
	showIcons: boolean;
	showCategories: boolean;
	showPinned: boolean;
	showRecent: boolean;
	maxRecent: number;
	animations: boolean;
	/** Highlight briefly what an action inserted. */
	flashInserted: boolean;
	unavailableDisplay: UnavailableDisplay;
	/** Max rows rendered when searching (keeps the menu fast with hundreds of items). */
	maxResults: number;

	// Formats (moment.js)
	dateFormat: string;
	timeFormat: string;
	datetimeFormat: string;

	// Content
	/** Ordered list of categories; order is the order in the menu. */
	categories: SlashCategory[];
	/** Ordered list of items; order inside a category is the order of this array. */
	items: SlashItem[];

	// State (not configuration, but persisted)
	/** Item ids, most recent first. */
	recent: string[];
}

