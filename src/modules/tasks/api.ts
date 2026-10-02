// Public API of the Tasks module, shared with other modules and companion plugins through
// `ctx.provide("tasks", api)`. Reach it from a plugin with:
//   app.plugins.plugins.snailkit?.api.service("tasks") as TasksApi | undefined
// It is undefined while the module is off; listen to the workspace event
// "snailkit:services-changed" to know when it comes and goes. Documented in docs/tasks.md.
import { isIsoDate } from "./group";
import { plainTitle } from "./parse";
import type { TaskIndex } from "./task-index";
import type { Task, TaskRef } from "./types";
import type { TaskWriter, Written } from "./writer";

export type TaskPriority = "high" | "medium" | "low";

/** Enough to find a task again: its note, its 0-based line and the whole line as last read. */
export interface TaskLocation {
	path: string;
	line: number;
	raw: string;
}

/** A tagged task, as read from its note. A copy: changing it changes nothing. */
export interface TaskInfo extends TaskLocation {
	/** Group tag and words ("project/website|fix the footer"): survives edits of priority and dates, and moves to another note. */
	key: string;
	/** What follows "- [ ] " in the line. */
	text: string;
	/** The text without its group tag, flags and tokens; inline Markdown kept. */
	title: string;
	/** The title with links and emphasis as plain text. */
	plainTitle: string;
	/** Group tag, lowercased, without "#". */
	tag: string;
	/** Every tag of the line, lowercased, without "#". */
	tags: string[];
	priority: TaskPriority | null;
	/** "YYYY-MM-DD" from `📅`, or null. */
	due: string | null;
	done: boolean;
	/** "YYYY-MM-DD" from `✅`, or null. */
	doneDate: string | null;
	/** `%%name:value%%` comments of the line. */
	markers: Record<string, string>;
}

export interface NewTask {
	title: string;
	/** Group tag, with or without "#". Ignored when the title already carries a tag. */
	tag: string;
	priority?: TaskPriority | null;
	due?: string | null;
	markers?: Record<string, string>;
}

export interface TasksApi {
	readonly version: 1;
	/** False until the first read of the vault is done (a "change" event follows). */
	isReady(): boolean;
	/** Tagged tasks of the vault, in note order. Open tasks only unless `includeDone`. */
	getTasks(options?: { includeDone?: boolean }): TaskInfo[];
	/** The task at that place now (same line, else the only identical line of the note), or null. */
	find(location: TaskLocation): TaskInfo | null;
	/** Group tags of the tasks and the other tags of the vault (not the flags), sorted. */
	getTags(): string[];
	/** Called after any change of the tasks (a note edited, the vault read). Returns an unsubscribe function. */
	on(event: "change", callback: () => void): () => void;

	/**
	 * Every operation finds the line again first and writes nothing when it is gone. It resolves
	 * to the task as written (with its new line and raw text), or null when nothing was written.
	 * No notice is shown: the caller decides what to say.
	 */
	setDone(location: TaskLocation, done: boolean): Promise<TaskInfo | null>;
	/** "YYYY-MM-DD", or null to remove the due date. */
	setDue(location: TaskLocation, due: string | null): Promise<TaskInfo | null>;
	setPriority(location: TaskLocation, priority: TaskPriority | null): Promise<TaskInfo | null>;
	/** Changes the title only: tags, dates and markers stay. */
	rename(location: TaskLocation, title: string): Promise<TaskInfo | null>;
	/** Replaces the group tag where it stands in the line. */
	moveToTag(location: TaskLocation, tag: string): Promise<TaskInfo | null>;
	/** Sets or removes (null) a hidden `%%name:value%%` marker. Name: a-z, 0-9, "-"; value: letters, digits, "_", ".", "-". */
	setMarker(location: TaskLocation, name: string, value: string | null): Promise<TaskInfo | null>;
	/** Writes a new open task where quick add writes (see the "New tasks go to" setting). */
	addTask(task: NewTask): Promise<TaskInfo | null>;
}

const MARKER_NAME_RE = /^[a-z][a-z0-9-]*$/;
const MARKER_VALUE_RE = /^[A-Za-z0-9_.-]+$/;
const TAG_RE = /^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u;
const PRIORITIES = ["high", "medium", "low"];

