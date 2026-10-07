// Tag suggestions: the menu that opens on "#" in the editor, in place of Obsidian's. Before you
// type, the tags of this note come first, then those used in the notes of the same area (from Note
// rail's "places" service), then the rest of the vault. Typing filters everything. Tab completes the
// next part of a nested tag, Enter inserts, Shift+Enter inserts and turns the line into a task.
import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { EditorSuggest, getAllTags, Platform, setIcon, TFile } from "obsidian";
import type { App, Editor, EditorPosition, EditorSuggestContext, EditorSuggestTriggerInfo } from "obsidian";
import type { ModuleContext } from "../../core/context";
import { capsule } from "./colors";
import type { TagColorsSettings } from "./types";

/** What the suggestions use of Note rail's "places" service. */
interface PlacesService {
	version: 1;
	placeOf(file: TFile): { area: TFile | null };
}

export type Origin = "note" | "area" | "vault" | "new";

export interface TagItem {
	/** Tag without "#", as written most often. */
	tag: string;
	/** Uses in the vault (0 for a new tag). */
	count: number;
	origin: Origin;
	/** The tag has sub-tags (Tab goes into them). */
	parent: boolean;
}

export interface TagStats {
	/** Lowercased tag to how it is written most often and how many times it is used. */
	all: Map<string, { tag: string; count: number }>;
	/** Uses in the current note, by lowercased tag. */
	note: Map<string, number>;
	/** Uses in the notes of the same area, by lowercased tag. */
	area: Map<string, number>;
}

