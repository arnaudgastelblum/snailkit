// Public API of the Tasks module, shared with other modules and companion plugins through
// `ctx.provide("tasks", api)`. Reach it from a plugin with:
//   app.plugins.plugins.snailkit?.api.service("tasks") as TasksApi | undefined
// It is undefined while the module is off; listen to the workspace event
// "snailkit:services-changed" to know when it comes and goes. Documented in docs/tasks.md.
import { isIsoDate } from "./group";
import { plainTitle } from "./parse";
import type { TasksHub } from "./hub";
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
	/** Resolved vault path of the 📝 note, or null when absent or missing. */
	notePath: string | null;
	/** Group tag and words ("project/website|fix the footer"): survives edits of priority and dates, and moves to another note. */
	key: string;
	/** What follows "- [ ] " in the line. */
	text: string;
	/** The text without its group tag, flags and tokens; inline Markdown kept. */
	title: string;
	/** The title with links and emphasis as plain text. */
	plainTitle: string;
	/** Indented block text without checkbox lines or fenced code, with common indentation removed; empty when absent. */
	description: string;
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

/** A button another plugin puts in the header of the task list. Read again at each redraw. */
export interface ViewAction {
	/** Lucide icon name. */
	icon: string;
	/** Tooltip, and what screen readers say. */
	label: string;
	/** Short text next to the icon, shown when the list is a page. */
	text?: string;
	/** "busy" turns the icon, "error" colors it. */
	state?: "busy" | "error" | null;
	onClick(): void;
}

export interface ViewTabHost {
	/** "page" (large) or "side" (narrow side panel). */
	readonly layout: "page" | "side";
	/** Opens a note at a line (or its top), like a task row does: Ctrl/Cmd for a new tab. */
	open(path: string, line: number | null, event?: MouseEvent | KeyboardEvent): void;
	/** Asks the Workbench to call `update()` of this tab soon. */
	refresh(): void;
}

export interface ViewTabInstance {
	/** Called when the tab must show fresh data (vault changes, refreshViews). Keep focus and scroll. */
	update?(): void;
	/** Called when the tab is hidden, the layout changes, or the tab is removed. */
	destroy?(): void;
}

export interface ViewTab {
	/** Unique id, a-z and "-". */
	id: string;
	/** Lucide icon. */
	icon: string;
	/** Already translated. */
	label: string;
	/** Small count next to the label, or null. */
	count?(): number | null;
	/** Warning color for the count, or null for its usual color. */
	countTone?(): "warn" | null;
	/** Builds the tab in `el` (empty) when it is shown. */
	mount(el: HTMLElement, host: ViewTabHost): ViewTabInstance | void;
}

export interface TasksApi {
	readonly version: 1;
	/**
	 * Plays the "task checked" sound when the user turned it on (Tasks settings). For tools that
	 * check a task on a click of the user, after setDone(..., true) succeeded; never for a sync.
	 */
	chime?(): void;
	/** Body below the task note's breadcrumb; available on versions supporting task notes. */
	taskNote?: {
		/** Null when the task, service or note is missing. */
		read(key: string): Promise<string | null>;
		/** Creates the note and link if needed; false when the task or service is missing. */
		write(key: string, body: string): Promise<boolean>;
	};
	/** False until the first read of the vault is done (a "change" event follows). */
	isReady(): boolean;
	/** Tagged tasks of the vault, in note order. Open tasks only unless `includeDone`. */
	/** `includeUntagged`: also the open tasks without a tag of recent notes (tag ""), for Search. Off by default. */
	getTasks(options?: { includeDone?: boolean; includeUntagged?: boolean }): TaskInfo[];
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

	/** Adds a button to the header of the open lists; `get` returns it as it is now, or null to hide it. Returns a remove function. */
	addViewAction(get: () => ViewAction | null): () => void;
	/** Adds a Workbench tab, after Snailkit's own tabs ("tasks", "home" and "sessions" are theirs). Returns a remove function. */
	addViewTab(tab: ViewTab): () => void;
	/** Refreshes the open views soon (after a ViewAction or ViewTab changed). */
	refreshViews(): void;
	/** Opens the task list as a page on one tag and its sub-tags. False when no list could open. */
	openTag(tag: string): Promise<boolean>;
	/** Reveals the Workbench, selects a registered tab (else Tasks), and optionally its task scope. */
	openWorkbench(options?: { tab?: string; scope?: "all" | "today" }): Promise<void>;
}

