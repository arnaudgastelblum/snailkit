// Task notes: one real note per task, to develop it (context, steps, links, images), linked from
// the task line with a small 📝 (`[[Tasks/Task - Title|📝]]`, the former Todo Hub format, so
// existing notes keep working). Created only when something is written. Its first lines are a
// breadcrumb back to the note that held the task when it was created (an empty line, then
// `[[Source note]]`), never rewritten; the body is what follows. Companion plugins read and write
// the body through the Tasks API.
import { normalizePath, TFile, type App } from "obsidian";
import type { TasksHub } from "./hub";
import { plainTitle } from "./parse";
import type { Task, TaskNotesService } from "./types";

/** Characters a file name cannot hold on some system, or that break a wiki link. */
const UNSAFE = /[\\/:*?"<>|#^[\]]/g;
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** "Task - " + the title made safe for a file name: at most 80 characters, no trailing dot or space. */
export function taskNoteName(prefix: string, title: string): string {
	let name = (prefix + title).replace(UNSAFE, " ").replace(/\s+/g, " ").trim().slice(0, 80);
	name = name.replace(/[. ]+$/, "");
	if (!name) name = "Task";
	if (DEVICE.test(name)) name = "Task " + name;
	return name;
}

/**
 * Splits a task note into what Snailkit keeps (frontmatter and the breadcrumb line) and the body.
 * The breadcrumb is a lone `[[link]]` on the first line, or on the second after an empty one; it
 * is followed by at most one empty line, which belongs to the head too.
 */
export function splitTaskNote(text: string): { head: string; body: string } {
	const lines = text.split("\n");
	let at = 0;
	if (lines[0]?.replace(/\r$/, "") === "---") {
		const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\r?$/.test(line));
		if (end > 0) at = end + 1;
	}
	const crumb = (i: number) => /^\s*\[\[[^\]]+\]\]\s*$/.test(lines[i] ?? "");
	if (lines[at]?.trim() === "" && crumb(at + 1)) at += 2;
	else if (crumb(at)) at += 1;
	else return { head: lines.slice(0, at).join("\n") + (at ? "\n" : ""), body: lines.slice(at).join("\n") };
	if (lines[at]?.trim() === "") at += 1;
	return { head: lines.slice(0, at).join("\n") + "\n", body: lines.slice(at).join("\n") };
}

export class TaskNotes implements TaskNotesService {
	/** Notes just created, by task key: the line shows its 📝 link only once the index has read it again. */
	private readonly created = new Map<string, string>();

	constructor(private readonly hub: TasksHub) {}

	private get app(): App {
		return this.hub.ctx.app;
	}

	/** The task's note, or null when the line has no 📝 link or the note does not exist. */
	file(task: Task): TFile | null {
		if (!task.noteLink) {
			const path = this.created.get(task.key);
			const recent = path ? this.app.vault.getAbstractFileByPath(path) : null;
			return recent instanceof TFile ? recent : null;
		}
		this.created.delete(task.key);
		const file = this.app.metadataCache.getFirstLinkpathDest(task.noteLink, task.path);
		return file instanceof TFile ? file : null;
	}

	async read(task: Task): Promise<string | null> {
		const file = this.file(task);
		if (!file) return null;
		return splitTaskNote(await this.app.vault.read(file)).body;
	}

	async write(task: Task, body: string): Promise<void> {
		const file = this.file(task);
		if (!file) {
			if (body.trim()) await this.create(task, body);
			return;
		}
		await this.app.vault.process(file, (text) => {
			const { head } = splitTaskNote(text);
			return head + body;
		});
	}

	/** Creates the note (breadcrumb, then `body`) and links it from the task line. */
	async create(task: Task, body: string): Promise<TFile | null> {
		const settings = this.hub.ctx.settings;
		const folder = settings.taskNotesFolder.trim()
			? normalizePath(settings.taskNotesFolder.trim())
			: this.app.fileManager.getNewFileParent(task.path).path;
		if (folder && folder !== "/" && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
		const base = taskNoteName(settings.taskNotePrefix, plainTitle(task.title));
		const dir = folder && folder !== "/" ? folder + "/" : "";
		let path = normalizePath(`${dir}${base}.md`);
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${dir}${base} ${n}.md`);
		const source = this.app.vault.getAbstractFileByPath(task.path);
		const crumb = source instanceof TFile ? `[[${this.app.metadataCache.fileToLinktext(source, path, true)}]]` : "";
		const file = await this.app.vault.create(path, `\n${crumb}\n\n${body}`);
		this.created.set(task.key, file.path);
		await this.hub.writer.setNoteLink(task, path.replace(/\.md$/i, ""));
		return file;
	}
}
