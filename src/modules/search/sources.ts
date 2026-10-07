import { getAllTags, MarkdownView, Platform, TFile } from "obsidian";
import type { ModuleContext } from "../../core/context";
import type { TasksReader, SessionsReader, NoteRailService } from "../../core/services";
import { accepts, capText, fold, foldedTokens, parseQuery, search, excerpt, readableText, compactText, rankBonus, LIMITS, type Entry, type Query } from "./engine";
import type { SearchSettings, SearchFilter, SearchGroup, SearchSource } from "./types";

export const CONTENT_CAP = 1024 * 1024;
const CHUNK = 8192;
export function excluded(path: string, filters: readonly string[]): boolean {
	return filters.some(filter => {
		if (filter.startsWith("/") && filter.endsWith("/")) {
			try { return new RegExp(filter.slice(1, -1)).test(path); } catch { return false; }
		}
		return path.toLowerCase().includes(filter.toLowerCase());
	});
}

/** Shared indexing uses the app window so closing a popout cannot strand pending work. */
export class Sources {
	lastSource: SearchSource | null = null;
	readonly catalog = new Map<string, Entry[]>();
	readonly content = new Map<string, string>();
	private listeners = new Set<() => void>();
	private subscriptions: Array<() => void> = [];
	private pending = new Set<string>();
	private revisions = new Map<string, number>();
	private revision = 0;
	private refreshingPlaces = false;
	private placesAgain = false;
	private started = false;
	private indexing = false;
	private disposed = false;
	private timers = new Map<number, () => void>();
	private win: Window;
	private loaded = false;
	private snapshot: Entry[] | null = null;
	private tagSnapshot: string[] | null = null;
	private rebuilding = false;
	private rebuildAgain = false;
	private ready: Promise<void> = Promise.resolve();
	private ignoredSignature = "";
	private resolvedSeen = false;
	get building(): boolean { return this.rebuilding; }
	get contentIndexing(): boolean { return this.indexing || this.pending.size > 0; }
	get stopped(): boolean { return this.disposed; }
	constructor(readonly ctx: ModuleContext<SearchSettings>) {
		this.win = ctx.app.workspace.containerEl.ownerDocument.defaultView!;
		const remember = () => { const view = ctx.app.workspace.getActiveViewOfType(MarkdownView); if (view?.file) this.lastSource = { file: view.file, editor: null }; };
		remember(); ctx.registerEvent(ctx.app.workspace.on("active-leaf-change", remember));
		ctx.registerEvent(ctx.app.workspace.on("file-open", remember));
		ctx.registerEvent(ctx.app.metadataCache.on("changed", file => { if (this.loaded) this.update(file); this.changed(); }));
		ctx.registerEvent(ctx.app.metadataCache.on("resolved", () => {
			// During a bulk import Obsidian can finish resolution after every file. Changed
			// already updates those files; only the first resolution needs a full refresh.
			if (this.resolvedSeen) return; this.resolvedSeen = true;
			if (this.loaded) this.rebuild(); this.changed();
		}));
		ctx.registerEvent(ctx.app.vault.on("modify", file => { if ("extension" in file) this.queue(file.path); }));
		ctx.registerEvent(ctx.app.vault.on("create", file => { if (file instanceof TFile && this.loaded) this.update(file); this.queue(file.path); }));
		ctx.registerEvent(ctx.app.vault.on("rename", (file, old) => {
			for (const path of this.catalog.keys()) if (path === old || path.startsWith(old + "/")) this.remove(path);
			if (file instanceof TFile) { if (this.loaded) this.update(file); this.queue(file.path); }
			else for (const note of ctx.app.vault.getMarkdownFiles()) if (note.path.startsWith(file.path + "/")) { if (this.loaded) this.update(note); this.queue(note.path); }
			this.changed();
		}));
		ctx.registerEvent(ctx.app.vault.on("delete", file => {
			for (const path of this.catalog.keys()) if (path === file.path || path.startsWith(file.path + "/")) this.remove(path);
			this.changed();
		}));
		ctx.register(ctx.places.onChange(() => { if (this.loaded) void this.refreshPlaces(); }));
		const bind = () => {
			this.subscriptions.splice(0).forEach(off => off());
			const tasks = this.service<TasksReader>("tasks"), sessions = this.service<SessionsReader>("sessions"), rail = this.service<NoteRailService>("note-rail");
			if (tasks) this.subscriptions.push(tasks.on("change", () => this.changed()));
			if (sessions?.onChange) this.subscriptions.push(sessions.onChange(() => this.changed()));
			if (rail) this.subscriptions.push(rail.onPinsChange(() => this.changed()));
			this.changed();
		};
		bind(); ctx.onServicesChange(bind);
		ctx.onSettingsChange(() => { if (!ctx.settings.content) { this.started = false; this.pending.clear(); this.content.clear(); } else if (this.loaded) this.startContent(); this.changed(); });
		ctx.register(() => this.destroy());
	}
	service<T extends { version: number }>(name: string): T | undefined {
		const value = this.ctx.service<T>(name); return value?.version === 1 ? value : undefined;
	}
	resolveSource(source: SearchSource | null): SearchSource | null {
		const file = source ? this.ctx.app.vault.getFileByPath(source.file.path) : null;
		if (!file) return null;
		const views = this.ctx.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view)
			.filter((view): view is MarkdownView => view instanceof MarkdownView && view.file?.path === file.path && view.getMode() === "source");
		const view = views.find(view => view.editor === source?.editor) ?? views[0];
		return { file, editor: view?.editor ?? null };
	}
	onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
	private changed(invalidate = true): void { if (invalidate) { this.snapshot = null; this.tagSnapshot = null; } if (!this.disposed) this.listeners.forEach(fn => fn()); }
	use(_win?: Window): void {
		if (this.disposed) return;
		const signature = JSON.stringify((this.ctx.app.vault as unknown as { getConfig?(key: string): unknown }).getConfig?.("userIgnoreFilters") ?? []);
		if (signature !== this.ignoredSignature) { this.ignoredSignature = signature; if (this.loaded) this.rebuild(); }
		if (!this.loaded) { this.loaded = true; this.rebuild(); }
		if (!this.rebuilding) this.startContent();
	}
	async ensureReady(): Promise<void> { this.use(); await this.ready; }
	allowed(path: string): boolean {
		const cache = this.ctx.app.metadataCache as unknown as { isUserIgnored?(path: string): boolean };
		if (cache.isUserIgnored) return !cache.isUserIgnored(path);
		const vault = this.ctx.app.vault as unknown as { getConfig?(key: string): unknown };
		const filters = vault.getConfig?.("userIgnoreFilters");
		return !excluded(path, Array.isArray(filters) ? filters.filter((f): f is string => typeof f === "string") : []);
	}
	private rebuild(): void {
		if (this.rebuilding) { this.rebuildAgain = true; return; }
		this.ready = this.buildCatalog();
	}
	private async buildCatalog(): Promise<void> {
		this.rebuilding = true;
		do {
			this.rebuildAgain = false;
			await this.pause();
			const files = this.ctx.app.vault.getMarkdownFiles(), live = new Set<string>();
			let slice = performance.now();
			for (const file of files) {
				if (this.disposed) return;
				live.add(file.path); this.update(file);
				if (performance.now() - slice >= 8) { await this.pause(); slice = performance.now(); }
			}
			for (const path of this.catalog.keys()) if (!live.has(path)) this.remove(path);
		} while (this.rebuildAgain && !this.disposed);
		// Keep the first query's snapshot work out of the same task as catalog construction.
		await this.pause(); if (this.disposed) return;
		this.tags();
		await this.pause(); if (this.disposed) return;
		this.ctx.places.domains();
		await this.pause(); if (this.disposed) return;
		this.entries();
		await this.pause(); if (this.disposed) return;
		this.rebuilding = false; this.changed(false);
		if (this.started) {
			for (const path of this.catalog.keys()) if (!this.content.has(path)) this.pending.add(path);
			if (this.pending.size) void this.pump();
		} else this.startContent();
	}
	/** Places changes reuse titles, aliases and headings already in the catalog. */
	private async refreshPlaces(): Promise<void> {
		if (this.refreshingPlaces) { this.placesAgain = true; return; }
		this.refreshingPlaces = true;
		try {
			do {
				this.placesAgain = false;
				let slice = performance.now();
				for (const [path, rows] of this.catalog) {
					if (this.disposed) return;
					const file = this.ctx.app.vault.getFileByPath(path);
					if (!file || !this.allowed(path)) { this.remove(path); continue; }
					const place = this.ctx.places.placeOf(file), area = place.area;
					const nearest = place.chain.find(parent => parent.path !== area?.path && parent.path !== this.ctx.places.homePath());
					for (const row of rows) {
						row.domain = fold(area?.basename ?? ""); row.hue = area ? this.ctx.places.hueOf(area.path) : null;
						row.trail = area?.path === path ? "" : [area?.basename, nearest?.basename].filter(Boolean).join(" › ");
					}
					if (performance.now() - slice >= 8) { await this.pause(); slice = performance.now(); }
				}
			} while (this.placesAgain && !this.disposed);
		} finally { this.refreshingPlaces = false; this.changed(); }
	}
	private update(file: TFile): void {
		this.snapshot = null; this.tagSnapshot = null;
		if (file.extension !== "md" || !this.allowed(file.path)) { this.remove(file.path); return; }
		const cache = this.ctx.app.metadataCache.getFileCache(file);
		const place = this.ctx.places.placeOf(file);
		const area = place.area;
		const nearest = place.chain.find(parent => parent.path !== area?.path && parent.path !== this.ctx.places.homePath());
		const aliases: unknown = cache?.frontmatter?.aliases ?? cache?.frontmatter?.alias;
		const base: Entry = { kind: "note", title: file.basename, folded: fold(file.basename), path: file.path, line: null,
			aliases: (Array.isArray(aliases) ? aliases.filter((alias): alias is string => typeof alias === "string") : typeof aliases === "string" ? aliases.split(",").map(alias => alias.trim()) : []).map(fold), tags: (cache ? getAllTags(cache) ?? [] : []).map(tag => fold(tag.replace(/^#/, ""))),
			domain: fold(area?.basename ?? ""), hue: area ? this.ctx.places.hueOf(area.path) : null,
			// The area note itself (a domain) shows no trail: it would only repeat its own name.
			trail: area?.path === file.path ? "" : [area?.basename, nearest?.basename].filter(Boolean).join(" › "), modified: file.stat.mtime };
		this.catalog.set(file.path, [base, ...(cache?.headings ?? []).map(h => ({ ...base, kind: "section" as const, title: h.heading, folded: fold(h.heading), aliases: [], line: h.position.start.line }))]);
	}
	private remove(path: string): void { this.snapshot = null; this.tagSnapshot = null; this.catalog.delete(path); this.content.delete(path); this.pending.delete(path); this.revisions.delete(path); }
	tags(): string[] {
		if (this.tagSnapshot) return this.tagSnapshot;
		const cache = this.ctx.app.metadataCache as unknown as { getTags?(): Record<string, number> };
		const allowed = new Set<string>();
		for (const rows of this.catalog.values()) rows[0].tags.forEach(tag => allowed.add(tag));
		return this.tagSnapshot = Object.keys(cache.getTags?.() ?? Object.fromEntries([...allowed].map(tag => [tag, 1]))).map(tag => tag.replace(/^#/, "")).filter(tag => allowed.has(fold(tag)));
	}
	entries(): Entry[] {
		if (this.snapshot) return this.snapshot;
		const sessions = this.service<SessionsReader>("sessions")?.list?.() ?? [];
		const brainstorms = new Map(sessions.map(session => [session.path, session]));
		const entries = Array.from(this.catalog.values()).flatMap(rows => {
			const session = brainstorms.get(rows[0].path!);
			return session ? rows.map(row => row.kind === "note" ? { ...row, kind: "brainstorm" as const, title: session.title, folded: fold(session.title) } : row) : rows;
		});
		for (const task of this.service<TasksReader>("tasks")?.getTasks({ includeDone: false }) ?? []) {
			const base = this.catalog.get(task.path)?.[0];
			if (base) entries.push({ ...base, kind: "task", title: task.plainTitle, folded: fold(task.plainTitle), aliases: [], line: task.line, tags: [...new Set([...base.tags, ...task.tags.map(tag => fold(tag.replace(/^#/, "")))])] });
		}
		for (const domain of this.ctx.places.domains()) {
			const base = this.catalog.get(domain.path)?.[0];
			if (base) entries.push({ ...base, kind: "domain" });
		}
		for (const tag of this.tags()) entries.push({ kind: "tag", title: tag, folded: fold(tag), path: null, line: null, tags: [fold(tag)], domain: "", hue: null, trail: "", modified: 0 });
		return this.snapshot = entries;
	}
	titles(text: string, options: { filter?: SearchFilter; limit?: number } = {}): SearchGroup[] {
		this.use();
		const active = this.ctx.app.workspace.getActiveFile();
		return search(this.entries(), parseQuery(text, this.tags()), { ...options, domain: active ? this.catalog.get(active.path)?.[0].domain : undefined });
	}
	private startContent(): void {
		if (this.started || Platform.isMobile || !this.ctx.settings.content || this.disposed) return;
		this.started = true;
		for (const path of this.catalog.keys()) this.pending.add(path);
		void this.pump();
	}
	private queue(path: string): void {
		const file = this.ctx.app.vault.getFileByPath(path);
		if (file?.extension !== "md" || !this.allowed(path)) return;
		if (this.revisions.has(path)) this.revisions.set(path, ++this.revision);
		this.content.delete(path);
		if (this.started) { this.pending.add(path); void this.pump(); }
	}
	private pause(): Promise<void> {
		if (this.disposed) return Promise.resolve();
		return new Promise(resolve => { const timer = this.win.setTimeout(() => { this.timers.delete(timer); resolve(); }, 0); this.timers.set(timer, resolve); });
	}
	private async pump(): Promise<void> {
		if (this.indexing || this.disposed) return;
		this.indexing = true;
		try {
			await this.pause();
			let slice = performance.now();
			while (this.pending.size && !this.disposed && this.ctx.settings.content) {
				const path = this.pending.values().next().value!; this.pending.delete(path);
				const file = this.ctx.app.vault.getFileByPath(path);
				if (!file || file.extension !== "md" || !this.catalog.has(path) || !this.allowed(path)) { this.revisions.delete(path); continue; }
				const revision = ++this.revision; this.revisions.set(path, revision);
				try {
					const text = readableText(capText(await this.ctx.app.vault.cachedRead(file), CONTENT_CAP));
					const chunks: string[] = [];
					for (let at = 0; at < text.length && !this.disposed && this.ctx.settings.content; at += CHUNK) {
						chunks.push(fold(text.slice(at, at + CHUNK)));
						if (performance.now() - slice >= 8) { await this.pause(); slice = performance.now(); }
					}
					if (!this.disposed && this.ctx.settings.content && this.catalog.has(path) && revision === this.revisions.get(path)) this.content.set(path, chunks.join(""));
				} catch { /* Deleted or unavailable files leave the index. */ }
				finally { if (!this.pending.has(path)) this.revisions.delete(path); }
				if (performance.now() - slice >= 8) { await this.pause(); slice = performance.now(); }
			}
		} finally { this.indexing = false; this.changed(false); }
	}
	async textResults(query: Query, signal: AbortSignal, limit?: number): Promise<SearchGroup[]> {
		if (!this.ctx.settings.content || query.text.length < 3 || query.tagPrefix !== null) return [];
		const candidates: Array<{ base: Entry; text?: string; offset: number; score: number }> = [];
		const count = Math.max(0, Math.floor(limit ?? LIMITS.content)); if (!count) return [];
		const active = this.ctx.app.workspace.getActiveFile(), now = Date.now();
		const domain = active ? this.catalog.get(active.path)?.[0].domain : undefined;
		let found = 0;
		const tokens = foldedTokens(query);
		let slice = performance.now();
		for (const [path, rows] of this.catalog) {
			if (signal.aborted || this.disposed || !this.ctx.settings.content) return [];
			const base = rows[0]; if (!accepts(base, query, tokens)) continue;
			const file = this.ctx.app.vault.getFileByPath(path); if (!file) continue;
			try {
				let text: string | undefined;
				let folded = this.content.get(path);
				if (folded === undefined) {
					if (!Platform.isMobile) continue;
					text = readableText(capText(await this.ctx.app.vault.cachedRead(file), CONTENT_CAP));
					const chunks: string[] = [];
					for (let at = 0; at < text.length; at += CHUNK) {
						if (signal.aborted || this.disposed) return [];
						chunks.push(fold(text.slice(at, at + CHUNK)));
						if (performance.now() - slice >= 8) { await this.pause(); slice = performance.now(); }
					}
					folded = chunks.join("");
				}
				if (query.words.every(word => folded.includes(word))) {
					found++;
					const candidate = { base, text, offset: folded.indexOf(query.words[0]), score: rankBonus(base, now, domain) };
					const index = candidates.findIndex(other => other.score < candidate.score || other.score === candidate.score && other.base.title.localeCompare(base.title) > 0);
					const at = index < 0 ? candidates.length : index;
					if (at < count) { candidates.splice(at, 0, candidate); if (candidates.length > count) candidates.pop(); }
					if (Platform.isMobile && found >= 20) break;
				}
			} catch { /* A note may disappear while searching. */ }
			if (performance.now() - slice >= 8) { await this.pause(); slice = performance.now(); }
		}
		const results: SearchGroup["results"] = [];
		for (const candidate of candidates) {
			if (signal.aborted || this.disposed || !this.ctx.settings.content) return [];
			const file = this.ctx.app.vault.getFileByPath(candidate.base.path!); if (!file) continue;
			try {
				const original = candidate.text ?? readableText(capText(await this.ctx.app.vault.cachedRead(file), CONTENT_CAP));
				const body = this.ctx.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset ?? 0;
				const hit = excerpt(original, query.words, 100, candidate.offset, body);
				const { title, path, hue, trail } = candidate.base;
				results.push({ kind: "content", title, path, hue, trail, ranges: [], line: hit.line, snippet: compactText(hit.text), score: 10 + candidate.score });
			} catch { /* The selected note disappeared before its preview was read. */ }
			if (performance.now() - slice >= 8) { await this.pause(); slice = performance.now(); }
		}
		return signal.aborted || this.disposed || !results.length ? [] : [{ kind: "content", results }];
	}
	destroy(): void {
		this.disposed = true;
		for (const [timer, resolve] of this.timers) { this.win.clearTimeout(timer); resolve(); } this.timers.clear();
		this.snapshot = null; this.tagSnapshot = null;
		this.lastSource = null;
		this.subscriptions.splice(0).forEach(off => off()); this.listeners.clear(); this.catalog.clear(); this.content.clear(); this.pending.clear(); this.revisions.clear();
	}
}
