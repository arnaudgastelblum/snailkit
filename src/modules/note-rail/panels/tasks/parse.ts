// Pure task parsing: open tasks of a note, checking one, finding it again after edits.
export interface TaskItem {
	line: number;
	indent: number;
	raw: string;
	text: string;
	display: string;
	due: string | null;
	tags: string[];
}

const OPEN = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[ \](?:[ \t]+(.*)|$)/;

function unquote(line: string): string {
	return line.replace(/^(?:[ \t]*>)+[ \t]?/, "");
}

function displayText(text: string): string {
	return text.replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, path: string, alias?: string) => alias ?? path)
		.replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/`+([^`]*?)`+/g, "$1")
		.replace(/(\*{2,3}|_{2,3}|~~)(\S(?:.*?\S)?)\1/g, "$2")
		.replace(/(^|[^\p{L}\p{N}_])([*_])(\S(?:.*?\S)?)\2(?=$|[^\p{L}\p{N}_])/gu, "$1$3");
}

/** Parse only open list tasks; indentation counts list ancestors, including ordinary items. */
export function parseOpenTasks(lines: string[]): TaskItem[] {
	const tasks: TaskItem[] = [];
	let frontmatter = /^\uFEFF?---\s*$/.test(lines[0] ?? "");
	let fence: { char: string; length: number } | null = null;
	const levels: number[] = [];
	for (let line = 0; line < lines.length; line++) {
		const raw = lines[line];
		if (frontmatter) {
			if (line > 0 && /^(---|\.\.\.)\s*$/.test(raw)) frontmatter = false;
			continue;
		}
		const content = unquote(raw);
		const marker = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(content);
		if (fence) {
			if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
			continue;
		}
		if (marker && !(marker[1][0] === "`" && marker[2].includes("`"))) {
			fence = { char: marker[1][0], length: marker[1].length };
			continue;
		}
		const list = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+/.exec(content);
		if (!list) {
			if (content.trim() && !/^[ \t]/.test(content)) levels.length = 0;
			continue;
		}
		const width = list[1].replace(/\t/g, "    ").length;
		while (levels.length && levels[levels.length - 1] >= width) levels.pop();
		const indent = levels.length;
		levels.push(width);
		const match = OPEN.exec(raw);
		if (!match) continue;
		const text = match[2] ?? "";
		tasks.push({ line, indent, raw, text, display: displayText(text),
			due: /📅\s+(\d{4}-\d{2}-\d{2})(?!\d)/u.exec(text)?.[1] ?? null,
			tags: Array.from(new Set(Array.from(text.matchAll(/(?:^|\s)(#[\p{L}\p{N}_/-]+)/gu), (m) => m[1]))),
		});
	}
	return tasks;
}

export function checkTaskLine(line: string): string | null {
	const match = OPEN.exec(line);
	return match ? `${line.slice(0, match[1].length)}[x]${line.slice(match[1].length + 3)}` : null;
}

export function locateTask(lines: string[], task: { line: number; raw: string }): number {
	if (lines[task.line] === task.raw) return task.line;
	const index = lines.indexOf(task.raw);
	return index >= 0 && lines.indexOf(task.raw, index + 1) < 0 ? index : -1;
}
