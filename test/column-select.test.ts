import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState, EditorSelection, Transaction, StateEffect, type Extension, type Text, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { Command } from "obsidian";
import type { ModuleContext } from "../src/core/context";
import type { ColumnSelectSettings } from "../src/modules/column-select/types";
import { ColumnSelectEditor, boxField, setBox } from "../src/modules/column-select/editor";
import * as t from "../src/modules/column-select/logic";

function makeDoc(text: string): Text {
	return EditorState.create({ doc: text }).doc;
}
function applyChanges(text: string, specs: t.Edit[]): string {
	const state = EditorState.create({ doc: text });
	return state.update({ changes: specs }).state.doc.toString();
}
const box = (anchorLine: number, anchorCol: number, headLine: number, headCol: number): t.Box => ({ anchorLine, anchorCol, headLine, headCol });

test("columns: plain text, empty text and past the end", () => {
	assert.strictEqual(t.columnOf("abcd", 2, 4), 2);
	assert.strictEqual(t.columnOf("abcd", 20, 4), 4);
	assert.strictEqual(t.lineWidth("abcd", 4), 4);
	assert.strictEqual(t.lineWidth("", 4), 0);
	assert.strictEqual(t.indexOfColumn("abcd", 0, 4), 0);
	assert.strictEqual(t.indexOfColumn("abcd", 2, 4), 2);
	assert.strictEqual(t.indexOfColumn("abcd", 20, 4), 4);
	assert.strictEqual(t.indexOfColumn("", 3, 4), 0);
});

test("columns: tabs reach the next tab stop and indexes round up", () => {
	assert.strictEqual(t.columnOf("\tab", 1, 4), 4);
	assert.strictEqual(t.lineWidth("\tab", 4), 6);
	assert.strictEqual(t.indexOfColumn("\tab", 2, 4), 1);
	assert.strictEqual(t.indexOfColumn("\tab", 4, 4), 1);
	assert.strictEqual(t.indexOfColumn("\tab", 5, 4), 2);
	assert.strictEqual(t.indexOfColumn("\tab", 20, 4), 3);
	assert.strictEqual(t.columnOf("a\tb\tc", 4, 4), 8);
	assert.strictEqual(t.lineWidth("a\tb\tc", 4), 9);
	assert.strictEqual(t.lineWidth("a\tb", 8), 9);
	assert.strictEqual(t.indexOfColumn("a\tb", 7, 8), 2);
});

test("boxRows and boxSelection: forward, reversed and clipped rows", () => {
	const doc = makeDoc("abcdef\na\nuvwxyz");
	const forward = box(1, 2, 3, 5);
	const keys = ["line", "lineFrom", "lineTo", "from", "to", "anchor", "head", "endCol"];
	const pick = (r: ReturnType<typeof t.boxRows>[number]) => Object.fromEntries(keys.map((k) => [k, r[k as keyof typeof r]]));
	assert.deepStrictEqual(t.boxRows(doc, forward, 4).map(pick), [
		{ line: 1, lineFrom: 0, lineTo: 6, from: 2, to: 5, anchor: 2, head: 5, endCol: 6 },
		{ line: 2, lineFrom: 7, lineTo: 8, from: 8, to: 8, anchor: 8, head: 8, endCol: 1 },
		{ line: 3, lineFrom: 9, lineTo: 15, from: 11, to: 14, anchor: 11, head: 14, endCol: 6 },
	]);
	assert.deepStrictEqual(t.boxSelection(doc, forward, 4), {
		ranges: [{ anchor: 2, head: 5 }, { anchor: 8, head: 8 }, { anchor: 11, head: 14 }], mainIndex: 2,
	});
	assert.deepStrictEqual(t.boxSelection(doc, box(3, 5, 1, 2), 4), {
		ranges: [{ anchor: 5, head: 2 }, { anchor: 8, head: 8 }, { anchor: 14, head: 11 }], mainIndex: 0,
	});
	assert.deepStrictEqual(t.boxBounds(box(3, 5, 1, 2)), { top: 1, bottom: 3, left: 2, right: 5 });
});

test("needsVirtualSpace: strictly shorter than the left edge, within selected rows", () => {
	const doc = makeDoc("abcd\nab\n");
	assert.strictEqual(t.needsVirtualSpace(doc, box(1, 2, 2, 8), 4), false);
	assert.strictEqual(t.needsVirtualSpace(doc, box(1, 3, 2, 3), 4), true);
	assert.strictEqual(t.needsVirtualSpace(doc, box(2, 8, 1, 3), 4), true);
	assert.strictEqual(t.needsVirtualSpace(doc, box(1, 0, 3, 5), 4), false);
	assert.strictEqual(t.needsVirtualSpace(makeDoc("\t\nabcd"), box(1, 4, 2, 9), 4), false);
});

