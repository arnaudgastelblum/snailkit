// Callout, a sub-panel of Actions: the type to insert (note, tip, warning...), each with Obsidian's
// icon and color. A click writes the callout at the cursor (the selection becomes its body) and
// leaves the cursor inside it.
import { Platform } from "obsidian";
import type { PanelContext, PanelDefinition, PanelInstance } from "../../types";
import { RowList } from "../rows";
import { CALLOUTS, calloutText } from "./inserts";

export const calloutPanel: PanelDefinition = {
	id: "callout",
	icon: "square-chevron-right",
	parent: "actions",
	isAvailable: (_env, view) => view.file?.extension === "md" && view.getMode() === "source",
	create: (ctx, body) => new CalloutPanel(ctx, body),
};

class CalloutPanel implements PanelInstance {
	private rows: RowList;
	private destroyed = false;

	constructor(private ctx: PanelContext, private body: HTMLElement) {
		body.addClass("sk-note-rail-callouts");
		this.rows = new RowList(body);
		this.build();
	}

	refresh(): void {}

	destroy(): void {
		this.destroyed = true;
		this.rows.destroy();
		this.body.empty();
	}

	private build(): void {
		for (const c of CALLOUTS) {
			const row = this.rows.row(this.body, this.ctx.t(`callout.${c.type}`), c.type, () => this.insert(c.type), { icon: c.icon });
			row.iconEl.setCssProps({ "--sk-callout-color": `var(--color-${c.color})` });
			row.iconEl.addClass("is-callout");
		}
	}

	private insert(type: string): void {
		const { ctx } = this;
		if (this.destroyed) return;
		ctx.close("commit");
		try {
			ctx.app.workspace.setActiveLeaf(ctx.view.leaf, { focus: true });
			const editor = ctx.view.editor;
			if (!Platform.isMobile) editor.focus();
			const selected = editor.getSelection();
			const from = editor.getCursor("from");
			const line = editor.getLine(from.line);
			// Without a selection, on a line that holds text: the callout goes on the next line.
			const own = !!selected || !line.trim();
			const { text, cursor } = calloutText(type, selected);
			const insert = own ? text : "\n" + text;
			const start = own ? (selected ? from : { line: from.line, ch: 0 }) : { line: from.line, ch: line.length };
			if (selected) editor.replaceSelection(insert);
			else editor.replaceRange(insert, start, own ? { line: from.line, ch: line.length } : start);
			editor.setCursor(editor.offsetToPos(editor.posToOffset(start) + (own ? cursor : cursor + 1)));
		} catch (err) {
			console.error("[Snailkit] note-rail: callout", err);
		}
	}
}
