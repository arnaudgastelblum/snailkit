// Pure rewriting of task lines (check, priority, due date, tag, title, markers) and of notes
// (where a new task goes, the smallest editor change). Lines in, lines out.
import { DONE_RE, DUE_RE, FENCE_RE, NOTE_LINK_RE, PRIORITIES, TASK_RE, escapeRe, fenceLines, frontmatterEnd, tagsOf } from "./parse";
import type { Priority } from "./types";

// Tokens other tools expect at the very end of a task: a carry-over counter (↻n), the done
// stamp, Markdown comments (markers) and a block id. New tokens go before this run.
const TRAILING_RE = /(?:\s+(?:↻\d+|✅\s*\d{4}-\d{2}-\d{2}|\^[A-Za-z0-9-]+|%%(?:(?!%%).)*%%))+\s*$/u;
const STAR_TOKEN_RE = /(^|\s)⭐️?(?=\s|$)/u;
const BLOCK_ID_END_RE = /\s+\^[A-Za-z0-9-]+\s*$/;
const TAG_CHARS = "[\\p{L}\\p{N}_/-]";

/** Replaces tokens outside task-note links, whose targets may contain token-like text. */
function replaceOutsideNoteLinks(text: string, re: RegExp, replacement: string): string {
	const links = [...text.matchAll(NOTE_LINK_RE)];
	let replaced = false;
	return text.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), (whole: string, ...args: unknown[]) => {
		const at = args[args.length - 2] as number;
		if (replaced && !re.global) return whole;
		if (links.some((link) => at < link.index + link[0].length && at + whole.length > link.index)) return whole;
		replaced = true;
		return whole.replace(re, replacement);
	});
}

/** Inserts a token before the trailing run (↻n, ✅ date, %%comments%%, ^block-id). */
export function insertToken(text: string, token: string): string {
	const m = text.match(TRAILING_RE);
	const head = (m ? text.slice(0, m.index) : text).replace(/\s+$/, "");
	return (head ? head + " " : "") + token + (m ? m[0] : "");
}

/** A flag on (written before the dates and markers) or off (every `#flag` removed). */
export function setFlagText(text: string, flag: string, on: boolean): string {
	const has = new RegExp(`(^|\\s)#${escapeRe(flag)}(?!${TAG_CHARS})`, "iu").test(text);
	if (on) return has ? text : insertToken(text, "#" + flag);
	return has ? removeTag(text, flag) : text;
}

/** Removes every `#tag` (whole tag, any case), with the space before it. */
export function removeTag(text: string, tag: string): string {
	const re = new RegExp(`(^|\\s+)#${escapeRe(tag)}(?!${TAG_CHARS})`, "giu");
	return replaceOutsideNoteLinks(text, re, "").replace(/^\s+/, "").replace(/\s+$/, "");
}

export function setPriorityText(text: string, priority: Priority | null): string {
	let out = replaceOutsideNoteLinks(text, STAR_TOKEN_RE, "$1").replace(/^\s+/, "");
	for (const p of PRIORITIES) out = removeTag(out, p);
	return priority ? insertToken(out, "#" + priority) : out;
}

/** Sets the due date where it stands, adds it, or removes it (null). Nothing else moves. */
export function setDueText(text: string, due: string | null): string {
	if (DUE_RE.test(text.replace(NOTE_LINK_RE, " "))) {
		if (due) return replaceOutsideNoteLinks(text, /📅\s*\d{4}-\d{2}-\d{2}/u, "📅 " + due);
		return replaceOutsideNoteLinks(text, DUE_RE, "").replace(/^\s+/, "");
	}
	return due ? insertToken(text, "📅 " + due) : text;
}

/** Replaces the group tag where it stands (leading or trailing style), else adds the new one. */
export function retagText(text: string, from: string, to: string): string {
	const re = new RegExp(`(^|\\s)#${escapeRe(from)}(?!${TAG_CHARS})`, "iu");
	return re.test(text.replace(NOTE_LINK_RE, " ")) ? replaceOutsideNoteLinks(text, re, `$1#${to}`) : insertToken(text, "#" + to);
}

/** Sets (or removes, with null) a `%%name:value%%` marker. */
export function setMarkerText(text: string, name: string, value: string | null): string {
	const re = new RegExp(`\\s*%%${escapeRe(name)}:[A-Za-z0-9_.-]+%%`, "g");
	const out = replaceOutsideNoteLinks(text, re, "").replace(/^\s+/, "");
	return value ? insertToken(out, `%%${name}:${value}%%`) : out;
}

