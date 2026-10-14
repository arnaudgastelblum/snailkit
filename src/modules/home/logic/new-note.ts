// The New note window's pure parts: the name checked as it is typed, the parent proposed, a
// template filled, a link line added to the parent, a selection turned into a name. Tested in
// test/new-note.test.ts.
import { cleanNoteName } from "./moves";

/** Characters a note name cannot hold (file name or link), in this display order. */
export const FORBIDDEN_CHARS: readonly string[] = ["\\", "/", ":", "*", "?", "\"", "<", ">", "|", "#", "^", "[", "]"];

/** Forbidden characters in first appearance order, or a leading or trailing dot. */
export type NameProblem = { kind: "chars"; chars: string[] } | { kind: "dot-start" } | { kind: "dot-end" };

/** The first problem in a raw name; blank names and surrounding spaces are fine. */
export function nameProblem(name: string): NameProblem | null {
	const trimmed = name.trim();
	if (!trimmed) return null;
	const chars = [...new Set([...name].filter((char) => FORBIDDEN_CHARS.includes(char)))];
	if (chars.length) return { kind: "chars", chars };
	if (trimmed.startsWith(".")) return { kind: "dot-start" };
	if (trimmed.endsWith(".")) return { kind: "dot-end" };
	return null;
}

/** Matching markdown note paths, ignoring case and outer spaces, shortest then alphabetical. */
export function sameName(name: string, notes: ReadonlyArray<{ path: string; basename: string }>): string[] {
	const key = name.trim().toLowerCase();
	if (!key) return [];
	return notes
		.filter((note) => note.path.toLowerCase().endsWith(".md") && note.basename.trim().toLowerCase() === key)
		.map((note) => note.path)
		.sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/** Where a note lives, for a message; empty at the vault's root. */
export function folderOf(path: string): string {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? "" : path.slice(0, slash);
}

/** The existing notes and their relationships used to propose a parent. */
export interface ParentWorld {
	exists(path: string): boolean;
	hasChildren(path: string): boolean;
	parent(path: string): string | null;
	isDomain(path: string): boolean;
}

/** Propose the given parent, active place or its parent, last parent, then existing home. */
export function defaultParent(world: ParentWorld, o: { given?: string | null; active?: string | null; last?: string | null; home?: string | null }): string | null {
	if (o.given && world.exists(o.given)) return o.given;
	if (o.active && world.exists(o.active)) {
		if (world.hasChildren(o.active) || o.active === o.home || world.isDomain(o.active)) return o.active;
		const parent = world.parent(o.active);
		if (parent) return parent;
	}
	if (o.last && world.exists(o.last)) return o.last;
	return o.home && world.exists(o.home) ? o.home : null;
}

/** Fill core Templates variables with the title and formatted now, leaving other syntax intact. */
export function fillTemplate(text: string, o: { title: string; dateFormat?: string; timeFormat?: string; format(pattern: string): string }): string {
	return text.replace(/\{\{\s*(title|date|time)\s*(?::([^{}]*))?\s*\}\}/gi, (whole: string, name: string, pattern: string | undefined) => {
		const key = name.toLowerCase();
		if (key === "title") return pattern === undefined ? o.title : whole;
		const fallback = key === "date" ? o.dateFormat || "YYYY-MM-DD" : o.timeFormat || "HH:mm";
		return o.format(pattern === undefined ? fallback : pattern.trim());
	});
}

/** Append a line after trimmed trailing whitespace, with exactly one final newline. */
export function appendLine(text: string, line: string): string {
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	const body = text.trimEnd();
	return `${body ? body + newline : ""}${line.trimEnd()}${newline}`;
}

/** A short single-line selection, unwrapped from emphasis and made safe, unless already a link. */
export function nameFromSelection(text: string): string | null {
	let name = text.trim();
	if (!name || name.length > 120 || /[\r\n]/.test(name)) return null;
	if (/^\[\[[^[\]]*\]\]$/.test(name) || /^\[[^[\]]*\]\((?:[^()]|\([^()]*\))*\)$/.test(name)) return null;
	const markers = ["**", "__", "*", "_", "==", "~~", "`"];
	for (;;) {
		const marker = markers.find((m) => name.length >= m.length * 2 && name.startsWith(m) && name.endsWith(m));
		if (!marker) break;
		name = name.slice(marker.length, -marker.length).trim();
	}
	return cleanNoteName(name) || null;
}

/** The trimmed selection as an alias when it differs from the trimmed name, case-sensitive. */
export function linkAlias(selection: string, name: string): string | null {
	const alias = selection.trim();
	return alias === name.trim() ? null : alias;
}
