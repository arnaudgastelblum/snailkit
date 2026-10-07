import type { SearchFilter, SearchGroup, SearchResult, SearchResultKind } from "./types";

/** Bound UTF-8 bytes without leaving an incomplete character at the end. */
export function capText(text: string, bytes = 1024 * 1024): string {
	// A UTF-16 code unit takes at most three UTF-8 bytes. Most notes need no allocation.
	if (text.length * 3 <= bytes) return text;
	let prefix = text.slice(0, bytes);
	if (prefix.length < text.length && /[\ud800-\udbff]$/.test(prefix)) prefix = prefix.slice(0, -1);
	const encoded = new TextEncoder().encode(prefix);
	return encoded.length <= bytes ? prefix : new TextDecoder().decode(encoded.subarray(0, bytes), { stream: true });
}

const LIGATURES: Readonly<Record<string, string>> = { "œ": "o", "Œ": "o", "æ": "a", "Æ": "a", "ß": "s", "ẞ": "s", "ø": "o", "Ø": "o", "ł": "l", "Ł": "l" };

/** Preserve UTF-16 offsets, including ligatures and combining marks. */
export function fold(text: string): string {
	return text.replace(/[\u0080-\uffff]/g, char => {
		const ligature = LIGATURES[char];
		if (ligature) return ligature;
		const simple = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
		return simple.length === 1 ? simple : char.toLowerCase().slice(0, 1);
	}).toLowerCase();
}

export interface Token { kind: "tag" | "domain"; value: string }
export interface Query { text: string; words: string[]; tokens: Token[]; tagPrefix: string | null }
export function parseQuery(raw: string, tags: readonly string[] = []): Query {
	const tokens: Token[] = [];
	let text = raw.replace(/(?:^|\s)(#([^\s#]+)|in:([^\s]+))(?=\s)/gi, (_all: string, _token: string, tag: string | undefined, domain: string) => {
		tokens.push({ kind: tag ? "tag" : "domain", value: tag ?? domain });
		return " ";
	}).trim();
	if (/^#[^\s#]+$/.test(text)) {
		const value = text.slice(1);
		if (tags.some(t => fold(t) === fold(value)) && !tags.some(t => fold(t) !== fold(value) && fold(t).startsWith(fold(value)))) {
			tokens.push({ kind: "tag", value }); text = "";
		}
	}
	return { text, words: fold(text).split(/\s+/).filter(Boolean), tokens, tagPrefix: text.startsWith("#") ? fold(text.slice(1)) : null };
}

export interface Match { score: number; ranges: Array<[number, number]> }
const NO_RANGES: Array<[number, number]> = [];
export function matchTitle(title: string, query: string, allowFuzzy = true, capture = true): Match | null {
	if (!query) return { score: 1, ranges: [] };
	if (query.includes(" ")) {
		const ranges: Array<[number, number]> = [];
		let score = 100;
		for (const word of query.split(/\s+/)) { const at = title.indexOf(word); if (at < 0) return null; score = Math.min(score, matchTitle(title, word, false, false)!.score); if (capture) ranges.push([at, at + word.length]); }
		ranges.sort((a, b) => a[0] - b[0]);
		const merged: Array<[number, number]> = [];
		for (const range of ranges) { const last = merged[merged.length - 1]; if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]); else merged.push(range); }
		return { score: title === query ? 100 : title.startsWith(query) ? 90 : score, ranges: merged };
	}
	const at = title.indexOf(query);
	if (at >= 0) return { score: title === query ? 100 : at === 0 ? 90 : /[^\p{L}\p{N}]/u.test(title[at - 1]) ? 80 : 60, ranges: capture ? [[at, at + query.length]] : NO_RANGES };
	if (!allowFuzzy || query.length < 3) return null;
	for (let start = 0; start < title.length; start++) {
		if (title[start] !== query[0] || (start > 0 && /[\p{L}\p{N}]/u.test(title[start - 1]))) continue;
		const ranges: Array<[number, number]> = capture ? [[start, start + 1]] : NO_RANGES;
		let pos = start, matched = 1;
		for (let i = 1; i < query.length; i++) {
			pos = title.indexOf(query[i], pos + 1);
			if (pos < 0) break;
			matched++; if (capture) ranges.push([pos, pos + 1]);
		}
		if (matched === query.length && pos - start + 1 <= query.length * 2 + 1) return { score: 40 - (pos - start + 1), ranges };
	}
	return null;
}