test("deriveBox: main row first or last chooses the opposite anchor, inner main gives null", () => {
	const rows = [2, 3, 4].map((line) => ({ line, anchorCol: 2, headCol: 5 }));
	assert.deepStrictEqual(t.deriveBox(rows, 0), box(4, 2, 2, 5));
	assert.strictEqual(t.deriveBox(rows, 1), null);
	assert.deepStrictEqual(t.deriveBox(rows, 2), box(2, 2, 4, 5));
	assert.deepStrictEqual(t.deriveBox(rows.map((r) => ({ ...r, anchorCol: 5, headCol: 2 })), 2), box(2, 5, 4, 2));
});

test("deriveBox: rejects gaps, differing columns and fewer than two rows", () => {
	const row = { line: 1, anchorCol: 2, headCol: 5 };
	assert.strictEqual(t.deriveBox([], 0), null);
	assert.strictEqual(t.deriveBox([row], 0), null);
	assert.strictEqual(t.deriveBox([row, { ...row, line: 3 }], 0), null);
	assert.strictEqual(t.deriveBox([row, { ...row, line: 2, anchorCol: 3 }], 0), null);
	assert.strictEqual(t.deriveBox([row, { ...row, line: 2, headCol: 6 }], 0), null);
});

test("steps: tabs, real characters, virtual space and column zero", () => {
	for (const [col, left, right] of [[0, 0, 4], [2, 0, 4], [4, 0, 5], [5, 4, 6], [6, 5, 7], [7, 6, 8], [9, 8, 10]]) {
		assert.strictEqual(t.stepLeft("\tab", col, 4), left, `left from ${col}`);
		assert.strictEqual(t.stepRight("\tab", col, 4), right, `right from ${col}`);
	}
	assert.strictEqual(t.stepRight("a\tb", 1, 8), 8);
	assert.strictEqual(t.stepLeft("a\tb", 8, 8), 1);
	assert.strictEqual(t.stepLeft("", 1, 4), 0);
	assert.strictEqual(t.stepRight("", 0, 4), 1);
});

test("moveBox: moves only the head and clamps document and column boundaries", () => {
	const doc = makeDoc("\tab\nab\ncd");
	const original = box(2, 2, 1, 0);
	assert.deepStrictEqual(t.moveBox(doc, original, "up", 4), original);
	assert.deepStrictEqual(t.moveBox(doc, original, "left", 4), original);
	assert.deepStrictEqual(t.moveBox(doc, original, "down", 4), box(2, 2, 2, 0));
	assert.deepStrictEqual(t.moveBox(doc, original, "right", 4), box(2, 2, 1, 4));
	assert.deepStrictEqual(t.moveBox(doc, box(1, 0, 3, 9), "down", 4), box(1, 0, 3, 9));
	assert.deepStrictEqual(t.moveBox(doc, box(1, 0, 3, 9), "left", 4), box(1, 0, 3, 8));
	assert.deepStrictEqual(original, box(2, 2, 1, 0));
});

test("splitClipboard: LF, CRLF and exactly one trailing break removed", () => {
	for (const [input, expected] of [
		["a\nb", ["a", "b"]], ["a\r\nb\r\n", ["a", "b"]],
		["a\nb\n", ["a", "b"]], ["a\n", ["a"]], ["a\r\n", ["a"]],
		["a\n\n", ["a", ""]], ["a\r\n\r\n", ["a", ""]],
		["", [""]], ["\n", [""]], ["a\n\nb", ["a", "", "b"]],
	] as [string, string[]][]) assert.deepStrictEqual(t.splitClipboard(input), expected, JSON.stringify(input));
});

test("pickPasteLines: repetition, exact match, cycling and dropped count", () => {
	assert.deepStrictEqual(t.pickPasteLines(["a"], 3), { picked: ["a", "a", "a"], dropped: 0 });
	assert.deepStrictEqual(t.pickPasteLines(["a", "b", "c"], 3), { picked: ["a", "b", "c"], dropped: 0 });
	assert.deepStrictEqual(t.pickPasteLines(["a", "b"], 5), { picked: ["a", "b", "a", "b", "a"], dropped: 0 });
	assert.deepStrictEqual(t.pickPasteLines(["a", "b", "c", "d", "e"], 3), { picked: ["a", "b", "c"], dropped: 2 });
});

