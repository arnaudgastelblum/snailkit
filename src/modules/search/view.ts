import { MarkdownView, Platform, Scope, setIcon } from "obsidian";
import { Surface } from "../../ui/surface";
import { dailyConfig, getOrCreateDaily, todayKey, todayNote } from "../../core/daily";
import type { HomeService, NoteRailService, TasksReader, TagColorsReader } from "../../core/services";
import type { InlineSearch, InlineSearchHost, SearchFilter, SearchGroup, SearchOpenOptions, SearchResult, SearchSource } from "./types";
import { creationTitle, excerpt, parseQuery, tokenInput, insertLink, linkAtCursor, readableText, compactText, textRanges, type Token } from "./engine";
import { Sources } from "./sources";

type Row = { result?: SearchResult; label?: string; group?: string; run?: (event?: MouseEvent | KeyboardEvent) => Promise<void> | void };
let nextId = 0;
export function sourceOf(sources: Sources): SearchSource | null {
	const view = sources.ctx.app.workspace.getActiveViewOfType(MarkdownView);
	return view?.file ? { file: view.file, editor: null } : sources.lastSource;
}
export function element<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
	const el = parent.ownerDocument.createElement(tag); el.className = cls; if (text) el.textContent = text; parent.append(el); return el;
}
function highlight(parent: HTMLElement, text: string, words: string[]): void {
	let at = 0;
	for (const [start, end] of textRanges(text, words)) {
		parent.append(text.slice(at, start)); element(parent, "mark", "", text.slice(start, end)); at = end;
	}
	parent.append(text.slice(at));
}

