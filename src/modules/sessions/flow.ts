// Pure logic of the brainstorm's path: Write, Sort, Finish, Archive. Where a brainstorm stands
// (computed from its text, never stored), what counts in its tally (what was dropped and launched,
// never what is left), the lines the sorting mode offers one at a time, and how each decision
// rewrites the note (and how it is taken back). No Obsidian here: tested in test/sessions.test.ts.
import { locateRaw } from "./atelier";
import { bodyStart, candidateRange, fingerprint, fish, groupTag, hiddenLines, indentWidth, isTagLine, lineInfo, markOf, poseLines, sentences, type LearnedVerbs, type Summary } from "./logic";

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
	/** Free sentences with a pale dot (likely tasks, questions) not kept as ideas. */
	loose?: number;
	/** Lines written (not blank) in the body of the note. */
	lines: number;
	/** Last change (ms), and now: a brainstorm left for a week is invited to finish. */
	modified?: number;
	now?: number;
}

export interface Flow extends FlowInput {
	loose: number;
	kind: FlowKind;
	/** The current step, 0 (Write) to 3 (Archive); 4 once archived (every step done). */
	step: number;
	/** Lines the sorting mode would offer: untagged tasks, lines to decide, dotted free sentences. */
	toSort: number;
	/** No change for 7 days or more, still open: a soft invitation to finish it. */
	stale: boolean;
}

const WEEK = 7 * 86_400_000;

/** Where a brainstorm stands, from its counts. "Sort" comes first when something waits for a choice. */
export function flowOf(input: FlowInput): Flow {
	const loose = input.loose ?? 0;
	const toSort = input.untagged + input.undecided + loose;
	let kind: FlowKind;
	if (input.archived) kind = "archived";
	else if (input.closed) kind = "closed";
	else if (toSort > 0) kind = "sort";
	else if (input.tasks > 0) kind = "ready";
	else if (input.ideas === 0) kind = "new";
	else kind = "write";
	const step = { new: 0, write: 0, sort: 1, ready: 2, closed: 3, archived: 4 }[kind];
	const stale = !input.closed && !input.archived && input.modified !== undefined && input.now !== undefined && input.now - input.modified >= WEEK;
	return { ...input, loose, kind, step, toSort, stale };
}

