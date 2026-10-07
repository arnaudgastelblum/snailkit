// While a task is composed, only its title can change, on one line, and the cursor stays in it.
import { Annotation, EditorSelection, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

/** Our own transactions: never filtered, never cancel what is pending. */
export const ours = Annotation.define<boolean>();
/** Asks the editors to draw their decorations again. */
export const refresh = StateEffect.define<null>();

/** The part of the task line that can be edited while a task is being composed. */
export interface Guard {
	from: number;
	to: number;
}

export const setGuard = StateEffect.define<Guard | null>();

export const guardField = StateField.define<Guard | null>({
	create: () => null,
	update(value, tr) {
		for (const e of tr.effects) if (e.is(setGuard)) return e.value;
		if (!value || !tr.docChanged) return value;
		return { from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1) };
	},
});

export const guardFilters: Extension = [
	// Changes outside the title are dropped (typing at either end of it is fine).
	EditorState.changeFilter.of((tr) => {
		const g = tr.startState.field(guardField, false);
		if (!g || tr.annotation(ours)) return true;
		return [0, g.from, g.to, tr.startState.doc.length];
	}),
	EditorState.transactionFilter.of((tr) => {
		const g = tr.startState.field(guardField, false);
		if (!g || tr.annotation(ours)) return tr;
		let multiline = false;
		tr.changes.iterChanges((_a, _b, _c, _d, inserted) => {
			if (inserted.lines > 1) multiline = true;
		});
		// A title is one line: a pasted paragraph is refused.
		if (multiline) return [];
		if (!tr.selection) return tr;
		const from = tr.changes.mapPos(g.from, -1);
		const to = tr.changes.mapPos(g.to, 1);
		const sel = tr.newSelection;
		if (sel.ranges.every((r) => r.from >= from && r.to <= to)) return tr;
		const clamp = (n: number) => Math.max(from, Math.min(to, n));
		return [tr, { selection: EditorSelection.create(sel.ranges.map((r) => EditorSelection.range(clamp(r.anchor), clamp(r.head))), sel.mainIndex), sequential: true }];
	}),
];

/** Room left under the task line for the panel (block widgets must come from a state field). */
export const setSpacer = StateEffect.define<{ pos: number; height: number } | null>();

class SpacerWidget extends WidgetType {
	constructor(readonly height: number) {
		super();
	}
	eq(other: SpacerWidget): boolean {
		return other.height === this.height;
	}
	toDOM(): HTMLElement {
		const el = createDiv();
		el.className = "sk-sessions-spacer";
		el.style.height = `${this.height}px`;
		return el;
	}
	get estimatedHeight(): number {
		return this.height;
	}
	ignoreEvent(): boolean {
		return true;
	}
}

export const spacerField = StateField.define<{ pos: number; height: number } | null>({
	create: () => null,
	update(value, tr) {
		for (const e of tr.effects) if (e.is(setSpacer)) value = e.value;
		if (value && tr.docChanged) value = { pos: tr.changes.mapPos(value.pos, 1), height: value.height };
		return value;
	},
	provide: (f) =>
		EditorView.decorations.from(f, (v) =>
			v && v.height > 0 ? Decoration.set([Decoration.widget({ widget: new SpacerWidget(v.height), block: true, side: 2 }).range(v.pos)]) : Decoration.none,
		),
});