test("planRowInsert: zero-width insertion pads short rows to the left column", () => {
	const str = "abcdef\nab\nabcdef";
	const rows = t.boxRows(makeDoc(str), box(1, 3, 3, 3), 4);
	assert.strictEqual(applyChanges(str, t.planRowInsert(rows, ["x", "x", "x"], 3)), "abcxdef\nab x\nabcxdef");
});

test("planRowInsert: replaces a box and uses visual width for padding", () => {
	const str = "abcdef\na\n\tz";
	const rows = t.boxRows(makeDoc(str), box(1, 3, 3, 5), 4);
	assert.strictEqual(applyChanges(str, t.planRowInsert(rows, ["X", "Y", "Z"], 3)), "abcXf\na  Y\n\tZ");
});

test("planBoxDelete: nonzero width deletes selected text and collapses left", () => {
	const str = "abcdef\na\nabcdef";
	for (const forward of [false, true]) {
		const plan = t.planBoxDelete(makeDoc(str), box(3, 5, 1, 2), forward, 4);
		assert.strictEqual(applyChanges(str, plan.changes), "abf\na\nabf");
		assert.deepStrictEqual(plan.box, box(3, 2, 1, 2));
		assert.strictEqual(plan.changes.length, 2);
	}
});

test("planBoxDelete: backspace includes rows ending at the column and skips shorter rows", () => {
	const str = "abcd\nab\nabc";
	const plan = t.planBoxDelete(makeDoc(str), box(1, 3, 3, 3), false, 4);
	assert.strictEqual(applyChanges(str, plan.changes), "abd\nab\nab");
	assert.deepStrictEqual(plan.box, box(1, 2, 3, 2));
	assert.strictEqual(plan.changes.length, 2);
});

test("planBoxDelete: backspace at zero never joins lines", () => {
	const str = "ab\n\ncd";
	const original = box(1, 0, 3, 0);
	const plan = t.planBoxDelete(makeDoc(str), original, false, 4);
	assert.deepStrictEqual(plan.changes, []);
	assert.deepStrictEqual(plan.box, original);
	assert.strictEqual(applyChanges(str, plan.changes), str);
});

test("planBoxDelete: forward delete requires text beyond the column", () => {
	const str = "abcde\nab\nabc";
	const original = box(1, 3, 3, 3);
	const plan = t.planBoxDelete(makeDoc(str), original, true, 4);
	assert.strictEqual(applyChanges(str, plan.changes), "abce\nab\nabc");
	assert.deepStrictEqual(plan.box, original);
	assert.strictEqual(plan.changes.length, 1);
});



test("copyText: preserves empty ranges at the start, middle and end", () => {
	const doc = makeDoc("abcd\nx\nwxyz");
	assert.strictEqual(t.copyText(doc, [
		{ from: 0, to: 0 }, { from: 1, to: 3 }, { from: 6, to: 6 },
		{ from: 8, to: 10 }, { from: 11, to: 11 },
	]), "\nbc\n\nxy\n");
	assert.strictEqual(t.copyText(doc, []), "");
	assert.strictEqual(t.copyText(doc, [{ from: 0, to: 0 }, { from: 6, to: 6 }]), "\n");
});

test("surrogate pairs: one column, never split by columns or deletion", () => {
	const emoji = "😀";
	assert.strictEqual(t.columnOf(emoji + "a", 2, 4), 1);
	assert.strictEqual(t.indexOfColumn(emoji + "a", 1, 4), 2);
	const str = emoji + "a\n";
	const doc = makeDoc(str);
	const back = t.planBoxDelete(doc, box(1, 1, 2, 1), false, 4);
	assert.strictEqual(applyChanges(str, back.changes), "a\n");
	const fwd = t.planBoxDelete(doc, box(1, 0, 2, 0), true, 4);
	assert.strictEqual(applyChanges(str, fwd.changes), "a\n");
});

test("tabs: a column inside a tab splits it into spaces", () => {
	const str = "\tZ\n";
	const doc = makeDoc(str);
	const b = box(1, 2, 2, 2);
	assert.strictEqual(t.needsVirtualSpace(makeDoc("\tZ\nabcdef"), b, 4), true);
	const rows = t.boxRows(doc, b, 4);
	assert.strictEqual(applyChanges(str, t.planRowInsert(rows, ["X", "X"], 2)), "  X  Z\n  X");
	const back = t.planBoxDelete(makeDoc("\tZ\nabcd"), box(1, 4, 2, 4), false, 4);
	assert.strictEqual(applyChanges("\tZ\nabcd", back.changes), "   Z\nabc");
	assert.deepStrictEqual(back.box, box(1, 3, 2, 3));
});