// Everything of a task text that is not its title: tags, and the tokens the parser reads or
// keeps (⭐, dates, ⏰ time, ↻n, %%comments%%, block id), wherever they stand.
const TOKEN_RE = /(?:^|\s)#[\p{L}\p{N}_][\p{L}\p{N}_/-]*|⭐️?|📅\s*\d{4}-\d{2}-\d{2}|⏰\s*\d{1,2}:\d{2}|[⏳🛫➕❌]️?\s*\d{4}-\d{2}-\d{2}|↻\d+|✅\s*\d{4}-\d{2}-\d{2}|%%(?:(?!%%).)*%%|\^[A-Za-z0-9-]+(?=\s*$)/gu;

interface Span {
	start: number;
	end: number;
	text: string;
}

function tokenSpans(text: string): Span[] {
	const links = [...text.matchAll(NOTE_LINK_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));
	const tokens = [...text.matchAll(TOKEN_RE)].map((m) => {
		const lead = m[0].length - m[0].trimStart().length;
		const index = m.index ?? 0;
		return { start: index + lead, end: index + m[0].length, text: m[0].trim() };
	});
	return [...links, ...tokens.filter((token) => !links.some((link) => token.start < link.end && token.end > link.start))].sort((a, b) => a.start - b.start);
}

/** Adds or replaces the task-note link before trailing tags and tokens, or removes it. */
export function setNoteLinkText(text: string, linkTarget: string | null): string {
	const out = text.replace(NOTE_LINK_RE, " ").replace(/\s+/g, " ").trim();
	if (linkTarget === null) return out;
	let at = out.length;
	const spans = tokenSpans(out);
	for (let i = spans.length - 1; i >= 0; i--) {
		if (out.slice(spans[i].end, at).trim()) break;
		at = spans[i].start;
	}
	return [out.slice(0, at).trim(), `[[${linkTarget.replace(/\.md$/i, "")}|📝]]`, out.slice(at).trim()].filter(Boolean).join(" ");
}

/**
 * The task text with another title. When the old title appears exactly once outside the
 * tokens it is replaced in place; else the new title goes first and every token follows in
 * its order (a tag already typed in the new title is not repeated). Tokens never change.
 */
export function retitleText(text: string, oldTitle: string, newTitle: string): string {
	const title = newTitle.replace(/\s+/g, " ").trim();
	const spans = tokenSpans(text);
	const free = (i: number, length: number) => !spans.some((s) => i < s.end && i + length > s.start);
	const hits: number[] = [];
	if (oldTitle) {
		for (let i = text.indexOf(oldTitle); i >= 0; i = text.indexOf(oldTitle, i + 1)) if (free(i, oldTitle.length)) hits.push(i);
	}
	if (hits.length === 1) return text.slice(0, hits[0]) + title + text.slice(hits[0] + oldTitle.length);
	const typed = new Set(tagsOf(title));
	const kept = spans.filter((s) => !(s.text.startsWith("#") && typed.has(s.text.slice(1).toLowerCase())));
	return [title, ...kept.map((s) => s.text)].join(" ");
}

export function mapTaskText(line: string, fn: (text: string) => string): string | null {
	const m = line.match(TASK_RE);
	return m ? `${m[1]}${m[2]} [${m[3]}] ${fn(m[4])}` : null;
}

/** Checks or unchecks a task line. A stamp adds "✅ date" (before a block id, which must stay last). */
export function setDoneLine(line: string, done: boolean, stamp: string | null): string | null {
	const m = line.match(TASK_RE);
	if (!m) return null;
	let text = replaceOutsideNoteLinks(m[4], DONE_RE, "").replace(/\s+$/, "");
	if (done && stamp) {
		const id = text.match(BLOCK_ID_END_RE);
		text = id ? text.slice(0, id.index) + " ✅ " + stamp + id[0] : text + " ✅ " + stamp;
	}
	return `${m[1]}${m[2]} [${done ? "x" : " "}] ${text}`;
}

/** Finds a line again: same place, else the only identical line of the note. Two candidates: -1. */
/** One task line rewritten by a change made to many at once. */
export interface LineChange {
	at: number;
	before: string;
	after: string;
}

/**
 * Sets the due date of several tasks of one note (`null` removes it), each found again by its line
 * and text. Returns the new lines and what changed, or null when nothing did (no write needed).
 */
