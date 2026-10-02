// Pure rewriting of task lines (check, priority, due date, tag, title, markers) and of notes
// (where a new task goes, the smallest editor change). Lines in, lines out.
import { DONE_RE, DUE_RE, FENCE_RE, PRIORITIES, TASK_RE, escapeRe, fenceLines, frontmatterEnd, tagsOf } from "./parse";
import type { Priority } from "./types";

// Tokens other tools expect at the very end of a task: a carry-over counter (↻n), the done
// stamp, Markdown comments (markers) and a block id. New tokens go before this run.
const TRAILING_RE = /(?:\s+(?:↻\d+|✅\s*\d{4}-\d{2}-\d{2}|\^[A-Za-z0-9-]+|%%(?:(?!%%).)*%%))+\s*$/u;
const STAR_TOKEN_RE = /(^|\s)⭐️?(?=\s|$)/u;
const BLOCK_ID_END_RE = /\s+\^[A-Za-z0-9-]+\s*$/;
const TAG_CHARS = "[\\p{L}\\p{N}_/-]";

/** Inserts a token before the trailing run (↻n, ✅ date, %%comments%%, ^block-id). */
export function insertToken(text: string, token: string): string {
	const m = text.match(TRAILING_RE);
	const head = (m ? text.slice(0, m.index) : text).replace(/\s+$/, "");
	return (head ? head + " " : "") + token + (m ? m[0] : "");
}

/** Removes every `#tag` (whole tag, any case), with the space before it. */
export function removeTag(text: string, tag: string): string {
	const re = new RegExp(`(^|\\s+)#${escapeRe(tag)}(?!${TAG_CHARS})`, "giu");
	return text.replace(re, "").replace(/^\s+/, "").replace(/\s+$/, "");
}

export function setPriorityText(text: string, priority: Priority | null): string {
	let out = text.replace(STAR_TOKEN_RE, "$1").replace(/^\s+/, "");
	for (const p of PRIORITIES) out = removeTag(out, p);
	return priority ? insertToken(out, "#" + priority) : out;
}

/** Sets the due date where it stands, adds it, or removes it (null). Nothing else moves. */
export function setDueText(text: string, due: string | null): string {
	if (DUE_RE.test(text)) {
		if (due) return text.replace(/📅\s*\d{4}-\d{2}-\d{2}/u, "📅 " + due);
		return text.replace(DUE_RE, "").replace(/^\s+/, "");
	}
	return due ? insertToken(text, "📅 " + due) : text;
}

/** Replaces the group tag where it stands (leading or trailing style), else adds the new one. */
export function retagText(text: string, from: string, to: string): string {
	const re = new RegExp(`(^|\\s)#${escapeRe(from)}(?!${TAG_CHARS})`, "iu");
	return re.test(text) ? text.replace(re, `$1#${to}`) : insertToken(text, "#" + to);
}

/** Sets (or removes, with null) a `%%name:value%%` marker. */
export function setMarkerText(text: string, name: string, value: string | null): string {
	const re = new RegExp(`\\s*%%${escapeRe(name)}:[A-Za-z0-9_.-]+%%`, "g");
	const out = text.replace(re, "").replace(/^\s+/, "");
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
	return [...text.matchAll(TOKEN_RE)].map((m) => {
		const lead = m[0].length - m[0].trimStart().length;
		const index = m.index ?? 0;
		return { start: index + lead, end: index + m[0].length, text: m[0].trim() };
	});
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
	let text = m[4].replace(DONE_RE, "").replace(/\s+$/, "");
	if (done && stamp) {
		const id = text.match(BLOCK_ID_END_RE);
		text = id ? text.slice(0, id.index) + " ✅ " + stamp + id[0] : text + " ✅ " + stamp;
	}
	return `${m[1]}${m[2]} [${done ? "x" : " "}] ${text}`;
}

/** Finds a line again: same place, else the only identical line of the note. Two candidates: -1. */
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