test("forward deletion removes one tab column and never merges equal-length lines", () => {
	const input = "a\tZ\na\n";
	const plan = t.planBoxDelete(makeDoc(input), box(1, 1, 3, 1), true, 4);
	assert.equal(applyChanges(input, plan.changes), "a  Z\na\n");
	const ends = t.planBoxDelete(makeDoc("ab\ncd"), box(1, 2, 2, 2), true, 4);
	assert.equal(applyChanges("ab\ncd", ends.changes), "ab\ncd");
});

// Real CodeMirror transactions, without a browser layout or shared mock changes.
function editorHarness(doc: string, initial: t.Box, readOnly = false) {
	let extension: Extension = [];
	const commands: Command[] = [];
	const cleanups: (() => void)[] = [];
	const notices: string[] = [];
	const settings: ColumnSelectSettings = { keyboard: true, mouse: true, distributePaste: true };
	const ctx = {
		settings,
		register: (cleanup: () => void) => cleanups.push(cleanup),
		registerEditorExtension: (value: Extension) => { extension = value; },
		onSettingsChange: () => {},
		addCommand: (command: Command) => { commands.push(command); },
		t: (key: string) => key,
		tn: (key: string, count: number) => `${key}:${count}`,
		toast: (text: string) => { notices.push(text); },
	} as unknown as ModuleContext<ColumnSelectSettings>;
	const controller = new ColumnSelectEditor(ctx);
	const edits: Transaction[] = [];
	let state = EditorState.create({ doc, extensions: [extension, EditorState.readOnly.of(readOnly), EditorState.tabSize.of(4)] });
	const selected = t.boxSelection(state.doc, initial, 4);
	state = state.update({ selection: EditorSelection.create(selected.ranges.map((r) => EditorSelection.range(r.anchor, r.head)), selected.mainIndex), effects: setBox.of(initial) }).state;
	const cm = {
		get state() { return state; },
		composing: false,
		dispatch(spec: TransactionSpec | Transaction) {
			const tr = spec instanceof Transaction ? spec : state.update(spec);
			if (tr.docChanged) edits.push(tr);
			state = tr.state;
		},
	} as unknown as EditorView;
	const press = (key: string) => {
		const binding = state.facet(keymap).flat().find((entry) => entry.key === key);
		return binding?.run?.(cm) ?? false;
	};
	return { cm, controller, settings, commands, notices, cleanups, press, edits };
}

function clipboard(text: string) {
	const values = new Map([["text/plain", text]]);
	let prevented = false;
	const event = {
		clipboardData: {
			getData: (type: string) => values.get(type) ?? "",
			setData: (type: string, value: string) => { values.set(type, value); },
			clearData: () => { values.clear(); },
		},
		preventDefault: () => { prevented = true; },
	} as unknown as ClipboardEvent;
	return { event, values, get prevented() { return prevented; } };
}

test("virtual typing pads all rows in one reversible transaction", () => {
	const { cm, controller, edits } = editorHarness("abcd\na\n", box(1, 3, 3, 3));
	const type = (text: string) => controller.handleInput(cm, cm.state.selection.main.from, cm.state.selection.main.to, text);
	assert.equal(type("X"), true);
	assert.equal(cm.state.doc.toString(), "abcXd\na  X\n   X");
	assert.equal(cm.state.selection.ranges.length, 3);
	assert.equal(edits.length, 1);
	assert.equal(edits[0].changes.invert(edits[0].startState.doc).apply(cm.state.doc).toString(), "abcd\na\n");
});

test("native typing, composition, multiline input and read-only editing are left alone", () => {
	const real = editorHarness("abcd\nxyz", box(1, 1, 2, 1));
	assert.equal(real.controller.handleInput(real.cm, 6, 6, "X"), false);
	const virtual = editorHarness("a\nb", box(1, 4, 2, 4));
	const { cm, controller } = virtual;
	assert.equal(controller.handleInput(cm, 3, 3, "x\ny"), false);
	Object.assign(cm, { composing: true });
	assert.equal(controller.handleInput(cm, 3, 3, "X"), false);
	assert.equal(virtual.press("Escape"), false);
	assert.equal(virtual.press("Backspace"), false);
	const locked = editorHarness("a\nb", box(1, 4, 2, 4), true);
	assert.equal(locked.controller.handleInput(locked.cm, 3, 3, "X"), false);
	assert.equal(locked.controller.handlePaste(clipboard("X").event, locked.cm), false);
	assert.equal(locked.press("Delete"), false);
	assert.equal(locked.cm.state.doc.toString(), "a\nb");
});

