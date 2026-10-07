// The module while it runs: which notes are sessions (followed through renames), their state
// (closed, pending choices), the commands, the status bar, the service for the rail, and what the
// editors need (tags, colors, learning).
import { getAllTags, MarkdownView, normalizePath, TFile, TFolder } from "obsidian";
import type { EditorView } from "@codemirror/view";
import type { ModuleContext } from "../../core/context";
import { SummaryModal } from "./summary";
import { sessionsEditor, viewOf, type SessionView } from "./editor";
import {
	closingLine,
	closingMatcher,
	LEGACY_CLOSING,
	dayPart,
	hhmm,
	learn,
	newSessionText,
	proposedTitle,
	remember,
	safeName,
	summarize,
	type Summary,
} from "./logic";
import { TAB_ORDER } from "../../core/workbench/types";
import type { PlacesService, SessionsService, SessionsSettings, TagColorsService, TasksWorkbench } from "./types";
import { contextOf, contextsOf, createdAt, keepCreated, keepIn, renameCreated, renameIn, searchable, serviceList, toggleIn, triageOf, locateRaw, withContext, withCreated, type SessionInfo, type Triage } from "./atelier";
import { SessionsTab } from "./tab";
import { applyEdit, bodyLineCount, countsOf, flowOf, linesOf, type Flow, type LineEdit } from "./flow";
import { Sorter } from "./tri";


export class SessionsRuntime {
	readonly views = new Set<SessionView>();
	/** Open summaries: closed when the module stops. */
	readonly modals = new Set<SummaryModal>();
	/** Read from each session's text: closed or not, how many choices still wait. */
	private state = new Map<string, { closed: boolean; pending: number }>();
	/** Counts and searchable text of each session, for the Sessions tab of the Workbench. */
	private details = new Map<string, { summary: Summary; triage: Triage; context: string | null; text: string; lines: number }>();
	/** The sorting mode, while it is open. */
	sorter: Sorter | null = null;
	/** Counts the requests to open the sorting mode: only the last one opens. */
	sortGeneration = 0;
	private readonly tab = new SessionsTab(this);
	private tabRemove: (() => void) | null = null;
	private statusEl: HTMLElement | null = null;
	private saveTimer = 0;
	private statusTimer = 0;
	private areaCache: { at: number; byArea: Map<string, Map<string, number>> } | null = null;
	/** Callbacks of the service's onChange (the rail's sessions panel). */
	private listeners = new Set<() => void>();
	stopped = false;
	/** Sessions, pins and archive as last seen by syncTracked. */
	private trackedSnapshot = "";
	readonly isClosing: (line: string) => boolean;

	constructor(readonly ctx: ModuleContext<SessionsSettings>) {
		this.isClosing = closingMatcher([...ctx.translators().map((t) => t.t("closing.prefix")), ...LEGACY_CLOSING]);
	}

	get app() {
		return this.ctx.app;
	}
	get settings(): SessionsSettings {
		return this.ctx.settings;
	}

