// Pure logic of the brainstorm's path: Write, Sort, Finish, Archive. Where a brainstorm stands
// (computed from its text, never stored), what counts in its tally (what was dropped and launched,
// never what is left), the lines the sorting mode offers one at a time, and how each decision
// rewrites the note (and how it is taken back). No Obsidian here: tested in test/sessions.test.ts.
import { locateRaw } from "./atelier";
import { bodyStart, candidateRange, groupTag, hiddenLines, lineInfo, poseLines, type Summary } from "./logic";

/** Where a brainstorm stands. */
export type FlowKind = "new" | "write" | "sort" | "ready" | "closed" | "archived";

/** The four steps of the path, in order. */
export const STEPS = ["write", "sort", "finish", "archive"] as const;
export type StepName = (typeof STEPS)[number];

export interface FlowInput {
	closed: boolean;
	archived: boolean;
	/** Ideas dropped (free paragraphs, questions, tasks). */
	ideas: number;
	/** Tasks launched (checked or not). */
	tasks: number;
	/** Open tasks without a tag. */
	untagged: number;
	/** "- [?]" lines. */
	undecided: number;
	/** Lines written (not blank) in the body of the note. */
	lines: number;
	/** Last change (ms), and now: a brainstorm left for a week is invited to finish. */
	modified?: number;
	now?: number;
}

export interface Flow extends FlowInput {
	kind: FlowKind;
	/** The current step, 0 (Write) to 3 (Archive); 4 once archived (every step done). */
	step: number;
	/** Lines the sorting mode would offer: untagged tasks and lines to decide. */
	toSort: number;
	/** No change for 7 days or more, still open: a soft invitation to finish it. */
	stale: boolean;
}

const WEEK = 7 * 86_400_000;

/** Where a brainstorm stands, from its counts. "Sort" comes first when something waits for a choice. */
export function flowOf(input: FlowInput): Flow {
	const toSort = input.untagged + input.undecided;
	let kind: FlowKind;
	if (input.archived) kind = "archived";
	else if (input.closed) kind = "closed";
	else if (toSort > 0) kind = "sort";
	else if (input.tasks > 0) kind = "ready";
	else if (input.ideas === 0) kind = "new";
	else kind = "write";
	const step = { new: 0, write: 0, sort: 1, ready: 2, closed: 3, archived: 4 }[kind];
	const stale = !input.closed && !input.archived && input.modified !== undefined && input.now !== undefined && input.now - input.modified >= WEEK;
	return { ...input, kind, step, toSort, stale };
}

/** The counts of a flow, from the summary of a note. */
export function countsOf(s: Summary, lines: number): Pick<FlowInput, "ideas" | "tasks" | "untagged" | "undecided" | "lines"> {
	return {
		ideas: s.ideas,
		tasks: s.tasks.length,
		untagged: s.tasks.filter((t) => !t.tag && !t.done).length,
		undecided: s.questions.filter((q) => q.explicit).length,
		lines,
	};
}

/** Lines written in the body (after the header), outside code, properties and the closing line. */
export function bodyLineCount(lines: readonly string[], isClosing: (line: string) => boolean): number {
	const hidden = hiddenLines(lines);
	let n = 0;
	for (let i = bodyStart(lines); i < lines.length; i++) if (!hidden[i] && lines[i].trim() && !isClosing(lines[i])) n++;
	return n;
}

/**
 * The state of each step for the frieze: "done" before the current one, "current", then "todo".
 * Archived: all four done.
 */
export function stepStates(flow: Pick<Flow, "step">): Array<"done" | "current" | "todo"> {
	return STEPS.map((_, i) => (i < flow.step ? "done" : i === flow.step ? "current" : "todo"));
}

/** The one next action a brainstorm offers. */
export type NextAction = "sort" | "finish" | "archive" | "unarchive" | null;