test("keyboard settings apply live, commands have no assigned hotkeys, removal clears extension state", () => {
	const h = editorHarness("abcd\nx", box(1, 2, 1, 2));
	assert.equal(h.press("Alt-Shift-ArrowDown"), true);
	assert.equal(h.cm.state.selection.ranges.length, 2);
	h.settings.keyboard = false;
	assert.equal(h.press("Alt-Shift-ArrowRight"), false);
	assert.equal(h.commands.length, 4);
	assert.ok(h.commands.every((command) => !command.hotkeys && !command.id.includes(":")));
	h.cm.dispatch({ effects: StateEffect.reconfigure.of([]) });
	assert.equal(h.cm.state.field(boxField, false), undefined);
	assert.equal(h.press("Alt-Shift-ArrowDown"), false);
});

test("Home and End move every cursor to logical boundaries, Escape keeps the main cursor", () => {
	const h = editorHarness("abcd\nx\n", box(1, 3, 3, 3));
	assert.equal(h.press("End"), true);
	assert.deepEqual(h.cm.state.selection.ranges.map((r) => r.head), [4, 6, 7]);
	assert.equal(h.cm.state.field(boxField), null);
	assert.equal(h.press("Home"), true);
	assert.deepEqual(h.cm.state.selection.ranges.map((r) => r.head), [0, 5, 7]);
	assert.equal(h.press("Escape"), true);
	assert.equal(h.cm.state.selection.ranges.length, 1);
	assert.equal(h.cm.state.selection.main.head, 7);
});

test("Delete at real line ends does not join rows; Backspace at starts is harmless", () => {
	const h = editorHarness("ab\ncd", box(1, 2, 2, 2));
	assert.equal(h.press("Delete"), true);
	assert.equal(h.cm.state.doc.toString(), "ab\ncd");
	const start = editorHarness("ab\ncd", box(1, 0, 2, 0));
	assert.equal(start.press("Backspace"), true);
	assert.equal(start.cm.state.doc.toString(), "ab\ncd");
});

test("paste splits tabs with cursors after inserted text and reports excess lines", () => {
	const h = editorHarness("\tZ\n", box(1, 2, 2, 2));
	const data = clipboard("X\nYZ\nextra");
	assert.equal(h.controller.handlePaste(data.event, h.cm), true);
	assert.equal(data.prevented, true);
	assert.equal(h.cm.state.doc.toString(), "  X  Z\n  YZ");
	assert.deepEqual(h.cm.state.selection.ranges.map((r) => r.head), [3, 11]);
	assert.deepEqual(h.notices, ["paste.dropped:1"]);
	assert.equal(h.edits.length, 1);
	assert.equal(h.edits[0].changes.invert(h.edits[0].startState.doc).apply(h.cm.state.doc).toString(), "\tZ\n");
});

test("single-cursor paste and disabled spreading use native paste", () => {
	const h = editorHarness("a\nb", box(1, 4, 1, 4));
	const data = clipboard("X\nY");
	assert.equal(h.controller.handlePaste(data.event, h.cm), false);
	assert.equal(data.prevented, false);
	h.press("Alt-Shift-ArrowDown");
	h.settings.distributePaste = false;
	assert.equal(h.controller.handlePaste(data.event, h.cm), false);
	assert.equal(h.cm.state.doc.toString(), "a\nb");
});

test("copy retains a trailing empty row, virtual-only cut cannot delete whole lines", () => {
	const h = editorHarness("abc\nx\n", box(1, 0, 3, 2));
	const copied = clipboard("");
	assert.equal(h.controller.handleCopy(copied.event, h.cm, false), true);
	assert.equal(copied.values.get("text/plain"), "ab\nx\n");
	assert.deepEqual(h.controller.clipboardRows("ab\r\nx\r\n"), ["ab", "x", ""]);
	const virtual = editorHarness("a\nb", box(1, 4, 2, 6));
	assert.equal(virtual.controller.handleCopy(clipboard("").event, virtual.cm, true), true);
	assert.equal(virtual.cm.state.doc.toString(), "a\nb");
	assert.deepEqual(virtual.cm.state.field(boxField), box(1, 4, 2, 4));
});
