// Open tasks: the unchecked tasks of the note and of its pinned notes. Check one with a small
// animation (through the editor when the note is open, so Ctrl+Z works), or jump to its line.
import { Component, MarkdownRenderer, MarkdownView, Notice, setIcon, type TFile } from "obsidian";
import { getNotePins, getVaultPins } from "../../pins";
import { asElement, reducedMotion } from "../../rail/motion";
import type { PanelContext, PanelDefinition, PanelInstance } from "../../types";
import { checkTaskLine, locateTask, parseOpenTasks, type TaskItem } from "./parse";
import { workbenchFooter } from "../workbench-link";
import { dueBadge, summaryParts } from "./summary";

export const tasksPanel: PanelDefinition = {
	id: "tasks",
	icon: "list-checks",
	isAvailable: (_env, view) => view.file?.extension === "md",
	// With the Tasks module: what is due in the vault (overdue and today). Without: the open tasks of the note.
	badge: (env, view) => {
		if (!env.settings.tasksBadge) return null;
		const vault = env.vaultTasks();
		if (vault) return dueBadge(vault).count;
		return view.file ? env.app.metadataCache.getFileCache(view.file)?.listItems?.filter((item) => item.task === " ").length || null : null;
	},
	badgeTone: (env) => {
		const vault = env.settings.tasksBadge ? env.vaultTasks() : null;
		return vault && dueBadge(vault).warn ? "warn" : null;
	},
	create: (ctx, body) => new TasksController(ctx, body),
};

interface Group { file: TFile; tasks: TaskItem[]; error: boolean }

class TaskChangedError extends Error {}

class TasksController implements PanelInstance {
	private destroyed = false;
	private generation = 0;
	private checking = 0;
	private timer = 0;
	private total = 0;
	private watched = new Set<TFile>();
	private collapsed = new Set<string>();
	private cleanups: (() => void)[] = [];
	/** Owns the Markdown render children of the current list (tags, links), unloaded on rebuild and destroy. */
	private renderer = new Component();
	private animations = new Set<Animation>();
	private delays = new Map<number, () => void>();
	/** With the Tasks module: what is due in the vault, and the way to the Workbench. Kept on top of the list. */
	private summaryEl: HTMLElement;

	constructor(private ctx: PanelContext, private body: HTMLElement) {
		this.summaryEl = body.createDiv({ cls: "sk-note-rail-tasks-summary" });
		this.renderSummary();
		const changed = ctx.app.metadataCache.on("changed", (file) => {
			if (this.watched.has(file)) this.refresh();
		});
		this.cleanups.push(() => ctx.app.metadataCache.offref(changed));
		// Edits that cancel out before the file is saved (check, then Ctrl+Z) never reach the metadata cache.
		const edited = ctx.app.workspace.on("editor-change", (_editor, info) => {
			if (info.file && this.watched.has(info.file)) this.refresh();
		});
		this.cleanups.push(() => ctx.app.workspace.offref(edited));
		this.summaryEl.addEventListener("click", (event) => this.onSummary(event));
		this.listen("click", (event) => this.activate(event as MouseEvent));
		this.listen("auxclick", (event) => { if ((event as MouseEvent).button === 1) this.activate(event as MouseEvent); });
		this.listen("keydown", (event) => {
			const key = event as KeyboardEvent;
			const row = asElement(key.target)?.closest<HTMLElement>(".sk-note-rail-tasks-row");
			if (!row || (key.key !== " " && key.key !== "Enter")) return;
			key.preventDefault();
			if (key.repeat) return;
			if (key.key === " ") void this.complete(row);
			else void this.jumpRow(row, key);
		});
		this.renderer.load();
		void this.build();
	}

	private rows = new Map<HTMLElement, { group: Group; task: TaskItem }>();
	private groups = new Map<HTMLElement, Group>();

	private listen(type: string, listener: EventListener): void {
		this.body.addEventListener(type, listener);
		this.cleanups.push(() => this.body.removeEventListener(type, listener));
	}

	/** Overdue and today's tasks of the vault, as links to the Workbench (zero counts left out). The Workbench itself is in the footer. */
	private renderSummary(): void {
		const el = this.summaryEl;
		el.empty();
		const vault = this.ctx.vaultTasks();
		const parts = vault ? summaryParts(vault) : [];
		el.toggle(parts.length > 0);
		if (!parts.length) return;
		const counts = el.createDiv("sk-note-rail-tasks-summary-counts");
		parts.forEach((part, i) => {
			if (i) counts.createSpan({ cls: "sk-note-rail-tasks-summary-sep", text: "·" });
			counts.createEl("button", {
				cls: `sk-btn is-ghost is-s sk-note-rail-tasks-summary-count is-${part.kind}`,
				text: this.ctx.tn(`tasks.summary-${part.kind}`, part.count),
				attr: { type: "button", "data-scope": "today" },
			});
		});
	}

