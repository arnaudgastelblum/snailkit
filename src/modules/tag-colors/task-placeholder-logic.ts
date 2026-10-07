/** Line numbers are zero-based; snapshots deliberately include all original whitespace. */
export interface TaskLine { line: number; text: string; open: boolean }

export function taskLine(text: string, line = 0): TaskLine | null {
	const match = /^(?:\s*> ?)*[ \t]*(?:[-+*]|\d+[.)])\s+\[([^\]])\](?:[ \t]+|$)/.exec(text);
	return match ? { line, text, open: match[1] === " " } : null;
}

export function hasTaskTag(text: string): boolean {
	const prose = text.replace(/(`+)[\s\S]*?\1/g, " ").replace(/%%.*?%%/g, " ").replace(/\]\([^)]*\)/g, "]").replace(/\[\[[^\]]*\]\]/g, " ");
	// Priorities (#high, #medium, #low) mark a task, they are not its tag.
	for (const m of prose.matchAll(/(?:^|[^\p{L}\p{N}_/\\])#(?=[\p{L}\p{N}_/-]*[\p{L}_/-])([\p{L}\p{N}_/-]+)/gu)) if (!/^(?:high|medium|low)$/i.test(m[1])) return true;
	return false;
}

/** Used for rendered sections, never for a full vault scan. */
export function taskLines(source: string): TaskLine[] {
	const result: TaskLine[] = [];
	let frontmatter = false, fence = "", fenceSize = 0;
	const listIndents: number[] = [];
	for (const [line, text] of source.split(/\r?\n/).entries()) {
		if (line === 0 && /^\uFEFF?---\s*$/.test(text)) { frontmatter = true; continue; }
		if (frontmatter) { if (/^(---|\.\.\.)\s*$/.test(text)) frontmatter = false; continue; }
		const plain = text.replace(/^(?:\s*> ?)+/, "");
		const indent = (/^[ \t]*/.exec(plain)![0]).replace(/\t/g, "    ").length;
		if (plain.trim()) while (listIndents.length && indent < listIndents[listIndents.length - 1]) listIndents.pop();
		const base = listIndents[listIndents.length - 1] ?? 0;
		if (!fence && indent >= base + 4) continue;
		const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(plain);
		if (fence) {
			if (marker && marker[1][0] === fence && marker[1].length >= fenceSize && !marker[2].trim()) fence = "";
			continue;
		}
		if (marker) { fence = marker[1][0]; fenceSize = marker[1].length; continue; }
		const list = /^\s*(?:[-+*]|\d+[.)])([ \t]+)/.exec(plain);
		if (list) listIndents.push(list[0].replace(/\t/g, "    ").length);
		const task = taskLine(text, line);
		if (task) result.push(task);
	}
	return result;
}

export function untaggedTasks(source: string): TaskLine[] {
	return taskLines(source).filter(task => task.open && !hasTaskTag(task.text));
}

/** Strip only a suffix of Tasks dates, priorities (emoji or #high/#medium/#low), comments and whitespace. */
export function taskTagPosition(text: string): number {
	const suffix = /(?:[ \t]+(?:(?:📅|✅|🛫|⏳|➕|❌)\s*\d{4}-\d{2}-\d{2}|[🔺⏫🔼🔽⏬]\uFE0F?|%%.*?%%|#(?:[Hh][Ii][Gg][Hh]|[Mm][Ee][Dd][Ii][Uu][Mm]|[Ll][Oo][Ww])(?![\p{L}\p{N}_/-])))*[ \t]*$/u.exec(text)!;
	return suffix.index;
}

export function checkedTaskInsertion(current: string, snapshot: string, tag: string): { at: number; insert: string } | null {
	if (current !== snapshot || !taskLine(current)?.open || hasTaskTag(current)) return null;
	const name = tag.replace(/^#/, "");
	if (!/^[\p{L}\p{N}_/-]+$/u.test(name) || !/[\p{L}_/-]/u.test(name)) return null;
	return { at: taskTagPosition(current), insert: " #" + name };
}

export function checkedSourceTaskInsertion(source: string, line: number, snapshot: string, tag: string): string | null {
	const current = taskLines(source).find(task => task.line === line);
	if (!current) return null;
	const change = checkedTaskInsertion(current.text, snapshot, tag);
	if (!change) return null;
	const lines = source.split("\n");
	lines[line] = lines[line].slice(0, change.at) + change.insert + lines[line].slice(change.at);
	return lines.join("\n");
}
