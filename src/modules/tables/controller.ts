// Tables in the editor: which table and cell has the cursor, running actions on it (one undo
// step each), the style comment, menus and commands. The floating toolbar, the style panel,
// the column tools and the editor extensions all go through this controller.
import { isolateHistory } from "@codemirror/commands";
import type { Annotation } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { MarkdownView, Menu, Notice, type MarkdownPostProcessorContext } from "obsidian";
import { applyMeta } from "./dom";
import { ColumnButton, ColumnResizer } from "./column-tools";
import { refreshEffect } from "./extensions";
import { InsertTableModal } from "./insert-modal";
import {
	editorView,
	findTableWidget,
	focusCell,
	runNativeCommand,
	TABLE_WIDGET,
	tableCellOf,
	widgetLine,
} from "./internals";
import {
	cellIndexAt,
	cellSpan,
	columnKind,
	createTable,
	defaultMeta,
	findAllTables,
	findTableAt,
	formatTable,
	headerKey,
	lineOfRow,
	lookExtras,
	lookMeta,
	metaFromLine,
	parseTable,
	planAction,
	plainText,
	rowOfLine,
	shownStyle,
	STYLES,
	toCsv,
	withMeta,
	type Action,
	type Block,
	type DateOrder,
	type Meta,
	type Plan,
} from "./logic";
import { StylePanel } from "./style-panel";
import { TableToolbar } from "./toolbar";
import type { Context, StyleTarget, TableContext } from "./types";

/**
 * Table edits are their own undo step, never merged with the typing around them. (The cast
 * bridges two copies of @codemirror/state in development; Obsidian provides only one.)
 */
const isolate = (): Annotation<unknown>[] => (isolateHistory ? [isolateHistory.of("full") as unknown as Annotation<unknown>] : []);

/** Commands and their actions, also used by the menus. */
export const ACTION_COMMANDS: Array<[id: string, action: Action, icon: string]> = [
	["sort-asc", "sortAsc", "arrow-down-narrow-wide"],
	["sort-desc", "sortDesc", "arrow-down-wide-narrow"],
	["format", "format", "wand-2"],
	["row-above", "rowAbove", "panel-top-close"],
	["row-below", "rowBelow", "panel-bottom-close"],
	["row-duplicate", "rowDuplicate", "copy"],
	["row-up", "rowUp", "arrow-up"],
	["row-down", "rowDown", "arrow-down"],
	["row-delete", "rowDelete", "trash-2"],
	["col-left", "colLeft", "panel-left-close"],
	["col-right", "colRight", "panel-right-close"],
	["col-duplicate", "colDuplicate", "copy"],
	["col-move-left", "colMoveLeft", "arrow-left"],
	["col-move-right", "colMoveRight", "arrow-right"],
	["col-delete", "colDelete", "trash-2"],
	["align-left", "alignLeft", "align-left"],
	["align-center", "alignCenter", "align-center"],
	["align-right", "alignRight", "align-right"],
];

const ANNOUNCE: Partial<Record<Action, string>> = {
	rowAbove: "announce.row-added",
	rowBelow: "announce.row-added",
	rowDuplicate: "announce.row-added",
	rowUp: "announce.row-moved",
	rowDown: "announce.row-moved",
	rowDelete: "announce.row-deleted",
	colLeft: "announce.col-added",
	colRight: "announce.col-added",
	colDuplicate: "announce.col-added",
	colMoveLeft: "announce.col-moved",
	colMoveRight: "announce.col-moved",
	colDelete: "announce.col-deleted",
	sortAsc: "announce.sorted",
	sortDesc: "announce.sorted",
};

export class TablesController {
	readonly stylers = new Set<{ schedule(): void }>();
	stylePanel: StylePanel | null = null;
	readonly toolbar: TableToolbar;
	readonly columnButton: ColumnButton;
	readonly resizer: ColumnResizer;
	private readonly timers = new Set<number>();
	private modal: InsertTableModal | null = null;

