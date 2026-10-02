// Line highlight for the editing modes: "hold" while a heading is previewed, "flash" after a jump.
// A line decoration survives CodeMirror re-rendering lines as they scroll in and out of view.
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export type MarkKind = "hold" | "flash";

interface Marks {
	hold: number | null;
	flash: number | null;
	deco: DecorationSet;
}

const setMark = StateEffect.define<{ kind: MarkKind; pos: number | null }>();
const holdDeco = Decoration.line({ class: "sk-note-rail-hold" });
const flashDeco = Decoration.line({ class: "sk-note-rail-flash" });

function build(doc: { lineAt(pos: number): { from: number } }, hold: number | null, flash: number | null): DecorationSet {
	const items: { pos: number; deco: Decoration }[] = [];
	if (hold !== null) items.push({ pos: doc.lineAt(hold).from, deco: holdDeco });
	if (flash !== null) items.push({ pos: doc.lineAt(flash).from, deco: flashDeco });
	items.sort((a, b) => a.pos - b.pos);
	const b = new RangeSetBuilder<Decoration>();
	for (const it of items) b.add(it.pos, it.pos, it.deco);
	return b.finish();
}

const tocMarkField = StateField.define<Marks>({
	create: () => ({ hold: null, flash: null, deco: Decoration.none }),
	update(value, tr) {
		let { hold, flash } = value;
		let touched = false;
		if (tr.docChanged) {
			const len = tr.newDoc.length;
			if (hold !== null) hold = Math.min(tr.changes.mapPos(hold), len);
			if (flash !== null) flash = Math.min(tr.changes.mapPos(flash), len);
			touched = hold !== null || flash !== null;
		}
		for (const e of tr.effects) {
			if (!e.is(setMark)) continue;
			touched = true;
			if (e.value.kind === "hold") hold = e.value.pos;
			else flash = e.value.pos;
		}
		if (!touched) return value;
		return { hold, flash, deco: build(tr.state.doc, hold, flash) };
	},
	provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/** The extension the module registers with ctx.registerEditorExtension. */
export const tocEditorExtension = [tocMarkField];

/** Set or clear a mark on the line starting the 0-based `line`. False if the field is not installed. */
export function setLineMark(cm: EditorView, kind: MarkKind, line: number | null): boolean {
	if (!cm.state.field(tocMarkField, false)) return false;
	let pos: number | null = null;
	if (line !== null) {
		const n = line + 1;
		if (n < 1 || n > cm.state.doc.lines) return true;
		pos = cm.state.doc.line(n).from;
	}
	try {
		cm.dispatch({ effects: setMark.of({ kind, pos }) });
	} catch {
		// Editor destroyed: nothing to mark.
	}
	return true;
}
