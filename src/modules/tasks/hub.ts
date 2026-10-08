// The running module: index, writer, the Tasks tabs shown in the Workbench and the actions they
// share (with toasts). The Workbench itself belongs to the core (ctx.workbench).
import { moment, TFile } from "obsidian";
import { isSideLeaf } from "../../core/workbench/state";
import { TAB_ORDER, WORKBENCH_VIEW_TYPE, type WorkbenchTab } from "../../core/workbench/types";
import { dueLabel } from "./group";
import { plainTitle } from "./parse";
import type { DayWords } from "./quick-add";
import { resolveWorkbench, type TasksApi, type ViewAction, type ViewTab } from "./api";
import { TasksTab } from "./tab";
import { TaskIndex } from "./task-index";
import type { Context, Priority, Task, TaskNotesService } from "./types";
import { TaskWriter, type Undo } from "./writer";
import { playDoneSound } from "../../ui/sound";

/** Ids of Snailkit's own tabs: a companion plugin cannot take them (see addViewTab in api.ts). */
const RESERVED_TABS = ["tasks", "home", "sessions"];

interface TagColors {
	version: number;
	classes(tag: string): string;
}

export class TasksHub {
	taskNotes: TaskNotesService | null = null;
	readonly index: TaskIndex;
	readonly writer: TaskWriter;
	private lastUndo: { run: Undo; until: number } | null = null;
	private disposed = false;
	/** Buttons other plugins put in the header of the lists (see ViewAction in api.ts). */
	readonly viewActions = new Set<() => ViewAction | null>();

	constructor(readonly ctx: Context) {
		this.index = new TaskIndex(ctx);
		this.writer = new TaskWriter(ctx, this.index);
		this.index.onChange(() => this.refreshViews());
	}

	get alive(): boolean {
		return !this.disposed;
	}

	/** The Tasks tab, as the Workbench registers it. */
	tab(): WorkbenchTab {
		return {
			id: "tasks",
			order: TAB_ORDER.tasks,
			icon: "list-checks",
			label: this.ctx.t("view.tasks"),
			count: () => this.index.open().length,
			mount: (el, host) => new TasksTab(this, el, host),
		};
	}

	/** The Tasks tabs shown right now (one per Workbench showing Tasks). */
	views(): TasksTab[] {
		return this.ctx.workbench.instances("tasks").filter((instance): instance is TasksTab => instance instanceof TasksTab);
	}

	/** Redraws every open Workbench soon: tab counts, then the shown tabs (many changes in a row draw once). */
	refreshViews(): void {
		if (this.disposed) return;
		this.ctx.workbench.refresh();
	}

	/** A companion plugin's tab (Tasks API addViewTab), after Brainstorm. Removed when this module stops. */
	addViewTab(tab: ViewTab): () => void {
		if (this.disposed || RESERVED_TABS.includes(tab.id)) return () => undefined;
		return this.ctx.workbench.addTab(tab);
	}

	/** Whether a Workbench tab is registered (Tasks, Home, Brainstorm, a companion's). */
	hasTab(id: string): boolean {
		return this.ctx.workbench.hasTab(id);
	}

