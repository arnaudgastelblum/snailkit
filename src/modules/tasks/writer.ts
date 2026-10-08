// Every change the module makes to notes. An open note is edited through its editor (one small
// change, Ctrl+Z works there); a closed note through vault.process. A task line is always found
// again before writing, and nothing is written when it is gone.
import { MarkdownView, Notice, TFile, normalizePath, type Editor, type WorkspaceLeaf } from "obsidian";
import {
	editLines, insertTaskLine, insertToken, locateLine, removeBlock, removeBlocks, restoreBlock, restoreBlocks, type RemovedBlock, mapTaskText, minimalChange, newTaskPath, retagText, retitleText, revertLines,
	setDoneLine, setDueLines, setDueText, setMarkerText, setNoteLinkText, setPriorityText, type LineChange,
} from "./edit";
import { blockEnd, parseTaskText, scanTasks, scanUntagged, taskKey } from "./parse";
import type { TaskIndex } from "./task-index";
import type { Context, Priority, Task, TaskRef } from "./types";
import { openNoteAt } from "../../core/workbench/open";
import { moment } from "../../core/moment";

/** Puts the line back as it was. Resolves to false when the line changed since. */
export type Undo = () => Promise<boolean>;

export interface Written {
	path: string;
	/** Line number of the task after the write. */
	line: number;
	undo: Undo;
}

interface InternalPlugins {
	getPluginById?(id: string): { enabled?: boolean; instance?: { options?: { folder?: string; format?: string } } } | null;
}

export class TaskWriter {
	constructor(
		private readonly ctx: Context,
		private readonly index: TaskIndex,
	) {}

	private get app() {
		return this.ctx.app;
	}

	today(): string {
		return moment().format("YYYY-MM-DD");
	}