	constructor(readonly ctx: Context) {
		this.toolbar = new TableToolbar(this);
		this.columnButton = new ColumnButton(this);
		this.resizer = new ColumnResizer(this);
	}

	get app() {
		return this.ctx.app;
	}

	t(key: string, vars?: Record<string, string | number>): string {
		return this.ctx.t(key, vars);
	}

	get dateOrder(): DateOrder {
		return this.ctx.settings.dateOrder === "mdy" ? "mdy" : "dmy";
	}

	/** A timeout that is cancelled when the module stops. */
	later(callback: () => void, ms: number): void {
		const id = window.setTimeout(() => {
			this.timers.delete(id);
			callback();
		}, ms);
		this.timers.add(id);
	}

	/** Undoes what the module drew outside the registered extensions. */
	stop(): void {
		for (const id of this.timers) window.clearTimeout(id);
		this.timers.clear();
		this.modal?.close();
		this.stylePanel?.close(false);
		this.toolbar.destroy();
		this.resizer.destroy();
		this.columnButton.destroy();
		// The stylesheet stays loaded while the module is off: rendered tables lose their styling here.
		this.app.workspace.iterateAllLeaves((leaf) => {
			leaf.view.containerEl
				.querySelectorAll<HTMLElement>("table.sk-tables-styled, table[data-sk-widths], table[data-sk-size], table[data-sk-hide-header]")
				.forEach((table) => applyMeta(table, null));
		});
	}

	// ----- Looks -----

	/** Look given to new tables (no widths). */
	newTableMeta(): Meta {
		const s = this.ctx.settings;
		return lookMeta(s.newStyle, s.newBanding, s.newSize, s.newExtras);
	}

	async setNewTableLook(meta: Meta): Promise<void> {
		const s = this.ctx.settings;
		const style = shownStyle(meta.style);
		s.newStyle = style === "none" ? "plain" : style;
		s.newBanding = meta.banding;
		s.newSize = meta.size;
		s.newExtras = lookExtras(meta);
		await this.ctx.saveSettings();
	}

	/** Look of tables without a style comment, null for the theme's look. */
	defaultMeta(): Meta | null {
		const style = this.ctx.settings.otherTables;
		return (STYLES as readonly string[]).includes(style) ? { ...this.newTableMeta(), style } : null;
	}

