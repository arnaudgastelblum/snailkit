// Tag card: what a click on a tag shows instead of the search pane. The tag and its parents (each
// one a link), its sub-tags, the open tasks that carry it (from the Tasks module, checkable here)
// and the notes where it appears outside tasks, with the line and the color of the note's area
// (from Note rail). Opens next to the tag, closes on Escape or a click elsewhere.
import { getAllTags, Keymap, moment, setIcon, TFile } from "obsidian";
import type { App, CachedMetadata } from "obsidian";
import type { ModuleContext } from "../../core/context";
import type { TagColorsSettings } from "./types";

/** What the card uses of the Tasks module (its public API, version 1). */
interface TaskInfo {
	path: string;
	line: number;
	raw: string;
	plainTitle: string;
	tags: string[];
	due: string | null;
	done: boolean;
}
interface TasksApi {
	version: 1;
	getTasks(options?: { includeDone?: boolean }): TaskInfo[];
	setDone(location: TaskInfo, done: boolean): Promise<TaskInfo | null>;
	openTag?(tag: string): Promise<boolean>;
}
/** What the card uses of Note rail's "places" service. */
interface PlacesService {
	version: 1;
	placeOf(file: TFile): { area: TFile | null };
	hueOf(path: string): number;
}

const MAX_TASKS = 6;
const MAX_NOTES = 8;
const GAP = 6;

export interface NoteHit {
	file: TFile;
	/** 0-based line of the first place the tag appears outside a task, or -1 (in the properties). */
	line: number;
}

