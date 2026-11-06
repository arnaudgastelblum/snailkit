// Around this note (the colored pill): the way up to the top of the tree (home page, domain,
// parents), this note, and the notes under it. A row opens that note here (Ctrl or Cmd: a new
// tab); Ctrl or Cmd hover shows Obsidian's page preview. With the Home module, the footer opens
// the page of the area in the Workbench.
import { Notice, setIcon, TFile, type MarkdownView } from "obsidian";
import type { PanelContext, PanelDefinition, PanelInstance, RailEnv } from "../../types";
import { RowList, wantsNewTab } from "../rows";
import { homeOf } from "../services";
import { placeRows, type PlaceRow } from "./tree";

export const placePanel: PanelDefinition = {
	id: "place",
	icon: "signpost",
	isAvailable: (env, view) => !!pillOf(env, view),
	create: (ctx, body) => new PlacePanel(ctx, body),
};

/** What the pill shows for this note: the area (or the note itself when it tops a tree), or null to hide it. */
export function pillOf(env: Pick<RailEnv, "places" | "settings">, view: MarkdownView): TFile | null {
	const file = view.file;
	if (!file || file.extension !== "md" || env.settings.showPlace === false) return null;
	try {
		const place = env.places.placeOf(file);
		if (place.area) return place.area;
		return env.places.hasChildren(file.path) ? file : null;
	} catch {
		return null;
	}
}

class PlacePanel implements PanelInstance {
	private rows: RowList;
	private cleanups: (() => void)[] = [];
	private destroyed = false;
	private timer = 0;

	constructor(private ctx: PanelContext, private body: HTMLElement) {
		body.addClass("sk-note-rail-place-panel");
		this.rows = new RowList(body);
		const over = (e: MouseEvent) => this.onMouseOver(e);
		body.addEventListener("mouseover", over);
		this.cleanups.push(() => body.removeEventListener("mouseover", over));
		this.cleanups.push(ctx.places.onChange(() => this.refresh()));
		this.build();
	}

	refresh(): void {
		if (this.destroyed) return;
		this.body.win.clearTimeout(this.timer);
		this.timer = this.body.win.setTimeout(() => this.build(), 60);
	}

	destroy(): void {
		this.destroyed = true;
		this.body.win.clearTimeout(this.timer);
		for (const c of this.cleanups) c();
		this.cleanups = [];
		this.rows.destroy();
		this.body.empty();
	}

	private build(): void {
		if (this.destroyed) return;
		const { ctx } = this;
		const t = ctx.t.bind(ctx);
		const file = ctx.view.file;
		const focusKey = this.rows.focusedKey();
		this.body.empty();
		this.rows.clear();
		if (!file) return;

		const list = placeRows<TFile>(file, ctx.places.placeOf(file).chain, ctx.places.homePath(), ctx.places.childrenOf(file.path));
		for (const r of list) this.drawRow(r);
		const children = list.filter((r) => r.kind === "child").length;
		if (!children) this.body.createDiv({ cls: "sk-note-rail-empty is-silent", text: t("place.no-children") });

		const area = pillOf(ctx, ctx.view);
		ctx.setSubtitle(area && area !== file ? area.basename : "");
		ctx.setCount(children || null);
		this.footer(file);
		this.rows.focus(focusKey);
	}

	private drawRow(r: PlaceRow<TFile>): void {
		const { file, kind, depth } = r;
		const current = kind === "self";
		const el = this.rows.row(this.body, file.basename, `f:${file.path}`, current ? null : (e) => void this.open(file, e), {
			depth, current, title: file.path, cls: `is-${kind}`,
		});
		el.dataset.path = file.path;
		if (kind === "home") setIcon(el.iconEl, "house");
		else if (kind === "self") setIcon(el.iconEl, "dot");
		else if (kind === "child") setIcon(el.iconEl, "corner-down-right");
		else el.iconEl.addClass("is-guide");
	}

	/** With Home: the page of the area in the Workbench. */
	private footer(file: TFile): void {
		const home = homeOf(this.ctx);
		if (!home) {
			this.ctx.setFooter("");
			return;
		}
		const frag = createFragment();
		const button = frag.createEl("button", { cls: "sk-btn is-ghost is-s sk-note-rail-link sk-note-rail-workbench", attr: { type: "button" } });
		setIcon(button.createSpan("sk-note-rail-workbench-icon"), "layout-dashboard");
		button.createSpan({ text: this.ctx.t("place.open-home") });
		setIcon(button.createSpan("sk-note-rail-link-arrow"), "arrow-right");
		button.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.ctx.close("commit");
			home.openPlace(file).catch((err) => console.error("[Snailkit] note-rail: could not open the page of the area", err));
		});
		this.ctx.setFooter(frag);
	}

	private async open(file: TFile, e: MouseEvent | KeyboardEvent): Promise<void> {
		const { ctx } = this;
		const leaf = wantsNewTab(e) ? ctx.app.workspace.getLeaf("tab") : ctx.view.leaf;
		ctx.close("commit");
		await leaf.openFile(file).catch(() => new Notice(ctx.t("panel.open-error", { name: file.basename })));
	}

	private onMouseOver(e: MouseEvent): void {
		const row = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-path]");
		if (!row || row.hasClass("is-self")) return;
		this.ctx.app.workspace.trigger("hover-link", {
			event: e, source: this.ctx.hoverSource, hoverParent: this.body, targetEl: row,
			linktext: row.dataset.path, sourcePath: this.ctx.view.file?.path ?? "",
		});
	}
}
