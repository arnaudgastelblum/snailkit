// Every tagged task of the vault, kept up to date from the metadata cache and from our own writes.
import { TFile } from "obsidian";
import { flagSet, isInFolder, parseFolderList, scanTasks, scanUntagged, untaggedInScope } from "./parse";
import type { Context, Task, TaskRef } from "./types";

interface InternalPlugins {
	getPluginById?(id: string): { enabled?: boolean; instance?: { options?: Record<string, unknown> } } | null;
}

export class TaskIndex {
	private readonly files = new Map<string, Task[]>();
	/** Open tasks without a tag, per note (recent notes only): kept apart from `list`. */
	private readonly loose = new Map<string, Task[]>();
	/** When each note with untagged tasks last changed: they leave once it is older than the setting. */
	private readonly looseTime = new Map<string, number>();
	private byKey = new Map<string, Task>();
	private readonly listeners = new Set<() => void>();
	private generation = 0;
	private disposed = false;
	/** Notes updated while a full read runs: their live version wins over what the read found. */
	private touched: Set<string> | null = null;
	/** Every indexed task, open and done, sorted by note path then line. */
	list: Task[] = [];
	/** Open tasks without a tag, in recent notes (see `untaggedIn`): the "No tag" group. Never in `list`. */
	untagged: Task[] = [];
	/** False until the first full read of the vault is done. */
	ready = false;

	constructor(private readonly ctx: Context) {}

	flags(): Set<string> {
		return flagSet(this.ctx.settings.flagTags);
	}

	/** Folders of the setting, plus the folder of the core Templates plugin when it is on. */
	excludedFolders(): string[] {
		const folders = parseFolderList(this.ctx.settings.excludedFolders);
		try {
			const internal = (this.ctx.app as unknown as { internalPlugins?: InternalPlugins }).internalPlugins;
			const templates = internal?.getPluginById?.("templates");
			const folder = templates?.enabled ? templates.instance?.options?.folder : null;
			if (typeof folder === "string" && folder.trim()) folders.push(...parseFolderList(folder));
		} catch {
			// No templates folder known: nothing more to leave out.
		}
		return folders;
	}

