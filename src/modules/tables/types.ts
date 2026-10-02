// Shared types of the Tables module.
import type { EditorView } from "@codemirror/view";
import type { MarkdownView } from "obsidian";
import type { ModuleContext } from "../../core/context";
import type { LiveTable } from "./internals";
import type { Block, Meta, Model } from "./logic";

export interface TablesSettings {
	/** Look of new tables: style, banding, text size, and the other tokens kept by "Use as default". */
	newStyle: string;
	newBanding: string;
	newSize: string;
	newExtras: string;
	/** Style drawn on tables without a style comment, "none" for the theme's look. */
	otherTables: string;
	toolbar: boolean;
	chip: boolean;
	keyboard: boolean;
	dateOrder: string;
}
export type Context = ModuleContext<TablesSettings>;

/** Which table, which cell. `table` is Obsidian's Live Preview table while one of its cells is edited. */
export interface TableContext {
	view: MarkdownView;
	cm: EditorView;
	block: Block;
	lines: string[];
	model: Model;
	row: number;
	col: number;
	table: LiveTable | null;
	path: string | null;
	/** Header cells, to make sure a menu left open still acts on the same table. */
	header: string;
	/** path:line of the header, to tell tables apart. */
	key: string;
	/** Keeps the chosen column even when another cell has the focus (header button). */
	pinned?: boolean;
}

/** What the style panel edits: one table's comment, and the rendered tables to preview on. */
export interface StyleTarget {
	meta: Meta | null;
	tables(): HTMLTableElement[];
	commit(meta: Meta | null): void;
	restoreFocus(): void;
}