export function nextAction(flow: Pick<Flow, "kind">): NextAction {
	switch (flow.kind) {
		case "sort":
			return "sort";
		case "ready":
		case "write":
			return "finish";
		case "closed":
			return "archive";
		case "archived":
			return "unarchive";
		default:
			return null;
	}
}

/** What the "Sort" button names: tasks only, lines to decide only, or lines (both). */
export function sortWord(flow: Pick<Flow, "untagged" | "undecided">): "tasks" | "lines" {
	return flow.untagged && !flow.undecided ? "tasks" : "lines";
}

// ----- the sorting mode -----

export interface SortItem {
	/** 0-based line, and the line as read (found again before any change). */
	line: number;
	raw: string;
	kind: "task" | "decide";
	text: string;
	/** The description lines of a task, trimmed. */
	description: string[];
	/** The line and its description exactly as shown: Delete removes them only if they still read so. */
	block: string[];
}

/** The lines of a text, an empty text having none (so that an emptied note can be filled again). */
export function linesOf(text: string): string[] {
	return text === "" ? [] : text.split(/\r?\n/);
}

/** The lines a brainstorm offers to sort, in the order of the note: open tasks without a tag, lines to decide. */
export function sortItems(s: Summary, lines: readonly string[], isClosing: (line: string) => boolean): SortItem[] {
	const block = (line: number) => lines.slice(line, line + 1 + candidateRange(lines, line, isClosing).description);
	const out: SortItem[] = [
		...s.tasks.filter((t) => !t.tag && !t.done).map((t) => ({ line: t.line, raw: t.raw, kind: "task" as const, text: t.title, description: t.description, block: block(t.line) })),
		...s.questions.filter((q) => q.explicit).map((q) => ({ line: q.line, raw: q.raw, kind: "decide" as const, text: q.text, description: [], block: block(q.line) })),
	];
	return out.sort((a, b) => a.line - b.line);
}

export type Choice = "task" | "decide" | "idea" | "delete";
export const CHOICES: readonly Choice[] = ["task", "decide", "idea", "delete"];

/** A change of the note: lines [at, at + removed.length) become `inserted`. */
export interface LineEdit {
	at: number;
	removed: string[];
	inserted: string[];
	/** The lines around the edit, checked again before taking it back. */
	before: string | null;
	after: string | null;
}