	onVaultTasks(): void {
		if (this.destroyed) return;
		const focused = asElement(this.body.doc.activeElement);
		const scope = focused && this.summaryEl.contains(focused) ? (focused as HTMLElement).dataset.scope : undefined;
		this.renderSummary();
		if (scope) this.summaryEl.querySelector<HTMLElement>(`[data-scope="${scope}"]`)?.focus({ preventScroll: true });
	}

	private onSummary(event: MouseEvent): void {
		const button = asElement(event.target)?.closest<HTMLElement>("[data-scope]");
		if (!button) return;
		event.preventDefault();
		event.stopPropagation();
		const scope = button.dataset.scope === "today" ? "today" : "all";
		if (!this.ctx.openWorkbench({ scope })) new Notice(this.ctx.t("rail.workbench-unavailable"));
		else if (!this.destroyed) this.ctx.close("commit");
	}

	refresh(): void {
		if (this.destroyed) return;
		this.generation++;
		this.body.win.clearTimeout(this.timer);
		this.timer = this.body.win.setTimeout(() => { if (!this.checking) void this.build(); }, 150);
	}

	private async build(): Promise<void> {
		if (this.destroyed || this.checking) return;
		const generation = ++this.generation;
		const { app, view, settings } = this.ctx;
		const current = view.file;
		if (!current) return;
		const files = [current, ...(settings.tasksIncludePinned ? getNotePins(app, current, settings) : []),
			...(settings.tasksIncludeVaultPins ? getVaultPins(app, settings) : [])];
		const unique = Array.from(new Map(files.filter((file) => file.extension === "md").map((file) => [file.path, file])).values());
		this.watched = new Set(unique);
		const groups = await Promise.all(unique.map(async (file): Promise<Group> => {
			try {
				const editorView = this.editorView(file);
				const text = editorView ? editorView.editor.getValue() : await app.vault.cachedRead(file);
				return { file, tasks: parseOpenTasks(text.split(/\r?\n/)), error: false };
			} catch { return { file, tasks: [], error: true }; }
		}));
		if (this.destroyed || generation !== this.generation || this.checking) return;
		const focused = asElement(this.body.doc.activeElement)?.closest<HTMLElement>(".sk-note-rail-tasks-row");
		const focusTask = focused ? this.rows.get(focused) : undefined;
		this.body.empty();
		this.rows.clear();
		this.groups.clear();
		this.renderer.unload();
		this.renderer = new Component();
		this.renderer.load();
		this.body.appendChild(this.summaryEl);
		this.total = groups.reduce((sum, group) => sum + group.tasks.length, 0);
		this.ctx.setCount(this.total);
		this.ctx.setSubtitle(current.basename);
		this.ctx.setFooter(this.ctx.vaultTasks() ? workbenchFooter(this.ctx, { tab: "tasks" }, this.ctx.t("rail.workbench-tip-tasks")) : this.ctx.t("tasks.foot"));
		this.ctx.setProgress(null);
		for (const group of groups) {
			if (group.error) {
				this.body.createDiv({ cls: "sk-note-rail-hint", text: this.ctx.t("tasks.read-error", { name: group.file.basename }) });
				continue;
			}
			if (!group.tasks.length) continue;
			const section = this.body.createDiv("sk-note-rail-tasks-group");
			this.groups.set(section, group);
			const header = section.createDiv("sk-note-rail-section sk-note-rail-tasks-header");
			const toggle = header.createEl("button", { cls: "sk-btn is-ghost is-icon is-s sk-note-rail-tasks-toggle", attr: { type: "button", "aria-label": this.ctx.t("tasks.fold", { name: group.file.basename }) } });
			setIcon(toggle, "chevron-down");
			const name = group.file === current ? this.ctx.t("tasks.this-note") : group.file.basename;
			header.createEl("button", { cls: "sk-btn is-ghost is-s sk-note-rail-tasks-name", text: name, attr: { type: "button", title: group.file.path } });
			header.createSpan({ cls: "sk-note-rail-row-meta sk-note-rail-tasks-count", text: String(group.tasks.length) });
			const items = section.createDiv("sk-note-rail-tasks-items");
			this.collapse(section, group);
			for (const task of group.tasks) {
				const row = items.createDiv({ cls: "sk-note-rail-row sk-note-rail-tasks-row", attr: { tabindex: "0", role: "group", "aria-label": task.display, "aria-keyshortcuts": "Space Enter" } });
				row.style.setProperty("--sk-note-rail-tasks-depth", String(task.indent));
				this.rows.set(row, { group, task });
				const check = row.createSpan({ cls: "sk-note-rail-tasks-check", attr: { role: "checkbox", "aria-checked": "false", "aria-label": this.ctx.t("tasks.complete", { task: task.display }) } });
				setIcon(check, "check");
				this.renderText(row.createDiv({ cls: "sk-note-rail-tasks-text" }), task, group.file);
				if (task.due) this.due(row, task.due);
				if (focusTask?.group.file === group.file && focusTask.task.raw === task.raw) row.focus({ preventScroll: true });
			}
		}
		if (!this.total && !groups.some((group) => group.error)) this.body.createDiv({ cls: "sk-note-rail-empty", text: this.ctx.t("tasks.empty") });
	}

