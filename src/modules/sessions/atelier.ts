// Pure logic of the Brainstorms tab of the Workbench: what each brainstorm is (open, to sort,
// closed), how far it is sorted, its context, the pins and the archive, the filters and the search,
// and where the bubbles go on the timeline. Tested in test/sessions.test.ts.
import { hiddenLines, isTagLine, lineInfo, type Summary } from "./logic";

export type SessionState = "open" | "triage" | "closed";
export type SessionFilter = "all" | "open" | "triage" | "closed" | "archived";
export const FILTERS: readonly SessionFilter[] = ["all", "open", "triage", "closed", "archived"];

export interface SessionInfo {
	path: string;
	title: string;
	/** When the session was created (ms). */
	created: number;
	ideas: number;
	tasks: number;
	/** Questions and lines kept to decide (as the summary and the closing line count them). */
	decide: number;
	/** Tasks without a tag and lines kept to decide. */
	pending: number;
	closed: boolean;
	/** The text of the note, for the search (lowercased, without accents). */
	text: string;
	/** Rank among the pinned ones (0: pinned last, shown first), or null. */
	pin?: number | null;
	archived?: boolean;
	/** The context tag of the note (without "#"), or null. */
	context?: string | null;
	/** Last change of the file (ms). */
	modified?: number;
	/** Tasks checked. */
	done?: number;
	/** "- [?]" lines only. */
	undecided?: number;
	/** Open tasks without a tag. */
	untagged?: number;
	/** Lines written in the body. */
	lines?: number;
	/** Free sentences with a pale dot, still to sort. */
	loose?: number;
}

/** Open, to sort (open with tasks without a tag or lines to decide), or closed. */
export function stateOf(s: Pick<SessionInfo, "closed" | "pending">): SessionState {
	return s.closed ? "closed" : s.pending > 0 ? "triage" : "open";
}

/** Lowercased, without accents: what the search compares. */
export function searchable(text: string): string {
	return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function matches(s: SessionInfo, filter: SessionFilter): boolean {
	if (filter === "archived") return !!s.archived;
	if (s.archived) return false;
	const state = stateOf(s);
	if (filter === "all") return true;
	if (filter === "open") return state !== "closed";
	return state === filter;
}

const sameContext = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

/** Pinned first (the last pinned on top), then newest first. */
export function compareSessions(a: SessionInfo, b: SessionInfo): number {
	const pa = a.pin ?? null;
	const pb = b.pin ?? null;
	if (pa !== null || pb !== null) {
		if (pa === null) return 1;
		if (pb === null) return -1;
		if (pa !== pb) return pa - pb;
	}
	return b.created - a.created || a.title.localeCompare(b.title);
}

/**
 * The sessions shown: the filter, the context (null: every one), then every word of the query in
 * the title or the text; pinned first, then newest first.
 */
export function filterSessions(list: readonly SessionInfo[], filter: SessionFilter, query: string, context: string | null = null): SessionInfo[] {
	const words = searchable(query).split(/\s+/).filter(Boolean);
	return list
		.filter((s) => matches(s, filter))
		.filter((s) => context === null || sameContext(s.context, context))
		.filter((s) => {
			if (!words.length) return true;
			const hay = searchable(s.title) + "\n" + s.text;
			return words.every((w) => hay.includes(w));
		})
		.sort(compareSessions);
}

/** How many sessions each filter shows (before the search and the context). */
export function filterCounts(list: readonly SessionInfo[]): Record<SessionFilter, number> {
	const out: Record<SessionFilter, number> = { all: 0, open: 0, triage: 0, closed: 0, archived: 0 };
	for (const s of list) for (const f of FILTERS) if (matches(s, f)) out[f]++;
	return out;
}

/** The contexts of the sessions, most used first (case ignored, the first spelling kept). */
export function contextsOf(list: readonly Pick<SessionInfo, "context">[]): string[] {
	const seen = new Map<string, { tag: string; n: number }>();
	for (const s of list) {
		if (!s.context) continue;
		const key = s.context.toLowerCase();
		const prev = seen.get(key);
		seen.set(key, { tag: prev?.tag ?? s.context, n: (prev?.n ?? 0) + 1 });
	}
	return [...seen.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)).map((x) => x.tag);
}

/** One session as the "sessions" service lists it (the rail's panel reads it). */
export interface SessionEntry {
	path: string;
	title: string;
	created: number;
	state: "open" | "to-sort" | "closed";
	tasks: number;
	undecided: number;
}

/** The sessions as the service lists them: archived ones left out, newest first, the state named for other modules. */
export function serviceList(list: readonly SessionInfo[]): SessionEntry[] {
	return list
		.filter((s) => !s.archived)
		.sort((a, b) => b.created - a.created || a.title.localeCompare(b.title))
		.map((s) => {
			const state = stateOf(s);
			return { path: s.path, title: s.title, created: s.created, state: state === "triage" ? "to-sort" : state, tasks: s.tasks, undecided: s.decide };
		});
}

