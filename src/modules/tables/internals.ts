// Every access to Obsidian internals used by Tables lives in this file, each one behind feature
// detection. They were read in Obsidian 1.13.7. When one is missing (another version), the
// function returns null or false and the caller falls back: no toolbar on Live Preview tables,
// edits written by Tables itself instead of Obsidian's table commands, nothing ever thrown.
//
// Internals used:
// - `editor.cm`: the CodeMirror EditorView behind a MarkdownView's editor.
// - `view.editMode.tableCell` (also reachable as `view.editor.editorComponent.tableCell`): the
//   Live Preview table cell being edited, with `.table.start` (document offset of the table),
//   `.table.containerEl`, `.table.setCellFocus(row, col)`, `.cell.row`, `.cell.col` and `.cm`
//   (the cell's own editor). `setCellFocus` does nothing for the cell already being edited.
// - `app.commands.commands` / `app.commands.executeCommandById`: Obsidian's own table commands
//   `editor:table-row-before|after|up|down|copy|delete` and
//   `editor:table-col-before|after|left|right|copy|delete|align-left|center|right`.
//   `executeCommandById` returns true even when the command's own check fails, so callers only
//   use it when they made sure a cell of the right table is being edited.
// - `.cm-table-widget`: the class of the element that holds a Live Preview table.
// - `.mobile-toolbar`: Obsidian's toolbar above the keyboard on phones.
import type { EditorView } from "@codemirror/view";
import type { App, Editor, MarkdownView } from "obsidian";
import type { Action } from "./logic";

export const TABLE_WIDGET = ".cm-table-widget";

export interface LiveTable {
	start: number;
	containerEl: HTMLElement;
	setCellFocus?: (row: number, col: number) => void;
}
export interface TableCell {
	table: LiveTable;
	cell: { row: number; col: number };
	cm?: { focus(): void };
}

/** Obsidian's own command for an action, used while a Live Preview cell is being edited. */
const NATIVE_COMMANDS: Partial<Record<Action, string>> = {
	rowAbove: "editor:table-row-before",
	rowBelow: "editor:table-row-after",
	rowUp: "editor:table-row-up",
	rowDown: "editor:table-row-down",
	rowDuplicate: "editor:table-row-copy",
	rowDelete: "editor:table-row-delete",
	colLeft: "editor:table-col-before",
	colRight: "editor:table-col-after",
	colMoveLeft: "editor:table-col-left",
	colMoveRight: "editor:table-col-right",
	colDuplicate: "editor:table-col-copy",
	colDelete: "editor:table-col-delete",
	alignLeft: "editor:table-col-align-left",
	alignCenter: "editor:table-col-align-center",
	alignRight: "editor:table-col-align-right",
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The CodeMirror view behind an editor, or null. */
export function editorView(editor: Editor | null | undefined): EditorView | null {
	const cm = (editor as unknown as { cm?: unknown } | null | undefined)?.cm;
	return isObject(cm) && isObject(cm.state) && isObject(cm.contentDOM) && typeof cm.dispatch === "function" ? (cm as unknown as EditorView) : null;
}

/** The Live Preview cell being edited in a view, or null (none, or unknown shape). */
export function tableCellOf(view: MarkdownView | null | undefined): TableCell | null {
	if (!view) return null;
	try {
		const raw = view as unknown as { editMode?: { tableCell?: unknown }; editor?: { editorComponent?: { tableCell?: unknown } } };
		const tc = raw.editMode?.tableCell ?? raw.editor?.editorComponent?.tableCell;
		if (!isObject(tc) || !isObject(tc.table) || !isObject(tc.cell)) return null;
		const table = tc.table;
		const cell = tc.cell;
		// Not `instanceof HTMLElement`: a table in a pop-out window comes from another window.
		if (typeof table.start !== "number" || !isObject(table.containerEl) || typeof (table.containerEl as { querySelector?: unknown }).querySelector !== "function") return null;
		if (typeof cell.row !== "number" || typeof cell.col !== "number") return null;
		return tc as unknown as TableCell;
	} catch {
		return null;
	}
}

/** Runs Obsidian's own table command for `action`. False when there is none (then edit the text). */
export function runNativeCommand(app: App, action: Action): boolean {
	const id = NATIVE_COMMANDS[action];
	if (!id) return false;
	const commands = (app as unknown as { commands?: { commands?: Record<string, unknown>; executeCommandById?: (id: string) => boolean } }).commands;
	if (!commands || typeof commands.executeCommandById !== "function" || !isObject(commands.commands) || !(id in commands.commands)) return false;
	try {
		commands.executeCommandById(id);
		return true;
	} catch (error) {
		console.error("[Snailkit] tables: native table command failed", error);
		return false;
	}
}

/** Focuses a cell of a Live Preview table. False when it could not (the caller focuses the editor). */
export function focusCell(view: MarkdownView, table: LiveTable, row: number, col: number): boolean {
	try {
		const tc = tableCellOf(view);
		if (tc && tc.table === table && tc.cell.row === row && tc.cell.col === col && tc.cm && typeof tc.cm.focus === "function") {
			tc.cm.focus();
			return true;
		}
		if (table.containerEl.isConnected && typeof table.setCellFocus === "function") {
			table.setCellFocus(row, col);
			return true;
		}
	} catch {
		// The table object changed shape: the caller falls back on the editor.
	}
	return false;
}

/** Live Preview table holders of an editor. */
export function tableWidgets(cm: EditorView): HTMLElement[] {
	return Array.from(cm.contentDOM.querySelectorAll<HTMLElement>(TABLE_WIDGET));
}

/** The holder of the Live Preview table whose header is on 0-based line `line`, or null. */
export function findTableWidget(cm: EditorView, line: number): HTMLElement | null {
	for (const widget of tableWidgets(cm)) {
		if (widgetLine(cm, widget) === line) return widget;
	}
	return null;
}

/** 0-based line where a table holder starts, or null when it is detached. */
export function widgetLine(cm: EditorView, widget: HTMLElement): number | null {
	try {
		return cm.state.doc.lineAt(cm.posAtDOM(widget)).number - 1;
	} catch {
		return null;
	}
}

/** Obsidian's toolbar above the keyboard on phones, when shown. */
export function mobileToolbar(doc: Document): HTMLElement | null {
	const bar = doc.querySelector<HTMLElement>(".mobile-toolbar");
	return bar && bar.offsetParent ? bar : null;
}