const BOX = /^(\s*(?:[-*+]|\d+[.)])\s\[)(.)\]/;
const FENCE = /^\s*(```|~~~)/;

/** A block holding a code fence is never deleted in one go: the fence could lose its other half. */
export function holdsFence(block: readonly string[]): boolean {
	return block.some((l) => FENCE.test(l));
}

/** Where an item is now: its own line if it still reads the same, else the only line reading the same; null otherwise. */
function placeOf(lines: readonly string[], item: Pick<SortItem, "line" | "raw">): number | null {
	return locateRaw(lines, item.line, item.raw);
}

/**
 * How a decision rewrites the note, or null when nothing may be written: the line is gone, reads
 * the same in several places, is no longer something to sort (checked, tagged, in code or the
 * properties), or, for Delete, its block changed or holds a code fence.
 * - task: "- [ ] Text #tag" (a line to decide becomes a task);
 * - decide: "- [?] Text" (a line to decide stays as it is: null change);
 * - idea: the line without its checkbox ("- Text");
 * - delete: the line and its description, exactly as shown, are removed.
 */
export function decide(lines: readonly string[], item: Pick<SortItem, "line" | "raw" | "block">, choice: Choice, tag: string | null, unit: string, isClosing: (line: string) => boolean): LineEdit | null {
	const at = placeOf(lines, item);
	if (at === null) return null;
	const raw = lines[at];
	if (hiddenLines(lines)[at] || isClosing(raw)) return null;
	const info = lineInfo(raw);
	const sortable = info.kind === "decide" || (info.kind === "task" && info.box === " " && !groupTag(info.body));
	if (!sortable) return null;
	let removed = [raw];
	let inserted: string[];
	if (choice === "task") {
		if (!tag) return null;
		const open = raw.replace(BOX, "$1 ]");
		inserted = [poseLines({ taskLine: open, tag, candidates: [], count: 0, wasDescription: 0, unit })[0]];
	} else if (choice === "decide") inserted = [raw.replace(BOX, "$1?]")];
	else if (choice === "idea") inserted = [info.indent + info.marker.replace(/\s+$/, "") + " " + info.body.trim()];
	else {
		const block = item.block.length ? item.block : [raw];
		const now = 1 + candidateRange(lines, at, isClosing).description;
		if (now !== block.length || holdsFence(block)) return null;
		for (let i = 0; i < block.length; i++) if (lines[at + i] !== block[i]) return null;
		removed = [...block];
		inserted = [];
	}
	return { at, removed, inserted, before: at > 0 ? lines[at - 1] : null, after: at + removed.length < lines.length ? lines[at + removed.length] : null };
}

/** The lines with the edit applied. */
export function applyEdit(lines: readonly string[], edit: LineEdit): string[] {
	return [...lines.slice(0, edit.at), ...edit.inserted, ...lines.slice(edit.at + edit.removed.length)];
}

/** How many lines an edit adds (negative: removes). */
export function shiftOf(edit: Pick<LineEdit, "removed" | "inserted">): number {
	return edit.inserted.length - edit.removed.length;
}

/** A line number after an edit: lines below it move by its size; lines inside it are lost (null). */
export function mapLine(line: number, edit: LineEdit): number | null {
	if (line < edit.at) return line;
	if (line >= edit.at + edit.removed.length) return line + shiftOf(edit);
	return null;
}

/**
 * The edit that takes `edit` back, only at the very place it was made and only if that place still
 * reads as it was left (its lines and both neighbours); null otherwise: then nothing is undone.
 */
export function revertOf(lines: readonly string[], edit: LineEdit): LineEdit | null {
	const at = edit.at;
	if (at < 0 || at + edit.inserted.length > lines.length) return null;
	for (let i = 0; i < edit.inserted.length; i++) if (lines[at + i] !== edit.inserted[i]) return null;
	const before = at > 0 ? lines[at - 1] : null;
	const after = at + edit.inserted.length < lines.length ? lines[at + edit.inserted.length] : null;
	if (before !== edit.before || after !== edit.after) return null;
	return { at, removed: lines.slice(at, at + edit.inserted.length), inserted: edit.removed, before, after };
}

/** What a sorting round did, for its closing screen. */
export type Tally = Record<Choice, number>;

export function emptyTally(): Tally {
	return { task: 0, decide: 0, idea: 0, delete: 0 };
}

// ----- the Brainstorms tab -----

export interface WeekRecap {
	brainstorms: number;
	tasks: number;
}

/** Brainstorms started in the last 7 days and the tasks they launched. */
export function weekRecap(list: ReadonlyArray<{ created: number; tasks: number }>, now: number): WeekRecap {
	const recent = list.filter((s) => now - s.created < WEEK && s.created <= now);
	return { brainstorms: recent.length, tasks: recent.reduce((n, s) => n + s.tasks, 0) };
}

export interface Lead {
	/** Brainstorms in progress (neither finished nor archived). */
	live: number;
	untagged: number;
	undecided: number;
	ready: number;
}

/** The sentence at the top of the tab: how many are in progress, what waits (summed over them). */
export function leadOf(list: ReadonlyArray<Pick<Flow, "kind" | "untagged" | "undecided">>): Lead {
	const live = list.filter((f) => f.kind !== "closed" && f.kind !== "archived");
	return {
		live: live.length,
		untagged: live.reduce((n, f) => n + f.untagged, 0),
		undecided: live.reduce((n, f) => n + f.undecided, 0),
		ready: live.filter((f) => f.kind === "ready").length,
	};
}