/** The counts of a flow, from the summary of a note. */
export function countsOf(s: Summary, lines: number, loose = 0): Pick<FlowInput, "ideas" | "tasks" | "untagged" | "undecided" | "loose" | "lines"> {
	return {
		loose,
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

/** What the "Sort" button names: tasks only (untagged tasks and nothing else), or lines. */
export function sortWord(flow: Pick<FlowInput, "untagged" | "undecided" | "loose">): "tasks" | "lines" {
	return flow.untagged && !flow.undecided && !flow.loose ? "tasks" : "lines";
}

/** What still waits before Finish, said in one sentence: lines to sort, to decide, or both. */
export function leftover(flow: Pick<Flow, "untagged" | "undecided" | "loose">): { sort: number; decide: number } {
	return { sort: flow.untagged + flow.loose, decide: flow.undecided };
}

// ----- the sorting mode -----

export interface SortItem {
	/** 0-based line, and the line as read (found again before any change). */
	line: number;
	raw: string;
	/** A task without tag, a "- [?]" line, a free sentence that looks like a task, a free question. */
	kind: "task" | "decide" | "likely" | "question";
	/** The text shown: the title, or the dotted sentence of a free line. */
	text: string;
	/** For a free sentence: where it is in the body of its line. */
	start?: number;
	end?: number;
	/** The description lines of a task, trimmed. */
	description: string[];
	/** The line and its description exactly as shown: Delete removes them only if they still read so. */
	block: string[];
}

/** The lines of a text, an empty text having none (so that an emptied note can be filled again). */
export function linesOf(text: string): string[] {
	return text === "" ? [] : text.split(/\r?\n/);
}

/** What the sorting mode reads besides the note: the user's verbs, the sentences kept as ideas. */
export interface LooseOptions {
	verbs?: LearnedVerbs;
	kept?: ReadonlySet<string>;
}

/**
 * The free lines with a pale dot, as the editor draws them: a sentence that looks like a task (else
 * a question), not kept as an idea, on a free line of the body that is not a task's description.
 */
export function looseItems(lines: readonly string[], isClosing: (line: string) => boolean, opts: LooseOptions = {}): SortItem[] {
	const hidden = hiddenLines(lines);
	const out: SortItem[] = [];
	// From the first line, as the editor: a short line with a digit ("Buy 2 pencils") is not taken for a date header.
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		if (hidden[i] || isClosing(raw)) continue;
		const info = lineInfo(raw);
		if (info.kind !== "free" || isTagLine(raw) || inDescription(lines, i, info.indent)) continue;
		const mark = markOf(info.body, opts.verbs, opts.kept);
		if (!mark) continue;
		const s = mark.sentence;
		out.push({ line: i, raw, kind: mark.kind === "task" ? "likely" : "question", text: s.text, start: s.start, end: s.end, description: [], block: [raw] });
	}
	return out;
}

/**
 * An indented line whose nearest less indented line above (blank lines skipped, 60 lines at most)
 * is a task or a line to decide: its description, never a new idea. The editor's rule, exactly.
 */
export function inDescription(lines: readonly string[], i: number, indent: string): boolean {
	const own = indentWidth(indent);
	if (!own) return false;
	for (let k = i - 1; k >= 0 && k >= i - 60; k--) {
		if (!lines[k].trim()) continue;
		const other = lineInfo(lines[k]);
		if (indentWidth(other.indent) < own) return other.kind === "task" || other.kind === "decide";
	}
	return false;
}

/** How many free lines wait to be sorted (see `looseItems`). */
export function looseCount(lines: readonly string[], isClosing: (line: string) => boolean, opts: LooseOptions = {}): number {
	return looseItems(lines, isClosing, opts).length;
}

/**
 * The lines a brainstorm offers to sort, in the order of the note: open tasks without a tag, lines
 * to decide, and free sentences with a pale dot.
 */
export function sortItems(s: Summary, lines: readonly string[], isClosing: (line: string) => boolean, opts: LooseOptions = {}): SortItem[] {
	const block = (line: number) => lines.slice(line, line + 1 + candidateRange(lines, line, isClosing).description);
	const out: SortItem[] = [
		...s.tasks.filter((t) => !t.tag && !t.done).map((t) => ({ line: t.line, raw: t.raw, kind: "task" as const, text: t.title, description: t.description, block: block(t.line) })),
		...s.questions.filter((q) => q.explicit).map((q) => ({ line: q.line, raw: q.raw, kind: "decide" as const, text: q.text, description: [], block: block(q.line) })),
		...looseItems(lines, isClosing, opts),
	];
	return out.sort((a, b) => a.line - b.line);
}

/**
 * The prints to remember when a line is kept as an idea: the dotted sentence of a free line, or,
 * for a task or a line to decide, every sentence of the line it becomes (else it would come back
 * with a dot).
 */
export function keptPrints(item: Pick<SortItem, "kind" | "text">, edit: Pick<LineEdit, "inserted"> | null): string[] {
	if (item.kind === "likely" || item.kind === "question") return [fingerprint(item.text)];
	const line = edit?.inserted[0];
	return line === undefined ? [] : sentences(lineInfo(line).body).map((x) => fingerprint(x.text));
}

/** The prints kept in a note, without those of sentences it no longer holds. */
export function prunePrints(prints: readonly string[], lines: readonly string[]): string[] {
	const present = new Set<string>();
	for (const l of lines) {
		const info = lineInfo(l);
		if (info.kind === "free") for (const x of sentences(info.body)) present.add(fingerprint(x.text));
	}
	return prints.filter((p, i) => present.has(p) && prints.indexOf(p) === i);
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
 * A free sentence (likely task, question) is caught as Ctrl/Cmd+Enter catches it: what comes before
 * stays on its line, what comes after goes below; "idea" writes nothing (null); "delete" removes the
 * sentence only, and the line when nothing else is left on it.
 */
export function decide(lines: readonly string[], item: Pick<SortItem, "line" | "raw" | "block"> & Partial<Pick<SortItem, "kind" | "text" | "start" | "end">>, choice: Choice, tag: string | null, unit: string, isClosing: (line: string) => boolean): LineEdit | null {
	const at = placeOf(lines, item);
	if (at === null) return null;
	const raw = lines[at];
	if (hiddenLines(lines)[at] || isClosing(raw)) return null;
	const info = lineInfo(raw);
	const edit = (removed: string[], inserted: string[]): LineEdit => ({ at, removed, inserted, before: at > 0 ? lines[at - 1] : null, after: at + removed.length < lines.length ? lines[at + removed.length] : null });
	if (item.kind === "likely" || item.kind === "question") {
		const { start, end } = item;
		if (info.kind !== "free" || start === undefined || end === undefined || info.body.slice(start, end) !== item.text) return null;
		if (choice === "idea") return null;
		if (choice === "delete") {
			const rest = [info.body.slice(0, start).trim(), info.body.slice(end).trim()].filter(Boolean).join(" ");
			return edit([raw], rest ? [info.indent + info.marker + rest] : []);
		}
		if (choice === "task" && !tag) return null;
		const caught = fish(raw, start, end, choice === "task" ? " " : "?");
		if (choice === "task") caught.lines[caught.task] = poseLines({ taskLine: caught.lines[caught.task], tag, candidates: [], count: 0, wasDescription: 0, unit })[0];
		return edit([raw], caught.lines);
	}
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
	return edit(removed, inserted);
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
	/** Free sentences with a pale dot. */
	loose: number;
	ready: number;
}

/** The sentence at the top of the tab: how many are in progress, what waits (summed over them). */
export function leadOf(list: ReadonlyArray<Pick<Flow, "kind" | "untagged" | "undecided"> & { loose?: number }>): Lead {
	const live = list.filter((f) => f.kind !== "closed" && f.kind !== "archived");
	return {
		live: live.length,
		untagged: live.reduce((n, f) => n + f.untagged, 0),
		undecided: live.reduce((n, f) => n + f.undecided, 0),
		loose: live.reduce((n, f) => n + (f.loose ?? 0), 0),
		ready: live.filter((f) => f.kind === "ready").length,
	};
}