function info(t: Task): TaskInfo {
	return {
		path: t.path,
		line: t.line,
		raw: t.raw,
		key: t.key,
		text: t.text,
		title: t.title,
		plainTitle: plainTitle(t.title),
		tag: t.primary,
		tags: [...t.tags],
		priority: t.priority,
		due: t.due,
		done: t.done,
		doneDate: t.doneDate,
		markers: { ...t.markers },
	};
}

function location(value: TaskLocation): TaskRef | null {
	if (!value || typeof value.path !== "string" || typeof value.raw !== "string" || !Number.isInteger(value.line)) return null;
	return { path: value.path, line: value.line, raw: value.raw };
}

/** Builds the API over the module's index and writer. `alive` turns false when the module stops. */
export function createTasksApi(index: TaskIndex, writer: TaskWriter, alive: () => boolean): TasksApi {
	const after = (written: Written | null) => (written && alive() ? index.at(written.path, written.line) : null);
	const run = async (value: TaskLocation, op: (task: Task) => Promise<Written | null>): Promise<TaskInfo | null> => {
		const ref = location(value);
		const task = ref && alive() ? index.find(ref) : null;
		if (!task) return null;
		try {
			const written = after(await op(task));
			return written ? info(written) : null;
		} catch (error) {
			console.error("[Snailkit] tasks: API write failed", error);
			return null;
		}
	};
	const cleanTag = (tag: string) => (typeof tag === "string" ? tag.trim().replace(/^#/, "").toLowerCase() : "");

	return {
		version: 1,
		isReady: () => alive() && index.ready,
		getTasks: (options) => (alive() ? index.list.filter((t) => options?.includeDone || !t.done).map(info) : []),
		find: (value) => {
			const ref = location(value);
			const task = ref && alive() ? index.find(ref) : null;
			return task ? info(task) : null;
		},
		getTags: () => (alive() ? index.allTags() : []),
		on: (event, callback) => {
			if (event !== "change" || typeof callback !== "function" || !alive()) return () => undefined;
			return index.onChange(callback);
		},
		setDone: (value, done) => run(value, (t) => writer.setDone(t, !!done, true)),
		setDue: (value, due) => {
			if (due !== null && !(typeof due === "string" && isIsoDate(due))) return Promise.resolve(null);
			return run(value, (t) => writer.setDue(t, due, true));
		},
		setPriority: (value, priority) => {
			if (priority !== null && !PRIORITIES.includes(priority)) return Promise.resolve(null);
			return run(value, (t) => writer.setPriority(t, priority, true));
		},
		rename: (value, title) => {
			if (typeof title !== "string" || !title.trim()) return Promise.resolve(null);
			return run(value, (t) => writer.rename(t, title, true));
		},
		moveToTag: (value, tag) => {
			const clean = cleanTag(tag);
			if (!TAG_RE.test(clean) || index.flags().has(clean)) return Promise.resolve(null);
			return run(value, (t) => (t.primary === clean ? Promise.resolve({ path: t.path, line: t.line, undo: async () => true }) : writer.retag(t, clean, true)));
		},
		setMarker: (value, name, markerValue) => {
			if (!MARKER_NAME_RE.test(name) || (markerValue !== null && !MARKER_VALUE_RE.test(markerValue))) return Promise.resolve(null);
			return run(value, (t) => writer.setMarker(t, name, markerValue, true));
		},
		addTask: async (task) => {
			if (!alive() || !task || typeof task.title !== "string" || !task.title.trim()) return null;
			const tag = cleanTag(task.tag);
			if (!TAG_RE.test(tag) || index.flags().has(tag)) return null;
			const priority = task.priority && PRIORITIES.includes(task.priority) ? task.priority : null;
			const due = task.due && isIsoDate(task.due) ? task.due : null;
			const markers: Record<string, string> = {};
			for (const [name, value] of Object.entries(task.markers ?? {})) {
				if (MARKER_NAME_RE.test(name) && typeof value === "string" && MARKER_VALUE_RE.test(value)) markers[name] = value;
			}
			try {
				const place = await writer.addTask(task.title, tag, priority, due, markers);
				const written = place && alive() ? index.at(place.path, place.line) : null;
				return written ? info(written) : null;
			} catch (error) {
				console.error("[Snailkit] tasks: addTask failed", error);
				return null;
			}
		},
	};
}
