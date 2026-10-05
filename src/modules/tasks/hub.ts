// The running module: index, writer, open views and the actions they share (with toasts).
import { moment } from "obsidian";
import { dueLabel } from "./group";
import { plainTitle } from "./parse";
import type { DayWords } from "./quick-add";
import type { ViewAction } from "./api";
import { TaskIndex } from "./task-index";
import { VIEW_TYPE, type Context, type Priority, type Task } from "./types";
import { TaskWriter, type Undo } from "./writer";

/** What the hub needs from an open view. */
export interface HubView {
	refresh(): void;
	build(): void;
	startAdd(tag: string | null): void;
	showTag(tag: string): void;
}

interface TagColors {
	version: number;
	classes(tag: string): string;
}

export class TasksHub {
	readonly index: TaskIndex;
	readonly writer: TaskWriter;
	private refreshTimer = 0;
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

	views(): HubView[] {
		return this.ctx.app.workspace
			.getLeavesOfType(VIEW_TYPE)
			.map((leaf) => leaf.view as unknown as Partial<HubView>)
			.filter((view): view is HubView => typeof view.refresh === "function" && typeof view.build === "function");
	}

	/** Redraws every open list soon (many changes in a row draw once). */
	refreshViews(): void {
		if (this.disposed) return;
		window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			for (const view of this.views()) view.refresh();
		}, 60);
	}

	rebuildViews(): void {
		for (const view of this.views()) view.build();
	}

	/** Shows the list as a page (main area) or in the right side panel, reusing an open one. */
	async activate(where: "page" | "side"): Promise<HubView | null> {
		const workspace = this.ctx.app.workspace;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE).find((l) => (l.getRoot() === workspace.rootSplit) === (where === "page")) ?? null;
		if (!leaf) {
			leaf = where === "page" ? workspace.getLeaf("tab") : workspace.getRightLeaf(false);
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await workspace.revealLeaf(leaf);
		const view = leaf.view as unknown as Partial<HubView>;
		return typeof view.startAdd === "function" ? (view as HubView) : null;
	}

	/** Shows the list as a page, on the tasks of one tag (and its sub-tags). */
	async showTag(tag: string): Promise<boolean> {
		const view = await this.activate("page");
		view?.showTag(tag);
		return !!view;
	}

	/** Opens the quick add row: in an open list, else in the side panel. */
	async newTask(): Promise<void> {
		const workspace = this.ctx.app.workspace;
		const open = workspace.getLeavesOfType(VIEW_TYPE)[0];
		const view = open ? await this.activate(open.getRoot() === workspace.rootSplit ? "page" : "side") : await this.activate("side");
		view?.startAdd(null);
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

	async complete(task: Task): Promise<void> {
		const written = await this.writer.setDone(task, true);
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
		window.clearTimeout(this.refreshTimer);
		this.lastUndo = null;
		this.index.dispose();
	}
}
