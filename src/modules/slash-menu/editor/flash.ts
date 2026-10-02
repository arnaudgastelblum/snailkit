import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

// Briefly highlights what an action inserted (a soft accent glow that fades out).

const addFlash = StateEffect.define<{ from: number; to: number }>();
const clearFlash = StateEffect.define<null>();
const flashMark = Decoration.mark({ class: "sk-slash-menu-flash" });

export const flashField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const e of tr.effects) {
			if (e.is(addFlash)) deco = Decoration.set(e.value.from < e.value.to ? [flashMark.range(e.value.from, e.value.to)] : []);
			else if (e.is(clearFlash)) deco = Decoration.none;
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});

const FLASH_MS = 1100;

export function flashRange(view: EditorView, from: number, to: number, later: (callback: () => void, delay: number) => void): void {
	const len = view.state.doc.length;
	from = Math.max(0, Math.min(from, len));
	to = Math.max(from, Math.min(to, len));
	if (from === to) return;
	try {
		view.dispatch({ effects: addFlash.of({ from, to }) });
		later(() => {
			try {
				view.dispatch({ effects: clearFlash.of(null) });
			} catch {
				// The view was destroyed (note closed): nothing to clear.
			}
		}, FLASH_MS);
	} catch {
		// Never break the editor for a cosmetic effect.
	}
}
