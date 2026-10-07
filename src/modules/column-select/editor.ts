import { EditorSelection, EditorState, StateField, StateEffect, Prec, type Extension, type AnnotationType } from "@codemirror/state";
import { EditorView, keymap, layer, RectangleMarker, ViewPlugin, type KeyBinding } from "@codemirror/view";
import { Platform } from "obsidian";
import { isolateHistory as historyIsolation } from "@codemirror/commands";
import type { ModuleContext } from "../../core/context";
import type { ColumnSelectSettings } from "./types";
import {
	columnOf, lineWidth, boxBounds, boxRows, boxSelection, needsVirtualSpace,
	deriveBox, moveBox, splitClipboard, pickPasteLines, planRowInsert, planBoxDelete,
	copyText, insideTab, type Box, type Direction, type Edit, type InsertRow,
} from "./logic";

// Obsidian supplies one shared CodeMirror instance; local command typings may resolve a second copy.
const isolateHistory = historyIsolation as unknown as AnnotationType<"full">;

function cursorEdge(cm: EditorView, end: boolean): boolean {
	if (cm.composing || (!currentBox(cm.state) && cm.state.selection.ranges.length < 2)) return false;
	const ranges = cm.state.selection.ranges.map((r) => {
		const line = cm.state.doc.lineAt(r.head);
		return EditorSelection.cursor(end ? line.to : line.from);
	});
	cm.dispatch({ selection: EditorSelection.create(ranges, cm.state.selection.mainIndex), effects: setBox.of(null), scrollIntoView: true, userEvent: "select" });
	return true;
}

export const setBox = StateEffect.define<Box | null>();

function selectionRows(state: EditorState) {
	const tab = state.tabSize;
	const rows = [];
	for (const r of state.selection.ranges) {
		const line = state.doc.lineAt(r.anchor);
		if (r.head < line.from || r.head > line.to) return null;
		rows.push({
			line: line.number,
			anchorCol: columnOf(line.text, r.anchor - line.from, tab),
			headCol: columnOf(line.text, r.head - line.from, tab),
		});
	}
	return rows;
}

// The box currently on screen, kept per editor state. Our own commands set it
// explicitly (it can hold virtual columns); any other change of selection or
// text rebuilds it from the selection, or drops it.
export const boxField = StateField.define<Box | null>({
	create: () => null,
	update(value, tr) {
		for (const e of tr.effects) if (e.is(setBox)) return e.value;
		if (!tr.docChanged && !tr.selection) return value;
		const rows = selectionRows(tr.state);
		return rows ? deriveBox(rows, tr.state.selection.mainIndex) : null;
	},
});

function currentBox(state: EditorState) {
	return state.field(boxField, false) || null;
}

// A box starting from the current selection when none is active: the main
// range if it sits on one line, its head otherwise.
function boxFromSelection(state: EditorState) {
	const box = currentBox(state);
	if (box) return box;
	const tab = state.tabSize;
	const main = state.selection.main;
	const headLine = state.doc.lineAt(main.head);
	const headCol = columnOf(headLine.text, main.head - headLine.from, tab);
	const anchorLine = state.doc.lineAt(main.anchor);
	if (anchorLine.number !== headLine.number) {
		return { anchorLine: headLine.number, anchorCol: headCol, headLine: headLine.number, headCol };
	}
	return {
		anchorLine: headLine.number,
		anchorCol: columnOf(anchorLine.text, main.anchor - anchorLine.from, tab),
		headLine: headLine.number,
		headCol,
	};
}

function toSelection(sel: ReturnType<typeof boxSelection>) {
	return EditorSelection.create(
		sel.ranges.map((r) => EditorSelection.range(r.anchor, r.head)),
		sel.mainIndex
	);
}

function dispatchBox(cm: EditorView, box: Box, userEvent: string) {
	cm.dispatch({
		selection: toSelection(boxSelection(cm.state.doc, box, cm.state.tabSize)),
		effects: setBox.of(box),
		scrollIntoView: true,
		userEvent,
	});
}

// Apply change specs, then select `box` in the new document.
function dispatchEditWithBox(cm: EditorView, specs: Edit[], box: Box, userEvent: string) {
	const state = cm.state;
	const changes = state.changes(specs);
	const doc = changes.apply(state.doc);
	cm.dispatch({
		changes,
		annotations: isolateHistory.of("full"),
		selection: toSelection(boxSelection(doc, box, state.tabSize)),
		effects: setBox.of(box),
		scrollIntoView: true,
		userEvent,
	});
}

function extendBox(cm: EditorView, dir: Direction) {
	const state = cm.state;
	dispatchBox(cm, moveBox(state.doc, boxFromSelection(state), dir, state.tabSize), "select.column");
	return true;
}

