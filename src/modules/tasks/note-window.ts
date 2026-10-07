import { locateLine } from "./edit";

/** A bounded excerpt, with a private render-only anchor on the exact task occurrence. */
export function noteWindow(text: string, task: { line: number; raw: string }, whole = false) {
	const lines = text.split(/\r?\n/);
	const line = locateLine(lines, task.line, task.raw);
	const center = line < 0 ? Math.max(0, Math.min(task.line, lines.length - 1)) : line;
	let start = whole ? 0 : Math.max(0, center - 40);
	// If the window starts inside fenced code or properties, skip that partial block.
	// Otherwise its closing fence could hide the selected task as code.
	if (start > 0) {
		let fence = "";
		let openedBeforeWindow = false;
		let properties = lines[0] === "---";
		for (let i = properties ? 1 : 0; i < center; i++) {
			if (properties) {
				if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
					properties = false;
					if (i >= start) start = i + 1;
				}
				continue;
			}
			const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i]);
			if (!match) continue;
			if (!fence) fence = match[1];
			else if (match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) {
				// Only trim a block that started before the current window.
				if (i >= start && openedBeforeWindow) start = i + 1;
				fence = "";
			}
			if (fence && i < start) openedBeforeWindow = true;
			else if (!fence) openedBeforeWindow = false;
		}
	}
	const end = whole ? lines.length : Math.min(lines.length, center + 41);
	const excerpt = lines.slice(start, end);
	if (line >= 0) excerpt[line - start] = excerpt[line - start].replace(
		/^(\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]\s*)/,
		'$1<span class="sk-tasks-note-anchor"></span>',
	);
	return { markdown: excerpt.join("\n"), line, start, end, truncated: start > 0 || end < lines.length };
}