/** The tone of the tab's count: "warn" while sessions wait to be sorted. */
export function tabTone(list: readonly SessionInfo[]): "warn" | null {
	return tabCount(list) ? "warn" : null;
}

/** The count next to the tab's name: sessions to sort (archived ones left out), or null when there is none. */
export function tabCount(list: readonly SessionInfo[]): number | null {
	const n = list.filter((s) => !s.archived && stateOf(s) === "triage").length;
	return n || null;
}

// ----- how far a session is sorted -----

export interface Orphan {
	line: number;
	text: string;
}

export interface Triage {
	tasks: number;
	done: number;
	/** Open tasks without a tag. */
	untagged: number;
	/** "- [?]" lines. */
	undecided: number;
	/** Ideas without follow-up: free paragraphs and questions left as sentences. */
	orphans: Orphan[];
	/** Sorted at N % (0 to 100), or null when there is nothing to sort. */
	sorted: number | null;
}

/**
 * What is left to sort in a session. The choices are its tasks and its "- [?]" lines; a choice is
 * made when the task has a tag or is checked. "Sorted at N %" is the share of choices made, rounded
 * down (100 only when nothing waits). Free paragraphs and questions left as sentences are ideas
 * without follow-up: shown apart, they never lower the percentage.
 */
export function triageOf(s: Summary): Triage {
	const done = s.tasks.filter((t) => t.done).length;
	const untagged = s.tasks.filter((t) => !t.done && !t.tag).length;
	const undecided = s.questions.filter((q) => q.explicit).length;
	const choices = s.tasks.length + undecided;
	const made = s.tasks.length - untagged;
	const orphans: Orphan[] = [
		...s.items.filter((i) => i.kind === "free").map((i) => ({ line: i.line, text: i.text })),
		...s.questions.filter((q) => !q.explicit).map((q) => ({ line: q.line, text: q.text })),
	].sort((a, b) => a.line - b.line);
	return { tasks: s.tasks.length, done, untagged, undecided, orphans, sorted: choices ? Math.floor((100 * made) / choices) : null };
}

// ----- the context of a session: a tag at the top of the note -----