// Only take over from CodeMirror when the box needs virtual space.
function activeVirtualBox(state: EditorState) {
	const box = currentBox(state);
	return box && needsVirtualSpace(state.doc, box, state.tabSize) ? box : null;
}

function deleteInBox(cm: EditorView, forward: boolean) {
	const state = cm.state;
	const box = currentBox(state);
	if (!box || state.readOnly || cm.composing) return false;
	const plan = planBoxDelete(state.doc, box, forward, state.tabSize);
	dispatchEditWithBox(cm, plan.changes, plan.box, forward ? "delete.forward" : "delete.backward");
	return true;
}

// Cursor after each inserted text; CodeMirror rebuilds the box from them.
function dispatchRowInsert(cm: EditorView, rows: InsertRow[], texts: string[], left: number | null, userEvent: string) {
	const state = cm.state;
	const changes = state.changes(planRowInsert(rows, texts, left));
	const ranges = rows.map((r) => {
		const trailing = left != null && insideTab(r, left) ? (r.startCol ?? 0) - left : 0;
		return EditorSelection.cursor(changes.mapPos(r.to, 1) - trailing);
	});
	cm.dispatch({
		changes,
		annotations: isolateHistory.of("full"),
		selection: EditorSelection.create(ranges, Math.min(state.selection.mainIndex, ranges.length - 1)),
		scrollIntoView: true,
		userEvent,
	});
}

function rangeRows(state: EditorState) {
	const tab = state.tabSize;
	return state.selection.ranges.map((r) => {
		const line = state.doc.lineAt(r.from);
		return { from: r.from, to: r.to, lineTo: line.to, endCol: lineWidth(line.text, tab) };
	});
}

export class ColumnSelectEditor {
	private lastBlock: { text: string; rows: string[] } | null = null;
	private cancelDrag: (() => void) | null = null;
	private views = new Set<EditorView>();

	constructor(private ctx: ModuleContext<ColumnSelectSettings>) {
		ctx.register(() => {
			this.cancelDrag?.();
			this.lastBlock = null;
			for (const cm of this.views) {
				cm.dom.classList.remove("sk-column-select-alt");
				cm.dispatch({ selection: EditorSelection.cursor(cm.state.selection.main.head), effects: setBox.of(null) });
			}
		});
		ctx.registerEditorExtension(this.buildExtension());
		ctx.onSettingsChange(() => {
			if (!ctx.settings.mouse) {
				this.cancelDrag?.();
				for (const cm of this.views) cm.dom.classList.remove("sk-column-select-alt");
			}
		});
		for (const dir of ["up", "down", "left", "right"] as const) {
			ctx.addCommand({
				id: `extend-column-${dir}`,
				name: ctx.t(`command.${dir}`),
				editorCallback: (editor) => {
					const cm = (editor as unknown as { cm?: EditorView }).cm;
					if (cm && !Platform.isMobile && !cm.composing) extendBox(cm, dir);
				},
			});
		}
	}

	buildExtension() {
		const keys: KeyBinding[] = ([
			["Alt-Shift-ArrowUp", "up"],
			["Alt-Shift-ArrowDown", "down"],
			["Alt-Shift-ArrowLeft", "left"],
			["Alt-Shift-ArrowRight", "right"],
		] as const).map(([key, dir]) => ({
			key,
			run: (cm) => !Platform.isMobile && !cm.composing && this.ctx.settings.keyboard && extendBox(cm, dir),
		}));
		keys.push(
			{ key: "Home", run: (cm) => cursorEdge(cm, false) },
			{ key: "End", run: (cm) => cursorEdge(cm, true) },
			{ key: "Backspace", run: (cm) => deleteInBox(cm, false) },
			{ key: "Delete", run: (cm) => deleteInBox(cm, true) },
			{
				key: "Escape",
				run: (cm) => {
					if (cm.composing) return false;
					if (cm.state.selection.ranges.length < 2 && !currentBox(cm.state)) return false;
					cm.dispatch({ selection: EditorSelection.cursor(cm.state.selection.main.head), effects: setBox.of(null) });
					return true;
				},
			}
		);

		const extensions: Extension[] = [
			EditorState.allowMultipleSelections.of(true),
			ViewPlugin.define((cm) => {
				this.views.add(cm);
				return { destroy: () => { this.cancelDrag?.(); this.views.delete(cm); cm.dom.classList.remove("sk-column-select-alt"); } };
			}),
			boxField,
			Prec.highest(keymap.of(keys)),
			Prec.highest(EditorView.inputHandler.of((cm, from, to, text) => this.handleInput(cm, from, to, text))),
			Prec.highest(
				EditorView.domEventHandlers({
					mousedown: (event, cm) => this.handleMouseDown(event, cm),
					mousemove: (event, cm) => {
						cm.dom.classList.toggle("sk-column-select-alt", !!(event.altKey && this.ctx.settings.mouse));
						return false;
					},
					mouseleave: (event, cm) => {
						cm.dom.classList.remove("sk-column-select-alt");
						return false;
					},
					copy: (event, cm) => this.handleCopy(event, cm, false),
					cut: (event, cm) => this.handleCopy(event, cm, true),
					paste: (event, cm) => this.handlePaste(event, cm),
				})
			),
		];
		const virtual = virtualSpaceLayer();
		if (virtual) extensions.push(virtual);
		return extensions;
	}