export function setDueLines(lines: readonly string[], refs: ReadonlyArray<{ line: number; raw: string }>, due: string | null): { lines: string[]; changes: LineChange[] } | null {
	return editLines(lines, refs.map((ref) => ({ ...ref, fn: (line: string) => mapTaskText(line, (text) => setDueText(text, due)) })));
}

/**
 * Rewrites several task lines of one note, each found again by its line and text, each with its
 * own change (`fn` returns the new line, or null to leave it). Returns the new lines and what
 * changed, or null when nothing did.
 */
export function editLines(lines: readonly string[], items: ReadonlyArray<{ line: number; raw: string; fn: (line: string) => string | null }>): { lines: string[]; changes: LineChange[] } | null {
	const out = [...lines];
	const changes: LineChange[] = [];
	for (const item of items) {
		const at = locateLine(lines, item.line, item.raw);
		if (at < 0 || changes.some((c) => c.at === at)) continue;
		const next = item.fn(out[at]);
		if (next === null || next === out[at]) continue;
		changes.push({ at, before: out[at], after: next });
		out[at] = next;
	}
	return changes.length ? { lines: out, changes } : null;
}

/**
 * Removes several tasks of one note with their blocks, the lowest first (the others keep their
 * place). `ends(at)` gives the last line of the block at `at`. The blocks are returned in the order
 * they were removed: Undo puts them back in the reverse order.
 */
export function removeBlocks(lines: readonly string[], refs: ReadonlyArray<{ line: number; raw: string }>, ends: (lines: readonly string[], at: number) => number): { lines: string[]; blocks: RemovedBlock[] } | null {
	// The blocks as the note reads now; one inside another goes with it (a task and its subtask both picked).
	const ranges = [...new Set(refs.map((ref) => locateLine(lines, ref.line, ref.raw)).filter((at) => at >= 0))]
		.sort((a, b) => a - b)
		.map((at) => ({ at, end: ends(lines, at) }));
	const outer: Array<{ at: number; end: number }> = [];
	for (const r of ranges) {
		const last = outer[outer.length - 1];
		if (last && r.at <= last.end) last.end = Math.max(last.end, r.end);
		else outer.push({ ...r });
	}
	// The lowest first: the lines above keep their place.
	let out = [...lines];
	const blocks: RemovedBlock[] = [];
	for (const r of outer.reverse()) {
		const result = removeBlock(out, r.at, r.end);
		out = result.lines;
		blocks.push(result.block);
	}
	return blocks.length ? { lines: out, blocks } : null;
}

/**
 * Puts back blocks removed by `removeBlocks`, the last removed first. A block whose place cannot be
 * found is left out; the others still come back. Returns the lines and how many came back.
 */
export function restoreBlocks(lines: readonly string[], blocks: readonly RemovedBlock[]): { lines: string[]; restored: number } {
	let out = [...lines];
	let restored = 0;
	for (let i = blocks.length - 1; i >= 0; i--) {
		const back = restoreBlock(out, blocks[i]);
		if (!back) continue;
		out = back;
		restored++;
	}
	return { lines: out, restored };
}

/**
 * Takes back changes made by `setDueLines`, only on lines that still read as they were left.
 * Each change takes one line: first those still at their place, then those found once elsewhere
 * among the lines nobody else claimed. Two candidates: left alone (never a date put on another
 * task that happens to read the same). Returns the lines and how many came back.
 */
export function revertLines(lines: readonly string[], changes: readonly LineChange[]): { lines: string[]; restored: number } {
	const out = [...lines];
	const taken = new Set<number>();
	const place = new Map<LineChange, number>();
	for (const c of changes) {
		if (lines[c.at] === c.after && !taken.has(c.at)) {
			taken.add(c.at);
			place.set(c, c.at);
		}
	}
	for (const c of changes) {
		if (place.has(c)) continue;
		const free: number[] = [];
		lines.forEach((l, i) => {
			if (l === c.after && !taken.has(i)) free.push(i);
		});
		if (free.length !== 1) continue;
		taken.add(free[0]);
		place.set(c, free[0]);
	}
	for (const [c, i] of place) out[i] = c.before;
	return { lines: out, restored: place.size };
}

/** A task removed with its block (subtasks, description), and the lines around it, to put it back. */
export interface RemovedBlock {
	at: number;
	removed: string[];
	before: string | null;
	after: string | null;
}