	start(): void {
		const { ctx } = this;
		ctx.register(() => this.stop());
		ctx.registerEditorExtension(sessionsEditor(this));
		// Registered on both sides of the extension: whatever order the cleanups run in, a
		// composition in progress is cancelled (its text given back) before the editors lose us.
		ctx.register(() => {
			for (const view of [...this.views]) view.shutdown();
		});

		ctx.addCommand({ id: "new", name: ctx.t("command.new"), icon: "zap", callback: () => void this.startSession() });
		ctx.addCommand({
			id: "open-workbench",
			name: ctx.t("command.open-workbench"),
			icon: "layout-dashboard",
			checkCallback: (checking) => {
				if (!this.ctx.workbench.hasTab("sessions")) return false;
				if (!checking) this.openWorkbench();
				return true;
			},
		});
		ctx.addCommand({
			id: "adopt",
			name: ctx.t("command.adopt"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md" || this.isSession(file)) return false;
				if (!checking) void this.adopt(file);
				return true;
			},
		});
		ctx.addCommand({
			id: "forget",
			name: ctx.t("command.forget"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.isSession(file)) return false;
				if (!checking) void this.forget(file);
				return true;
			},
		});
		ctx.addCommand({
			id: "close",
			name: ctx.t("command.close"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.isSession(file) || this.isClosed(file)) return false;
				if (!checking) this.close(file);
				return true;
			},
		});
		ctx.addCommand({
			id: "reopen",
			name: ctx.t("command.reopen"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.isSession(file) || !this.isClosed(file)) return false;
				if (!checking) this.reopen(file);
				return true;
			},
		});

		const vault = this.app.vault;
		ctx.registerEvent(vault.on("rename", (file, oldPath) => {
			const i = this.settings.sessions.indexOf(oldPath);
			if (i < 0) return;
			this.settings.sessions[i] = file.path;
			this.settings.created = renameCreated(this.settings.created, oldPath, file.path);
			this.settings.pinned = renameIn(this.settings.pinned, oldPath, file.path);
			this.settings.archived = renameIn(this.settings.archived, oldPath, file.path);
			const s = this.state.get(oldPath);
			this.state.delete(oldPath);
			if (s) this.state.set(file.path, s);
			const d = this.details.get(oldPath);
			this.details.delete(oldPath);
			if (d) this.details.set(file.path, d);
			this.tab.renamed(oldPath, file.path);
			this.tab.changed();
			this.saveSoon();
		}));
		ctx.registerEvent(vault.on("delete", (file) => {
			if (!this.settings.sessions.includes(file.path)) return;
			this.settings.sessions = this.settings.sessions.filter((p) => p !== file.path);
			this.settings.created = keepCreated(this.settings.created, this.settings.sessions);
			this.settings.pinned = keepIn(this.settings.pinned, this.settings.sessions);
			this.settings.archived = keepIn(this.settings.archived, this.settings.sessions);
			this.state.delete(file.path);
			this.details.delete(file.path);
			this.tab.changed();
			this.saveSoon();
			this.changed();
		}));
		ctx.registerEvent(this.app.metadataCache.on("changed", (file, data) => {
			if (!this.settings.sessions.includes(file.path)) return;
			this.read(file.path, data);
		}));
		ctx.registerEvent(this.app.workspace.on("file-open", () => {
			this.refreshViews();
			this.updateStatus();
		}));
		ctx.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
			this.updateStatus();
			for (const view of [...this.views]) view.onLeafChange(leaf);
		}));
		ctx.onSettingsChange(() => {
			this.refreshViews();
			this.syncTracked();
		});
		ctx.onServicesChange(() => this.refreshViews());
		// The Brainstorms tab of the Workbench (a view of the core): there whether Tasks is on or not.
		this.tabRemove = ctx.workbench.addTab({ ...this.tab.definition(), order: TAB_ORDER.sessions });

		this.statusEl = ctx.addStatusBarItem();
		this.statusEl.addClass("sk-sessions-status", "mod-clickable");
		ctx.registerDomEvent(this.statusEl, "click", () => {
			const file = this.app.workspace.getActiveFile();
			if (!file || !this.isSession(file)) return;
			if (this.isClosed(file)) this.reopen(file);
			else this.close(file);
		});

		this.app.workspace.onLayoutReady(() => {
			if (this.stopped) return;
			this.reconcile();
			void this.readAll();
		});

		const service: SessionsService = {
			version: 1,
			isSession: (file) => this.isSession(file),
			isClosed: (file) => this.isClosed(file),
			start: () => this.startSession(),
			close: (file) => this.close(file),
			reopen: (file) => this.reopen(file),
			pending: () => this.pending(),
			list: () => serviceList(this.sessionInfos()),
			onChange: (callback) => {
				this.listeners.add(callback);
				return () => this.listeners.delete(callback);
			},
		};
		ctx.provide<SessionsService>("sessions", service);
	}

	private stop(): void {
		this.stopped = true;
		this.listeners.clear();
		this.tabRemove?.();
		this.tabRemove = null;
		this.tab.destroyAll();
		window.clearTimeout(this.statusTimer);
		if (this.saveTimer) {
			window.clearTimeout(this.saveTimer);
			void this.ctx.saveSettings();
		}
		this.sorter?.close("quit", true);
		for (const view of [...this.views]) view.shutdown();
		for (const modal of [...this.modals]) modal.close();
		this.modals.clear();
	}

	// ----- sessions -----

	isSession(file: TFile | null | undefined): boolean {
		return !!file && this.settings.sessions.includes(file.path);
	}

	isClosed(file: TFile): boolean {
		return this.state.get(file.path)?.closed ?? false;
	}

	pending(): number {
		let n = 0;
		for (const path of this.settings.sessions) {
			const s = this.state.get(path);
			if (s && !s.closed && s.pending > 0 && !this.settings.archived.includes(path)) n++;
		}
		return n;
	}

	/** Catching tasks works in this note (a session, or any note when the setting says so). */
	activeFor(file: TFile | null | undefined): boolean {
		if (!file || file.extension !== "md") return false;
		return this.settings.scope === "all" || this.isSession(file);
	}

	summaryOf(text: string): Summary {
		return summarize(text.split(/\r?\n/), this.isClosing);
	}

	private read(path: string, text: string): void {
		const lines = text.split(/\r?\n/);
		const last = [...lines].reverse().find((l) => l.trim()) ?? "";
		const summary = summarize(lines, this.isClosing);
		const before = this.state.get(path);
		const next = { closed: this.isClosing(last), pending: summary.pending };
		this.state.set(path, next);
		this.details.set(path, { summary, triage: triageOf(summary), context: contextOf(lines.slice(0, 40)), text: searchable(text.slice(0, 20000)), lines: bodyLineCount(lines, this.isClosing) });
		this.tab.changed();
		if (!before || before.closed !== next.closed || (before.pending > 0) !== (next.pending > 0)) this.changed();
		this.updateStatus();
	}

	/**
	 * The settings changed from outside (another device through Obsidian Sync, the settings page):
	 * sessions no longer tracked are dropped from what was read, new ones are read, and the tab,
	 * the rail and the status bar follow (pins and archive are read from the settings at each use).
	 */
	private syncTracked(): void {
		if (this.stopped) return;
		const snapshot = JSON.stringify([this.settings.sessions, this.settings.pinned, this.settings.archived]);
		if (snapshot === this.trackedSnapshot) return;
		this.trackedSnapshot = snapshot;
		const tracked = new Set(this.settings.sessions);
		for (const path of [...this.state.keys()]) if (!tracked.has(path)) this.state.delete(path);
		for (const path of [...this.details.keys()]) if (!tracked.has(path)) this.details.delete(path);
		const fresh = [...tracked].filter((path) => !this.details.has(path));
		void (async () => {
			for (const path of fresh) {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) continue;
				try {
					const text = await this.app.vault.cachedRead(file);
					if (this.stopped) return;
					if (this.settings.sessions.includes(path)) this.read(path, text);
				} catch {
					/* unreadable: counted as open, nothing pending */
				}
			}
			this.changed();
			this.updateStatus();
		})();
	}

	/** Sessions deleted while the module was off (or Obsidian closed) are forgotten. */
	private reconcile(): void {
		const kept = this.settings.sessions.filter((path, i, all) => all.indexOf(path) === i && this.app.vault.getAbstractFileByPath(path) instanceof TFile);
		const created = keepCreated(this.settings.created, kept);
		const pinned = keepIn(this.settings.pinned, kept);
		const archived = keepIn(this.settings.archived, kept);
		if (kept.length === this.settings.sessions.length && created.length === this.settings.created.length && pinned.length === this.settings.pinned.length && archived.length === this.settings.archived.length) return;
		this.settings.sessions = kept;
		this.settings.created = created;
		this.settings.pinned = pinned;
		this.settings.archived = archived;
		void this.ctx.saveSettings();
	}

	private async readAll(): Promise<void> {
		for (const path of this.settings.sessions) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			try {
				const text = await this.app.vault.cachedRead(file);
				if (this.stopped) return;
				this.read(path, text);
			} catch {
				/* unreadable: counted as open, nothing pending */
			}
		}
		this.changed();
	}

	/** Asks the Workbench to redraw (the tab's count). */
	refreshWorkbench(): void {
		if (!this.stopped) this.ctx.workbench.refresh();
	}

	/** Every session, with its state and counts. */
	sessionInfos(): SessionInfo[] {
		const out: SessionInfo[] = [];
		let recorded = false;
		for (const path of this.settings.sessions) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			const s = this.state.get(path);
			const d = this.details.get(path);
			out.push({
				path,
				title: file.basename,
				created: (() => {
					const known = createdAt(this.settings.created, path);
					if (known !== null) return known;
					// A session tracked before its start was recorded: the file date, kept from now on.
					this.settings.created = withCreated(this.settings.created, path, file.stat.ctime);
					recorded = true;
					return file.stat.ctime;
				})(),
				ideas: d?.summary.ideas ?? 0,
				tasks: d?.summary.tasks.length ?? 0,
				decide: d?.summary.questions.length ?? 0,
				pending: s?.pending ?? 0,
				closed: s?.closed ?? false,
				text: d?.text ?? "",
				pin: this.settings.pinned.includes(path) ? this.settings.pinned.indexOf(path) : null,
				archived: this.settings.archived.includes(path),
				context: d?.context ?? null,
				modified: file.stat.mtime,
				done: d?.triage.done ?? 0,
				undecided: d?.triage.undecided ?? 0,
				untagged: d?.triage.untagged ?? 0,
				lines: d?.lines ?? 0,
			});
		}
		if (recorded) this.saveSoon();
		return out;
	}

	// ----- the sorting desk (Brainstorms tab) -----

	/** What the tab's detail shows of a session (from the last read), or null. */
	detailOf(path: string): { summary: Summary; triage: Triage; context: string | null } | null {
		return this.details.get(path) ?? null;
	}

	/** The contexts used by the sessions, most used first. */
	contexts(): string[] {
		return contextsOf(this.sessionInfos());
	}

	file(path: string): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	togglePin(path: string): boolean {
		this.settings.pinned = toggleIn(this.settings.pinned, path);
		this.saveSoon();
		this.tab.changed();
		return this.settings.pinned.includes(path);
	}

	toggleArchive(path: string): boolean {
		return this.setArchived(path, !this.settings.archived.includes(path));
	}

	/** Archives or brings back a session (only a tracked one); returns the new state. */
	setArchived(path: string, on: boolean): boolean {
		if (!this.settings.sessions.includes(path)) return this.settings.archived.includes(path);
		const has = this.settings.archived.includes(path);
		if (has !== on) {
			this.settings.archived = toggleIn(this.settings.archived, path);
			this.saveSoon();
			this.changed();
			this.refreshViews();
		}
		return on;
	}

	/** Writes the context tag at the top of the note (null removes it). */
	async setContext(path: string, tag: string | null): Promise<void> {
		const file = this.file(path);
		if (!file) return;
		await this.app.vault.process(file, (text) => withContext(text.split(/\r?\n/), tag).join("\n"));
	}

	/** Renames the note in its folder (links follow, as Obsidian does). Returns an error message, or null. */
	async renameSession(path: string, name: string): Promise<string | null> {
		const file = this.file(path);
		if (!file || !name.trim()) return null;
		const clean = safeName(name);
		if (clean === file.basename) return null;
		const folder = file.parent && file.parent.path !== "/" ? file.parent.path + "/" : "";
		const to = normalizePath(`${folder}${clean}.${file.extension}`);
		if (this.app.vault.getAbstractFileByPath(to)) return this.ctx.t("desk.rename-exists", { name: clean });
		try {
			await this.app.fileManager.renameFile(file, to);
			return null;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	}

	/** Moves the note to the trash, as Obsidian's setting says (the delete event cleans the settings). */
	async trashSession(path: string): Promise<void> {
		const file = this.file(path);
		if (file) await this.app.fileManager.trashFile(file);
	}

	/**
	 * Checks or unchecks a task of a session. Through the Tasks module when it knows the task (it
	 * writes its completion date), else the checkbox alone; nothing when the line changed.
	 */
	async setTaskDone(path: string, line: number, raw: string, done: boolean): Promise<void> {
		const tasks = this.ctx.service<TasksWorkbench>("tasks");
		try {
			if (tasks?.version === 1 && tasks.find?.({ path, line, raw }) && tasks.setDone) {
				await tasks.setDone({ path, line, raw }, done);
				return;
			}
		} catch {
			/* fall back to the checkbox */
		}
		const file = this.file(path);
		if (!file) return;
		await this.app.vault.process(file, (text) => {
			const lines = text.split(/\r?\n/);
			if (lines[line] !== raw) return text;
			lines[line] = raw.replace(/^(\s*(?:[-*+]|\d+[.)])\s\[)(.)\]/, `$1${done ? "x" : " "}]`);
			return lines.join("\n");
		});
	}

	/** Calls the service's listeners (from the tab's debounced change, so once per burst). */
	notifyChange(): void {
		for (const callback of [...this.listeners]) {
			try {
				callback();
			} catch (error) {
				console.error("[Snailkit] sessions: a change listener failed", error);
			}
		}
	}

	/** The Workbench on the Brainstorms tab. */
	private openWorkbench(): void {
		this.ctx.workbench.open({ tab: "sessions" }).catch((error) => console.error("[Snailkit] sessions: could not open the Workbench", error));
	}

	/** Tells the rail (and anyone listening) that sessions changed. */
	private changed(): void {
		if (this.stopped) return;
		this.tab.changed();
		this.app.workspace.trigger("snailkit:services-changed");
	}

	private saveSoon(): void {
		window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = 0;
			void this.ctx.saveSettings();
		}, 400);
	}

	async startSession(): Promise<void> {
		const { ctx } = this;
		const now = new Date();
		const short = new Intl.DateTimeFormat(ctx.lang, { day: "numeric", month: "short" }).format(now);
		const title = proposedTitle(ctx.t("title.template"), short, ctx.t(`part.${dayPart(now)}`));
		const long = new Intl.DateTimeFormat(ctx.lang, { day: "numeric", month: "long", year: "numeric" }).format(now);
		try {
			const folder = await this.folder();
			const base = safeName(title);
			let path = normalizePath(`${folder}/${base}.md`);
			for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${folder}/${base} ${i}.md`);
			const file = await this.app.vault.create(path, newSessionText(this.settings.parent, `${long} · ${hhmm(now)}`));
			this.settings.sessions.push(file.path);
			this.settings.created = withCreated(this.settings.created, file.path, now.getTime());
			this.state.set(file.path, { closed: false, pending: 0 });
			await ctx.saveSettings();
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file, { active: true });
			const view = leaf.view instanceof MarkdownView ? leaf.view : null;
			if (view) {
				const last = view.editor.lastLine();
				view.editor.setCursor({ line: last, ch: 0 });
				view.editor.focus();
			}
			this.changed();
		} catch (error) {
			ctx.toast(ctx.t("new.failed", { error: error instanceof Error ? error.message : String(error) }));
		}
	}

	private async folder(): Promise<string> {
		const wanted = normalizePath(this.settings.folder.trim());
		if (wanted && wanted !== "/") {
			const existing = this.app.vault.getAbstractFileByPath(wanted);
			if (!existing) await this.app.vault.createFolder(wanted);
			return wanted;
		}
		const parent = this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? "");
		return parent instanceof TFolder ? parent.path : "";
	}

	async adopt(file: TFile): Promise<void> {
		if (this.isSession(file)) return;
		this.settings.sessions.push(file.path);
		// The note began a while ago: its file date, recorded now that it is known.
		this.settings.created = withCreated(this.settings.created, file.path, file.stat.ctime);
		await this.ctx.saveSettings();
		this.read(file.path, await this.app.vault.cachedRead(file));
		this.ctx.toast(this.ctx.t("adopted"));
		this.refreshViews();
		this.changed();
	}

	async forget(file: TFile): Promise<void> {
		this.settings.sessions = this.settings.sessions.filter((p) => p !== file.path);
		this.settings.created = keepCreated(this.settings.created, this.settings.sessions);
		this.settings.pinned = keepIn(this.settings.pinned, this.settings.sessions);
		this.settings.archived = keepIn(this.settings.archived, this.settings.sessions);
		this.state.delete(file.path);
		this.details.delete(file.path);
		await this.ctx.saveSettings();
		this.ctx.toast(this.ctx.t("forgotten"));
		this.refreshViews();
		this.updateStatus();
		this.changed();
	}

	/** Opens the summary of the session; closing it there writes the closing line. */
	close(file: TFile): void {
		if (this.stopped) return;
		for (const view of this.views) view.cancelCompose();
		void this.app.vault.cachedRead(file).then((text) => {
			if (this.stopped) return;
			const editorText = this.editorText(file);
			new SummaryModal(this, file, editorText ?? text).open();
		});
	}

	/** Appends the closing line at the bottom of the note. */
	async writeClosing(file: TFile, message?: (summary: Summary) => string): Promise<void> {
		const { ctx } = this;
		if (this.stopped) return;
		let summary: Summary | null = null;
		await this.app.vault.process(file, (text) => {
			const lines = text.replace(/\s+$/, "").split(/\r?\n/);
			while (lines.length && (this.isClosing(lines[lines.length - 1]) || !lines[lines.length - 1].trim())) lines.pop();
			summary = summarize(lines, this.isClosing);
			const line = closingLine(ctx.t("closing.line", {
				time: hhmm(new Date()),
				ideas: ctx.tn("ideas", summary.ideas),
				tasks: ctx.tn("tasks", summary.tasks.length),
				decide: ctx.tn("decide", summary.questions.length),
			}));
			return [...lines, "", line, ""].join("\n");
		});
		const s = this.state.get(file.path);
		this.state.set(file.path, { closed: true, pending: s?.pending ?? 0 });
		this.changed();
		this.updateStatus();
		for (const view of this.views) if (view.file?.path === file.path) view.sealed();
		const done = summary as Summary | null;
		if (message && done) ctx.toast(message(done), { action: { label: ctx.t("flow.reopen"), run: () => this.reopen(file) }, duration: 6000 });
		else ctx.toast(ctx.t("toast.closed"));
	}

	reopen(file: TFile): void {
		void this.app.vault.process(file, (text) => {
			const lines = text.split(/\r?\n/);
			const kept = lines.filter((l) => !this.isClosing(l));
			while (kept.length > 1 && !kept[kept.length - 1].trim() && !kept[kept.length - 2].trim()) kept.pop();
			return kept.join("\n");
		}).then(() => {
			const s = this.state.get(file.path);
			this.state.set(file.path, { closed: false, pending: s?.pending ?? 0 });
			this.changed();
			this.updateStatus();
			this.ctx.toast(this.ctx.t("toast.reopened"));
		});
	}

	/**
	 * An editor was destroyed in the middle of a composition (the note closed): once Obsidian has
	 * saved it, the caught region, found once in the note, is replaced by the original sentence.
	 */
	restoreOnDisk(file: TFile, composed: string, original: string): void {
		const run = () => {
			void this.app.vault.process(file, (text) => {
				if (text.includes(original)) return text;
				const at = text.indexOf(composed);
				if (at < 0 || text.indexOf(composed, at + 1) >= 0) return text;
				return text.slice(0, at) + original + text.slice(at + composed.length);
			}).catch((error) => console.error("[Snailkit] sessions: could not give the sentence back", error));
		};
		// Obsidian writes the editor's text as the note unloads: the restore waits for that write (or a moment).
		let done = false;
		const ref = this.app.vault.on("modify", (f) => {
			if (done || f.path !== file.path) return;
			done = true;
			this.app.vault.offref(ref);
			window.setTimeout(run, 50);
		});
		window.setTimeout(() => {
			if (done) return;
			done = true;
			this.app.vault.offref(ref);
			run();
		}, 1500);
	}

	/** The text of a note as its open editor holds it (newer than the disk while typing). */
	private editorText(file: TFile): string | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === file.path) return view.editor.getValue();
		}
		return null;
	}

	/** Opens the note (if needed) and catches the sentence at that line as a task. */
	/**
	 * With `expected` (the line as it was read), the line is found again in the editor first: when
	 * it moved, its new place (if it is the only line reading so); when it is gone or ambiguous,
	 * nothing is rewritten and the cursor only goes near where it was.
	 */
	async catchAt(file: TFile, line: number, start: number, end: number, expected?: string): Promise<void> {
		let target: MarkdownView | null = null;
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) target = leaf.view;
		}
		if (!target) {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file, { active: true });
			target = leaf.view instanceof MarkdownView ? leaf.view : null;
		} else this.app.workspace.setActiveLeaf(target.leaf, { focus: true });
		if (!target) return;
		if (target.getMode() !== "source") await target.setState({ ...target.getState(), mode: "source" }, { history: false });
		if (this.stopped) return;
		if (expected !== undefined) {
			const at = locateRaw(target.editor.getValue().split(/\r?\n/), line, expected);
			if (at === null) {
				const near = Math.min(line, target.editor.lastLine());
				target.editor.setCursor({ line: near, ch: 0 });
				return;
			}
			line = at;
		}
		const cm = (target.editor as unknown as { cm?: EditorView }).cm;
		const view = cm ? viewOf(cm) : null;
		view?.catchLine(line + 1, start, end);
	}

	// ----- the path: Write, Sort, Finish, Archive -----

	/** Where a session stands, from what was last read of it. */
	flowOf(s: SessionInfo, now = Date.now()): Flow {
		return flowOf({ closed: s.closed, archived: !!s.archived, ideas: s.ideas, tasks: s.tasks, untagged: s.untagged ?? 0, undecided: s.undecided ?? 0, lines: s.lines ?? 0, modified: s.modified, now });
	}

	/** Where a note stands, from its text as the editor holds it. */
	flowOfText(path: string, text: string, now = Date.now()): Flow {
		const lines = text.split(/\r?\n/);
		const summary = summarize(lines, this.isClosing);
		const last = [...lines].reverse().find((l) => l.trim()) ?? "";
		const file = this.file(path);
		return flowOf({ closed: this.isClosing(last), archived: this.settings.archived.includes(path), ...countsOf(summary, bodyLineCount(lines, this.isClosing)), modified: file?.stat.mtime, now });
	}

	/** One session's info, or null. */
	infoOf(path: string): SessionInfo | null {
		return this.sessionInfos().find((s) => s.path === path) ?? null;
	}

	/** Finish: the closing line at the bottom of the note, the note sealed, a warm word. */
	async finish(path: string): Promise<void> {
		const file = this.file(path);
		if (!file || this.stopped) return;
		for (const view of this.views) if (view.file?.path === path) view.cancelCompose();
		await this.writeClosing(file, (s) => this.ctx.t("seal.line", { ideas: this.ctx.tn("seal.ideas", s.ideas), tasks: this.ctx.tn("seal.tasks", s.tasks.length) }));
	}

	/** Archive or take out of the archive, with a toast that can undo it. */
	archiveWithUndo(path: string, on: boolean): void {
		const file = this.file(path);
		this.setArchived(path, on);
		this.ctx.toast(this.ctx.t(on ? "desk.archived" : "desk.unarchived"), {
			action: { label: this.ctx.t("common.undo"), run: () => {
				if (file && this.file(file.path) === file) this.setArchived(file.path, !on);
			} },
		});
		this.refreshViews();
	}

	/** Opens the sorting mode on one session (its path) or on every session in progress (null). */
	startSort(scope: string | null, returnFocus?: HTMLElement | null): void {
		if (this.stopped) return;
		this.sorter?.close("quit", true);
		for (const view of this.views) view.cancelCompose();
		void Sorter.open(this, scope, returnFocus ?? null);
	}

	/** The text of a session now: the open editor's, else the file's. */
	async textOf(path: string): Promise<string | null> {
		const file = this.file(path);
		if (!file) return null;
		return this.editorText(file) ?? (await this.app.vault.cachedRead(file));
	}

	/**
	 * Changes lines of a note, in its open editor when there is one (so that Ctrl/Cmd+Z takes it
	 * back there too), else on disk. `compute` gets the lines as they are just before the change and
	 * returns the edit, or null to leave the note untouched. Returns the edit made, or null.
	 */
	async editNote(path: string, compute: (lines: string[]) => LineEdit | null): Promise<LineEdit | null> {
		const file = this.file(path);
		if (!file) return null;
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || view.file?.path !== path) continue;
			const editor = view.editor;
			const text = editor.getValue();
			const lines = linesOf(text);
			const edit = compute(lines);
			if (!edit) return null;
			// The smallest change between the two texts, as one replacement (one step of the editor's history).
			const next = applyEdit(lines, edit).join("\n");
			let from = 0;
			while (from < text.length && from < next.length && text[from] === next[from]) from++;
			let tail = 0;
			while (tail < text.length - from && tail < next.length - from && text[text.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
			if (from !== text.length || from !== next.length) editor.replaceRange(next.slice(from, next.length - tail), editor.offsetToPos(from), editor.offsetToPos(text.length - tail));
			return edit;
		}
		let made: LineEdit | null = null;
		await this.app.vault.process(file, (text) => {
			const lines = linesOf(text);
			made = compute(lines);
			return made ? applyEdit(lines, made).join("\n") : text;
		});
		return made;
	}

	// ----- what the editors need -----

	refreshViews(): void {
		for (const view of this.views) view.recheck();
	}

	tagClasses(tag: string): string {
		const colors = this.ctx.service<TagColorsService>("tag-colors");
		if (!colors || colors.version !== 1) return "";
		try {
			return colors.classes(tag);
		} catch {
			return "";
		}
	}

	/** Every tag of the vault, most used first (priorities are flags, not groups). */
	allTags(): string[] {
		const raw = (this.app.metadataCache as unknown as { getTags?(): Record<string, number> }).getTags?.() ?? {};
		const merged = new Map<string, { tag: string; count: number }>();
		for (const [written, count] of Object.entries(raw)) {
			const tag = written.replace(/^#/, "");
			const key = tag.toLowerCase();
			const prev = merged.get(key);
			merged.set(key, { tag: prev && prev.count >= count ? prev.tag : tag, count: (prev?.count ?? 0) + count });
		}
		return [...merged.values()].filter((x) => !isFlag(x.tag)).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).map((x) => x.tag);
	}

	/** Tags of this note, then of its area (with Note rail): the subject of the note. */
	nearTags(file: TFile | null): string[] {
		const out: string[] = [];
		if (file) {
			const cache = this.app.metadataCache.getFileCache(file);
			for (const t of cache ? getAllTags(cache) ?? [] : []) out.push(t.replace(/^#/, ""));
			const area = this.areaTags(file);
			for (const t of [...area.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)) out.push(t);
		}
		return out.filter((t) => !isFlag(t));
	}

	/** Tags chosen recently, most recent first. */
	recentTags(): string[] {
		return this.settings.recentTags.filter((t) => !isFlag(t));
	}

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
			for (const [path, files] of members) {
				const counts = new Map<string, number>();
				for (const f of files) {
					const cache = this.app.metadataCache.getFileCache(f);
					for (const t of cache ? getAllTags(cache) ?? [] : []) {
						const tag = t.replace(/^#/, "");
						counts.set(tag, (counts.get(tag) ?? 0) + 1);
					}
				}
				byArea.set(path, counts);
			}
			this.areaCache = { at: now, byArea };
		}
		return this.areaCache.byArea.get(area.path) ?? new Map<string, number>();
	}

	/** Remembers the words of a placed task and its tag, to suggest it next time. */
	learnTag(title: string, tag: string): void {
		this.settings.learned = learn(this.settings.learned, title, tag);
		this.settings.recentTags = remember(this.settings.recentTags, tag);
		this.saveSoon();
	}

	// ----- status bar -----

	updateStatus(): void {
		window.clearTimeout(this.statusTimer);
		this.statusTimer = window.setTimeout(() => this.drawStatus(), 120);
	}

	private drawStatus(): void {
		const el = this.statusEl;
		if (!el || this.stopped) return;
		const file = this.app.workspace.getActiveFile();
		if (!file || !this.isSession(file)) {
			el.hide();
			return;
		}
		el.show();
		const closed = this.isClosed(file);
		const text = this.editorText(file);
		el.empty();
		el.createSpan({ cls: "sk-sessions-status-bolt" });
		el.createSpan({ text: this.ctx.t(closed ? "status.closed" : "status.open") });
		if (text !== null && !closed) {
			const s = this.summaryOf(text);
			el.createSpan({ cls: "sk-sessions-status-counts", text: `${this.ctx.tn("ideas", s.ideas)} · ${this.ctx.tn("tasks", s.tasks.length)} · ${this.ctx.tn("decide", s.questions.length)}` });
		}
		el.setAttr("aria-label", this.ctx.t(closed ? "status.closed-tip" : "status.open-tip"));
		el.toggleClass("is-closed", closed);
	}
}

/** Priority tags mark a task, they never group it: never offered as its tag. */
const FLAGS = new Set(["high", "medium", "low"]);
function isFlag(tag: string): boolean {
	return FLAGS.has(tag.toLowerCase());
}