const lower = (tag: string) => tag.replace(/^#/, "").toLowerCase();
/** `tag` is `scope` or one of its sub-tags. */
export const inTag = (tag: string, scope: string) => {
	const t = lower(tag);
	return t === scope || t.startsWith(scope + "/");
};

/** Direct sub-tags of `tag` with their counts (sub-sub-tags counted in their parent). */
export function subTags(all: Record<string, number>, tag: string): Array<[string, number]> {
	const out = new Map<string, number>();
	for (const [raw, n] of Object.entries(all)) {
		const t = lower(raw);
		if (!t.startsWith(tag + "/")) continue;
		const child = tag + "/" + t.slice(tag.length + 1).split("/")[0];
		out.set(child, (out.get(child) ?? 0) + n);
	}
	return [...out].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Where `tag` appears in a note outside task lines: the first line, -1 for the properties, null if nowhere. */
export function lineOutsideTasks(cache: CachedMetadata, tag: string): number | null {
	const taskLines = new Set((cache.listItems ?? []).filter((i) => i.task !== undefined).map((i) => i.position.start.line));
	for (const t of cache.tags ?? []) {
		if (inTag(t.tag, tag) && !taskLines.has(t.position.start.line)) return t.position.start.line;
	}
	const fm: unknown = cache.frontmatter?.tags ?? cache.frontmatter?.tag;
	const fmTags = Array.isArray(fm) ? fm : typeof fm === "string" ? fm.split(/[,\s]+/) : [];
	return fmTags.some((t) => typeof t === "string" && inTag(t, tag)) ? -1 : null;
}

export class TagCard {
	private el: HTMLElement | null = null;
	private cleanup: (() => void)[] = [];

	constructor(private ctx: ModuleContext<TagColorsSettings>, private classes: (tag: string) => string) {}

	private get app(): App {
		return this.ctx.app;
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.ctx.t(key, vars);
	}

	close(): void {
		for (const fn of this.cleanup.splice(0)) fn();
		this.el?.remove();
		this.el = null;
	}

	/** Shows the card of `tag` next to `anchor` (the clicked tag). */
	open(tag: string, anchor: HTMLElement): void {
		this.close();
		const scope = lower(tag);
		const doc = anchor.ownerDocument;
		const win = doc.defaultView ?? window;
		const card = (this.el = doc.body.createDiv({ cls: "sk-tag-card", attr: { role: "dialog", "aria-label": "#" + scope } }));
		this.render(card, scope);
		this.place(card, anchor, win);
		// Snippets arrive later and a parent tag may hold more: place it again when its size changes.
		const RO = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
		if (RO) {
			const observer = new RO(() => {
				if (card.isConnected) this.place(card, anchor, win);
			});
			observer.observe(card);
			this.cleanup.push(() => observer.disconnect());
		}

		const onDown = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (target && (card.contains(target) || anchor.contains(target))) return;
			this.close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			this.close();
		};
		const onScroll = (e: Event) => {
			if (!card.contains(e.target as Node)) this.close();
		};
		doc.addEventListener("pointerdown", onDown, true);
		doc.addEventListener("keydown", onKey, true);
		doc.addEventListener("scroll", onScroll, true);
		this.cleanup.push(() => {
			doc.removeEventListener("pointerdown", onDown, true);
			doc.removeEventListener("keydown", onKey, true);
			doc.removeEventListener("scroll", onScroll, true);
		});
	}

	/** Below the tag, or above it when there is no room; always inside the window (it scrolls inside when taller). */
	private place(card: HTMLElement, anchor: HTMLElement, win: Window): void {
		card.style.maxHeight = `${Math.max(160, win.innerHeight - 2 * GAP)}px`;
		const r = anchor.getBoundingClientRect();
		const width = card.offsetWidth;
		const height = card.offsetHeight;
		const left = Math.max(GAP, Math.min(r.left, win.innerWidth - width - GAP));
		const below = r.bottom + GAP;
		const above = r.top - GAP - height;
		let top = below + height <= win.innerHeight - GAP ? below : above >= GAP ? above : win.innerHeight - GAP - height;
		top = Math.max(GAP, Math.min(top, win.innerHeight - GAP - height));
		card.style.left = `${Math.round(left)}px`;
		card.style.top = `${Math.round(top)}px`;
	}

	private render(card: HTMLElement, tag: string): void {
		card.empty();
		this.head(card, tag);
		const tasks = this.tasksSection(card, tag);
		const notes = this.notesSection(card, tag);
		if (!tasks && !notes) card.createDiv({ cls: "sk-tag-card-empty", text: this.t("card.empty") });
	}

	/** The tag and its parents (each a link to its own card), then the sub-tags. */
	private head(card: HTMLElement, tag: string): void {
		const head = card.createDiv("sk-tag-card-head");
		const crumbs = head.createDiv("sk-tag-card-crumbs");
		const parts = tag.split("/");
		parts.forEach((part, i) => {
			const path = parts.slice(0, i + 1).join("/");
			if (i) crumbs.createSpan({ cls: "sk-tag-card-sep", text: "›" });
			const crumb = crumbs.createEl("button", { cls: "sk-tag-card-crumb" + (i === parts.length - 1 ? " is-current" : ""), attr: { type: "button" } });
			crumb.createSpan({ cls: `sk-tag-card-dot ${this.classes(path)}` });
			crumb.createSpan({ text: (i ? "" : "#") + part });
			if (i < parts.length - 1) crumb.addEventListener("click", () => this.render(card, path));
			else crumb.disabled = true;
		});
		const close = head.createEl("button", { cls: "sk-tag-card-close clickable-icon", attr: { type: "button", "aria-label": this.t("card.close") } });
		setIcon(close, "x");
		close.addEventListener("click", () => this.close());

		const all = (this.app.metadataCache as unknown as { getTags?(): Record<string, number> }).getTags?.() ?? {};
		const subs = subTags(all, tag);
		if (!subs.length) return;
		const chips = card.createDiv("sk-tag-card-subs");
		for (const [sub, n] of subs.slice(0, 12)) {
			const chip = chips.createEl("button", { cls: `sk-tag-card-chip ${this.classes(sub)}`, attr: { type: "button" } });
			chip.createSpan({ text: sub.slice(tag.length + 1) });
			chip.createSpan({ cls: "sk-tag-card-n", text: String(n) });
			chip.addEventListener("click", () => this.render(card, sub));
		}
	}

	private tasksApi(): TasksApi | null {
		const api = this.ctx.service<TasksApi>("tasks");
		return api && api.version === 1 ? api : null;
	}

	/** Open tasks of the tag, soonest first; checking one here checks it in its note. */
	private tasksSection(card: HTMLElement, tag: string): boolean {
		const api = this.tasksApi();
		if (!api) return false;
		const tasks = api.getTasks().filter((task) => task.tags.some((t) => inTag(t, tag)));
		if (!tasks.length) return false;
		tasks.sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
		const section = this.section(card, this.t("card.tasks"), tasks.length);
		const today = moment().format("YYYY-MM-DD");
		for (const task of tasks.slice(0, MAX_TASKS)) {
			const row = section.createDiv("sk-tag-card-row sk-tag-card-task");
			const box = row.createEl("button", { cls: "sk-tag-card-check", attr: { type: "button", "aria-label": this.t("card.check") } });
			const title = row.createSpan({ cls: "sk-tag-card-title", text: task.plainTitle });
			if (task.due) {
				const late = task.due < today;
				row.createSpan({ cls: "sk-tag-card-meta" + (late ? " is-late" : task.due === today ? " is-today" : ""), text: task.due === today ? this.t("card.today") : moment(task.due).format("ddd D MMM") });
			}
			box.addEventListener("click", () => { void (async () => {
				if (row.hasClass("is-done")) return;
				row.addClass("is-done");
				if (!(await api.setDone(task, true))) row.removeClass("is-done");
			})(); });
			title.addEventListener("click", (e) => void this.openAt(task.path, task.line, e));
		}
		if (api.openTag) {
			const more = section.createEl("button", { cls: "sk-tag-card-more", attr: { type: "button" } });
			setIcon(more.createSpan(), "list-checks");
			more.createSpan({ text: tasks.length > MAX_TASKS ? this.t("card.all-tasks", { count: tasks.length }) : this.t("card.open-tasks") });
			more.addEventListener("click", () => {
				this.close();
				void api.openTag?.(tag);
			});
		}
		return true;
	}

	/** Notes where the tag appears outside tasks, last edited first, with the line. */
	private notesSection(card: HTMLElement, tag: string): boolean {
		const hits: NoteHit[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache || !(getAllTags(cache) ?? []).some((t) => inTag(t, tag))) continue;
			const line = lineOutsideTasks(cache, tag);
			if (line !== null) hits.push({ file, line });
		}
		if (!hits.length) return false;
		hits.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
		const section = this.section(card, this.t("card.notes"), hits.length);
		const places = this.ctx.service<PlacesService>("places");
		for (const hit of hits.slice(0, MAX_NOTES)) {
			const row = section.createDiv("sk-tag-card-row sk-tag-card-note");
			const dot = row.createSpan("sk-tag-card-area");
			const area = places?.version === 1 ? places.placeOf(hit.file).area : null;
			if (area) {
				dot.setCssProps({ "--sk-tag-card-hue": String(places!.hueOf(area.path)) });
				dot.addClass("has-area");
				dot.setAttribute("aria-label", area.basename);
			}
			const text = row.createDiv("sk-tag-card-text");
			text.createDiv({ cls: "sk-tag-card-title", text: hit.file.basename });
			const snippet = text.createDiv({ cls: "sk-tag-card-snippet" });
			if (hit.line >= 0) void this.fillSnippet(snippet, hit);
			row.addEventListener("click", (e) => void this.openAt(hit.file.path, hit.line, e));
		}
		if (hits.length > MAX_NOTES) section.createDiv({ cls: "sk-tag-card-more-n", text: this.t("card.more-notes", { count: hits.length - MAX_NOTES }) });
		return true;
	}

	private async fillSnippet(el: HTMLElement, hit: NoteHit): Promise<void> {
		const text = await this.app.vault.cachedRead(hit.file);
		const line = (text.split(/\r?\n/)[hit.line] ?? "").replace(/^\s*(?:[-*+]|\d+\.)\s+/, "").replace(/^#+\s+/, "").trim();
		el.setText(line.length > 90 ? line.slice(0, 89) + "…" : line);
	}

	private section(card: HTMLElement, title: string, count: number): HTMLElement {
		const section = card.createDiv("sk-tag-card-section");
		const head = section.createDiv("sk-tag-card-section-head");
		head.createSpan({ text: title });
		head.createSpan({ cls: "sk-tag-card-n", text: String(count) });
		return section;
	}

	private async openAt(path: string, line: number, e: MouseEvent): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		this.close();
		const leaf = this.app.workspace.getLeaf(Keymap.isModEvent(e));
		await leaf.openFile(file, line >= 0 ? { eState: { line } } : undefined);
	}
}