	private findEditor(path: string): Editor | null {
		let editor: Editor | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (!editor && leaf.view instanceof MarkdownView && leaf.view.file?.path === path) editor = leaf.view.editor;
		});
		return editor;
	}

	/**
	 * Runs `mutate(lines)` on a note. `mutate` returns the new lines, or null to leave the note
	 * as it is. Resolves to the new text, or null when nothing was written.
	 */
	async editFile(path: string, mutate: (lines: string[]) => string[] | null): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return null;
		const editor = this.findEditor(path);
		let out: string | null = null;
		if (editor) {
			const before = editor.getValue();
			const lines = mutate(before.split(/\r?\n/));
			if (!lines) return null;
			out = lines.join("\n");
			const change = minimalChange(before, out);
			editor.replaceRange(change.text, editor.offsetToPos(change.from), editor.offsetToPos(change.to));
		} else {
			await this.app.vault.process(file, (data) => {
				const lines = mutate(data.split(/\r?\n/));
				if (!lines) return data;
				out = lines.join("\n");
				return out;
			});
		}
		// The list follows at once, without waiting for the editor to save.
		if (out !== null) this.index.set(path, out, true);
		return out;
	}

	/** Rewrites one task line with `fn`. Null when the line is gone (a notice says so unless quiet). */
	async editLine(ref: TaskRef, fn: (line: string) => string | null, quiet = false): Promise<Written | null> {
		let at = -1;
		let before = "";
		let after = "";
		let same = false;
		const written = await this.editFile(ref.path, (lines) => {
			at = locateLine(lines, ref.line, ref.raw);
			// The line changed since it was read (a sync added a marker, the note was being typed in):
			// the same task is still found by its tag and words when only one line has them.
			if (at < 0 && "baseKey" in ref) at = this.findByKey(lines, ref.path, ref as Task);
			if (at < 0) return null;
			const next = fn(lines[at]);
			if (next === null) return null;
			if (next === lines[at]) {
				same = true;
				return null;
			}
			before = lines[at];
			after = next;
			lines[at] = next;
			return lines;
		});
		if (written === null) {
			if (same) return { path: ref.path, line: at, undo: async () => true };
			if (!quiet) new Notice(this.ctx.t("notice.changed"));
			return null;
		}
		const undo: Undo = async () => {
			let ok = false;
			await this.editFile(ref.path, (lines) => {
				const i = locateLine(lines, at, after);
				if (i < 0) return null;
				lines[i] = before;
				ok = true;
				return lines;
			});
			if (!ok) new Notice(this.ctx.t("notice.undo-failed"));
			return ok;
		};
		return { path: ref.path, line: at, undo };
	}

	/**
	 * The line of the only task of the note with the same tag and words as `task` (whatever its
	 * state, so that a twin is never taken for it), in the same state and without a marker that
	 * says otherwise (a sync id of another task); -1 when unsure.
	 */
	private findByKey(lines: readonly string[], path: string, task: Task): number {
		const flags = this.index.flags();
		const all = task.primary ? scanTasks(lines, path, flags) : scanUntagged(lines, path, flags);
		const hits = all.filter((t) => t.baseKey === task.baseKey);
		if (hits.length !== 1) return -1;
		const hit = hits[0];
		if (hit.done !== task.done) return -1;
		for (const [name, value] of Object.entries(task.markers ?? {})) if (hit.markers?.[name] !== undefined && hit.markers[name] !== value) return -1;
		return hit.line;
	}

	editText(ref: TaskRef, fn: (text: string) => string, quiet = false): Promise<Written | null> {
		return this.editLine(ref, (line) => mapTaskText(line, fn), quiet);
	}

	setDone(ref: TaskRef, done: boolean, quiet = false): Promise<Written | null> {
		const stamp = this.ctx.settings.stampDone ? this.today() : null;
		return this.editLine(ref, (line) => setDoneLine(line, done, stamp), quiet);
	}

	setPriority(ref: TaskRef, priority: Priority | null, quiet = false): Promise<Written | null> {
		return this.editText(ref, (text) => setPriorityText(text, priority), quiet);
	}

	setDue(ref: TaskRef, due: string | null, quiet = false): Promise<Written | null> {
		return this.editText(ref, (text) => setDueText(text, due), quiet);
	}

	/**
	 * Sets the due date of many tasks at once (`null` removes it): one write per note. Resolves to
	 * how many changed and one Undo that puts every date back (where the line was left untouched).
	 */
	async setDueAll(refs: readonly TaskRef[], due: string | null): Promise<{ count: number; undo: Undo }> {
		const byPath = new Map<string, TaskRef[]>();
		for (const ref of refs) byPath.set(ref.path, [...(byPath.get(ref.path) ?? []), ref]);
		const done: Array<{ path: string; changes: LineChange[] }> = [];
		let failed = false;
		for (const [path, list] of byPath) {
			// One note that cannot be written does not cost the others, nor their Undo.
			let changes: LineChange[] = [];
			try {
				const written = await this.editFile(path, (lines) => {
					const result = setDueLines(lines, list, due);
					changes = result?.changes ?? [];
					return result?.lines ?? null;
				});
				if (written !== null && changes.length) done.push({ path, changes });
			} catch (error) {
				failed = true;
				console.error("[Snailkit] tasks: could not change the dates in " + path, error);
			}
		}
		if (failed) new Notice(this.ctx.t("notice.some-failed"));
		const count = done.reduce((n, d) => n + d.changes.length, 0);
		const undo: Undo = async () => {
			let all = true;
			for (const { path, changes } of done) {
				let restored = 0;
				try {
					await this.editFile(path, (lines) => {
						const result = revertLines(lines, changes);
						restored = result.restored;
						return restored ? result.lines : null;
					});
				} catch (error) {
					console.error("[Snailkit] tasks: could not undo the dates in " + path, error);
				}
				if (restored < changes.length) all = false;
			}
			if (!all) new Notice(this.ctx.t("notice.undo-failed"));
			return all;
		};
		return { count, undo };
	}

	/**
	 * Deletes a task line with its subtasks and description (the indented lines under it). The
	 * task note, if any, is left as it is. Undo puts the lines back where they were.
	 */
	async deleteTask(ref: TaskRef, quiet = false): Promise<Written | null> {
		const found: { block: RemovedBlock | null } = { block: null };
		const written = await this.editFile(ref.path, (lines) => {
			const at = locateLine(lines, ref.line, ref.raw);
			if (at < 0) return null;
			const result = removeBlock(lines, at, blockEnd(lines, at));
			found.block = result.block;
			return result.lines;
		});
		const removed = found.block;
		if (written === null || !removed) {
			if (!quiet) new Notice(this.ctx.t("notice.changed"));
			return null;
		}
		const undo: Undo = async () => {
			let ok = false;
			await this.editFile(ref.path, (lines) => {
				const back = restoreBlock(lines, removed);
				ok = back !== null;
				return back;
			});
			if (!ok) new Notice(this.ctx.t("notice.undo-failed"));
			return ok;
		};
		return { path: ref.path, line: removed.at, undo };
	}

	/**
	 * Rewrites many task lines (`fn` per task: the new line, or null to leave it): one write per
	 * note, one Undo that puts back every line left untouched since.
	 */
	async editMany(items: ReadonlyArray<{ task: TaskRef; fn: (line: string) => string | null }>): Promise<{ count: number; undo: Undo }> {
		const byPath = new Map<string, Array<{ line: number; raw: string; fn: (line: string) => string | null }>>();
		for (const { task, fn } of items) byPath.set(task.path, [...(byPath.get(task.path) ?? []), { line: task.line, raw: task.raw, fn }]);
		const done: Array<{ path: string; changes: LineChange[] }> = [];
		let failed = false;
		for (const [path, list] of byPath) {
			let changes: LineChange[] = [];
			try {
				const written = await this.editFile(path, (lines) => {
					const result = editLines(lines, list);
					changes = result?.changes ?? [];
					return result?.lines ?? null;
				});
				if (written !== null && changes.length) done.push({ path, changes });
			} catch (error) {
				failed = true;
				console.error("[Snailkit] tasks: could not change " + path, error);
			}
		}
		if (failed) new Notice(this.ctx.t("notice.some-failed"));
		const count = done.reduce((n, d) => n + d.changes.length, 0);
		const undo: Undo = async () => {
			let all = true;
			for (const { path, changes } of done) {
				let restored = 0;
				try {
					await this.editFile(path, (lines) => {
						const result = revertLines(lines, changes);
						restored = result.restored;
						return restored ? result.lines : null;
					});
				} catch (error) {
					console.error("[Snailkit] tasks: could not undo in " + path, error);
				}
				if (restored < changes.length) all = false;
			}
			if (!all) new Notice(this.ctx.t("notice.undo-failed"));
			return all;
		};
		return { count, undo };
	}

	/** Deletes many tasks with their blocks: one write per note, one Undo that puts them all back. */
	async deleteMany(refs: readonly TaskRef[]): Promise<{ count: number; undo: Undo }> {
		const byPath = new Map<string, TaskRef[]>();
		for (const ref of refs) byPath.set(ref.path, [...(byPath.get(ref.path) ?? []), ref]);
		const done: Array<{ path: string; blocks: RemovedBlock[] }> = [];
		let failed = false;
		for (const [path, list] of byPath) {
			let blocks: RemovedBlock[] = [];
			try {
				const written = await this.editFile(path, (lines) => {
					const result = removeBlocks(lines, list, blockEnd);
					blocks = result?.blocks ?? [];
					return result?.lines ?? null;
				});
				if (written !== null && blocks.length) done.push({ path, blocks });
			} catch (error) {
				failed = true;
				console.error("[Snailkit] tasks: could not delete in " + path, error);
			}
		}
		if (failed) new Notice(this.ctx.t("notice.some-failed"));
		const count = done.reduce((n, d) => n + d.blocks.length, 0);
		const undo: Undo = async () => {
			let all = true;
			for (const { path, blocks } of done) {
				let restored = 0;
				try {
					await this.editFile(path, (lines) => {
						const back = restoreBlocks(lines, blocks);
						restored = back.restored;
						return restored ? back.lines : null;
					});
				} catch (error) {
					console.error("[Snailkit] tasks: could not undo in " + path, error);
				}
				if (restored < blocks.length) all = false;
			}
			if (!all) new Notice(this.ctx.t("notice.undo-failed"));
			return all;
		};
		return { count, undo };
	}

	setNoteLink(task: Task, linkTarget: string | null, quiet = false): Promise<Written | null> {
		return this.editText(task, (text) => setNoteLinkText(text, linkTarget), quiet);
	}

	setMarker(ref: TaskRef, name: string, value: string | null, quiet = false): Promise<Written | null> {
		return this.editText(ref, (text) => setMarkerText(text, name, value), quiet);
	}

	/** Changes the group tag of a task where it stands in the line. */
	retag(task: Task, tag: string, quiet = false): Promise<Written | null> {
		const to = tag.replace(/^#/, "").toLowerCase();
		return this.editText(task, (text) => retagText(text, task.primary, to), quiet);
	}

	/** Gives an untagged task its tag, before its dates and markers. */
	addTag(task: Task, tag: string, quiet = false): Promise<Written | null> {
		const to = tag.replace(/^#/, "").toLowerCase();
		return this.editText(task, (text) => insertToken(text, "#" + to), quiet);
	}

	/** Renames a task: only its title, tags and dates stay. Refused when the group tag would be lost. */
	async rename(task: Task, title: string, quiet = false): Promise<Written | null> {
		const next = retitleText(task.text, task.title, title);
		if (task.primary && !parseTaskText(next, this.index.flags()).primary) {
			if (!quiet) new Notice(this.ctx.t("notice.keep-tag"));
			return null;
		}
		// Rewritten from the line as it is now: a date or a marker added meanwhile stays.
		return this.editText(task, (text) => {
			const now = retitleText(text, task.title, title);
			return !task.primary || parseTaskText(now, this.index.flags()).primary ? now : next;
		}, quiet);
	}

	/** Key the task will have once renamed, to keep it selected in the list. */
	keyAfterRename(task: Task, title: string): string {
		const fields = parseTaskText(retitleText(task.text, task.title, title), this.index.flags());
		if (fields.primary) return taskKey(fields.primary, fields.title);
		// A task without a tag keeps its "|words" key, with its new words.
		return task.primary ? task.key : taskKey("", fields.title);
	}

	toggleSubtask(task: Task, sub: { line: number; raw: string; done: boolean }): Promise<Written | null> {
		return this.editLine({ path: task.path, line: sub.line, raw: sub.raw }, (line) => setDoneLine(line, !sub.done, null));
	}

	// ----- new tasks -----

	/** Where new tasks go (see the "New tasks go to" setting). */
	newTaskTarget(): { path: string; daily: boolean } {
		let daily: { folder: string; format: string } | null = null;
		try {
			const internal = (this.app as unknown as { internalPlugins?: InternalPlugins }).internalPlugins;
			const plugin = internal?.getPluginById?.("daily-notes");
			if (plugin?.enabled) {
				const options = plugin.instance?.options ?? {};
				daily = { folder: options.folder ?? "", format: options.format ?? "" };
			}
		} catch {
			daily = null;
		}
		const target = newTaskPath(this.ctx.settings.newTaskNote, daily, this.ctx.t("note.inbox"), (format) => moment().format(format));
		return { ...target, path: normalizePath(target.path) };
	}

	private async ensureFolder(path: string): Promise<void> {
		let current = "";
		for (const part of path.split("/").filter(Boolean)) {
			current = current ? current + "/" + part : part;
			if (this.app.vault.getAbstractFileByPath(current)) continue;
			try {
				await this.app.vault.createFolder(current);
			} catch (error) {
				// Created meanwhile is fine; any other failure stops here.
				if (!this.app.vault.getAbstractFileByPath(current)) throw error;
			}
		}
	}

	/**
	 * Writes "- [ ] text" in the note for new tasks, under its `## #tag` heading when there is
	 * one. Resolves to the place of the new line, or null when it could not be written.
	 */
	async appendTask(text: string, tag: string): Promise<{ path: string; line: number } | null> {
		const target = this.newTaskTarget();
		let file = this.app.vault.getAbstractFileByPath(target.path);
		if (!file) {
			const slash = target.path.lastIndexOf("/");
			if (slash > 0) await this.ensureFolder(target.path.slice(0, slash));
			try {
				file = await this.app.vault.create(target.path, "");
			} catch (error) {
				file = this.app.vault.getAbstractFileByPath(target.path);
				if (!file) throw error;
			}
		}
		if (!(file instanceof TFile)) {
			new Notice(this.ctx.t("notice.target-folder", { path: target.path }));
			return null;
		}
		let at = -1;
		const written = await this.editFile(file.path, (lines) => {
			const result = insertTaskLine(lines, "- [ ] " + text, tag);
			at = result.at;
			return result.lines;
		});
		return written === null ? null : { path: file.path, line: at };
	}

	/** Builds the text of a new task (tag, priority, due date added when missing) and writes it. */
	async addTask(
		title: string,
		tag: string,
		priority: Priority | null,
		due: string | null,
		markers: Record<string, string> = {},
	): Promise<{ path: string; line: number; key: string } | null> {
		const flags = this.index.flags();
		let text = title.replace(/\s+/g, " ").trim();
		const typed = parseTaskText(text, flags).primary;
		const primary = typed ?? tag.replace(/^#/, "").toLowerCase();
		if (!typed) text += " #" + primary;
		if (priority) text = setPriorityText(text, priority);
		if (due) text = setDueText(text, due);
		for (const [name, value] of Object.entries(markers)) text = setMarkerText(text, name, value);
		const place = await this.appendTask(text, primary);
		return place ? { ...place, key: taskKey(primary, parseTaskText(text, flags).title) } : null;
	}

	// ----- opening -----

	/**
	 * Opens the note at the task line, without replacing the list when it is a page. From a
	 * transient Workbench (a new tab), `replace` is its leaf: the note takes its place.
	 */
	async openTask(task: TaskRef, event?: MouseEvent | KeyboardEvent, replace?: WorkspaceLeaf | null): Promise<void> {
		await this.openNote(task.path, task.line, event, task.raw, replace);
	}

	/** The Workbench's rules (src/core/workbench/open.ts); the task line is found again by its text. */
	async openNote(path: string, line: number | null, event?: MouseEvent | KeyboardEvent, raw?: string, replace?: WorkspaceLeaf | null): Promise<void> {
		await openNoteAt(this.app, path, line, {
			event,
			replace,
			locate: raw === undefined ? undefined : (lines) => locateLine(lines, line ?? 0, raw),
		});
	}
}