	/**
	 * Shows the Workbench as a page (main area) or in the right side panel: an open one keeps its
	 * tab, a new one opens on Tasks. `tasks`: on the Tasks tab in any case (the list's own "Open as
	 * a page" button: the list is what should grow, not the tab the page happens to show).
	 */
	async activate(where: "page" | "side", options: { tasks?: boolean } = {}): Promise<TasksTab | null> {
		if (this.disposed) return null;
		const app = this.ctx.app;
		const exists = !options.tasks && app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE).some((leaf) => isSideLeaf(app, leaf) === (where === "side"));
		const shown = await this.ctx.workbench.open({ tab: exists ? undefined : "tasks", where });
		return !this.disposed && shown instanceof TasksTab ? shown : null;
	}

	/** Reveals an existing Workbench or opens a page, then selects its destination. */
	async openWorkbench(options?: Parameters<TasksApi["openWorkbench"]>[0]): Promise<void> {
		if (this.disposed) return;
		const target = resolveWorkbench(options, { has: (id) => this.hasTab(id) });
		await this.ctx.workbench.open({ tab: target.tab, state: target.scope ? { scope: target.scope } : undefined });
	}

	/** Shows the Workbench as a page, on the tasks of one tag (and its sub-tags). */
	async showTag(tag: string): Promise<boolean> {
		if (this.disposed) return false;
		const shown = await this.ctx.workbench.open({ tab: "tasks", where: "page" });
		if (this.disposed || !(shown instanceof TasksTab)) return false;
		shown.showTag(tag);
		return true;
	}

	/** Opens the quick add row: in an open Workbench, else in the side panel. */
	async newTask(): Promise<void> {
		if (this.disposed) return;
		const app = this.ctx.app;
		const open = app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE)[0];
		const where = open ? (isSideLeaf(app, open) ? "side" : "page") : "side";
		const shown = await this.ctx.workbench.open({ tab: "tasks", where });
		if (!this.disposed && shown instanceof TasksTab) shown.startAdd(null);
	}

	/** Classes from the Tag colors module when it runs, else "" (the fallback colors apply). */
	tagClasses(tag: string): string {
		try {
			const service = this.ctx.service<TagColors>("tag-colors");
			return service && typeof service.classes === "function" ? service.classes(tag) || "" : "";
		} catch {
			return "";
		}
	}

	isSession(path: string): boolean {
		const file = this.ctx.app.vault.getAbstractFileByPath(path);
		const service = this.ctx.service<{ version: 1; isSession(file: TFile): boolean }>("sessions");
		return file instanceof TFile && service?.version === 1 && service.isSession(file);
	}

	today(): string {
		return this.writer.today();
	}

	/** `@today` / `@tomorrow` words, in every interface language. */
	dayWords(): DayWords {
		const words: DayWords = { today: ["today"], tomorrow: ["tomorrow"] };
		for (const t of this.ctx.translators()) {
			words.today.push(t.t("quick.today"));
			words.tomorrow.push(t.t("quick.tomorrow"));
		}
		return words;
	}

	/** A date in the interface language, with a format from the translations. */
	formatDate(date: string, formatKey: string): string {
		return moment(date, "YYYY-MM-DD").locale(this.ctx.lang).format(this.ctx.t(formatKey));
	}

	/** "Today", "Tomorrow", "3 days overdue", "Fri", "Oct 12". */
	dueText(due: string): string {
		const label = dueLabel(due, this.today());
		switch (label.kind) {
			case "today":
			case "tomorrow":
			case "yesterday":
				return this.ctx.t("due." + label.kind);
			case "overdue":
				return this.ctx.tn("due.overdue", label.days);
			case "weekday":
				return this.formatDate(due, "format.weekday");
			default:
				return this.formatDate(due, label.sameYear ? "format.short" : "format.long");
		}
	}

	// ----- actions with a toast -----

	private offerUndo(message: string, undo: Undo): void {
		this.lastUndo = { run: undo, until: Date.now() + 5000 };
		this.ctx.toast(message, { action: { label: this.ctx.t("common.undo"), run: () => void this.undo() } });
	}

	/** Undoes the last completion or move, within the few seconds its toast is shown. */
	async undo(): Promise<boolean> {
		const last = this.lastUndo;
		this.lastUndo = null;
		if (!last || Date.now() > last.until) return false;
		await last.run();
		return true;
	}

	canUndo(): boolean {
		return !!this.lastUndo && Date.now() <= this.lastUndo.until;
	}

	/** The sound of a task checked by hand, when it is on in the settings. */
	chime(): void {
		if (this.ctx.settings.doneSound) playDoneSound();
	}

	async complete(task: Task): Promise<void> {
		const written = await this.writer.setDone(task, true);
		if (written) this.chime();
		if (written) this.offerUndo(this.ctx.t("toast.done", { title: plainTitle(task.title) }), written.undo);
	}

	async retag(task: Task, tag: string): Promise<void> {
		const to = tag.replace(/^#/, "").toLowerCase();
		if (!to || to === task.primary) return;
		const written = await this.writer.retag(task, to);
		if (written) this.offerUndo(this.ctx.t("toast.moved", { tag: to, title: plainTitle(task.title) }), written.undo);
	}

	async setPriority(task: Task, priority: Priority | null): Promise<void> {
		await this.writer.setPriority(task, priority);
	}

	async setDue(task: Task, due: string | null): Promise<void> {
		await this.writer.setDue(task, due);
	}

	/** Renames; resolves to the task's key afterwards (null when nothing was written). */
	async rename(task: Task, title: string): Promise<string | null> {
		const written = await this.writer.rename(task, title);
		return written ? this.index.at(written.path, written.line)?.key ?? null : null;
	}

	dispose(): void {
		this.disposed = true;
		this.lastUndo = null;
		this.index.dispose();
	}
}
