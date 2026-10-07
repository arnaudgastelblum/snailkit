// The way from a rail panel to the Workbench (Tasks module): one button, in the same place (the
// panel's footer) in every panel that has one.
import { Notice, setIcon } from "obsidian";
import type { PanelContext, WorkbenchOptions } from "../types";

/** A footer holding "Open in Workbench", opening the Workbench on `options` (its tab, its scope). */
export function workbenchFooter(ctx: PanelContext, options: WorkbenchOptions, tip: string): DocumentFragment {
	const frag = createFragment();
	const button = frag.createEl("button", { cls: "sk-btn is-ghost is-s sk-note-rail-link sk-note-rail-workbench", attr: { type: "button", title: tip } });
	setIcon(button.createSpan("sk-note-rail-workbench-icon"), "layout-dashboard");
	button.createSpan({ text: ctx.t("rail.workbench-open") });
	setIcon(button.createSpan("sk-note-rail-link-arrow"), "arrow-right");
	button.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (!ctx.openWorkbench(options)) new Notice(ctx.t("rail.workbench-unavailable"));
		else ctx.close("commit");
	});
	return frag;
}