export class SearchView implements InlineSearch {
	private readonly cleanups: Array<() => void> = [];
	private readonly list: HTMLElement;
	private readonly chips: HTMLElement;
	private readonly status: HTMLElement;
	private readonly surface: Surface;
	private readonly win: Window;
	private rows: Row[] = [];
	private tokens: Token[] = [];
	private filter: SearchFilter = "all";
	private controller = new AbortController();
	private timer: number | null = null;
	private refreshTimer: number | null = null;
	private generation = 0;
	private previewGeneration = 0;
	private previewKey = "";
	private renderedQuery = "";
	private refreshPending = false;
	private disposed = false;
	private actions: HTMLElement | null = null;
	private index = 0;
	private soft = true;
	private readonly originalAttributes: Array<[string, string | null]>;
	private readonly keyScope: Scope;
	private scoped = false;
	constructor(readonly sources: Sources, readonly host: InlineSearchHost, private readonly floating = false, private readonly done: (navigated?: boolean) => void = () => {}) {
		this.win = host.input.ownerDocument.defaultView!;
		this.keyScope = new Scope(floating ? undefined : sources.ctx.app.scope);
		for (const key of ["Enter", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Tab", "Backspace"]) {
			this.keyScope.register(null, key, event => {
				if (!this.owns(event.target)) return undefined;
				this.key(event); return event.defaultPrevented ? false : undefined;
			});
		}
		this.listen(host.input.ownerDocument, "focusin", event => this.syncScope(event.target));
		this.listen(host.input.ownerDocument, "focusout", event => this.syncScope((event as FocusEvent).relatedTarget));
		this.originalAttributes = ["role", "aria-controls", "aria-expanded", "aria-autocomplete", "aria-activedescendant"].map(key => [key, host.input.getAttribute(key)]);
		this.chips = element(host.results, "div", "sk-search-chips sk-segm");
		this.list = element(host.results, "div", `sk-search-list${floating ? "" : " is-inline"}`); this.list.id = `sk-search-${++nextId}`; this.list.setAttribute("role", "listbox");
		this.status = element(host.results, "div", "sk-search-status"); this.status.setAttribute("role", "status");
		host.input.setAttribute("role", "combobox"); host.input.setAttribute("aria-controls", this.list.id); host.input.setAttribute("aria-autocomplete", "list");
		this.surface = new Surface(this.list, { sticky: () => true, onSet: el => {
			this.index = Number(el.dataset.index); this.host.input.setAttribute("aria-activedescendant", el.id);
			for (const row of Array.from(this.list.querySelectorAll("[role=option]"))) row.setAttribute("aria-selected", String(row === el));
			void this.preview(this.rows[this.index]?.result, el);
		} });
		this.listen(host.input, "focus", () => { sources.use(this.win); this.update(); });
		this.listen(host.input, "input", () => { this.actions?.remove(); this.actions = null; this.refreshPending = false; this.soft = true; this.update(); });
		this.listen(host.input, "keydown", event => this.key(event as KeyboardEvent));
		this.listen(this.list, "keydown", event => this.key(event as KeyboardEvent));
		this.listen(this.list, "click", event => {
			const row = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
			if (row) { this.index = Number(row.dataset.index); void this.run(this.rows[this.index], event as MouseEvent); }
		});
		this.listen(this.list, "contextmenu", event => {
			const row = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
			if (row) { event.preventDefault(); this.index = Number(row.dataset.index); this.more(); }
		});
		this.listen(this.list, "scroll", () => this.layout());
		this.listen(this.win, "resize", () => this.layout());
		this.listen(this.win, "pagehide", () => this.destroy());
		this.cleanups.push(sources.onChange(() => {
			if (this.refreshTimer !== null) return;
			this.refreshTimer = this.win.setTimeout(() => { this.refreshTimer = null; if (this.actions) this.refreshPending = true; else this.update(); }, 80);
		}));
		this.update();
		this.syncScope(host.input.ownerDocument.activeElement);
	}
	private owns(target: EventTarget | null): boolean {
		const node = target as Node | null;
		return !!node?.nodeType && (node === this.host.input || this.host.results.contains(node) || !!this.host.tokens?.contains(node));
	}
	private syncScope(target: EventTarget | null): void {
		const want = !this.disposed && (this.floating || this.owns(target));
		if (want === this.scoped) return; this.scoped = want;
		if (want) this.sources.ctx.app.keymap.pushScope(this.keyScope); else this.sources.ctx.app.keymap.popScope(this.keyScope);
	}
	get active(): boolean { return !!this.host.input.value.trim() || this.tokens.length > 0 || this.filter !== "all"; }
	private t(key: string, vars?: Record<string, string | number>): string { return this.sources.ctx.t(key, vars); }
	private listen(target: EventTarget, name: string, callback: (event: Event) => void): void { target.addEventListener(name, callback); this.cleanups.push(() => target.removeEventListener(name, callback)); }
	private raw(): string { return this.tokens.map(token => (token.kind === "tag" ? "#" : "in:") + token.value + " ").join("") + this.host.input.value; }
	setQuery(text: string): void { this.actions?.remove(); this.actions = null; this.refreshPending = false; this.tokens = []; this.host.input.value = text; this.update(); }
	clear(focus = true): void { this.actions?.remove(); this.actions = null; this.refreshPending = false; this.tokens = []; this.filter = "all"; this.host.input.value = ""; this.soft = true; this.update(); if (focus) this.host.input.focus(); }
	private update(): void {
		if (this.disposed) return;
		if (this.active || this.floating || this.host.input.ownerDocument.activeElement === this.host.input) this.sources.use(this.win);
		this.controller.abort(); this.controller = new AbortController();
		if (this.timer !== null) this.win.clearTimeout(this.timer);
		const generation = ++this.generation;
		if (this.host.tokens) {
			const parsed = parseQuery(this.host.input.value, this.sources.tags());
			if (parsed.tokens.length) { this.tokens.push(...parsed.tokens); this.host.input.value = tokenInput(this.host.input.value, parsed); }
			this.host.tokens.replaceChildren();
			this.tokens.forEach((token, index) => {
				const chip = element(this.host.tokens!, "button", "sk-btn is-s sk-search-token", (token.kind === "tag" ? "#" : "in:") + token.value + " ×");
				chip.type = "button"; chip.setAttribute("aria-label", this.t("remove", { filter: token.value }));
				chip.onclick = () => { this.tokens.splice(index, 1); this.update(); this.host.input.focus(); };
			});
		}
		this.host.onActive(this.active); this.chips.hidden = !this.active && !this.floating;
		this.chips.replaceChildren();
		for (const filter of ["all", "notes", "tasks", "brainstorms"] as SearchFilter[]) {
			const button = element(this.chips, "button", "sk-btn is-s", this.t(`filter.${filter}`)); button.type = "button";
			button.setAttribute("aria-pressed", String(this.filter === filter)); button.onclick = () => { this.filter = filter; this.update(); this.host.input.focus(); };
		}
		if (!this.active) { this.render([], this.floating ? this.emptyRows() : []); return; }
		if (this.sources.building && !this.sources.catalog.size) { this.render([], [], false); this.status.textContent = this.t("loading"); return; }
		const raw = this.raw(), query = parseQuery(raw, this.sources.tags());
		const groups = this.sources.titles(raw, { filter: this.filter });
		const content = this.sources.ctx.settings.content && query.text.length >= 3 && query.tagPrefix === null && (this.filter === "all" || this.filter === "notes");
		this.render(groups, [], !content);
		if (content) {
			this.status.textContent = this.t("searching");
			this.timer = this.win.setTimeout(() => {
				this.timer = null;
				void this.sources.textResults(query, this.controller.signal).then(found => { if (!this.disposed && generation === this.generation) { this.render([...groups, ...found], [], !this.sources.contentIndexing); if (this.sources.contentIndexing) this.status.textContent = this.t("indexing"); } });
			}, Platform.isMobile ? 220 : 100);
		}
	}
	private emptyRows(): Row[] {
		const app = this.sources.ctx.app, rail = this.sources.service<NoteRailService>("note-rail");
		const cfg = dailyConfig(app, rail), today = todayNote(app, cfg);
		const rows: Row[] = [];
		if (!today) rows.push({ group: "empty.today", label: this.t("today.create"), run: async event => { const file = await getOrCreateDaily(app, todayKey(), cfg); await this.openCreated(file.path, event); } });
		const sections: Array<[string, string[]]> = [["empty.today", today ? [today.path] : []], ["empty.recent", [...new Set(app.workspace.getLastOpenFiles())].filter(path => path !== today?.path).slice(0, 5)], ["empty.pins", rail?.vaultPins() ?? []]];
		for (const [group, paths] of sections) for (const path of paths) {
			const entry = this.sources.catalog.get(path)?.[0];
			if (entry) rows.push({ group, result: { ...entry, ranges: [], score: 0 } });
		}
		return rows;
	}
	private render(groups: SearchGroup[], extras: Row[] = [], allowCreate = true): void {
		const previous = this.rows[this.index]?.result;
		const hadFocus = this.list.contains(this.host.input.ownerDocument.activeElement);
		if (this.actions) { this.refreshPending = true; return; }
		const query = JSON.stringify([this.raw(), this.filter]), sameQuery = query === this.renderedQuery;
		this.renderedQuery = query;
		this.surface.clear();
		for (const child of Array.from(this.list.children)) if (child !== this.surface.cursorEl) child.remove();
		this.rows = []; this.index = 0; this.status.textContent = "";
		const append = (row: Row) => {
			const index = this.rows.push(row) - 1, result = row.result;
			const el = element(this.list, "div", "sk-search-row sk-surface-item"); el.dataset.nav = ""; el.dataset.index = String(index); el.id = `${this.list.id}-${index}`; el.tabIndex = -1; el.setAttribute("role", "option"); el.setAttribute("aria-selected", "false");
			if (result?.hue !== null && result?.hue !== undefined) el.style.setProperty("--sk-hue", String(result.hue));
			else el.classList.add("is-gray");
			const icon = element(el, "span", "sk-search-row-icon"); setIcon(icon, result ? ({ note: "file", section: "heading", task: "square-check", brainstorm: "zap", domain: "circle", tag: "hash", content: "text" }[result.kind]) : "plus");
			const body = element(el, "span", "sk-search-row-body"), title = element(body, "span", "sk-search-title");
			const text = result?.title ?? row.label ?? ""; let offset = 0;
			for (const [start, end] of result?.ranges ?? []) { title.append(text.slice(offset, start)); element(title, "mark", "", text.slice(start, end)); offset = end; }
			title.append(text.slice(offset));
			if (result?.kind === "tag") title.className += " sk-search-tag " + (this.sources.service<TagColorsReader>("tag-colors")?.classes(result.title) ?? "");
			if (result?.snippet) {
				const snippet = element(body, "span", "sk-search-snippet"), words = parseQuery(this.raw()).words;
				highlight(snippet, result.snippet, words);
			}
			if (result?.trail) element(body, "span", "sk-search-trail", result.trail);
			if (result?.path) el.title = result.path;
			if (result) {
				const more = element(el, "button", "sk-btn is-ghost is-icon sk-search-more", "⋯");
				more.type = "button"; more.tabIndex = -1; more.setAttribute("aria-label", this.t("action.more"));
				more.onclick = event => { event.stopPropagation(); this.index = index; this.more(); };
			}
		};
		for (const group of groups) { element(this.list, "div", "sk-search-group", this.t(`group.${group.kind}`)); group.results.forEach(result => append({ result })); }
		let previousGroup = "";
		for (const row of extras) { if (row.group && row.group !== previousGroup) { element(this.list, "div", "sk-search-group", this.t(row.group)); previousGroup = row.group; } append(row); }
		const title = allowCreate && this.active ? creationTitle(parseQuery(this.raw(), this.sources.tags()), groups) : null;
		if (title) append({ label: this.t("create", { title }), run: async event => {
			const safe = title.replace(/[\\/:*?"<>|\[\]#^]/g, " ").trim(); if (!safe || safe === "." || safe === "..") return;
			const app = this.sources.ctx.app, folder = app.fileManager.getNewFileParent(this.host.source?.()?.file.path ?? "");
			const parent = folder.path.replace(/^\/+|\/+$/g, "");
			const path = (parent ? parent + "/" : "") + safe + ".md";
			const file = app.vault.getFileByPath(path) ?? await app.vault.create(path, "");
			await this.openCreated(file.path, event);
		} });
		if (this.active && this.omnisearch()) append({ label: this.t("omnisearch"), run: () => { this.win.open(`obsidian://omnisearch?vault=${encodeURIComponent(this.sources.ctx.app.vault.getName())}&query=${encodeURIComponent(this.raw())}`); this.done(true); } });
		this.host.input.setAttribute("aria-expanded", String(this.rows.length > 0));
		this.host.input.removeAttribute("aria-activedescendant");
		this.list.classList.toggle("is-soft", this.soft);
		const kept = sameQuery && previous ? this.rows.findIndex(row => row.result?.path === previous.path && row.result?.kind === previous.kind && row.result?.line === previous.line && row.result?.title === previous.title) : -1;
		const first = this.list.querySelector<HTMLElement>(`[data-index="${Math.max(0, kept)}"]`);
		if (first) { this.surface.set(first, "key", true); if (hadFocus) this.surface.focus(first); }
		else { this.previewKey = ""; this.previewGeneration++; this.host.preview?.replaceChildren(); }
	}
	private omnisearch(): boolean { return !!(this.sources.ctx.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins?.omnisearch; }
	private key(event: KeyboardEvent): void {
		if (event.isComposing || event.defaultPrevented) return;
		if (this.actions && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
			event.preventDefault(); const buttons = Array.from(this.actions.querySelectorAll("button"));
			const at = buttons.indexOf(this.host.input.ownerDocument.activeElement as HTMLButtonElement);
			buttons[Math.max(0, Math.min(buttons.length - 1, at + (event.key === "ArrowRight" ? 1 : -1)))]?.focus(); return;
		}
		if (event.key === "Escape") {
			event.preventDefault(); event.stopPropagation();
			if (this.actions) { this.actions.remove(); this.actions = null; this.host.input.focus(); if (this.refreshPending) { this.refreshPending = false; this.update(); } }
			else if (this.active) this.clear(); else this.host.onEscape?.(); return;
		}
		if (event.key === "Backspace" && event.target === this.host.input && this.host.input.selectionStart === 0 && this.host.input.selectionEnd === 0 && this.tokens.length) { event.preventDefault(); this.tokens.pop(); this.update(); return; }
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			if (!this.active && !this.floating) { if (event.key === "ArrowDown") { event.preventDefault(); this.host.onLeave?.(); } return; }
			event.preventDefault();
			if (this.soft) { this.soft = false; this.list.classList.remove("is-soft"); const first = this.list.querySelector<HTMLElement>("[data-nav]"); if (first) this.surface.focus(first); }
			else if (!this.surface.move(event.key === "ArrowDown" ? "down" : "up") && event.key === "ArrowUp") { this.soft = true; this.list.classList.add("is-soft"); this.host.input.focus(); } return;
		}
		if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !this.actions && this.list.contains(event.target as Node)) {
			event.preventDefault(); this.host.input.focus(); const input = this.host.input; const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start; input.value = input.value.slice(0, start) + event.key + input.value.slice(end); this.soft = true; this.update(); return;
		}
		if (event.key === "Tab" && !event.shiftKey && this.rows.length && !this.actions) { event.preventDefault(); this.more(); return; }
		if (event.key === "Enter" && !(event.target as HTMLElement).closest("button")) { event.preventDefault(); void this.run(this.rows[this.index], event); }
	}
	private async run(row: Row | undefined, event?: MouseEvent | KeyboardEvent): Promise<void> {
		try {
			if (row?.run) { await row.run(event); return; }
			const result = row?.result; if (!result) return;
			const app = this.sources.ctx.app;
			if (event?.shiftKey) {
				const source = this.sources.resolveSource(this.host.source?.() ?? sourceOf(this.sources)); const file = result.path ? app.vault.getFileByPath(result.path) : null;
				if (!source || !file) { this.sources.ctx.toast(this.t("no-source")); return; }
				const link = app.fileManager.generateMarkdownLink(file, source.file.path, result.kind === "section" ? "#" + result.title : undefined);
				if (source.editor) {
					const editor = source.editor;
					const from = editor.getCursor("from");
					const empty = !editor.somethingSelected();
					editor.replaceSelection(empty ? linkAtCursor(editor.getLine(from.line), from.ch, link) : link);
				} else await app.vault.process(source.file, text => insertLink(text, link));
				this.done(); return;
			}
			const home = this.sources.service<HomeService>("home");
			if (result.kind === "tag") {
				if (!await home?.openTag(result.title)) {
					const leaf = app.workspace.getLeavesOfType("search")[0] ?? app.workspace.getLeftLeaf(false);
					if (leaf) { await leaf.setViewState({ type: "search", state: { query: "tag:#" + result.title }, active: true }); await app.workspace.revealLeaf(leaf); }
				}
			} else if (result.kind !== "domain" || !result.path || !await home?.openDomain(result.path)) {
				if (!result.path) return;
				if (this.host.openNote) this.host.openNote(result.path, result.line, event);
				else { const file = app.vault.getFileByPath(result.path); if (file) await app.workspace.getLeaf(event?.ctrlKey || event?.metaKey ? "tab" : false).openFile(file, { eState: result.line === null ? undefined : { line: result.line } }); }
			}
			if (!event?.ctrlKey && !event?.metaKey) this.done(true);
		} catch { this.sources.ctx.toast(this.t("failed")); }
	}
	private async openCreated(path: string, event?: MouseEvent | KeyboardEvent): Promise<void> {
		if (this.host.openNote) this.host.openNote(path, null, event);
		else { const file = this.sources.ctx.app.vault.getFileByPath(path); if (file) await this.sources.ctx.app.workspace.getLeaf(event?.ctrlKey || event?.metaKey ? "tab" : false).openFile(file); }
		this.done(true);
	}
	private more(): void {
		const result = this.rows[this.index]?.result; if (!result) return;
		this.actions?.remove();
		this.actions = element(this.list, "div", "sk-search-actions");
		const selected = this.list.querySelector<HTMLElement>(`[data-index="${this.index}"]`); selected?.after(this.actions);
		const add = (key: string, run: () => unknown) => { const button = element(this.actions!, "button", "sk-btn is-s", this.t(key)); button.type = "button"; button.onclick = () => { void Promise.resolve().then(run).catch(() => this.sources.ctx.toast(this.t("failed"))); }; };
		const app = this.sources.ctx.app;
		if (result.kind === "tag") {
			add("action.filter", () => this.setQuery("#" + result.title + " ")); add("action.tag", () => this.run({ result }));
		} else if (result.path) {
			add("action.side", async () => { const file = app.vault.getFileByPath(result.path!); if (file) await app.workspace.getLeaf("split").openFile(file, { eState: { line: result.line ?? 0 } }); this.done(true); });
			const rail = this.sources.service<NoteRailService>("note-rail");
			if (rail) add(rail.isPinned(result.path) ? "action.unpin" : "action.pin", async () => { await rail.setPinned(result.path!, !rail.isPinned(result.path!)); this.more(); });
			add("action.copy", async () => { const file = app.vault.getFileByPath(result.path!); if (file) await this.win.navigator.clipboard.writeText(app.fileManager.generateMarkdownLink(file, this.host.source?.()?.file.path ?? "")); });
			if (result.kind === "task") add("action.check", async () => {
				const tasks = this.sources.service<TasksReader>("tasks"), task = tasks?.getTasks().find(task => task.path === result.path && task.line === result.line);
				if (task && task.plainTitle === result.title) await tasks!.setDone({ path: task.path, line: task.line, raw: task.raw }, true);
				else this.sources.ctx.toast(this.t("failed"));
			});
		}
		this.actions.querySelector("button")?.focus();
	}
	private async preview(result?: SearchResult, row?: HTMLElement): Promise<void> {
		this.layout();
		const key = JSON.stringify([result?.path, result?.line, result?.title, this.raw()]);
		if (key === this.previewKey) return; this.previewKey = key;
		const generation = ++this.previewGeneration, preview = this.host.preview;
		if (!preview) return; preview.replaceChildren();
		if (!result?.path || Platform.isMobile) return;
		const file = this.sources.ctx.app.vault.getFileByPath(result.path); if (!file) return;
		try {
			const text = readableText((await this.sources.ctx.app.vault.cachedRead(file)).slice(0, 1048576));
			if (this.disposed || generation !== this.previewGeneration) return;
			element(preview, "strong", "sk-search-preview-title", result.title);
			// The top of a note starts after its properties (raw YAML says little).
			const start = result.line === null ? this.sources.ctx.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset ?? 0 : 0;
			const words = parseQuery(this.raw()).words;
			const body = result.line === null ? excerpt(text.slice(start, start + 8192).replace(/^\s+/, ""), words, 240).text : text.split("\n").slice(Math.max(0, result.line - 2), result.line + 5).join("\n");
			highlight(element(preview, "div", "sk-search-preview-text"), compactText(body), words);
			if (!this.floating && row) preview.style.transform = `translateY(${Math.max(0, row.getBoundingClientRect().top - this.host.results.getBoundingClientRect().top)}px)`;
		} catch { /* An unavailable preview must not block navigation. */ }
	}
	layout(): void {
		this.surface.repaint(true);
		if (!this.floating && this.host.preview && this.surface.current) this.host.preview.style.transform = `translateY(${Math.max(0, this.surface.current.getBoundingClientRect().top - this.host.results.getBoundingClientRect().top)}px)`;
	}
	destroy(): void {
		if (this.disposed) return; this.disposed = true; this.controller.abort(); this.generation++; this.previewGeneration++;
		this.syncScope(null);
		if (this.timer !== null) this.win.clearTimeout(this.timer); if (this.refreshTimer !== null) this.win.clearTimeout(this.refreshTimer);
		this.cleanups.splice(0).forEach(off => off()); this.surface.destroy(); this.chips.remove(); this.list.remove(); this.status.remove(); this.host.tokens?.replaceChildren(); this.host.preview?.replaceChildren();
		if (this.host.preview) this.host.preview.style.removeProperty("transform");
		for (const [key, value] of this.originalAttributes) { if (value === null) this.host.input.removeAttribute(key); else this.host.input.setAttribute(key, value); }
		this.host.onActive(false);
	}
}

export function openFloating(sources: Sources, options: SearchOpenOptions, onClose: () => void): () => void {
	const app = sources.ctx.app, doc = options.anchor?.ownerDocument ?? app.workspace.getMostRecentLeaf()?.view.containerEl.ownerDocument ?? app.workspace.containerEl.ownerDocument;
	const win = doc.defaultView!, previous = doc.activeElement as HTMLElement | null;
	const origin = options.from ?? sourceOf(sources);
	const from = origin ? { file: origin.file } : null;
	const backdrop = element(doc.body, "div", "sk-search-backdrop"), box = element(backdrop, "div", "sk-search-dialog");
	// Named by hidden text: an aria-label would show as Obsidian's tooltip over the whole window.
	const name = element(box, "span", "sk-search-sr", "Search"); name.id = `sk-search-name-${++nextId}`;
	box.setAttribute("role", "dialog"); box.setAttribute("aria-labelledby", name.id); box.setAttribute("aria-modal", "true");
	const top = element(box, "div", "sk-search-field"), tokens = element(top, "div", "sk-search-tokens"), input = element(top, "input", "sk-search-input");
	input.type = "search"; input.placeholder = sources.ctx.t("placeholder"); input.setAttribute("aria-labelledby", name.id);
	input.spellcheck = false; input.autocomplete = "off";
	const closeButton = element(top, "button", "sk-btn is-icon", "×"); closeButton.setAttribute("aria-label", sources.ctx.t("close"));
	const body = element(box, "div", "sk-search-body"), results = element(body, "div", "sk-search-results"), preview = element(body, "aside", "sk-search-preview");
	// Touch screens have no keys to learn: the footer only names the tool.
	element(box, "footer", "sk-search-footer", Platform.isMobile ? "Search" : "Search · " + sources.ctx.t("keys"));
	let closed = false;
	const close = (navigated = false) => { if (closed) return; closed = true; view.destroy(); backdrop.remove(); viewport?.removeEventListener("resize", layout); viewport?.removeEventListener("scroll", layout); win.removeEventListener("resize", layout); win.removeEventListener("pagehide", dismiss); if (!navigated && previous?.isConnected) previous.focus(); onClose(); };
	const view = new SearchView(sources, { input, results, tokens, preview, onActive() {}, source: () => from, onEscape: () => close() }, true, close);
	const dismiss = () => close();
	closeButton.onclick = dismiss; backdrop.onclick = event => { if (event.target === backdrop) close(); };
	const viewport = win.visualViewport;
	const layout = () => {
		const mobile = Platform.isMobile || win.innerWidth < 600; box.classList.toggle("is-phone", mobile);
		box.style.maxHeight = `${(viewport?.height ?? win.innerHeight) - (mobile ? 0 : 48)}px`;
		if (mobile) { box.style.top = `${viewport?.offsetTop ?? 0}px`; box.style.left = `${viewport?.offsetLeft ?? 0}px`; box.style.height = `${viewport?.height ?? win.innerHeight}px`; }
		else { box.style.top = "48px"; box.style.left = ""; box.style.height = ""; }
		view.layout();
	};
	viewport?.addEventListener("resize", layout); viewport?.addEventListener("scroll", layout); win.addEventListener("resize", layout); layout();
	win.addEventListener("pagehide", dismiss);
	box.addEventListener("animationend", event => { if (event.target === box) view.layout(); });
	if (options.anchor && !Platform.isMobile) { const a = options.anchor.getBoundingClientRect(), b = box.getBoundingClientRect(); box.style.transformOrigin = `${a.left + a.width / 2 - b.left}px ${a.top + a.height / 2 - b.top}px`; }
	box.classList.add("is-opening");
	backdrop.addEventListener("keydown", event => {
		if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); if (view.active) view.clear(); else close(); return; }
		if (event.key !== "Tab" || event.defaultPrevented) return;
		const buttons = Array.from(box.querySelectorAll<HTMLElement>("input,button")).filter(el => !el.hidden && el.getClientRects().length);
		if (event.shiftKey && doc.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
		else if (!event.shiftKey && doc.activeElement === buttons.at(-1)) { event.preventDefault(); input.focus(); }
	});
	if (options.query) view.setQuery(options.query);
	// Asked for by a tap or a key: the field takes the focus (on phones, the keyboard comes up, as in Obsidian's own switcher).
	input.focus();
	return close;
}