	/**
	 * Renders the task text with Obsidian's Markdown renderer, so tags, links and emphasis look like
	 * in the note and other plugins' post processors (tag colors) apply. The due date has its own chip.
	 */
	private renderText(el: HTMLElement, task: TaskItem, file: TFile): void {
		const text = task.text.replace(/\s*📅\s*\d{4}-\d{2}-\d{2}(?!\d)/u, "").trim();
		// Rendered in place, inside a reading-view class: post processors of other plugins (tag
		// colors) only act on attached elements under .markdown-preview-view, sometimes a frame later.
		el.addClass("markdown-preview-view", "markdown-rendered");
		el.setAttr("title", task.text);
		MarkdownRenderer.render(this.ctx.app, text, el, file.path, this.renderer)
			.then(() => {
				// The row handles clicks and keys: rendered links and tags stay out of the tab order.
				el.querySelectorAll("a").forEach((a) => a.setAttr("tabindex", "-1"));
			})
			.catch(() => el.setText(task.display));
	}

	private due(row: HTMLElement, value: string): void {
		const date = new Date(`${value}T00:00:00`);
		if (Number.isNaN(date.getTime())) return;
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);
		const overdue = date < today;
		const text = overdue ? this.ctx.t("tasks.overdue") : +date === +today ? this.ctx.t("tasks.today") : +date === +tomorrow ? this.ctx.t("tasks.tomorrow")
			: date.toLocaleDateString(this.ctx.lang, { month: "short", day: "numeric" });
		row.createSpan({ cls: `sk-note-rail-row-meta sk-note-rail-tasks-due${overdue ? " sk-note-rail-tasks-overdue" : ""}`, text, attr: { title: value } });
	}

	private collapse(section: HTMLElement, group: Group): void {
		const collapsed = this.collapsed.has(group.file.path);
		section.toggleClass("sk-note-rail-tasks-collapsed", collapsed);
		section.querySelector(".sk-note-rail-tasks-toggle")?.setAttribute("aria-expanded", String(!collapsed));
	}

	private activate(event: MouseEvent): void {
		const target = asElement(event.target);
		const section = target?.closest<HTMLElement>(".sk-note-rail-tasks-group");
		const group = section ? this.groups.get(section) : undefined;
		if (!target || !section || !group) return;
		event.preventDefault();
		if (target.closest(".sk-note-rail-tasks-name")) { void this.jump(group.file, undefined, event); return; }
		if (target.closest(".sk-note-rail-tasks-header")) {
			if (event.button !== 0) return;
			if (this.collapsed.has(group.file.path)) this.collapsed.delete(group.file.path);
			else this.collapsed.add(group.file.path);
			this.collapse(section, group);
			return;
		}
		const row = target.closest<HTMLElement>(".sk-note-rail-tasks-row");
		if (!row) return;
		if (target.closest(".sk-note-rail-tasks-check")) { if (event.button === 0) void this.complete(row); }
		else void this.jumpRow(row, event);
	}

	private async jumpRow(row: HTMLElement, event: MouseEvent | KeyboardEvent): Promise<void> {
		const entry = this.rows.get(row);
		if (entry && !row.hasClass("sk-note-rail-tasks-busy")) await this.jump(entry.group.file, entry.task.line, event);
	}

	private async jump(file: TFile, line: number | undefined, event: MouseEvent | KeyboardEvent): Promise<void> {
		const newTab = event.ctrlKey || event.metaKey || ("button" in event && event.button === 1);
		const { view, app } = this.ctx;
		try {
			if (!newTab && file === view.file && view.getMode() !== "preview" && line !== undefined) {
				const position = { line: Math.min(line, view.editor.lineCount() - 1), ch: 0 };
				position.ch = view.editor.getLine(position.line).length;
				view.editor.setCursor(position);
				view.editor.scrollIntoView({ from: position, to: position }, true);
				view.editor.focus();
			} else await (newTab ? app.workspace.getLeaf("tab") : view.leaf).openFile(file, line === undefined ? {} : { eState: { line } });
			if (!this.destroyed) this.ctx.close("commit");
		} catch { if (!this.destroyed) new Notice(this.ctx.t("panel.open-error", { name: file.basename })); }
	}

	private editorView(file: TFile): MarkdownView | undefined {
		const { view, app } = this.ctx;
		if (view.file === file && view.getMode() !== "preview") return view;
		return app.workspace.getLeavesOfType("markdown").map((leaf) => leaf.view)
			.find((candidate): candidate is MarkdownView => candidate instanceof MarkdownView && candidate.file === file && candidate.getMode() !== "preview");
	}

	private async complete(row: HTMLElement): Promise<void> {
		const entry = this.rows.get(row);
		if (!entry || this.destroyed || row.hasClass("sk-note-rail-tasks-busy")) return;
		row.addClass("sk-note-rail-tasks-busy");
		this.checking++;
		this.generation++;
		try {
			const { group, task } = entry;
			const editor = this.editorView(group.file)?.editor;
			let changed = false;
			const update = (text: string): string => {
				const lines = text.split(/\r?\n/);
				const index = locateTask(lines, task);
				const checked = index >= 0 ? checkTaskLine(lines[index]) : null;
				if (checked === null) throw new TaskChangedError();
				changed = true;
				lines[index] = checked;
				return lines.join(text.includes("\r\n") ? "\r\n" : "\n");
			};
			if (editor) {
				const lines = editor.getValue().split(/\r?\n/);
				const index = locateTask(lines, task);
				const checked = index >= 0 ? checkTaskLine(lines[index]) : null;
				if (checked !== null) { editor.setLine(index, checked); changed = true; }
			} else await this.ctx.app.vault.process(group.file, update);
			if (this.destroyed) return;
			if (!changed) { new Notice(this.ctx.t("tasks.changed")); return; }
			row.addClass("sk-note-rail-tasks-done");
			row.querySelector(".sk-note-rail-tasks-check")?.setAttribute("aria-checked", "true");
			this.ctx.setCount(--this.total);
			group.tasks = group.tasks.filter((item) => item !== task);
			const section = row.closest<HTMLElement>(".sk-note-rail-tasks-group");
			const count = section?.querySelector(".sk-note-rail-tasks-count");
			if (count) count.textContent = String(group.tasks.length);
			await this.delay(reducedMotion(this.body.win) ? 0 : 400);
			if (this.destroyed) return;
			await this.animate(row, [{ opacity: 1, transform: "scaleY(1)" }, { opacity: 0, transform: "scaleY(0)" }], 160);
			if (this.destroyed) return;
			const remaining = Array.from(this.rows.keys()).filter((item) => item !== row && item.isConnected);
			const moving = [...remaining, ...Array.from(this.body.querySelectorAll<HTMLElement>(".sk-note-rail-tasks-header"))];
			const tops = moving.map((item) => item.getBoundingClientRect().top);
			const hadFocus = row.contains(this.body.doc.activeElement);
			const next = remaining.find((item) => item.getBoundingClientRect().top >= row.getBoundingClientRect().top) ?? remaining[remaining.length - 1];
			row.remove();
			this.rows.delete(row);
			if (section && !section.querySelector(".sk-note-rail-tasks-row")) {
				this.groups.delete(section);
				section.remove();
			}
			if (hadFocus) next?.focus({ preventScroll: true });
			await Promise.all(moving.map(async (item, index) => {
				const distance = tops[index] - item.getBoundingClientRect().top;
				if (!item.isConnected || !distance) return;
				await this.animate(item, [{ transform: `translateY(${distance}px)` }, { transform: "none" }], 240);
			}));
		} catch (error) {
			if (!this.destroyed) new Notice(error instanceof TaskChangedError
				? this.ctx.t("tasks.changed") : this.ctx.t("tasks.check-error"));
		}
		finally {
			this.checking--;
			row.removeClass("sk-note-rail-tasks-busy");
			if (!this.destroyed && !this.checking) this.refresh();
		}
	}

	private async animate(element: HTMLElement, frames: Keyframe[], duration: number): Promise<void> {
		if (this.destroyed || reducedMotion(this.body.win)) return;
		const animation = element.animate(frames, { duration, easing: "ease-out", fill: "forwards" });
		this.animations.add(animation);
		try { await animation.finished; } catch { /* Cancelled on destroy. */ }
		animation.cancel();
		this.animations.delete(animation);
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => {
			const id = this.body.win.setTimeout(() => { this.delays.delete(id); resolve(); }, ms);
			this.delays.set(id, resolve);
		});
	}

	destroy(): void {
		this.destroyed = true;
		this.generation++;
		this.body.win.clearTimeout(this.timer);
		for (const [id, resolve] of this.delays) { this.body.win.clearTimeout(id); resolve(); }
		this.delays.clear();
		for (const animation of this.animations) animation.cancel();
		this.animations.clear();
		for (const cleanup of this.cleanups) cleanup();
		this.cleanups = [];
		this.rows.clear();
		this.groups.clear();
		this.renderer.unload();
		this.summaryEl.remove();
		this.body.empty();
	}
}