export interface Entry {
	kind: SearchResultKind; title: string; folded: string; path: string | null; line: number | null;
	aliases?: string[]; tags: string[]; domain: string; hue: number | null; trail: string; modified: number;
	snippet?: string;
}
export const ORDER: SearchResultKind[] = ["note", "section", "task", "brainstorm", "domain", "tag", "content"];
export const LIMITS = { note: 5, section: 4, task: 4, brainstorm: 3, domain: 3, tag: 5, content: 4 };
/** Mask syntax before taking a slice, retaining source offsets and line numbers. */
export function readableText(text: string): string {
	const blank = (value: string) => value.replace(/[^\r\n]/g, " ");
	return text
		.replace(/^(?:\uFEFF)?---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)(?:\r?\n|$)/, blank)
		.replace(/%%[\s\S]*?(?:%%|$)/g, blank)
		.replace(/<!--[\s\S]*?(?:-->|$)/g, blank)
		.replace(/!?\[\[([^\]\n]+)\]\]/g, (all, target: string) => {
			const label = target.includes("|") ? target.slice(target.indexOf("|") + 1) : target;
			const at = all.lastIndexOf(label);
			return blank(all.slice(0, at)) + label + blank(all.slice(at + label.length));
		})
		.replace(/!?\[([^\]\n]*)\]\([^\n]*?\)/g, (all, label: string) => {
			const at = all.indexOf("[") + 1;
			return blank(all.slice(0, at)) + label + blank(all.slice(at + label.length));
		})
		.replace(/^\s{0,3}(?:`{3,}|~{3,})[^\r\n]*/gm, blank)
		.replace(/^[ \t]*(?:>\s*)*(?:(?:[-+*]|\d+[.)])\s+(?:\[[^\]\r\n]\]\s*)?|#{1,6}\s+|>\s*)/gm, blank)
		.replace(/_{1,3}(?=\W|$)|(^|\W)_{1,3}|[*`~]/g, (all: string, separator: string | undefined) => {
			// Match the separator first so a neighboring marker cannot consume it before an underscore.
			return separator === undefined ? blank(all) : separator.replace(/[*`~]/g, blank) + blank(all.slice(separator.length));
		});
}
export function compactText(text: string): string { return text.replace(/[^\S\r\n]+/g, " ").replace(/^ +| +$/gm, "").trim(); }
/** Highlight every visible occurrence, merging overlapping query words. */
export function textRanges(text: string, words: readonly string[]): Array<[number, number]> {
	const folded = fold(text), ranges: Array<[number, number]> = [];
	for (const word of words) {
		if (!word) continue;
		for (let at = folded.indexOf(word); at >= 0; at = folded.indexOf(word, at + word.length)) ranges.push([at, at + word.length]);
	}
	ranges.sort((a, b) => a[0] - b[0]);
	const merged: Array<[number, number]> = [];
	for (const range of ranges) {
		const last = merged[merged.length - 1];
		if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]); else merged.push(range);
	}
	return merged;
}
export function rankBonus(entry: Entry, now: number, domain?: string): number {
	return Math.min(0.5, Math.max(0, 0.5 * (1 - (now - entry.modified) / 2592000000))) * (entry.modified > 0 ? 1 : 0) + (domain && domain === entry.domain ? 0.3 : 0);
}
export function foldedTokens(query: Query): Token[] { return query.tokens.map(token => ({ kind: token.kind, value: fold(token.value) })); }
export function accepts(entry: Entry, query: Query, tokens = foldedTokens(query)): boolean {
	for (const { kind, value } of tokens) {
		if (kind === "domain") {
			if (entry.domain !== value && !entry.domain.split(/[\s/]+/).some(part => part.startsWith(value))) return false;
		} else if (!entry.tags.some(tag => tag === value || tag.startsWith(value + "/"))) return false;
	}
	return true;
}
export function search(entries: Iterable<Entry>, query: Query, options: { filter?: SearchFilter; limit?: number; now?: number; domain?: string } = {}): SearchGroup[] {
	const groups = new Map<SearchResultKind, SearchResult[]>();
	const filter = options.filter ?? "all";
	const needle = query.words.join(" "), now = options.now ?? Date.now(), tokens = foldedTokens(query);
	for (const entry of entries) {
		if (filter === "tasks" && entry.kind !== "task" || filter === "brainstorms" && entry.kind !== "brainstorm" || filter === "notes" && !["note", "section", "content"].includes(entry.kind)) continue;
		if (tokens.length && !accepts(entry, query, tokens)) continue;
		if (query.tagPrefix !== null && entry.kind !== "tag") continue;
		let match = matchTitle(entry.folded, query.tagPrefix ?? needle, entry.kind === "note" || entry.kind === "domain", false);
		let alias = false;
		for (const value of entry.aliases ?? []) {
			const hit = matchTitle(value, needle, true, false);
			if (hit && (!match || hit.score - 1 > match.score)) { match = { score: hit.score - 1, ranges: [] }; alias = true; }
		}
		if (!match) continue;
		const score = match.score + rankBonus(entry, now, options.domain);
		const rows = groups.get(entry.kind) ?? [];
		const limit = Math.max(0, options.limit ?? (filter === "tasks" ? 14 : LIMITS[entry.kind]));
		const last = rows[rows.length - 1];
		if (!limit || rows.length >= limit && (last.score > score || last.score === score && last.title.localeCompare(entry.title) <= 0)) continue;
		const ranges = alias ? [] : matchTitle(entry.folded, query.tagPrefix ?? needle, entry.kind === "note" || entry.kind === "domain")!.ranges;
		const result: SearchResult = { kind: entry.kind, title: entry.title, path: entry.path, line: entry.line, hue: entry.hue, trail: entry.trail, ranges, score, ...(entry.snippet ? { snippet: entry.snippet } : {}) };
		let index = rows.findIndex(row => row.score < score || row.score === score && row.title.localeCompare(result.title) > 0);
		if (index < 0) index = rows.length;
		if (index < limit) { rows.splice(index, 0, result); if (rows.length > limit) rows.pop(); }
		groups.set(entry.kind, rows);
	}
	return ORDER.flatMap(kind => groups.get(kind)?.length ? [{ kind, results: groups.get(kind)! }] : []);
}

/** The text around the first word. `from`: where the body starts (after the properties); a match after it never shows them. */
export function excerpt(text: string, words: string[], radius = 100, knownOffset?: number, from = 0): { text: string; line: number } {
	const at = Math.max(0, knownOffset ?? fold(text).indexOf(words[0] ?? ""));
	const floor = from > 0 && at >= from ? from : 0;
	const start = Math.max(floor, at - radius), end = Math.min(text.length, at + (words[0]?.length ?? 0) + radius);
	return { text: (start ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : ""), line: text.slice(0, at).split("\n").length - 1 };
}
export function creationTitle(query: Query, groups: SearchGroup[]): string | null {
	return !groups.length && query.text.trim() && query.tagPrefix === null ? query.text.trim() : null;
}

/** Preserve the separator after extracting a completed filter. */
export function tokenInput(raw: string, parsed: Query): string {
	return parsed.text + (parsed.text && /\s$/.test(raw) ? " " : "");
}
/**
 * What to type at the cursor to insert a link without breaking the line it lands on: at the start
 * of a line that already holds text (a heading, a list item), the link takes a line of its own.
 */
export function linkAtCursor(line: string, ch: number, link: string, newline = "\n"): string {
	return ch === 0 && line.trim() !== "" ? link + newline : link;
}

/** Insert above the body, preserving YAML and its closing delimiter. */
export function insertLink(text: string, link: string): string {
	const header = /^(?:\uFEFF)?---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)(?:\r?\n|$)/.exec(text)?.[0] ?? "";
	const newline = text.includes("\r\n") ? "\r\n" : "\n";
	return header + (header && !header.endsWith("\n") ? newline : "") + link + newline + text.slice(header.length);
}
