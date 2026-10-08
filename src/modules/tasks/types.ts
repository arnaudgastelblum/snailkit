// Settings, the task model and the module context shared by the Tasks files.
import type { ModuleContext } from "../../core/context";

/** View type of the task list (page and side panel). */
export const VIEW_TYPE = "snailkit-tasks";

export type Priority = "high" | "medium" | "low";
export type SortMode = "notes" | "priority" | "due";

export interface TasksSettings {
	/** Comma separated folders whose tasks are left out. */
	excludedFolders: string;
	/** Comma separated tags that never make a group. */
	flagTags: string;
	/** Adds "✅ YYYY-MM-DD" when a task is checked from the list. */
	stampDone: boolean;
	/** Note where new tasks go. Empty: today's daily note. */
	newTaskNote: string;
	/** Saved from the list itself. */
	sortMode: string;
	priorityFilter: string[];
	collapsed: string[];
	/** Tags placed by the user in the navigator, siblings in this order (the others follow, by name). */
	tagOrder: string[];
	/** Open tasks placed by the user within their tag (task keys), for the "My order" sort. */
	taskOrder: string[];
	/** Folder of new task notes; empty: where Obsidian puts new notes. */
	taskNotesFolder: string;
	/** Start of a task note's name, followed by the task title. */
	taskNotePrefix: string;
	/** A short sound when a task is checked by hand (never when a sync checks it). */
	doneSound: boolean;
	/** Today view: overdue tasks first, in warning colors (the former display). Off: today first, the rest folded below. */
	overdueFirst: boolean;
	/** Today view: the "Waiting since earlier" block is open (remembered). */
	earlierOpen: boolean;
	/** Untagged checkboxes are listed (under "No tag") in notes changed in the last N days; 0: never. */
	untaggedDays: number;
}

export type Context = ModuleContext<TasksSettings>;

export interface Subtask {
	line: number;
	raw: string;
	done: boolean;
	text: string;
}

/** What a task line says, without its place in the vault. */
export interface TaskFields {
	/** Target of the 📝 wiki link, without its alias or .md extension. */
	noteLink: string | null;
	/** Every tag of the line, lowercased, without "#". */
	tags: string[];
	/** The group of the task: its first tag that is not a flag. */
	primary: string | null;
	priority: Priority | null;
	due: string | null;
	doneDate: string | null;
	/** The text without the group tag, flags, dates and other tokens. */
	title: string;
	/** `%%name:value%%` comments of the line. */
	markers: Record<string, string>;
}

export interface Task extends TaskFields {
	primary: string;
	path: string;
	/** 0-based line number in the note when it was read. */
	line: number;
	/** The whole line as it was read. */
	raw: string;
	indent: string;
	/** What follows "- [ ] ". */
	text: string;
	done: boolean;
	/** Tag + words: survives edits of priority, dates and moves to another note. */
	baseKey: string;
	/** baseKey, with "#2", "#3"... for identical tasks. */
	key: string;
	subtasks: Subtask[];
	description: string;
}

/** Enough to find a task line again. */
export interface TaskRef {
	path: string;
	line: number;
	raw: string;
}

/** The task notes of the vault: the note linked from a task line with 📝 (src/modules/tasks/task-note.ts). */
export interface TaskNotesService {
	/** The task's note file, or null when it has none. */
	file(task: Task): import("obsidian").TFile | null;
	/** The body of the task's note (below its breadcrumb line), or null when the task has no note. */
	read(task: Task): Promise<string | null>;
	/** Writes the body of the task's note, creating the note and the 📝 link in the line when missing. */
	write(task: Task, body: string): Promise<void>;
}
