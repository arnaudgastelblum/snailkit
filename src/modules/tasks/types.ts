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
}

/** Enough to find a task line again. */
export interface TaskRef {
	path: string;
	line: number;
	raw: string;
}