	/**
	 * The untagged tasks of a note: only when it changed in the last days of the setting, and not
	 * while it is a brainstorm in progress (its own sorting takes care of them).
	 */
	private untaggedIn(path: string, lines: readonly string[], mtime: number, flags: ReadonlySet<string>): Task[] {
		if (!untaggedInScope(mtime, Date.now(), this.ctx.settings.untaggedDays)) return [];
		try {
			const sessions = this.ctx.service<{ version: number; isSession?(file: TFile): boolean; isClosed?(file: TFile): boolean }>("sessions");
			const file = this.ctx.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile && sessions?.isSession?.(file) && !sessions.isClosed?.(file)) return [];
		} catch {
			// Without the Brainstorm module, every note counts.
		}
		return scanUntagged(lines, path, flags);
	}

	/** Reads the whole vault again (on start and when the excluded folders or flag tags change). */
	async build(): Promise<void> {
		const generation = ++this.generation;
		const { vault, metadataCache } = this.ctx.app;
		const excluded = this.excludedFolders();
		const flags = this.flags();
		const files = new Map<string, Task[]>();
		const loose = new Map<string, Task[]>();
		this.touched = new Set();
		for (const file of vault.getMarkdownFiles()) {
			if (isInFolder(file.path, excluded)) continue;
			// Skip notes the cache knows have no checkbox at all.
			const cache = metadataCache.getFileCache(file);
			if (cache && !(cache.listItems ?? []).some((item) => item.task !== undefined)) continue;
			const data = await vault.cachedRead(file);
			if (this.disposed || generation !== this.generation) return;
			const lines = data.split(/\r?\n/);
			const tasks = scanTasks(lines, file.path, flags);
			if (tasks.length) files.set(file.path, tasks);
			const untagged = this.untaggedIn(file.path, lines, file.stat?.mtime ?? 0, flags);
			if (untagged.length) {
				loose.set(file.path, untagged);
				this.looseTime.set(file.path, file.stat?.mtime ?? 0);
			}
		}
		const touched = this.touched ?? new Set<string>();
		this.touched = null;
		for (const path of [...this.files.keys()]) if (!touched.has(path)) this.files.delete(path);
		for (const [path, tasks] of files) if (!touched.has(path)) this.files.set(path, tasks);
		for (const path of [...this.loose.keys()]) if (!touched.has(path)) this.loose.delete(path);
		for (const [path, tasks] of loose) if (!touched.has(path)) this.loose.set(path, tasks);
		this.ready = true;
		this.changed();
	}

	/** When a note last changed, from its file (null when unknown). */
	private mtimeOf(path: string): number | null {
		const file = this.ctx.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile && typeof file.stat?.mtime === "number" ? file.stat.mtime : null;
	}

	/**
	 * New content of a note (from the cache, or right after we wrote it: `fresh`, the editor may not
	 * have saved it yet). Its age is the file's, so an old checklist read again stays out.
	 */
	set(path: string, data: string, fresh = false): void {
		if (this.disposed) return;
		this.touched?.add(path);
		const excluded = isInFolder(path, this.excludedFolders());
		const lines = data.split(/\r?\n/);
		const tasks = excluded ? [] : scanTasks(lines, path, this.flags());
		const mtime = fresh ? Date.now() : this.mtimeOf(path) ?? Date.now();
		const untagged = excluded ? [] : this.untaggedIn(path, lines, mtime, this.flags());
		if (untagged.length) this.looseTime.set(path, mtime);
		else this.looseTime.delete(path);
		const had = this.files.has(path) || this.loose.has(path);
		if (tasks.length) this.files.set(path, tasks);
		else this.files.delete(path);
		if (untagged.length) this.loose.set(path, untagged);
		else this.loose.delete(path);
		if (had || tasks.length || untagged.length) this.changed();
	}

	remove(path: string): void {
		this.touched?.add(path);
		const a = this.files.delete(path);
		const b = this.loose.delete(path);
		this.looseTime.delete(path);
		if (a || b) this.changed();
	}

	async renamed(file: TFile, oldPath: string): Promise<void> {
		this.remove(oldPath);
		if (file.extension === "md") this.set(file.path, await this.ctx.app.vault.cachedRead(file));
	}

	/** Identical tasks get "#2", "#3"... in note order, so each keeps its own identity. */
	private changed(): void {
		const seen = new Map<string, number>();
		this.list = [];
		this.byKey = new Map();
		for (const path of [...this.files.keys()].sort()) {
			for (const t of this.files.get(path)!) {
				const n = (seen.get(t.baseKey) ?? 0) + 1;
				seen.set(t.baseKey, n);
				t.key = n > 1 ? `${t.baseKey}#${n}` : t.baseKey;
				this.list.push(t);
				this.byKey.set(t.key, t);
			}
		}
		// Untagged tasks: their own keys ("|words"), never mixed with the tagged ones.
		this.untagged = [];
		for (const path of [...this.loose.keys()].sort()) {
			for (const t of this.loose.get(path)!) {
				const n = (seen.get(t.baseKey) ?? 0) + 1;
				seen.set(t.baseKey, n);
				t.key = n > 1 ? `${t.baseKey}#${n}` : t.baseKey;
				this.untagged.push(t);
				this.byKey.set(t.key, t);
			}
		}
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch (error) {
				console.error("[Snailkit] tasks: change listener failed", error);
			}
		}
	}

	get(key: string | null): Task | null {
		return key ? this.byKey.get(key) ?? null : null;
	}

	/** The task at this place now: same line if unchanged, else the only identical line of the note. */
	find(ref: TaskRef): Task | null {
		const tasks = [...(this.files.get(ref.path) ?? []), ...(this.loose.get(ref.path) ?? [])];
		const same = tasks.find((t) => t.line === ref.line && t.raw === ref.raw);
		if (same) return same;
		const twins = tasks.filter((t) => t.raw === ref.raw);
		return twins.length === 1 ? twins[0] : null;
	}

	/** The task now at `line` of `path` (after a write), with or without a tag. */
	at(path: string, line: number): Task | null {
		return (this.files.get(path) ?? []).find((t) => t.line === line) ?? (this.loose.get(path) ?? []).find((t) => t.line === line) ?? null;
	}

	/** Untagged tasks of notes now older than the setting leave (called from time to time). */
	expireUntagged(now = Date.now()): void {
		let gone = false;
		for (const path of [...this.loose.keys()]) {
			if (untaggedInScope(this.looseTime.get(path) ?? 0, now, this.ctx.settings.untaggedDays)) continue;
			this.loose.delete(path);
			this.looseTime.delete(path);
			gone = true;
		}
		if (gone) this.changed();
	}

	/** Reads some notes again (a brainstorm started or finished: its untagged tasks come or go). */
	async reread(paths: readonly string[]): Promise<void> {
		for (const path of paths) {
			const file = this.ctx.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile) || this.disposed) continue;
			this.set(path, await this.ctx.app.vault.cachedRead(file));
		}
	}

	open(): Task[] {
		return this.list.filter((t) => !t.done);
	}

	/** Group tags of the tasks, plus every other tag of the vault (not the flags), sorted. */
	allTags(): string[] {
		const tags = new Set(this.list.map((t) => t.primary));
		const flags = this.flags();
		const cache = this.ctx.app.metadataCache as unknown as { getTags?(): Record<string, number> };
		try {
			for (const tag of Object.keys(cache.getTags?.() ?? {})) {
				const name = tag.replace(/^#/, "").toLowerCase();
				if (name && !flags.has(name)) tags.add(name);
			}
		} catch {
			// The tag list of the cache is a convenience only.
		}
		return [...tags].sort();
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		this.disposed = true;
		this.generation++;
		this.listeners.clear();
		this.files.clear();
		this.list = [];
		this.byKey.clear();
		this.ready = false;
	}
}