const LINK_LINE = /^(\[\[[^\]]+\]\]\s*[,·]?\s*)+$/;
const TRAILING_TAGS = /(\s+#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)+\s*$/u;

interface Head {
	/** First line that is not blank, after the properties (or the line after them). */
	first: number;
	heading: number | null;
	link: number | null;
	/** The line holding the context, and the context itself. */
	at: number | null;
	tag: string | null;
}

/** Where the tags of a line are, outside links and inline code (an alias like [[Inbox| #old]] is not a tag). */
function tagSpans(line: string): Array<{ tag: string; start: number; end: number }> {
	const masked = line.replace(/\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)|`[^`]*`/g, (m) => " ".repeat(m.length));
	const out: Array<{ tag: string; start: number; end: number }> = [];
	for (const m of masked.matchAll(/(^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu)) {
		const start = m.index + m[1].length;
		out.push({ tag: m[2].replace(/\/+$/, ""), start, end: start + 1 + m[2].length });
	}
	return out;
}

/** Reads the top of a note: a heading, the parent link line, a tag line, a date line. Stops at the first idea, task or block (code, quote...). */
function readHead(lines: readonly string[]): Head {
	const hidden = hiddenLines(lines);
	let top = 0;
	// Only the properties are skipped; a code block at the top ends the head.
	if (lines[0]?.trim() === "---") while (top < lines.length && hidden[top] && !/^\s*(```|~~~)/.test(lines[top])) top++;
	const head: Head = { first: top, heading: null, link: null, at: null, tag: null };
	let seen = 0;
	for (let i = top; i < lines.length && i < top + 8; i++) {
		const l = lines[i].trim();
		if (!l) continue;
		if (!seen) head.first = i;
		seen++;
		if (hidden[i]) break;
		const info = lineInfo(lines[i]);
		if (info.kind === "task" || info.kind === "decide" || (info.kind === "other" && !/^!?\[\[/.test(l))) break;
		if (info.kind === "heading") {
			if (seen === 1) {
				head.heading = i;
				continue;
			}
			break;
		}
		const linkLine = LINK_LINE.test(l.replace(TRAILING_TAGS, ""));
		if (linkLine || isTagLine(l)) {
			if (linkLine && head.link === null) head.link = i;
			const tag = tagSpans(lines[i])[0];
			if (tag) {
				head.at = i;
				head.tag = tag.tag;
				break;
			}
			continue;
		}
		const dateLine = l.length <= 60 && /\d/.test(l) && !/[.!?]\s*$|[.!?]\s/.test(l) && !info.marker;
		if (dateLine && seen <= 3) continue;
		break;
	}
	return head;
}

/** The context of a session: the first tag of the parent link line or of a tag line at the top, or null. */
export function contextOf(lines: readonly string[]): string | null {
	return readHead(lines).tag;
}

/**
 * The note with its context set (or removed with null). An existing context is replaced where it
 * is (never inside a link); otherwise the tag goes at the end of the parent link line, else on its
 * own line under the heading, else on its own line at the top (after the properties and the
 * leading blank lines, before any block).
 */
export function withContext(lines: readonly string[], tag: string | null): string[] {
	const out = [...lines];
	const head = readHead(lines);
	const name = tag?.replace(/^#/, "").trim() || null;
	if (head.at !== null && head.tag) {
		const line = out[head.at];
		const span = tagSpans(line)[0];
		if (name) out[head.at] = line.slice(0, span.start) + "#" + name + line.slice(span.end);
		else {
			const rest = (line.slice(0, span.start).replace(/[ \t]+$/, "") + line.slice(span.end)).replace(/\s+$/, "");
			if (!rest.trim()) out.splice(head.at, 1);
			else out[head.at] = rest;
		}
		return out;
	}
	if (!name) return out;
	if (head.link !== null) out[head.link] = `${out[head.link].replace(/\s+$/, "")} #${name}`;
	else if (head.heading !== null) out.splice(head.heading + 1, 0, `#${name}`);
	else out.splice(head.first, 0, `#${name}`);
	return out;
}

/** Where a line read earlier is now: the same index if it still reads so, else the only line reading so, else null. */
export function locateRaw(lines: readonly string[], line: number, raw: string): number | null {
	if (lines[line] === raw) return line;
	const first = lines.indexOf(raw);
	return first >= 0 && lines.indexOf(raw, first + 1) < 0 ? first : null;
}

// ----- paths kept in the settings (pins, archive) -----

/** The list after a rename: the entry follows the note. */
export function renameIn(list: readonly string[], from: string, to: string): string[] {
	return list.filter((p) => p !== to).map((p) => (p === from ? to : p));
}

/** Only the entries of the sessions still tracked, once each. */
export function keepIn(list: readonly string[], paths: readonly string[]): string[] {
	const keep = new Set(paths);
	return list.filter((p, i) => keep.has(p) && list.indexOf(p) === i);
}

/** Adds the path in front, or removes it when it is there. */
export function toggleIn(list: readonly string[], path: string): string[] {
	return list.includes(path) ? list.filter((p) => p !== path) : [path, ...list];
}

// ----- free sentences kept as ideas, by note -----

export type KeptList = Array<[string, string[]]>;

/** The prints kept in a note. */
export function keptIn(list: KeptList, path: string): string[] {
	const hit = list.find((e) => Array.isArray(e) && e[0] === path && Array.isArray(e[1]));
	return hit ? hit[1].filter((p) => typeof p === "string") : [];
}

/** The list with prints added to a note (`on`) or taken out of it; a note left without any is dropped. At most `cap` per note, the latest kept. */
export function withKept(list: KeptList, path: string, prints: readonly string[], on: boolean, cap = 300): KeptList {
	const old = keptIn(list, path);
	const next = on ? [...old.filter((p) => !prints.includes(p)), ...prints].slice(-cap) : old.filter((p) => !prints.includes(p));
	const rest = list.filter((e) => Array.isArray(e) && e[0] !== path);
	return next.length ? [...rest, [path, next]] : rest;
}

/** The list after a rename: the prints follow the note. */
export function renameKept(list: KeptList, from: string, to: string): KeptList {
	return list.filter(([p]) => p !== to).map(([p, prints]) => [p === from ? to : p, prints] as [string, string[]]);
}

/** Only the notes still tracked. */
export function keepKept(list: KeptList, paths: readonly string[]): KeptList {
	const keep = new Set(paths);
	return list.filter((e) => Array.isArray(e) && keep.has(e[0]));
}

// ----- age -----

export type AgeUnit = "minute" | "hour" | "day" | "week" | "month" | "year";

/** How long ago, as a value and a unit for Intl.RelativeTimeFormat (negative: in the past). */
export function ago(ms: number, now: number): [number, AgeUnit] {
	const s = Math.max(0, now - ms) / 1000;
	if (s < 3600) return [-Math.max(1, Math.round(s / 60)), "minute"];
	if (s < 86400) return [-Math.round(s / 3600), "hour"];
	const d = s / 86400;
	if (d < 7) return [-Math.round(d), "day"];
	if (d < 30) return [-Math.round(d / 7), "week"];
	if (d < 365) return [-Math.round(d / 30), "month"];
	return [-Math.round(d / 365), "year"];
}

// ----- when each session began -----

export type CreatedList = Array<[string, number]>;

/** The recorded start of a session, or null (an older session recorded before this list existed). */
export function createdAt(list: CreatedList, path: string): number | null {
	const hit = list.find(([p, ms]) => p === path && typeof ms === "number" && Number.isFinite(ms));
	return hit ? hit[1] : null;
}

/** The list with `path` set to `ms` (one entry per path). */
export function withCreated(list: CreatedList, path: string, ms: number): CreatedList {
	return [...list.filter(([p]) => p !== path), [path, ms]];
}

/** The list after a rename: the entry follows the note. */
export function renameCreated(list: CreatedList, from: string, to: string): CreatedList {
	return list.filter(([p]) => p !== to).map(([p, ms]) => [p === from ? to : p, ms] as [string, number]);
}

/** Only the entries of the sessions still tracked. */
export function keepCreated(list: CreatedList, paths: readonly string[]): CreatedList {
	const keep = new Set(paths);
	return list.filter(([p]) => keep.has(p));
}

// ----- the timeline -----

export interface TimelineDay {
	/** Start of the day (ms, local time). */
	date: number;
	x: number;
	today: boolean;
	/** A label is drawn under this day (every Monday, the first of a month, the first day and today). */
	label: boolean;
	/** First day of a month: a stronger tick. */
	month: boolean;
}

export interface TimelineBubble {
	path: string;
	/** Center, in pixels from the left of the axis and from the axis line (upward). */
	x: number;
	y: number;
	r: number;
	state: SessionState;
}

export interface Timeline {
	width: number;
	/** Height needed above the axis for the stacked bubbles. */
	height: number;
	days: TimelineDay[];
	bubbles: TimelineBubble[];
	/** x of now. */
	now: number;
}

const DAY = 86_400_000;

export function dayStart(ms: number): number {
	const d = new Date(ms);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/** Radius of a bubble: grows with the tasks of the session, gently (square root), within bounds. */
export function bubbleRadius(tasks: number): number {
	return Math.min(16, 5 + 2.6 * Math.sqrt(Math.max(0, tasks)));
}

/**
 * Lays the sessions out on a time axis: one column of `perDay` pixels per day, from the first
 * session (at least `minDays` back) to tomorrow, days widened to fill `fill` pixels when given.
 * Sessions of the same day stack upward.
 */
/** A calendar day as a number (local Y/M/D), so that days are counted the same across daylight saving changes. */
export function dayNumber(ms: number): number {
	const d = new Date(ms);
	return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

/** Midnight (local) of a day number. */
function dayDate(n: number): Date {
	const u = new Date(n * DAY);
	return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
}

/** How far into its day a moment is, from 0 to 1 (a day of 23 or 25 hours included). */
function dayFraction(ms: number): number {
	const start = dayStart(ms);
	const next = dayDate(dayNumber(ms) + 1).getTime();
	return Math.max(0, Math.min(1, (ms - start) / (next - start)));
}

export function layoutTimeline(list: readonly SessionInfo[], now: number, perDay: number, minDays = 21, fill = 0): Timeline {
	const todayN = dayNumber(now);
	const firstN = Math.min(todayN - (minDays - 1), ...list.map((s) => dayNumber(s.created)));
	const count = todayN - firstN + 2;
	const pad = 18;
	// Wider days when the axis would not fill the space it has.
	if (fill > 0) perDay = Math.max(perDay, (fill - 2 * pad) / (count - 1));
	const days: TimelineDay[] = [];
	for (let i = 0; i < count; i++) {
		const date = dayDate(firstN + i);
		const today = firstN + i === todayN;
		days.push({ date: date.getTime(), x: pad + i * perDay, today, label: i === 0 || today || date.getDay() === 1 || date.getDate() === 1, month: date.getDate() === 1 });
	}
	const stacks = new Map<number, number>();
	let height = 0;
	const bubbles = [...list]
		.sort((a, b) => a.created - b.created)
		.map((s) => {
			const i = dayNumber(s.created) - firstN;
			const r = bubbleRadius(s.tasks);
			const below = stacks.get(i) ?? 0;
			const y = below + r + 4;
			stacks.set(i, below + 2 * r + 4);
			height = Math.max(height, below + 2 * r + 8);
			return { path: s.path, x: pad + (i + 0.15 + 0.7 * dayFraction(s.created)) * perDay, y, r, state: stateOf(s) };
		});
	return { width: pad * 2 + (count - 1) * perDay, height: Math.max(height, 40), days, bubbles, now: pad + (todayN - firstN + dayFraction(now)) * perDay };
}
