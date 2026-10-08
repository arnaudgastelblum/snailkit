// Pure reading of task lines: which lines are tasks, their tag, priority, dates and title.
import type { Priority, Subtask, Task, TaskFields } from "./types";

export const TASK_RE = /^(\s*)([-*+]|\d+[.)])\s\[(.)\]\s(.*)$/;
export const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
export const TAG_RE = /(^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;
export const DUE_RE = /\s*📅\s*(\d{4}-\d{2}-\d{2})/u;
export const DONE_RE = /\s*✅\s*(\d{4}-\d{2}-\d{2})/u;
// Reminder times, scheduled, start, created and cancelled dates: kept as they are, never shown.
const TIME_RE = /\s*⏰\s*\d{1,2}:\d{2}/gu;
const OTHER_DATE_RE = /\s*[⏳🛫➕❌]️?\s*\d{4}-\d{2}-\d{2}/gu;
const CARRY_RE = /\s*↻\d+(?=\s|$)/gu;
const STAR_RE = /(^|\s)⭐️?(?=\s|$)/u;
const BLOCK_ID_RE = /\s+\^[A-Za-z0-9-]+\s*$/;
export const COMMENT_RE = /\s*%%(?:(?!%%).)*%%/g;
export const NOTE_LINK_RE = /\[\[([^[\]|\r\n]+)\|📝\]\]/gu;
const MARKER_RE = /%%([a-z][a-z0-9-]*):([A-Za-z0-9_.-]+)%%/g;

export const PRIORITIES: Priority[] = ["high", "medium", "low"];

export function indentWidth(s: string): number {
	let width = 0;
	for (const c of s) width += c === "\t" ? 4 : 1;
	return width;
}

export function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** "a, #b , c/" -> ["a", "b", "c/"]: comma separated, trimmed, "#" removed, lowercased. */
export function parseTagList(value: string): string[] {
	return value.split(",").map((part) => part.trim().replace(/^#/, "").toLowerCase()).filter(Boolean);
}

/** "Templates, /Archive/" -> ["Templates", "Archive"]. */
export function parseFolderList(value: string): string[] {
	return value.split(",").map((part) => part.trim().replace(/^\/+|\/+$/g, "")).filter(Boolean);
}

export function isInFolder(path: string, folders: readonly string[]): boolean {
	return folders.some((folder) => path === folder || path.startsWith(folder + "/"));
}

/** Tags that never make a group: the priorities and the flag tags of the settings. */
export function flagSet(flagTags: string): Set<string> {
	return new Set([...PRIORITIES, ...parseTagList(flagTags)]);
}

export function tagsOf(text: string): string[] {
	text = text.replace(NOTE_LINK_RE, " ");
	const out: string[] = [];
	for (const m of text.matchAll(TAG_RE)) if (!/^[\d/_-]+$/.test(m[2])) out.push(m[2].toLowerCase());
	return out;
}

export function markersOf(text: string): Record<string, string> {
	text = text.replace(NOTE_LINK_RE, " ");
	const out: Record<string, string> = {};
	for (const m of text.matchAll(MARKER_RE)) if (!(m[1] in out)) out[m[1]] = m[2];
	return out;
}

/** Splits a task text (what follows "- [ ] ") into its fields. */
export function parseTaskText(text: string, flags: ReadonlySet<string>): TaskFields {
	const noteLink = [...text.matchAll(NOTE_LINK_RE)][0]?.[1].replace(/\.md$/i, "") ?? null;
	text = text.replace(NOTE_LINK_RE, " ");
	const tags = tagsOf(text);
	const primary = tags.find((tag) => !flags.has(tag)) ?? null;
	let priority = PRIORITIES.find((p) => tags.includes(p)) ?? null;
	// A leading or standalone ⭐ (written by daily migration tools) counts as high.
	if (!priority && STAR_RE.test(text)) priority = "high";
	const title = text
		.replace(COMMENT_RE, "")
		.replace(BLOCK_ID_RE, "")
		.replace(CARRY_RE, "")
		.replace(DUE_RE, "")
		.replace(TIME_RE, "")
		.replace(DONE_RE, "")
		.replace(OTHER_DATE_RE, "")
		.replace(STAR_RE, "$1")
		.replace(TAG_RE, (whole, space: string, tag: string) => {
			const lower = tag.toLowerCase();
			return lower === primary || flags.has(lower) ? space : whole;
		})
		.replace(/\s+/g, " ")
		.trim();
	return {
		noteLink,
		tags,
		primary,
		priority,
		due: text.match(DUE_RE)?.[1] ?? null,
		doneDate: text.match(DONE_RE)?.[1] ?? null,
		title,
		markers: markersOf(text),
	};
}

/** Identity of a task: its tag and its words, so it survives edits of priority, dates or its note. */
export function taskKey(primary: string, title: string): string {
	return primary + "|" + title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Title with links and emphasis as plain text: what a person would read. */
export function plainTitle(title: string): string {
	return title
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, (_, target: string) => target.replace(/^.*\//, "").replace(/#.*$/, ""))
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/(\*\*|__|==|~~|`)(.+?)\1/g, "$2");
}

export function frontmatterEnd(lines: readonly string[]): number {
	if (lines[0] !== "---") return -1;
	for (let i = 1; i < lines.length; i++) if (/^---\s*$/.test(lines[i])) return i;
	return -1;
}

/**
 * fence[i] is true when line i is a fence line or sits inside a fenced code block. A closing
 * fence uses the same character, is at least as long as the opening one and has no info string.
 */
export function fenceLines(lines: readonly string[]): boolean[] {
	const out: boolean[] = [];
	let marker = "";
	for (const line of lines) {
		const m = line.match(FENCE_RE);
		if (!marker) {
			if (m) marker = m[1];
			out.push(!!m);
		} else {
			out.push(true);
			if (m && m[1][0] === marker[0] && m[1].length >= marker.length && !m[2].trim()) marker = "";
		}
	}
	return out;
}

/** Last line of the child block of the line at `at` (itself when it has none). */
export function blockEnd(lines: readonly string[], at: number): number {
	const indent = indentWidth(lines[at].match(/^\s*/)![0]);
	let end = at;
	for (let j = at + 1; j < lines.length; j++) {
		if (!lines[j].trim()) continue;
		if (indentWidth(lines[j].match(/^\s*/)![0]) <= indent) break;
		end = j;
	}
	return end;
}

/**
 * Every task of a note that carries a group tag: open ("[ ]") or done ("[x]"), outside the
 * frontmatter and code blocks. Child checkboxes without a tag of their own are its subtasks.
 * Keys are filled in by the index (they depend on the other notes).
 */
export function scanTasks(lines: readonly string[], path: string, flags: ReadonlySet<string>): Task[] {
	const tasks: Task[] = [];
	const fence = fenceLines(lines);
	const start = frontmatterEnd(lines) + 1;
	for (let i = start; i < lines.length; i++) {
		if (fence[i]) continue;
		const m = lines[i].match(TASK_RE);
		if (!m || !" xX".includes(m[3])) continue;
		const fields = parseTaskText(m[4], flags);
		if (!fields.primary) continue;
		const end = blockEnd(lines, i);
		const subtasks: Subtask[] = [];
		const description: string[] = [];
		for (let j = i + 1; j <= end; j++) {
			if (fence[j]) continue;
			const sub = lines[j].match(TASK_RE);
			if (!sub) description.push(lines[j]);
			if (sub && " xX".includes(sub[3]) && !parseTaskText(sub[4], flags).primary) {
				subtasks.push({ line: j, raw: lines[j], done: sub[3] !== " ", text: sub[4].trim() });
			}
		}
		const baseKey = taskKey(fields.primary, fields.title);
		tasks.push({
			...fields,
			primary: fields.primary,
			path,
			line: i,
			raw: lines[i],
			indent: m[1],
			text: m[4],
			done: m[3] !== " ",
			baseKey,
			key: baseKey,
			subtasks,
			description: unindentDescription(description),
		});
	}
	return tasks;
}

/** Removes common indentation while preserving paragraph breaks and deeper indentation. */
function unindentDescription(lines: string[]): string {
	while (lines.length && !lines[0].trim()) lines.shift();
	while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
	let common = Infinity;
	for (const line of lines) {
		if (line.trim()) common = Math.min(common, indentWidth(line.match(/^\s*/)![0]));
	}
	return lines.map((line) => {
		if (!line.trim()) return "";
		let width = 0;
		let at = 0;
		while (width < common) width += line[at++] === "\t" ? 4 : 1;
		return " ".repeat(width - common) + line.slice(at);
	}).join("\n");
}

export interface InlinePart {
	kind: "text" | "code" | "strong" | "em" | "mark" | "del" | "link";
	text: string;
}

const INLINE_RE = /(`+)([^`]+?)\1|\*\*(.+?)\*\*|__(.+?)__|==(.+?)==|~~(.+?)~~|\*([^*\s][^*]*?)\*|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)]+)\)/g;

/** The inline Markdown of a title, as parts to draw (never as HTML). */
export function inlineParts(text: string): InlinePart[] {
	const parts: InlinePart[] = [];
	let last = 0;
	for (const m of text.matchAll(INLINE_RE)) {
		const index = m.index ?? 0;
		if (index > last) parts.push({ kind: "text", text: text.slice(last, index) });
		if (m[2] !== undefined) parts.push({ kind: "code", text: m[2] });
		else if (m[3] || m[4]) parts.push({ kind: "strong", text: m[3] || m[4] });
		else if (m[5]) parts.push({ kind: "mark", text: m[5] });
		else if (m[6]) parts.push({ kind: "del", text: m[6] });
		else if (m[7]) parts.push({ kind: "em", text: m[7] });
		else if (m[8]) parts.push({ kind: "link", text: m[9] || m[8].replace(/^.*\//, "").replace(/#.*$/, "") });
		else if (m[10]) parts.push({ kind: "link", text: m[10] });
		last = index + m[0].length;
	}
	if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
	return parts;
}