	// Typing into a box with rows that end before it: pad them, then insert.
	// Only plain typing over the main range; any other replacement (spell
	// check, autocorrect) is left to CodeMirror.
	handleInput(cm: EditorView, from: number, to: number, text: string) {
		const state = cm.state;
		if (cm.composing || state.readOnly || /[\r\n]/.test(text)) return false;
		if (from !== state.selection.main.from || to !== state.selection.main.to) return false;
		const box = activeVirtualBox(state);
		if (!box) return false;
		const { left } = boxBounds(box);
		const rows = boxRows(state.doc, box, state.tabSize);
		const col = lineWidth(" ".repeat(left) + text, state.tabSize);
		dispatchEditWithBox(cm, planRowInsert(rows, rows.map(() => text), left), Object.assign({}, box, { anchorCol: col, headCol: col }), "input.type");
		return true;
	}

	// Several ranges, or a box with a width (even one lying entirely in
	// virtual space, where CodeMirror would copy or cut whole lines).
	handleCopy(event: ClipboardEvent, cm: EditorView, cut: boolean) {
		if (cm.composing) return false;
		const state = cm.state;
		const ranges = state.selection.ranges;
		const box = currentBox(state);
		const wideBox = box && boxBounds(box).right > boxBounds(box).left;
		if (!event.clipboardData) return false;
		if (!wideBox && (ranges.length < 2 || ranges.every((r) => r.empty))) return false;
		const rows = ranges.map((r) => state.doc.sliceString(r.from, r.to));
		const text = copyText(state.doc, ranges);
		event.clipboardData.clearData();
		event.clipboardData.setData("text/plain", text);
		event.preventDefault();
		this.lastBlock = { text, rows };
		if (cut && !state.readOnly) {
			if (box) {
				const plan = planBoxDelete(state.doc, box, false, state.tabSize);
				dispatchEditWithBox(cm, plan.changes, plan.box, "delete.cut");
			} else {
				cm.dispatch({ changes: ranges.map((r) => ({ from: r.from, to: r.to })), annotations: isolateHistory.of("full"), scrollIntoView: true, userEvent: "delete.cut" });
			}
		}
		return true;
	}

	// The clipboard as rows: the exact rows of our last copy when it is that
	// text, split into lines otherwise.
	isLastBlock(text: string) {
		return this.lastBlock != null && text.replace(/\r\n/g, "\n") === this.lastBlock.text;
	}

	clipboardRows(text: string) {
		return this.lastBlock && this.isLastBlock(text) ? this.lastBlock.rows : splitClipboard(text);
	}

	handlePaste(event: ClipboardEvent, cm: EditorView) {
		const text = event.clipboardData && event.clipboardData.getData("text/plain");
		const state = cm.state;
		if (!text || state.readOnly || cm.composing) return false;
		if (state.selection.ranges.length > 1) {
			if (!this.ctx.settings.distributePaste) return false;
			event.preventDefault();
			this.distributePaste(cm, this.clipboardRows(text));
			return true;
		}
		return false;
	}

	distributePaste(cm: EditorView, lines: string[]) {
		const state = cm.state;
		const box = currentBox(state);
		const rows = box ? boxRows(state.doc, box, state.tabSize) : rangeRows(state);
		const { picked, dropped } = pickPasteLines(lines, rows.length);
		dispatchRowInsert(cm, rows, picked, box ? boxBounds(box).left : null, "input.paste");
		if (dropped) this.ctx.toast(this.ctx.tn("paste.dropped", dropped));
	}