/** Resolves a Workbench destination without changing a view (`tabs`: the registered tabs). */
export function resolveWorkbench(options: Parameters<TasksApi["openWorkbench"]>[0], tabs: { has(id: string): boolean }): { tab: string; scope?: "all" | "today" } {
	const tab = options?.tab && tabs.has(options.tab) ? options.tab : "tasks";
	return tab === "tasks" && options?.scope ? { tab, scope: options.scope } : { tab };
}

const MARKER_NAME_RE = /^[a-z][a-z0-9-]*$/;
const MARKER_VALUE_RE = /^[A-Za-z0-9_.-]+$/;
const TAG_RE = /^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u;
const PRIORITIES = ["high", "medium", "low"];

function info(t: Task, notePath: string | null): TaskInfo {
	return {
		notePath,
		path: t.path,
		line: t.line,
		raw: t.raw,
		key: t.key,
		text: t.text,
		title: t.title,
		plainTitle: plainTitle(t.title),
		description: t.description,
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
export function createTasksApi(index: TaskIndex, writer: TaskWriter, alive: () => boolean, hub?: Pick<TasksHub, "viewActions" | "addViewTab" | "refreshViews" | "showTag" | "openWorkbench"> & Partial<Pick<TasksHub, "ctx" | "taskNotes" | "chime">>): TasksApi {
	const taskInfo = (task: Task) => info(task, task.noteLink ? hub?.ctx?.app.metadataCache.getFirstLinkpathDest(task.noteLink, task.path)?.path ?? null : null);
	const after = (written: Written | null) => (written && alive() ? index.at(written.path, written.line) : null);
	const run = async (value: TaskLocation, op: (task: Task) => Promise<Written | null>): Promise<TaskInfo | null> => {
		const ref = location(value);
		const task = ref && alive() ? index.find(ref) : null;
		if (!task) return null;
		try {
			const done = await op(task);
			const written = after(done);
			// An untagged task once checked is no longer indexed: the write still succeeded.
			if (!written && done && !task.primary) return taskInfo({ ...task, line: done.line });
			return written ? taskInfo(written) : null;
		} catch (error) {
			console.error("[Snailkit] tasks: API write failed", error);
			return null;
		}
	};
	const cleanTag = (tag: string) => (typeof tag === "string" ? tag.trim().replace(/^#/, "").toLowerCase() : "");

	return {
		version: 1,
		taskNote: {
			read: async (key) => {
				const task = alive() ? index.get(key) : null;
				return task && hub?.taskNotes ? hub.taskNotes.read(task) : null;
			},
			write: async (key, body) => {
				const task = alive() ? index.get(key) : null;
				if (!task || !hub?.taskNotes) return false;
				await hub.taskNotes.write(task, body);
				return true;
			},
		},
		openWorkbench: async (options) => {
			if (!hub || !alive()) return;
			await hub.openWorkbench(options);
		},
		isReady: () => alive() && index.ready,
		getTasks: (options) => (alive() ? [...index.list.filter((t) => options?.includeDone || !t.done), ...(options?.includeUntagged ? index.untagged : [])].map(taskInfo) : []),
		find: (value) => {
			const ref = location(value);
			const task = ref && alive() ? index.find(ref) : null;
			return task ? taskInfo(task) : null;
		},
		getTags: () => (alive() ? index.allTags() : []),
		on: (event, callback) => {
			if (event !== "change" || typeof callback !== "function" || !alive()) return () => undefined;
			return index.onChange(callback);
		},
		chime: () => hub?.chime?.(),
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
				return written ? taskInfo(written) : null;
			} catch (error) {
				console.error("[Snailkit] tasks: addTask failed", error);
				return null;
			}
		},
		addViewAction: (get) => {
			if (!hub || typeof get !== "function" || !alive()) return () => undefined;
			hub.viewActions.add(get);
			hub.refreshViews();
			return () => {
				if (hub.viewActions.delete(get)) hub.refreshViews();
			};
		},
		addViewTab: (tab) => {
			if (!hub || !alive() || !tab || typeof tab.id !== "string" || !/^[a-z-]+$/.test(tab.id) || typeof tab.mount !== "function") return () => undefined;
			// The Workbench (core) keeps the tab, after Brainstorm; it goes away when this module stops.
			return hub.addViewTab(tab);
		},
		refreshViews: () => {
			if (hub && alive()) hub.refreshViews();
		},
		openTag: async (tag) => {
			const clean = cleanTag(tag);
			if (!hub || !alive() || !TAG_RE.test(clean)) return false;
			return hub.showTag(clean);
		},
	};
}
