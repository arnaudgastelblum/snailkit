// The running module: index, writer, the Tasks tabs shown in the Workbench and the actions they
// share (with toasts). The Workbench itself belongs to the core (ctx.workbench).
import { TFile } from "obsidian";
import { isSideLeaf } from "../../core/workbench/state";
import { TAB_ORDER, WORKBENCH_VIEW_TYPE, type WorkbenchTab } from "../../core/workbench/types";
import { addDays, declaredFlags, dueLabel, isParked, parkingOf, sinceDays } from "./group";
import { plainTitle } from "./parse";
import type { DayWords } from "./quick-add";
import { resolveWorkbench, type TasksApi, type ViewAction, type ViewTab } from "./api";
import { TasksTab } from "./tab";
import { TaskIndex } from "./task-index";
import type { Context, Priority, Task, TaskNotesService } from "./types";
import { TaskWriter, type Undo } from "./writer";
import { insertToken, mapTaskText, retagText, setDoneLine, setFlagText, setPriorityText } from "./edit";
import { playDayClearSound, playDoneSound, playLandSound } from "../../ui/sound";
import { nextRun, reducedMotion, type Run } from "../../ui/playful";
import { moment } from "../../core/moment";

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
	/** Tasks checked one after another: the sound climbs (playful). */
	private run: Run = { step: 0, at: null };
	/** Checked from Snailkit today when no date is stamped: [day, count]. */
	private checkedToday: [string, number] = ["", 0];
	/** The day whose end was already shown here (kept even when the device storage fails). */
	private clearShown = "";
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

	/** Playful motion is on here (the setting, and the system does not ask for less motion). */
	playful(win: Window = activeWindow): boolean {
		return this.ctx.settings.playful && !reducedMotion(win);
	}

	/** The sound of a check, at the very gesture; it climbs while you go on (playful). Counts nothing. */
	checkSound(): void {
		this.run = nextRun(this.run, Date.now());
		if (this.ctx.settings.doneSound) playDoneSound(activeWindow, this.playful() ? this.run.step : 0);
	}

	/** `n` tasks were checked here (written): counted for "done today" when no date is stamped. */
	private counted(n: number): void {
		if (n <= 0) return;
		const today = this.today();
		this.checkedToday = this.checkedToday[0] === today ? [today, this.checkedToday[1] + n] : [today, n];
	}

	/** A task was checked by hand (here or by another tool, already written): its sound, and it counts. */
	chime(): void {
		this.checkSound();
		this.counted(1);
	}

	/** The small knock of a task landing in the count of the day (playful, with the sound on). */
	land(win: Window = activeWindow): void {
		if (this.ctx.settings.doneSound && this.playful(win)) playLandSound(win, this.run.step);
	}

	/** How far the run of checks went (0: the first one). */
	get runStep(): number {
		return this.run.step;
	}

	/** Tasks done today: those stamped with today's date, else (no stamp) those checked here today. */
	doneToday(): number {
		const today = this.today();
		const stamped = this.index.list.filter((t) => t.done && t.doneDate === today).length;
		return this.ctx.settings.stampDone ? stamped : Math.max(stamped, this.checkedToday[0] === today ? this.checkedToday[1] : 0);
	}

	/** Open tasks due today (those from earlier days wait apart and never hold the day back). */
	stillDue(): number {
		const today = this.today();
		const parking = parkingOf(declaredFlags(this.ctx.settings.flagTags));
		return this.index.open().filter((t) => t.due === today && !isParked(t, parking)).length;
	}

	/** True once per day and per device: the end of the day was not shown yet (it is now marked). */
	takeDayClear(): boolean {
		const key = "snailkit-tasks-day-clear";
		const today = this.today();
		if (this.clearShown === today) return false;
		this.clearShown = today;
		try {
			if (this.ctx.app.loadLocalStorage(key) === today) return false;
			this.ctx.app.saveLocalStorage(key, today);
		} catch {
			// Not kept on the device: the marker in memory still shows it once per session.
		}
		return true;
	}

	/** The chord of a clear day (with the sound on). */
	dayClearSound(win: Window = activeWindow): void {
		if (this.ctx.settings.doneSound) playDayClearSound(win);
	}

	/** Checks a task; true when it was written. `quiet`: the caller already played the sound (at the very click). */
	async complete(task: Task, quiet = false): Promise<boolean> {
		const written = await this.writer.setDone(task, true);
		if (!written) return false;
		if (quiet) this.counted(1);
		else this.chime();
		this.offerUndo(this.ctx.t("toast.done", { title: plainTitle(task.title) }), written.undo);
		return true;
	}

	/** Deletes a task (with its subtasks and description), with a toast that can undo it. */
	async deleteTask(task: Task): Promise<void> {
		const written = await this.writer.deleteTask(task);
		if (written) this.offerUndo(this.ctx.t("toast.deleted", { title: plainTitle(task.title) }), written.undo);
	}

	async retag(task: Task, tag: string): Promise<void> {
		const to = tag.replace(/^#/, "").toLowerCase();
		if (!to || to === task.primary) return;
		const written = task.primary ? await this.writer.retag(task, to) : await this.writer.addTag(task, to);
		if (written) this.offerUndo(this.ctx.t("toast.moved", { tag: to, title: plainTitle(task.title) }), written.undo);
	}

	async setPriority(task: Task, priority: Priority | null): Promise<void> {
		await this.writer.setPriority(task, priority);
	}

	async setDue(task: Task, due: string | null): Promise<void> {
		await this.writer.setDue(task, due);
	}

	/** Moves many tasks to a day, or removes their dates (`null`): one toast, one Undo for all. */
	async setDueAll(tasks: readonly Task[], due: string | null): Promise<void> {
		const { count, undo } = await this.writer.setDueAll(tasks, due);
		if (!count) return;
		const today = this.today();
		const key = due === null ? "toast.bulk-cleared" : due === today ? "toast.bulk-today" : due === addDays(today, 1) ? "toast.bulk-tomorrow" : "toast.bulk-moved";
		this.offerUndo(this.ctx.tn(key, count, { date: due ? this.dueText(due) : "" }), undo);
	}

	// ----- many tasks at once (the selection of the list): one toast, one Undo -----

	async completeAll(tasks: readonly Task[]): Promise<void> {
		const stamp = this.ctx.settings.stampDone ? this.today() : null;
		const { count, undo } = await this.writer.editMany(tasks.map((task) => ({ task, fn: (line: string) => setDoneLine(line, true, stamp) })));
		if (!count) return;
		this.checkSound();
		this.counted(count);
		this.offerUndo(this.ctx.tn("toast.bulk-done", count), undo);
	}

	/** A flag on or off for one task (quick, deep, waiting, someday...). */
	async setFlag(task: Task, flag: string, on: boolean): Promise<void> {
		await this.writer.editText(task, (text) => setFlagText(text, flag, on));
	}

	/** A flag on or off for many tasks: one write per note, one Undo. */
	async setFlagAll(tasks: readonly Task[], flag: string, on: boolean): Promise<void> {
		const { count, undo } = await this.writer.editMany(tasks.map((task) => ({ task, fn: (line: string) => mapTaskText(line, (text) => setFlagText(text, flag, on)) })));
		if (count) this.offerUndo(this.ctx.tn(on ? "toast.bulk-flag-on" : "toast.bulk-flag-off", count, { flag }), undo);
	}

	async setPriorityAll(tasks: readonly Task[], priority: Priority | null): Promise<void> {
		const { count, undo } = await this.writer.editMany(tasks.map((task) => ({ task, fn: (line: string) => mapTaskText(line, (text) => setPriorityText(text, priority)) })));
		if (count) this.offerUndo(this.ctx.tn("toast.bulk-priority", count), undo);
	}

	/** Every task to one tag: a tagged task changes its tag where it stands, an untagged one gets it. */
	async retagAll(tasks: readonly Task[], tag: string): Promise<void> {
		const to = tag.replace(/^#/, "").toLowerCase();
		if (!to) return;
		const moving = tasks.filter((task) => task.primary !== to);
		const { count, undo } = await this.writer.editMany(moving.map((task) => ({
			task,
			fn: (line: string) => mapTaskText(line, (text) => (task.primary ? retagText(text, task.primary, to) : insertToken(text, "#" + to))),
		})));
		if (count) this.offerUndo(this.ctx.tn("toast.bulk-tag", count, { tag: to }), undo);
	}

	async deleteAll(tasks: readonly Task[]): Promise<void> {
		const { count, undo } = await this.writer.deleteMany(tasks);
		if (count) this.offerUndo(this.ctx.tn("toast.bulk-deleted", count), undo);
	}

	/** "6 days ago", "Yesterday": how long a task has waited, said without blame. */
	sinceText(due: string): string {
		const days = sinceDays(due, this.today());
		return days === 1 ? this.ctx.t("due.yesterday") : this.ctx.tn("due.since", days);
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