	// Alt+drag draws a box, Alt+Shift+click or drag extends the current one.
	// A plain Alt+click keeps Obsidian's behavior (add a cursor) and removes a
	// cursor when clicked again.
	handleMouseDown(event: MouseEvent, cm: EditorView) {
		if (Platform.isMobile || cm.composing || !this.ctx.settings.mouse || event.button !== 0 || !event.altKey || event.ctrlKey || event.metaKey) return false;
		const start = cellAt(cm, event);
		if (!start) return false;
		if (this.cancelDrag) this.cancelDrag();
		event.preventDefault();
		cm.focus();
		const state = cm.state;
		const base = state.selection;
		const baseDoc = state.doc;
		let anchor: { line: number; col: number } = start;
		let moved = false;
		if (event.shiftKey) {
			const box = boxFromSelection(state);
			anchor = { line: box.anchorLine, col: box.anchorCol };
			moved = true;
		}
		const show = (cell: { line: number; col: number }) => dispatchBox(cm, { anchorLine: anchor.line, anchorCol: anchor.col, headLine: cell.line, headCol: cell.col }, "select.pointer");
		if (moved) show(start);

		const doc = cm.dom.ownerDocument;
		const win = doc.defaultView;
		// Stops listening without finishing the gesture (editor closed, window
		// left, plugin unloaded, new gesture).
		const cancel = () => {
			doc.removeEventListener("mousemove", onMove);
			doc.removeEventListener("mouseup", onUp);
			if (win) win.removeEventListener("blur", cancel);
			if (this.cancelDrag === cancel) this.cancelDrag = null;
		};
		const onMove = (e: MouseEvent) => {
			if (!cm.dom.isConnected || cm.state.doc !== baseDoc) return cancel();
			if (!(e.buttons & 1)) return onUp();
			const cell = cellAt(cm, e);
			if (!cell) return;
			if (!moved && cell.line === start.line && cell.col === start.col) return;
			moved = true;
			show(cell);
		};
		const onUp = () => {
			cancel();
			if (moved || !cm.dom.isConnected || cm.state.doc !== baseDoc) return;
			const existing = base.ranges.findIndex((r) => r.empty && r.head === start.pos);
			let selection;
			if (existing >= 0 && base.ranges.length > 1) {
				const ranges = base.ranges.filter((r, i) => i !== existing);
				selection = EditorSelection.create(ranges, Math.min(base.mainIndex, ranges.length - 1));
			} else {
				selection = base.addRange(EditorSelection.cursor(start.pos));
			}
			cm.dispatch({ selection, effects: setBox.of(null), userEvent: "select.pointer" });
		};
		doc.addEventListener("mousemove", onMove);
		doc.addEventListener("mouseup", onUp);
		if (win) win.addEventListener("blur", cancel);
		this.cancelDrag = cancel;
		return true;
	}
}

// Line and column under the pointer, the column counted in virtual space
// when the pointer is right of the end of the line.
function cellAt(cm: EditorView, event: MouseEvent) {
	const pos = cm.posAtCoords({ x: event.clientX, y: event.clientY }, false);
	if (pos == null) return null;
	const line = cm.state.doc.lineAt(pos);
	const tab = cm.state.tabSize;
	let col = columnOf(line.text, pos - line.from, tab);
	if (pos === line.to) {
		const end = cm.coordsAtPos(line.to, -1);
		if (end && event.clientX > end.right) {
			col = lineWidth(line.text, tab) + Math.round((event.clientX - end.right) / cm.defaultCharacterWidth);
		}
	}
	return { line: line.number, col, pos };
}

// Draws the part of the box that lies past the end of short lines, where
// CodeMirror has nothing to select: a shaded band, or a thin caret for a
// zero-width box. The layer is removed together with the editor extension.
function virtualSpaceLayer() {
	return layer({
		above: false,
		class: "sk-column-select-virtual",
		update: (update) =>
			update.docChanged ||
			update.selectionSet ||
			update.viewportChanged ||
			update.geometryChanged ||
			update.startState.field(boxField, false) !== update.state.field(boxField, false),
		markers(cm) {
			const box = currentBox(cm.state);
			if (!box) return [];
			const { top, bottom, left, right } = boxBounds(box);
			const tab = cm.state.tabSize;
			const width = cm.defaultCharacterWidth;
			const rect = cm.scrollDOM.getBoundingClientRect();
			const baseLeft = rect.left - cm.scrollDOM.scrollLeft;
			const baseTop = rect.top - cm.scrollDOM.scrollTop;
			const markers = [];
			for (let n = top; n <= bottom; n++) {
				const line = cm.state.doc.line(n);
				if (line.to < cm.viewport.from || line.from > cm.viewport.to) continue;
				const endCol = lineWidth(line.text, tab);
				if (endCol >= right && !(left === right && endCol < left)) continue;
				const end = cm.coordsAtPos(line.to, -1);
				if (!end) continue;
				const x = (c: number) => end.right + (c - endCol) * width - baseLeft;
				const y = end.top - baseTop;
				const h = end.bottom - end.top;
				if (left === right) {
					markers.push(new RectangleMarker("sk-column-select-caret", x(left), y, 2, h));
				} else {
					const x0 = x(Math.max(left, endCol));
					markers.push(new RectangleMarker("sk-column-select-band", x0, y, x(right) - x0, h));
				}
			}
			return markers;
		},
	});
}