const LIMIT = 14;
const TAG_CHARS = /^[\p{L}\p{N}_/-]*$/u;
/** "#" then what is typed so far, at the cursor, after a space, an opening bracket or the line start. */
const TRIGGER = /(?:^|[\s(])#([\p{L}\p{N}_/-]*)$/u;
/** The rest of a tag after the cursor (completing in the middle of "#pro|ject" replaces "ject" too). */
const TAG_REST = /^[\p{L}\p{N}_/-]*/u;

/** Syntax nodes where "#" is not a tag: code, links and their targets, URLs, math. */
const NOT_TAG_NODE = /code|link|url|math|comment/i;

/** The query after "#" when the cursor ends a tag being typed, else null. */
export function tagQuery(lineBefore: string): string | null {
	// Inside inline code (an odd number of backticks before), a wiki link or a Markdown link target.
	if (((lineBefore.match(/`/g) ?? []).length % 2) === 1) return null;
	if (/\[\[[^\]]*$/.test(lineBefore) || /\]\([^)\s]*$/.test(lineBefore)) return null;
	const m = TRIGGER.exec(lineBefore);
	// A heading needs a space after "#": the space ends the query and closes the menu.
	return m ? m[1] : null;
}

/**
 * Ranked suggestions for `query`. Empty query: this note, then the area, then the vault, each by
 * use. Otherwise: tags starting with the query, then tags with a part starting with it, then tags
 * containing it; within each, this note, the area, then the vault.
 */
export function rankTags(query: string, stats: TagStats, limit = LIMIT): TagItem[] {
	const q = query.toLowerCase();
	const keys = [...stats.all.keys()];
	const parentOf = new Set<string>();
	for (const key of keys) {
		const parts = key.split("/");
		for (let i = 1; i < parts.length; i++) parentOf.add(parts.slice(0, i).join("/"));
	}
	const origin = (key: string): Origin => (stats.note.has(key) ? "note" : stats.area.has(key) ? "area" : "vault");
	const weight = (key: string) => {
		const o = origin(key);
		const uses = o === "note" ? stats.note.get(key)! : o === "area" ? stats.area.get(key)! : stats.all.get(key)!.count;
		return (o === "note" ? 2e6 : o === "area" ? 1e6 : 0) + uses;
	};
	const tier = (key: string) => (key.startsWith(q) ? 0 : key.split("/").some((p) => p.startsWith(q)) ? 1 : key.includes(q) ? 2 : 3);
	const matches = keys.filter((key) => !q || tier(key) < 3);
	matches.sort((a, b) => (q ? tier(a) - tier(b) : 0) || weight(b) - weight(a) || a.localeCompare(b));
	const items: TagItem[] = matches.slice(0, limit).map((key) => ({
		tag: stats.all.get(key)!.tag,
		count: stats.all.get(key)!.count,
		origin: origin(key),
		parent: parentOf.has(key),
	}));
	const clean = q.replace(/\/+$/, "");
	if (clean && TAG_CHARS.test(clean) && !/^\d+$/.test(clean) && !stats.all.has(clean)) {
		items.push({ tag: query.replace(/\/+$/, ""), count: 0, origin: "new", parent: false });
	}
	return items;
}

/**
 * What Tab writes for `item` when `query` is typed: the next part of the tag, with "/" when the
 * tag goes on (or has sub-tags, to go into them); the whole tag when it is a leaf.
 */
export function nextPart(query: string, item: TagItem): string {
	const typed = query.split("/").length - 1;
	const parts = item.tag.split("/");
	if (typed + 1 < parts.length) return parts.slice(0, typed + 1).join("/") + "/";
	return item.parent ? item.tag + "/" : item.tag;
}

/** The line as a task: "text" or "- text" becomes "- [ ] text"; a task stays as it is. Returns the line and how many characters were added before the text. */
export function asTask(line: string): { text: string; shift: number } {
	if (/^\s*(?:[-*+]|\d+[.)])\s+\[.\]/.test(line)) return { text: line, shift: 0 };
	const list = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line);
	if (list) {
		const at = list[0].length;
		return { text: line.slice(0, at) + "[ ] " + line.slice(at), shift: 4 };
	}
	const indent = /^\s*/.exec(line)![0];
	return { text: indent + "- [ ] " + line.slice(indent.length), shift: 6 };
}

export class TagSuggest extends EditorSuggest<TagItem> {
	private statsCache: { at: number; file: string; stats: TagStats } | null = null;
	private areaCache: { at: number; byArea: Map<string, Map<string, number>> } | null = null;

	constructor(app: App, private ctx: ModuleContext<TagColorsSettings>, private classes: (tag: string) => string) {
		super(app);
		this.limit = LIMIT + 1;
		this.setInstructions([
			{ command: "Tab", purpose: ctx.t("suggest.tab") },
			{ command: "↵", purpose: ctx.t("suggest.enter") },
			{ command: "Shift ↵", purpose: ctx.t("suggest.task") },
		]);
		this.scope.register([], "Tab", (evt) => {
			evt.preventDefault();
			const item = this.selected();
			if (item) this.complete(item);
			return false;
		});
		this.scope.register(["Shift"], "Enter", (evt) => {
			evt.preventDefault();
			const item = this.selected();
			if (item) this.insert(item, true);
			return false;
		});
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!this.ctx.settings.tagSuggest) return null;
		const line = editor.getLine(cursor.line);
		const query = tagQuery(line.slice(0, cursor.ch));
		if (query === null || /^\s*(```|~~~)/.test(line)) return null;
		if (file && this.inProperties(file, cursor.line)) return null;
		if (this.inCodeOrLink(editor, cursor)) return null;
		const rest = TAG_REST.exec(line.slice(cursor.ch))?.[0] ?? "";
		return { start: { line: cursor.line, ch: cursor.ch - query.length - 1 }, end: { line: cursor.line, ch: cursor.ch + rest.length }, query };
	}

	/** Inside a code block, inline code, a link or a URL, as the editor's syntax tree says. */
	private inCodeOrLink(editor: Editor, cursor: EditorPosition): boolean {
		const view = (editor as unknown as { cm?: EditorView }).cm;
		if (!view) return false;
		try {
			const pos = view.state.doc.line(cursor.line + 1).from + cursor.ch;
			for (let node: { name: string; parent: unknown } | null = syntaxTree(view.state).resolveInner(pos, -1); node; node = node.parent as typeof node) {
				// The tag's own nodes ("hashtag") are fine; anything code- or link-like is not.
				if (!/hashtag/i.test(node.name) && NOT_TAG_NODE.test(node.name)) return true;
			}
			const lineNode = syntaxTree(view.state).resolveInner(view.state.doc.line(cursor.line + 1).from, 1);
			return /codeblock/i.test(lineNode.name);
		} catch {
			return false;
		}
	}

	getSuggestions(context: EditorSuggestContext): TagItem[] {
		const stats = this.stats(context.file);
		return rankTags(context.query, this.typedIsIndexed(context) ? withoutTyped(stats, context.query) : stats);
	}

	/** The note's cache already holds the tag being typed, at this very place (it lags behind typing). */
	private typedIsIndexed(context: EditorSuggestContext): boolean {
		if (!context.file || !context.query) return false;
		const tags = this.app.metadataCache.getFileCache(context.file)?.tags ?? [];
		const typed = "#" + context.query.toLowerCase();
		return tags.some((t) => t.position.start.line === context.start.line && t.position.start.col === context.start.ch && t.tag.toLowerCase() === typed);
	}

	renderSuggestion(item: TagItem, el: HTMLElement): void {
		el.addClass("sk-tag-suggest");
		const left = el.createDiv("sk-tag-suggest-tag");
		if (item.origin === "new") left.createSpan({ cls: "sk-tag-suggest-new", text: this.ctx.t("suggest.new") });
		left.appendChild(capsule(el.doc, item.tag, this.classes(item.tag)));
		const right = el.createDiv("sk-tag-suggest-meta");
		if (item.origin === "note" || item.origin === "area") right.createSpan({ cls: `sk-tag-suggest-origin is-${item.origin}`, text: this.ctx.t(`suggest.${item.origin}`) });
		if (item.count) right.createSpan({ cls: "sk-tag-suggest-count", text: String(item.count) });
		// Touch: no Tab and no Shift. A chevron goes into the sub-tags, a box inserts as a task.
		if (Platform.isMobile) {
			if (item.parent) this.touchButton(right, "chevron-right", this.ctx.t("suggest.tab"), () => this.complete(item));
			this.touchButton(right, "square-check", this.ctx.t("suggest.task"), () => this.insert(item, true));
		}
	}

	selectSuggestion(item: TagItem, evt: MouseEvent | KeyboardEvent): void {
		this.insert(item, evt.shiftKey);
	}

	// ----- writing -----

	private selected(): TagItem | null {
		const chooser = (this as unknown as { suggestions?: { values?: TagItem[]; selectedItem?: number } }).suggestions;
		return chooser?.values?.[chooser.selectedItem ?? 0] ?? null;
	}

	/** Tab: the next part of a nested tag, to keep going; the whole tag when it is the last part. */
	private complete(item: TagItem): void {
		const context = this.context;
		if (!context) return;
		const text = nextPart(context.query, item);
		if (!text.endsWith("/")) {
			this.insert(item, false);
			return;
		}
		// The menu stays open: the new text is a query again, for the sub-tags.
		context.editor.replaceRange(text, { line: context.start.line, ch: context.start.ch + 1 }, tagEnd(context.editor, context.start));
		context.editor.setCursor({ line: context.start.line, ch: context.start.ch + 1 + text.length });
	}

	/** Writes "#tag " in place of what was typed; as a task, the line also gets its checkbox. */
	private insert(item: TagItem, task: boolean): void {
		const context = this.context;
		if (!context) return;
		const { editor, start } = context;
		const end = tagEnd(editor, start);
		const lineText = editor.getLine(start.line);
		const after = lineText.slice(end.ch);
		const insert = "#" + item.tag + (after.startsWith(" ") ? "" : " ");
		editor.replaceRange(insert, start, end);
		let ch = start.ch + insert.length + (after.startsWith(" ") ? 1 : 0);
		if (task) {
			const { text, shift } = asTask(editor.getLine(start.line));
			if (shift) {
				editor.setLine(start.line, text);
				ch += shift;
			}
		}
		editor.setCursor({ line: start.line, ch });
		this.close();
	}

	private touchButton(parent: HTMLElement, icon: string, label: string, run: () => void): void {
		const button = parent.createEl("button", { cls: "sk-tag-suggest-touch clickable-icon", attr: { "aria-label": label } });
		setIcon(button, icon);
		// Before the row handles the tap: the row would insert the tag.
		for (const type of ["mousedown", "pointerdown", "touchstart"]) button.addEventListener(type, (e) => e.stopPropagation());
		button.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			run();
		});
	}

	// ----- what is known -----

	private inProperties(file: TFile, line: number): boolean {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatterPosition;
		return !!fm && line <= fm.end.line;
	}

	/** Tag counts of the vault, this note and its area. Cached briefly: a menu opening reads it once. */
	private stats(file: TFile | null): TagStats {
		const now = Date.now();
		const path = file?.path ?? "";
		if (this.statsCache && this.statsCache.file === path && now - this.statsCache.at < 2000) return this.statsCache.stats;
		const all = new Map<string, { tag: string; count: number }>();
		const raw = (this.app.metadataCache as unknown as { getTags?(): Record<string, number> }).getTags?.() ?? {};
		const spellings = new Map<string, Map<string, number>>();
		for (const [written, count] of Object.entries(raw)) {
			const tag = written.replace(/^#/, "");
			const key = tag.toLowerCase();
			const entry = all.get(key);
			all.set(key, { tag: entry?.tag ?? tag, count: (entry?.count ?? 0) + count });
			const ways = spellings.get(key) ?? new Map<string, number>();
			ways.set(tag, count);
			spellings.set(key, ways);
		}
		for (const [key, ways] of spellings) {
			const best = [...ways].sort((a, b) => b[1] - a[1])[0][0];
			all.set(key, { tag: best, count: all.get(key)!.count });
		}
		const note = file ? countTags(this.app, [file]) : new Map<string, number>();
		const stats: TagStats = { all, note, area: file ? this.areaTags(file) : new Map<string, number>() };
		this.statsCache = { at: now, file: path, stats };
		return stats;
	}

	/** Tags used in the notes of the same area as `file` (empty without Note rail or without an area). */
	private areaTags(file: TFile): Map<string, number> {
		const places = this.ctx.service<PlacesService>("places");
		if (!places || places.version !== 1) return new Map<string, number>();
		const area = places.placeOf(file).area;
		if (!area) return new Map<string, number>();
		const now = Date.now();
		if (!this.areaCache || now - this.areaCache.at > 60_000) {
			const members = new Map<string, TFile[]>();
			for (const f of this.app.vault.getMarkdownFiles()) {
				const a = places.placeOf(f).area;
				if (!a) continue;
				const list = members.get(a.path) ?? [];
				list.push(f);
				members.set(a.path, list);
			}
			const byArea = new Map<string, Map<string, number>>();
			for (const [path, files] of members) byArea.set(path, countTags(this.app, files));
			this.areaCache = { at: now, byArea };
		}
		return this.areaCache.byArea.get(area.path) ?? new Map<string, number>();
	}
}

/** Where the tag starting at `start` (its "#") ends on the line now: completing in the middle of "#pro|ject" replaces "ject" too. */
function tagEnd(editor: Editor, start: EditorPosition): EditorPosition {
	const rest = TAG_REST.exec(editor.getLine(start.line).slice(start.ch + 1))?.[0] ?? "";
	return { line: start.line, ch: start.ch + 1 + rest.length };
}

/** The stats without the one use of the tag being typed (the note's cache already holds "#pro" while "#project" is typed). */
export function withoutTyped(stats: TagStats, query: string): TagStats {
	const key = query.toLowerCase().replace(/\/+$/, "");
	if (!key || !stats.note.has(key)) return stats;
	const less = <V>(map: Map<string, V>, get: (v: V) => number, set: (v: V, n: number) => V) => {
		const out = new Map(map);
		const value = out.get(key);
		if (value === undefined) return out;
		const n = get(value) - 1;
		if (n > 0) out.set(key, set(value, n));
		else out.delete(key);
		return out;
	};
	return {
		all: less(stats.all, (v) => v.count, (v, n) => ({ ...v, count: n })),
		note: less(stats.note, (v) => v, (_v, n) => n),
		area: less(stats.area, (v) => v, (_v, n) => n),
	};
}

/** Uses of each tag (lowercased) in these notes. */
function countTags(app: App, files: TFile[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const f of files) {
		const cache = app.metadataCache.getFileCache(f);
		if (!cache) continue;
		for (const t of getAllTags(cache) ?? []) {
			const key = t.replace(/^#/, "").toLowerCase();
			out.set(key, (out.get(key) ?? 0) + 1);
		}
	}
	return out;
}