/**
 * Removes the task at `at` with its child block (the indented lines under it: subtasks and
 * description). `end` is the last line of that block (see `blockEnd` in parse.ts).
 */
export function removeBlock(lines: readonly string[], at: number, end: number): { lines: string[]; block: RemovedBlock } {
	const removed = lines.slice(at, end + 1);
	const block = { at, removed, before: at > 0 ? lines[at - 1] : null, after: end + 1 < lines.length ? lines[end + 1] : null };
	return { lines: [...lines.slice(0, at), ...lines.slice(end + 1)], block };
}

/**
 * Puts a removed block back: at its place when the lines around it are still the same, else after
 * the only line that still reads as the one before it. Null when its place cannot be found.
 */
export function restoreBlock(lines: readonly string[], block: RemovedBlock): string[] | null {
	// The block was the whole note: an emptied note reads as one empty line.
	if (block.before === null && block.after === null) return lines.length === 0 || (lines.length === 1 && lines[0] === "") ? [...block.removed] : null;
	const fits = (i: number) => (i > 0 ? lines[i - 1] : null) === block.before && (i < lines.length ? lines[i] : null) === block.after;
	let at = block.at <= lines.length && fits(block.at) ? block.at : -1;
	if (at < 0 && block.before !== null) {
		const hits = lines.flatMap((l, i) => (l === block.before && fits(i + 1) ? [i + 1] : []));
		if (hits.length === 1) at = hits[0];
	}
	if (at < 0) return null;
	return [...lines.slice(0, at), ...block.removed, ...lines.slice(at)];
}

export function locateLine(lines: readonly string[], line: number, raw: string): number {
	if (lines[line] === raw) return line;
	const hits: number[] = [];
	lines.forEach((l, i) => {
		if (l === raw) hits.push(i);
	});
	return hits.length === 1 ? hits[0] : -1;
}

/**
 * Where a new task line goes in a note: after the last non-empty line of the section of a
 * `## #tag` heading (any level) for its tag, else at the end of the note.
 */
export function insertTaskLine(source: readonly string[], line: string, tag: string): { lines: string[]; at: number } {
	const lines = [...source];
	const fence = fenceLines(lines);
	const fmEnd = frontmatterEnd(lines);
	const isHeading = (i: number) => i > fmEnd && !fence[i] && /^#{1,6}\s/.test(lines[i]);
	const re = new RegExp(`^#{1,6}\\s+#${escapeRe(tag)}\\s*$`, "iu");
	const head = lines.findIndex((l, i) => isHeading(i) && re.test(l));
	if (head >= 0) {
		let end = head;
		let marker = "";
		for (let i = head + 1; i < lines.length && !isHeading(i); i++) {
			const m = lines[i].match(FENCE_RE);
			if (m && !marker) marker = m[1];
			else if (m && m[1][0] === marker[0] && m[1].length >= marker.length && !m[2].trim()) marker = "";
			if (lines[i].trim()) end = i;
		}
		// Never inside a code block left open in that section: right under the heading instead.
		if (marker) end = head;
		lines.splice(end + 1, 0, line);
		return { lines, at: end + 1 };
	}
	while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
	lines.push(line);
	return { lines, at: lines.length - 1 };
}

/**
 * The note new tasks go to: the note of the setting, else today's daily note (folder and date
 * format of the core Daily notes plugin, `daily` null when it is off), else `<fallback>.md`.
 */
export function newTaskPath(
	setting: string,
	daily: { folder: string; format: string } | null,
	fallbackName: string,
	formatDate: (format: string) => string,
): { path: string; daily: boolean } {
	const own = setting.trim().replace(/\\/g, "/").replace(/^\/+/, "");
	if (own) return { path: /\.md$/i.test(own) ? own : own + ".md", daily: false };
	if (daily) {
		const folder = daily.folder.trim().replace(/^\/+|\/+$/g, "");
		const name = formatDate(daily.format.trim() || "YYYY-MM-DD");
		return { path: (folder ? folder + "/" : "") + name + ".md", daily: true };
	}
	return { path: fallbackName + ".md", daily: false };
}

/** The smallest replacement turning `before` into `after`: offsets in `before` and the new text. */
export function minimalChange(before: string, after: string): { from: number; to: number; text: string } {
	let a = 0;
	while (a < before.length && a < after.length && before[a] === after[a]) a++;
	let b = 0;
	while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
	return { from: a, to: before.length - b, text: after.slice(a, after.length - b) };
}
