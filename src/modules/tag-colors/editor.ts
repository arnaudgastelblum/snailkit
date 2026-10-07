import { editorLivePreviewField } from "obsidian";
import { StateEffect, type Range } from "@codemirror/state";
import { Decoration, WidgetType, ViewPlugin, type EditorView, type ViewUpdate, type DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { capsule } from "./colors";
import type { TagRuntime } from "./runtime";

const BEGIN_RE = /hashtag-begin/;
const END_RE = /hashtag-end/;
export const refreshColors = StateEffect.define<null>();

export class TagWidget extends WidgetType {
	constructor(public plugin: TagRuntime, public tag: string, public classes: string) {
		super();
		this.plugin = plugin;
		this.tag = tag;
		this.classes = classes;
	}
	eq(other: TagWidget) { return this.tag === other.tag && this.classes === other.classes; }
	toDOM(view: EditorView) {
		const el = capsule(view.dom.ownerDocument, this.tag, this.classes);
		el.setAttribute("aria-label", this.plugin.ctx.t(this.plugin.settings.tagCard ? "card.show" : "search", { tag: this.tag }));
		el.setAttribute("role", "link");
		el.tabIndex = 0;
		// Ctrl or Cmd click opens the search when the tag card is on (the card otherwise).
		const ours = (event: MouseEvent) => event.button === 0 && !event.altKey && !event.shiftKey && (!event.ctrlKey && !event.metaKey || this.plugin.settings.tagCard);
		el.addEventListener("mousedown", event => {
			if (ours(event)) event.preventDefault();
		});
		el.addEventListener("click", event => {
			if (!ours(event)) return;
			event.preventDefault();
			event.stopPropagation();
			this.plugin.openTag(this.tag, el, event);
		});
		el.addEventListener("keydown", event => {
			if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.plugin.openTag(this.tag, el, event); }
		});
		el.addEventListener("contextmenu", event => this.plugin.showMenu(event, this.tag));
		return el;
	}
	ignoreEvent() { return true; }
}

export function decorations(view: EditorView, plugin: TagRuntime) {
	const live = view.state.field(editorLivePreviewField, false);
	if (!live && !plugin.settings.taskPlaceholder) return Decoration.none;
	const ranges: Range<Decoration>[] = [], seen = new Set<number>();
	for (const visible of view.visibleRanges) {
		let begin: { from: number; to: number } | null = null;
		// Include boundary lines so partially visible tags still pair.
		const from = view.state.doc.lineAt(visible.from).from;
		const to = view.state.doc.lineAt(visible.to).to;
		syntaxTree(view.state).iterate({ from, to, enter(node) {
			if (BEGIN_RE.test(node.name)) begin = { from: node.from, to: node.to };
			if (!END_RE.test(node.name) || !begin || begin.to !== node.from) return;
			const start = begin.from;
			begin = null;
			if (seen.has(start) || node.to < visible.from || start > visible.to) return;
			seen.add(start);
			const tag = view.state.doc.sliceString(start + 1, node.to);
			const classes = plugin.classes(tag);
			const touched = view.state.selection.ranges.some(range => range.from <= node.to && range.to >= start);
			const decoration = touched || !live ? Decoration.mark({ class: `sk-tag-colors-raw ${classes}` })
				: Decoration.replace({ widget: new TagWidget(plugin, tag, classes) });
			ranges.push(decoration.range(start, node.to));
		} });
	}
	return Decoration.set(ranges, true);
}

export function editorExtension(runtime: TagRuntime) {
	return ViewPlugin.fromClass(class {
		decorations: DecorationSet;
		constructor(private view: EditorView) {
			runtime.editors.add(view);
			this.decorations = decorations(view, runtime);
		}
		update(update: ViewUpdate): void {
			if (update.docChanged || update.viewportChanged || update.selectionSet ||
				update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false) ||
				update.transactions.some(tr => tr.effects.some(effect => effect.is(refreshColors))) ||
				syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = decorations(update.view, runtime);
		}
		destroy(): void { runtime.editors.delete(this.view); }
	}, { decorations: value => value.decorations });
}