	/** Draws every open table again (after a settings change). */
	restyleAll(): void {
		for (const styler of this.stylers) styler.schedule();
		this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) return;
			if (view.getMode() === "preview") view.previewMode.rerender(true);
			editorView(view.editor)?.dispatch({ effects: refreshEffect.of(null) });
		});
	}

	// ----- Context: which table, which cell -----

	/** Table context of a Markdown view in editing mode, or null. */
	getContext(view: MarkdownView | null): TableContext | null {
		if (!view || !(view instanceof MarkdownView) || view.getMode() !== "source") return null;
		const cm = editorView(view.editor);
		if (!cm) return null;
		const doc = cm.state.doc;
		const tc = tableCellOf(view);
		let line: number;
		let head: number | null = null;
		let table = null;
		if (tc && tc.table.containerEl.isConnected) {
			table = tc.table;
			line = doc.lineAt(Math.min(table.start, doc.length)).number - 1;
		} else {
			// A Live Preview table has the focus but its cell cannot be read in this Obsidian
			// version: no context rather than a guess at the wrong cell.
			const active = activeDocument.activeElement;
			if (active && cm.contentDOM.contains(active) && active.closest(TABLE_WIDGET)) return null;
			head = cm.state.selection.main.head;
			const l = doc.lineAt(head);
			if (!l.text.includes("|")) return null;
			line = l.number - 1;
		}
		const lines = doc.toString().split("\n");
		const block = findTableAt(lines, line);
		if (!block) return null;
		let row: number;
		let col: number;
		if (tc && table) {
			row = tc.cell.row;
			col = tc.cell.col;
		} else {
			const l = doc.lineAt(head as number);
			row = rowOfLine(block, l.number - 1);
			col = cellIndexAt(l.text, (head as number) - l.from);
		}
		const model = parseTable(lines, block);
		col = Math.max(0, Math.min(col, model.aligns.length - 1));
		row = Math.max(0, Math.min(row, model.rows.length - 1));
		const path = view.file ? view.file.path : null;
		return { view, cm, block, lines, model, row, col, table, path, header: headerKey(lines, block), key: path + ":" + block.start };
	}

	activeContext(): TableContext | null {
		return this.getContext(this.app.workspace.getActiveViewOfType(MarkdownView));
	}

	/** Context of the table holding the keyboard focus. */
	focusedContext(): TableContext | null {
		const ctx = this.activeContext();
		if (!ctx) return null;
		const active = activeDocument.activeElement;
		const holder = ctx.table ? ctx.table.containerEl : ctx.cm.contentDOM;
		return active && holder.contains(active) ? ctx : null;
	}

	/**
	 * Same table, read again from the current document (positions may have moved). Null when the
	 * note, the editor or the table's header changed: a menu or panel left open never acts on
	 * another table.
	 */
	revalidate(ctx: TableContext): TableContext | null {
		const path = ctx.view.file ? ctx.view.file.path : null;
		if (path !== ctx.path || editorView(ctx.view.editor) !== ctx.cm) return null;
		const fresh = this.getContext(ctx.view);
		if (fresh && fresh.key === ctx.key && fresh.header === ctx.header) {
			if (!ctx.pinned) return fresh;
			return {
				...fresh,
				row: Math.min(ctx.row, fresh.model.rows.length - 1),
				col: Math.min(ctx.col, fresh.model.aligns.length - 1),
				pinned: true,
			};
		}
		const lines = ctx.cm.state.doc.toString().split("\n");
		const block = findTableAt(lines, ctx.block.start);
		if (!block || block.start !== ctx.block.start || headerKey(lines, block) !== ctx.header) return null;
		const model = parseTable(lines, block);
		return {
			...ctx,
			lines,
			block,
			model,
			row: Math.min(ctx.row, model.rows.length - 1),
			col: Math.min(ctx.col, model.aligns.length - 1),
		};
	}

	/** Screen rectangle of the table, to place the toolbar and panels. */
	anchorRect(ctx: TableContext): { top: number; bottom: number; left: number; right: number } | null {
		const widget = ctx.table ? ctx.table.containerEl : findTableWidget(ctx.cm, ctx.block.start);
		if (widget && widget.isConnected) return widget.getBoundingClientRect();
		const doc = ctx.cm.state.doc;
		if (ctx.block.start + 1 > doc.lines) return null;
		const coords = ctx.cm.coordsAtPos(doc.line(ctx.block.start + 1).from);
		if (!coords) return null;
		return { top: coords.top, bottom: coords.bottom, left: coords.left, right: coords.left };
	}

	/** Puts the cursor back in a cell after an action (Live Preview), or in the editor. */
	restoreFocus(ctx: TableContext, row: number, col: number): void {
		this.later(() => {
			if (ctx.table && focusCell(ctx.view, ctx.table, row, col)) return;
			ctx.cm.focus();
		}, 0);
	}

	/** The open Markdown view whose editor is `cm`. */
	viewOfEditor(cm: EditorView): MarkdownView | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView && editorView(leaf.view.editor) === cm) return leaf.view;
		}
		return null;
	}

	/** Context of the table around 0-based line `index` of an editor, without any cell focus. */
	contextAtLine(cm: EditorView, index: number): TableContext | null {
		const view = this.viewOfEditor(cm);
		const lines = cm.state.doc.toString().split("\n");
		const block = findTableAt(lines, index);
		if (!view || !block) return null;
		const model = parseTable(lines, block);
		const path = view.file ? view.file.path : null;
		return { view, cm, block, lines, model, row: 0, col: 0, table: null, path, header: headerKey(lines, block), key: path + ":" + block.start };
	}

	/** Context for column `col` of a Live Preview table element, kept even if another cell has the focus. */
	contextForTable(tableEl: HTMLElement, col: number): TableContext | null {
		const widget = tableEl.closest<HTMLElement>(TABLE_WIDGET);
		if (!widget) return null;
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const cm = leaf.view instanceof MarkdownView ? editorView(leaf.view.editor) : null;
			if (!cm || !cm.contentDOM.contains(widget)) continue;
			const line = widgetLine(cm, widget);
			const ctx = line === null ? null : this.contextAtLine(cm, line);
			return ctx ? { ...ctx, col: Math.min(col, ctx.model.aligns.length - 1), pinned: true } : null;
		}
		return null;
	}

	// ----- Editing -----

	/**
	 * Runs `action` on the table of `ctx`. The action is always checked on our own model first
	 * (the header and the last column are protected even where Obsidian's command would allow
	 * it). Then Obsidian's own command when that very cell of a Live Preview table is being
	 * edited (native focus and animation), otherwise our own rewrite.
	 */
	run(ctx: TableContext, action: Action): boolean {
		const fresh = this.revalidate(ctx);
		if (!fresh) {
			new Notice(this.t("notice.changed"));
			return false;
		}
		const meta = fresh.block.metaLine !== null ? metaFromLine(fresh.lines[fresh.block.metaLine]) : null;
		const plan = planAction(action, fresh.model, fresh.row, fresh.col, { keepLast: !!meta?.total, dateOrder: this.dateOrder });
		if (!plan) {
			if (action === "sortAsc" || action === "sortDesc") new Notice(this.t("notice.few-rows"));
			return false;
		}
		const tc = tableCellOf(fresh.view);
		const active = this.app.workspace.getActiveViewOfType(MarkdownView) === fresh.view;
		const editingThisCell = !!fresh.table && !!tc && tc.table === fresh.table && tc.cell.row === fresh.row && tc.cell.col === fresh.col;
		if (active && editingThisCell && runNativeCommand(this.app, action)) {
			this.afterEdit(fresh, action);
			return true;
		}
		this.applyPlan(fresh.cm, fresh.block, plan, false, !fresh.table);
		if (fresh.table) this.restoreFocus(fresh, plan.row, plan.col);
		else fresh.cm.focus();
		this.afterEdit(fresh, action, plan.row);
		return true;
	}

	/** Announces the change to screen readers and flashes the moved row or sorted table. */
	private afterEdit(ctx: TableContext, action: Action, row?: number): void {
		const word = ANNOUNCE[action];
		if (word) this.toolbar.announce(this.t(word));
		const sorted = action === "sortAsc" || action === "sortDesc";
		if (!sorted && !/^row(Above|Below|Duplicate|Up|Down)$/.test(action)) return;
		this.later(() => {
			const widget = findTableWidget(ctx.cm, ctx.block.start);
			const table = widget?.querySelector("table");
			const target = sorted ? table : row !== undefined ? table?.rows[row] : null;
			if (!target) return;
			target.addClass("sk-tables-flash");
			this.later(() => target.removeClass("sk-tables-flash"), 800);
		}, 60);
	}

	/**
	 * Tab / Shift+Tab / Enter in a table of the editor (Source mode, or a table Live Preview
	 * shows as raw text). Returns false to let CodeMirror handle the key.
	 */
	onTableKey(cm: EditorView, dir: "next" | "prev" | "down"): boolean {
		if (!this.ctx.settings.keyboard) return false;
		const sel = cm.state.selection;
		if (sel.ranges.length > 1) return false;
		const head = sel.main.head;
		const line = cm.state.doc.lineAt(head);
		if (!line.text.includes("|")) return false;
		const lines = cm.state.doc.toString().split("\n");
		const block = findTableAt(lines, line.number - 1);
		if (!block) return false;
		const model = parseTable(lines, block);
		const row = Math.min(rowOfLine(block, line.number - 1), model.rows.length - 1);
		const col = Math.min(cellIndexAt(line.text, head - line.from), model.aligns.length - 1);
		// Enter on an empty last row: the row goes and the cursor leaves the table.
		if (dir === "down" && row > 0 && row === model.rows.length - 1 && model.rows[row].every((c) => !c.trim())) {
			const doc = cm.state.doc;
			const last = doc.line(block.end + 1);
			const prev = doc.line(block.end);
			const exit = "\n" + block.prefix;
			const below = block.metaLine !== null ? doc.line(block.metaLine + 1).to : null;
			const removed = last.to - prev.to;
			const changes: Array<{ from: number; to?: number; insert?: string }> = [{ from: prev.to, to: last.to }];
			if (below === null) changes[0].insert = exit;
			else changes.push({ from: below, insert: exit });
			const anchor = below === null ? prev.to + exit.length : below - removed + exit.length;
			cm.dispatch({ changes, selection: { anchor }, scrollIntoView: true, userEvent: "input.table", annotations: isolate() });
			return true;
		}
		const plan = planAction(dir, model, row, col);
		if (!plan) return false;
		this.applyPlan(cm, block, plan, true, true);
		return true;
	}

	/** Writes the planned table over `block` and puts the selection in the planned cell (its whole text when `select`). */
	applyPlan(cm: EditorView, block: Block, plan: Plan, select: boolean, scroll: boolean): void {
		const out = formatTable(plan.model, block.prefix);
		const doc = cm.state.doc;
		const from = doc.line(block.start + 1).from;
		const to = doc.line(block.end + 1).to;
		const index = lineOfRow(plan.row);
		const span = cellSpan(out[index], plan.col);
		let offset = from;
		for (let i = 0; i < index; i++) offset += out[i].length + 1;
		const text = out.join("\n");
		cm.dispatch({
			changes: text === doc.sliceString(from, to) ? undefined : { from, to, insert: text },
			selection: { anchor: offset + (select ? span.from : span.to), head: offset + span.to },
			scrollIntoView: scroll,
			userEvent: "input.table",
			annotations: isolate(),
		});
	}

	openInsertModal(view: MarkdownView): void {
		this.modal?.close();
		this.modal = new InsertTableModal(this, (cols, rows) => this.insertTable(view, cols, rows), () => (this.modal = null));
		this.modal.open();
	}

	insertTable(view: MarkdownView, cols: number, rows: number): void {
		const cm = editorView(view.editor);
		if (!cm) {
			// No CodeMirror access: insert through the public editor API (still one undo step).
			const lines = createTable(cols, rows, this.newTableMeta(), (n) => this.t("insert.header", { n }));
			const cursor = view.editor.getCursor();
			const text = view.editor.getLine(cursor.line);
			view.editor.replaceRange((text.trim() ? "\n\n" : "") + lines.join("\n") + "\n", { line: cursor.line, ch: text.length });
			return;
		}
		const doc = cm.state.doc;
		const line = doc.lineAt(cm.state.selection.main.head);
		const lines = createTable(cols, rows, this.newTableMeta(), (n) => this.t("insert.header", { n }));
		const empty = !line.text.trim();
		const before = empty ? (line.number > 1 && doc.line(line.number - 1).text.trim() ? "\n" : "") : "\n\n";
		const next = line.number < doc.lines ? doc.line(line.number + 1).text : "";
		const after = next.trim() ? "\n\n" : "\n";
		const from = empty ? line.from : line.to;
		const insert = before + lines.join("\n") + after;
		const headerStart = from + before.length;
		const span = cellSpan(lines[0], 0);
		cm.dispatch({ changes: { from, to: line.to, insert }, scrollIntoView: true, userEvent: "input.table", annotations: isolate() });
		// A second transaction, like Obsidian's own Insert table: the Live Preview table now
		// exists and turns this selection into a cell focus.
		cm.dispatch({ selection: { anchor: headerStart + span.from, head: headerStart + span.to } });
		cm.focus();
	}

	// ----- Style -----

	/** The style comment of the table of `ctx`, edited through the editor (one undo step per change). */
	editorTarget(ctx: TableContext): StyleTarget {
		let block = ctx.block;
		const target: StyleTarget = {
			meta: block.metaLine !== null ? metaFromLine(ctx.lines[block.metaLine]) : null,
			tables: () => {
				const widget = ctx.table && ctx.table.containerEl.isConnected ? ctx.table.containerEl : findTableWidget(ctx.cm, block.start);
				const table = widget?.querySelector("table");
				return table ? [table] : [];
			},
			commit: (next) => {
				const doc = ctx.cm.state.doc;
				const lines = doc.toString().split("\n");
				const current = findTableAt(lines, block.start);
				const path = ctx.view.file ? ctx.view.file.path : null;
				if (!current || current.start !== block.start || path !== ctx.path || editorView(ctx.view.editor) !== ctx.cm || headerKey(lines, current) !== ctx.header) {
					new Notice(this.t("notice.changed"));
					this.stylePanel?.close(false);
					return;
				}
				const res = withMeta(lines, current, next);
				const lastRow = doc.line(current.end + 1);
				let changes: { from: number; to?: number; insert?: string } | null = null;
				if (current.metaLine !== null && next) {
					const ml = doc.line(current.metaLine + 1);
					changes = { from: ml.from, to: ml.to, insert: res.lines[current.metaLine] };
				} else if (current.metaLine !== null) {
					changes = { from: lastRow.to, to: doc.line(current.metaLine + 1).to };
				} else if (next && res.block.metaLine !== null) {
					changes = { from: lastRow.to, insert: "\n" + res.lines[res.block.metaLine] };
				}
				if (changes) ctx.cm.dispatch({ changes, userEvent: "input.table-style", annotations: isolate() });
				block = res.block;
				target.meta = next;
			},
			restoreFocus: () => this.restoreFocus(ctx, ctx.row, ctx.col),
		};
		return target;
	}

	openStylePanel(ctx: TableContext, rect: { top: number; bottom: number; left: number }, focus: boolean): void {
		this.stylePanel?.close(false);
		this.stylePanel = new StylePanel(this, this.editorTarget(ctx));
		this.stylePanel.open(rect, focus);
	}

	/** From the Live Preview chip on 1-based line `line` (just below the table). */
	openStylePanelAt(cm: EditorView, line: number, rect: DOMRect, focus: boolean): void {
		const ctx = this.contextAtLine(cm, line - 2);
		if (ctx) this.openStylePanel(ctx, rect, focus);
	}

	/** Saves the column widths of a Live Preview table in its style comment. */
	commitWidths(tableEl: HTMLElement, widths: number[]): void {
		const ctx = this.contextForTable(tableEl, 0);
		if (!ctx) return;
		const target = this.editorTarget(ctx);
		const base = target.meta ?? { ...defaultMeta(), ...(this.defaultMeta() ?? { style: "none" }) };
		target.commit({ ...base, widths });
	}

	/** Reading view: styles every rendered table from its comment. */
	styleReading(el: HTMLElement, mdCtx: MarkdownPostProcessorContext): void {
		const tables = el.findAll("table");
		if (!tables.length) return;
		const info = mdCtx.getSectionInfo(el);
		let lines: string[] = [];
		let blocks: Block[] = [];
		if (info) {
			lines = info.text.split(/\r?\n/);
			blocks = findAllTables(lines, info.lineStart, info.lineEnd);
		}
		tables.forEach((table, i) => {
			const block = blocks.length === tables.length ? blocks[i] : null;
			const meta = block && block.metaLine !== null ? metaFromLine(lines[block.metaLine]) : null;
			applyMeta(table, meta ?? this.defaultMeta());
		});
	}

	// ----- Menus -----

	columnName(ctx: TableContext): string {
		return plainText(ctx.model.rows[0][ctx.col]) || this.t("menu.column", { n: ctx.col + 1 });
	}

	sortDirections(ctx: TableContext): { asc: string; desc: string } {
		const kind = columnKind(ctx.model.rows.slice(1).map((r) => r[ctx.col]), this.dateOrder);
		return { asc: this.t(`sort.${kind}.asc`), desc: this.t(`sort.${kind}.desc`) };
	}

	private add(menu: Menu, title: string, icon: string, run: () => unknown, disabled = false, checked?: boolean): void {
		menu.addItem((item) => {
			item.setTitle(title).setIcon(icon).setDisabled(disabled).onClick(() => void run());
			if (checked !== undefined) item.setChecked(checked);
		});
	}

	fillRowMenu(menu: Menu, ctx: TableContext): void {
		const header = ctx.row === 0;
		const last = ctx.row === ctx.model.rows.length - 1;
		const act = (id: string, action: Action, icon: string, disabled = false) =>
			this.add(menu, this.t("command." + id), icon, () => this.run(ctx, action), disabled);
		act("row-above", "rowAbove", "panel-top-close", header);
		act("row-below", "rowBelow", "panel-bottom-close");
		act("row-duplicate", "rowDuplicate", "copy", header);
		menu.addSeparator();
		act("row-up", "rowUp", "arrow-up", ctx.row < 2);
		act("row-down", "rowDown", "arrow-down", header || last);
		menu.addSeparator();
		act("row-delete", "rowDelete", "trash-2", header);
	}

	fillSortMenu(menu: Menu, ctx: TableContext): void {
		const name = this.columnName(ctx);
		const dirs = this.sortDirections(ctx);
		const few = ctx.model.rows.length < 3;
		this.add(menu, this.t("menu.sort", { name, direction: dirs.asc }), "arrow-down-narrow-wide", () => this.run(ctx, "sortAsc"), few);
		this.add(menu, this.t("menu.sort", { name, direction: dirs.desc }), "arrow-down-wide-narrow", () => this.run(ctx, "sortDesc"), few);
	}

	fillColumnMenu(menu: Menu, ctx: TableContext): void {
		const cols = ctx.model.aligns.length;
		const align = ctx.model.aligns[ctx.col];
		const act = (title: string, action: Action, icon: string, disabled = false, checked?: boolean) =>
			this.add(menu, title, icon, () => this.run(ctx, action), disabled, checked);
		this.fillSortMenu(menu, ctx);
		menu.addSeparator();
		act(this.t("command.col-left"), "colLeft", "panel-left-close");
		act(this.t("command.col-right"), "colRight", "panel-right-close");
		act(this.t("command.col-duplicate"), "colDuplicate", "copy");
		menu.addSeparator();
		act(this.t("command.col-move-left"), "colMoveLeft", "arrow-left", ctx.col < 1);
		act(this.t("command.col-move-right"), "colMoveRight", "arrow-right", ctx.col >= cols - 1);
		menu.addSeparator();
		act(this.t("menu.align-left"), "alignLeft", "align-left", false, align === "left" || align === null);
		act(this.t("menu.align-center"), "alignCenter", "align-center", false, align === "center");
		act(this.t("menu.align-right"), "alignRight", "align-right", false, align === "right");
		menu.addSeparator();
		act(this.t("command.col-delete"), "colDelete", "trash-2", cols < 2);
	}

	fillMoreMenu(menu: Menu, ctx: TableContext): void {
		this.add(menu, this.t("command.format"), "wand-2", () => this.run(ctx, "format"));
		this.add(menu, this.t("command.copy-csv"), "clipboard-copy", () => this.copyCsv(ctx));
		menu.addSeparator();
		this.add(menu, this.t("command.delete-table"), "trash-2", () => this.deleteTable(ctx));
	}

	async copyCsv(ctx: TableContext): Promise<void> {
		const fresh = this.revalidate(ctx);
		if (!fresh) return;
		await navigator.clipboard.writeText(toCsv(fresh.model));
		this.ctx.toast(this.t("notice.csv"));
	}

	/** Removes the table and its style comment, as one undo step. */
	deleteTable(ctx: TableContext): void {
		const fresh = this.revalidate(ctx);
		if (!fresh) return;
		const doc = fresh.cm.state.doc;
		const last = fresh.block.metaLine !== null ? fresh.block.metaLine : fresh.block.end;
		const from = doc.line(fresh.block.start + 1).from;
		const to = Math.min(doc.length, doc.line(last + 1).to + 1);
		this.toolbar.hide();
		fresh.cm.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: "delete.table", annotations: isolate() });
		fresh.cm.focus();
	}

	/** Rewrites every table of the note, as one undo step. */
	formatAll(view: MarkdownView): void {
		const cm = editorView(view.editor);
		if (!cm) return;
		const doc = cm.state.doc;
		const lines = doc.toString().split("\n");
		const changes: Array<{ from: number; to: number; insert: string }> = [];
		for (const block of findAllTables(lines)) {
			const text = formatTable(parseTable(lines, block), block.prefix).join("\n");
			const from = doc.line(block.start + 1).from;
			const to = doc.line(block.end + 1).to;
			if (text !== doc.sliceString(from, to)) changes.push({ from, to, insert: text });
		}
		if (changes.length) cm.dispatch({ changes, userEvent: "input.table", annotations: isolate() });
		this.ctx.toast(changes.length ? this.ctx.tn("notice.formatted", changes.length) : this.t("notice.already"));
	}

	onEditorMenu(menu: Menu, view: unknown): void {
		if (!(view instanceof MarkdownView)) return;
		const ctx = this.getContext(view);
		if (!ctx) {
			menu.addItem((item) => item.setSection("insert").setTitle(this.t("menu.insert")).setIcon("table").onClick(() => this.openInsertModal(view)));
			return;
		}
		const dirs = this.sortDirections(ctx);
		const item = (title: string, icon: string, run: () => void) =>
			menu.addItem((it) => it.setSection("action").setTitle(title).setIcon(icon).onClick(run));
		item(this.t("menu.sort-column", { direction: dirs.asc }), "arrow-down-narrow-wide", () => this.run(ctx, "sortAsc"));
		item(this.t("menu.sort-column", { direction: dirs.desc }), "arrow-down-wide-narrow", () => this.run(ctx, "sortDesc"));
		item(this.t("menu.style"), "palette", () => this.openStylePanel(ctx, this.anchorRect(ctx) ?? { top: 100, bottom: 100, left: 100 }, false));
	}

	// ----- Commands -----

	registerCommands(): void {
		const { ctx } = this;
		const whenInTable = (id: string, icon: string, run: (table: TableContext) => unknown) =>
			ctx.addCommand({
				id,
				name: this.t("command." + id),
				icon,
				checkCallback: (checking) => {
					const table = this.activeContext();
					if (!table) return false;
					if (!checking) void run(table);
					return true;
				},
			});
		ctx.addCommand({
			id: "insert",
			name: this.t("command.insert"),
			icon: "table",
			editorCallback: (_editor, view) => {
				if (view instanceof MarkdownView) this.openInsertModal(view);
			},
		});
		whenInTable("style", "palette", (table) => this.openStylePanel(table, this.anchorRect(table) ?? { top: 100, bottom: 100, left: 100 }, true));
		whenInTable("focus", "rows-3", () => this.toolbar.focus());
		for (const [id, action, icon] of ACTION_COMMANDS) whenInTable(id, icon, (table) => this.run(table, action));
		whenInTable("copy-csv", "clipboard-copy", (table) => this.copyCsv(table));
		whenInTable("delete-table", "trash-2", (table) => this.deleteTable(table));
		ctx.addCommand({
			id: "format-all",
			name: this.t("command.format-all"),
			icon: "wand-2",
			editorCallback: (_editor, view) => {
				if (view instanceof MarkdownView) this.formatAll(view);
			},
		});
	}
}
