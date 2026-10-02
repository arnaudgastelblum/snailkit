// Editor extensions: styles on Live Preview tables, the style chip in place of the comment line,
// and Tab / Shift+Tab / Enter in tables.
import { Prec, StateEffect, type Extension } from "@codemirror/state";
import { Decoration, keymap, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { editorLivePreviewField, setIcon } from "obsidian";
import type { TablesController } from "./controller";
import { applyMeta } from "./dom";
import { tableWidgets, widgetLine } from "./internals";
import { accentCss, isTableLine, metaBelow, prefixOf, serializeMeta, shownStyle, type Meta } from "./logic";

/** Sent to every editor when settings change: chips and styles are drawn again. */
export const refreshEffect = StateEffect.define<null>();

const isLivePreview = (view: EditorView) => !!view.state.field(editorLivePreviewField, false);
const refreshed = (u: ViewUpdate) => u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)));

class StyleChip extends WidgetType {
	constructor(
		private readonly controller: TablesController,
		private readonly meta: Meta,
		private readonly line: number,
	) {
		super();
	}

	eq(other: StyleChip): boolean {
		return other.line === this.line && serializeMeta(other.meta) === serializeMeta(this.meta);
	}

	toDOM(view: EditorView): HTMLElement {
		const t = (key: string) => this.controller.t(key);
		const chip = createSpan({ cls: "sk-tables-chip", attr: { role: "button", tabindex: "0", "aria-label": t("command.style") } });
		const accent = accentCss(this.meta.accent);
		if (accent) chip.style.setProperty("--sk-tables-accent", accent);
		setIcon(chip.createSpan("sk-tables-chip-icon"), "table");
		const parts = [t("style." + shownStyle(this.meta.style))];
		if (this.meta.banding !== "off") parts.push(t("banding." + this.meta.banding));
		if (this.meta.header === "hide") parts.push(t("chip.no-header"));
		else if (this.meta.header === "off") parts.push(t("chip.plain-header"));
		chip.createSpan({ cls: "sk-tables-chip-label", text: parts.join(" · ") });
		chip.createSpan("sk-tables-chip-dot");
		const open = (evt: Event) => {
			evt.preventDefault();
			this.controller.openStylePanelAt(view, this.line, chip.getBoundingClientRect(), evt.type === "keydown");
		};
		chip.addEventListener("mousedown", (evt) => evt.preventDefault());
		chip.addEventListener("click", open);
		chip.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" || evt.key === " ") open(evt);
		});
		return chip;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

/** Replaces the style comment with a chip in Live Preview, except on lines that hold the cursor. */
function chipPlugin(controller: TablesController): Extension {
	const build = (view: EditorView): DecorationSet => {
		if (!controller.ctx.settings.chip || !isLivePreview(view)) return Decoration.none;
		const doc = view.state.doc;
		const ranges = [];
		const selection = view.state.selection.ranges;
		for (const { from, to } of view.visibleRanges) {
			for (let pos = from; pos <= to; ) {
				const line = doc.lineAt(pos);
				pos = line.to + 1;
				if (!line.text.includes("table:") || line.number < 3) continue;
				const prev = doc.line(line.number - 1).text;
				const meta = isTableLine(prev) ? metaBelow(line.text, prev) : null;
				if (!meta) continue;
				if (selection.some((r) => r.to >= line.from && r.from <= line.to)) continue;
				const start = line.from + prefixOf(line.text).length;
				ranges.push(Decoration.replace({ widget: new StyleChip(controller, meta, line.number) }).range(start, line.to));
			}
		}
		return Decoration.set(ranges, true);
	};
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = build(view);
			}
			update(u: ViewUpdate) {
				const modeChanged = u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false);
				if (u.docChanged || u.viewportChanged || u.selectionSet || modeChanged || refreshed(u)) this.decorations = build(u.view);
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

/** Applies table styles to the Live Preview tables of one editor, whenever they are drawn. */
function stylerPlugin(controller: TablesController): Extension {
	return ViewPlugin.fromClass(
		class {
			private frame = 0;
			private readonly observer: MutationObserver;
			constructor(private readonly view: EditorView) {
				// Obsidian draws table widgets on its own schedule: watch the content for them.
				this.observer = new MutationObserver(() => this.schedule());
				this.observer.observe(view.contentDOM, { childList: true, subtree: true });
				controller.stylers.add(this);
				this.schedule();
			}
			update(u: ViewUpdate) {
				if (u.docChanged || u.viewportChanged || refreshed(u)) this.schedule();
			}
			schedule() {
				if (!this.frame) this.frame = requestAnimationFrame(() => this.apply());
			}
			apply() {
				this.frame = 0;
				const { view } = this;
				const doc = view.state.doc;
				for (const widget of tableWidgets(view)) {
					const table = widget.querySelector("table");
					if (!table || table.hasAttribute("data-sk-preview")) continue;
					const index = widgetLine(view, widget);
					if (index === null) continue;
					const header = doc.line(index + 1).text;
					let last = index + 1;
					while (last < doc.lines && isTableLine(doc.line(last + 1).text)) last++;
					const meta = last < doc.lines ? metaBelow(doc.line(last + 1).text, header) : null;
					applyMeta(table, meta ?? controller.defaultMeta());
				}
			}
			destroy() {
				cancelAnimationFrame(this.frame);
				this.observer.disconnect();
				controller.stylers.delete(this);
			}
		},
	);
}

export function tablesExtensions(controller: TablesController): Extension[] {
	return [
		stylerPlugin(controller),
		chipPlugin(controller),
		Prec.high(
			keymap.of([
				{ key: "Tab", run: (view) => controller.onTableKey(view, "next") },
				{ key: "Shift-Tab", run: (view) => controller.onTableKey(view, "prev") },
				{ key: "Enter", run: (view) => controller.onTableKey(view, "down") },
			]),
		),
	];
}
