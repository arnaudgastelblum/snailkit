import type { App, TFile } from "obsidian";
import { getAllTags } from "obsidian";

/** Removes the optional hash and surrounding whitespace; rejects invalid tag paths. */
export function normalizeTagName(raw: string): string | null {
	const tag = raw.trim().replace(/^#/, "");
	return /^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(tag) && !/^\p{N}+$/u.test(tag) ? tag : null;
}

/** Maps a tag or descendant, preserving the spelling of its suffix. */
export function renamedTag(tag: string, from: string, to: string): string | null {
	const name = normalizeTagName(tag);
	const source = normalizeTagName(from);
	const target = normalizeTagName(to);
	if (!name || !source || !target) return null;
	const lower = name.toLowerCase();
	const prefix = source.toLowerCase();
	if (lower === prefix) return target;
	// Find the slash in the original spelling: Unicode case folding can change length.
	for (let at = name.indexOf("/"); at >= 0; at = name.indexOf("/", at + 1)) {
		if (name.slice(0, at).toLowerCase() === prefix) return target + name.slice(at);
	}
	return null;
}

interface Edit { start: number; end: number; value: string }

/** Renames real tag occurrences without serializing Markdown or YAML. Invalid inputs do nothing. */
export function renameTagInText(text: string, from: string, to: string): { text: string; count: number } {
	return renameText(text, from, to);
}

function renameText(text: string, from: string, to: string, onRename?: (tag: string) => void): { text: string; count: number } {
	const source = normalizeTagName(from);
	const target = normalizeTagName(to);
	if (!source || !target) return { text, count: 0 };
	const edits: Edit[] = [];
	const replace = (start: number, end: number) => {
		const tag = text.slice(start, end);
		const value = renamedTag(tag, source, target);
		if (value !== null && value !== tag) {
			edits.push({ start, end, value });
			onRename?.(value);
		}
	};
	let body = 0;
	const frontmatter = /^(?:\uFEFF)?---[^\S\r\n]*\r?\n[\s\S]*?^(?:---|\.\.\.)[^\S\r\n]*(?:\r?\n|$)/m.exec(text);
	if (frontmatter?.index === 0) {
		body = frontmatter[0].length;
		frontmatterTags(text.slice(0, body), replace);
	}
	const references = new Set(Array.from(text.slice(body).matchAll(/^[\t ]{0,3}\[([^\]\r\n]+)\]:/gm), (match) => match[1].trim().replace(/\s+/g, " ").toLowerCase()));

	// Consume constructs in document order: fence markers inside comments are just text.
	for (let at = body; at < text.length;) {
		if (at === body || text[at - 1] === "\n") {
			const fence = /^[\t >]*(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/.exec(text.slice(at));
			if (fence) {
				at += fence[0].length;
				for (const line of text.slice(at).matchAll(/[^\n]*(?:\n|$)/g)) {
					at += line[0].length;
					const close = /^[\t >]*(`{3,}|~{3,})[^\S\r\n]*(?:\r?\n|$)$/.exec(line[0]);
					if (close && close[1][0] === fence[1][0] && close[1].length >= fence[1].length) break;
				}
				continue;
			}
		}
		if (text[at] === "\\") { at += 2; continue; }
		const rest = text.slice(at);
		const comment = rest.startsWith("<!--") ? ["<!--", "-->"] : rest.startsWith("%%") ? ["%%", "%%"] : null;
		if (comment) {
			const end = text.indexOf(comment[1], at + comment[0].length);
			at = end < 0 ? text.length : end + comment[1].length;
			continue;
		}
		if (text[at] === "`") {
			const ticks = /^`+/.exec(rest)![0];
			let end = at + ticks.length;
			let close = -1;
			while (end < text.length) {
				if (text[end - 1] === "\n" && /^[\t >]*(`{3,}|~{3,})/.test(text.slice(end))) break;
				if (text[end] !== "`") { end++; continue; }
				const run = /^`+/.exec(text.slice(end))![0];
				if (run.length === ticks.length) { close = end + run.length; break; }
				end += run.length;
			}
			at = close < 0 ? at + ticks.length : close;
			continue;
		}
		if (rest.startsWith("[[")) {
			const end = text.indexOf("]]", at + 2);
			at = end < 0 ? text.length : end + 2;
			continue;
		}
		if (text[at] === "[") {
			const label = balancedEnd(text, at, "[", "]");
			if (label > at) {
				const next = text[label];
				const reference = text.slice(at + 1, label - 1).trim().replace(/\s+/g, " ").toLowerCase();
				if (next !== "(" && next !== "[" && next !== ":" && !references.has(reference)) { at++; continue; }
				const end = next === "(" ? balancedEnd(text, label, "(", ")") : next === "[" ? balancedEnd(text, label, "[", "]") : label;
				// Also protect shortcut reference links and reference definitions.
				at = end > label ? end : label;
				if (text[at] === ":") {
					const newline = text.indexOf("\n", at);
					at = newline < 0 ? text.length : newline;
				}
				continue;
			}
		}
		const url = /^(?:[a-z][a-z\d+.-]*:\/\/|mailto:|www\.|(?:[\p{L}\p{N}-]+\.)+[a-z]{2,}(?=[/:?#]))[^\s<>]*/iu.exec(rest);
		if (url) { at += url[0].length; continue; }
		if (text[at] === "#" && !/[\p{L}\p{N}_/#\\-]$/u.test(text.slice(Math.max(0, at - 2), at))) {
			const tag = /^#([\p{L}\p{N}_-][\p{L}\p{N}_/-]*)/u.exec(rest);
			if (tag) {
				replace(at + 1, at + tag[0].length);
				at += tag[0].length;
				continue;
			}
		}
		at++;
	}
	let result = "";
	let last = 0;
	for (const edit of edits.sort((a, b) => a.start - b.start)) {
		result += text.slice(last, edit.start) + edit.value;
		last = edit.end;
	}
	return { text: result + text.slice(last), count: edits.length };
}

/** Returns the first position after a balanced link label or destination. */
function balancedEnd(text: string, start: number, open: string, close: string): number {
	let depth = 0;
	for (let at = start; at < text.length; at++) {
		if (text[at] === "\\") { at++; continue; }
		if (text[at] === open) depth++;
		if (text[at] === close && --depth === 0) return at + 1;
	}
	return -1;
}

/** Reads only top-level tag properties; offsets always refer to the original bytes. */
function frontmatterTags(text: string, replace: (start: number, end: number) => void): void {
	const scalar = (value: string, offset: number): void => {
		const leading = value.length - value.trimStart().length;
		value = value.trim();
		offset += leading;
		if (!value) return;
		if ((value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
			scalar(value.slice(1, -1), offset + 1);
			return;
		}
		if (value.includes(",")) {
			let at = 0;
			for (const part of value.split(",")) { scalar(part, offset + at); at += part.length + 1; }
			return;
		}
		if (value.startsWith("#")) { value = value.slice(1); offset++; }
		if (normalizeTagName(value) === value) replace(offset, offset + value.length);
	};
	// Split flow entries outside quotes, keeping quoted hashes and trailing YAML comments.
	const values = (value: string, offset: number): void => {
		let quote = "";
		let start = 0;
		for (let at = 0; at <= value.length; at++) {
			const c = value[at];
			if (quote) {
				if (c === "\\" && quote === '"') at++;
				else if (c === quote) quote = "";
				continue;
			}
			if (c === '"' || c === "'") { quote = c; continue; }
			if (c === "#" && (at === start || /\s/.test(value[at - 1])) && (value.slice(start, at).trim() || /\s/.test(value[at + 1] ?? ""))) {
				scalar(value.slice(start, at), offset + start);
				const newline = value.indexOf("\n", at);
				if (newline < 0) return;
				at = newline;
				start = at + 1;
			} else if (c === "," || at === value.length) {
				scalar(value.slice(start, at), offset + start);
				start = at + 1;
			}
		}
	};
	let list = false;
	let flowStart = -1;
	for (const line of text.matchAll(/[^\n]*(?:\n|$)/g)) {
		if (flowStart >= 0) {
			const end = line[0].indexOf("]");
			if (end >= 0) { values(text.slice(flowStart, line.index + end), flowStart); flowStart = -1; }
			continue;
		}
		const key = /^(?:tags|tag|'tags'|'tag'|"tags"|"tag")[\t ]*:[\t ]*(.*?)(?:\r?\n)?$/.exec(line[0]);
		if (key) {
			const value = key[1];
			const offset = line.index + line[0].indexOf(":") + 1 + (/^[\t ]*/.exec(line[0].slice(line[0].indexOf(":") + 1))![0].length);
			list = !value.trim() || value.startsWith("# ");
			if (value.startsWith("[")) {
				const end = value.indexOf("]");
				if (end >= 0) values(value.slice(1, end), offset + 1);
				else flowStart = offset + 1;
			} else if (!list) values(value, offset);
			continue;
		}
		if (list) {
			const item = /^([\t ]*-[\t ]+)(.*?)(?:\r?\n)?$/.exec(line[0]);
			if (item) values(item[2], line.index + item[1].length);
			else if (line[0].trim() && !/^\s*#/.test(line[0])) list = false;
		}
	}
}

export interface TagRenamePlan {
	/** Files with actual replacements, in vault order. */
	files: { path: string; count: number }[];
	total: number;
	/** Whether a target tag already exists; case-only renames are not merges. */
	merges: boolean;
}

function indexedTags(app: App): { file: TFile; tags: string[] }[] {
	return app.vault.getMarkdownFiles().map((file) => {
		const cache = app.metadataCache.getFileCache(file);
		return { file, tags: cache ? (getAllTags(cache) ?? []).map((tag) => normalizeTagName(tag)).filter((tag): tag is string => tag !== null) : [] };
	});
}

/** Uses the metadata index for candidates, then counts replacements in the real contents. */
export async function planTagRename(app: App, from: string, to: string): Promise<TagRenamePlan> {
	const plan: TagRenamePlan = { files: [], total: 0, merges: false };
	const source = normalizeTagName(from);
	const target = normalizeTagName(to);
	if (!source || !target) return plan;
	const index = indexedTags(app);
	const existing = new Set(index.flatMap(({ tags }) => tags.map((tag) => tag.toLowerCase())));
	for (const { file, tags } of index) {
		if (!tags.some((tag) => renamedTag(tag, source, target) !== null)) continue;
		const mapped: string[] = [];
		const { count } = renameText(await app.vault.cachedRead(file), source, target, (tag) => mapped.push(tag));
		if (!count) continue;
		plan.files.push({ path: file.path, count });
		plan.total += count;
		if (source.toLowerCase() !== target.toLowerCase()) {
			plan.merges ||= existing.has(target.toLowerCase()) || mapped.some((tag) => existing.has(tag.toLowerCase()));
		}
	}
	return plan;
}

export interface TagRenameResult {
	files: number;
	total: number;
	/** Restores only files whose current content still equals what this operation wrote. */
	undo(): Promise<number>;
}

/** Recomputes each replacement inside vault.process, including the undo comparison. */
export async function applyTagRename(app: App, from: string, to: string): Promise<TagRenameResult> {
	const changed: { file: TFile; before: string; after: string }[] = [];
	let total = 0;
	if (normalizeTagName(from) && normalizeTagName(to)) {
		for (const { file, tags } of indexedTags(app)) {
			if (!tags.some((tag) => renamedTag(tag, from, to) !== null)) continue;
			let change: { file: TFile; before: string; after: string } | undefined;
			let count = 0;
			await app.vault.process(file, (before) => {
				const result = renameTagInText(before, from, to);
				count = result.count;
				change = count ? { file, before, after: result.text } : undefined;
				return result.text;
			});
			if (change) { changed.push(change); total += count; }
		}
	}
	return {
		files: changed.length,
		total,
		async undo() {
			let restored = 0;
			for (const change of changed) {
				let matches = false;
				try {
					await app.vault.process(change.file, (current) => {
						matches = current === change.after;
						return matches ? change.before : current;
					});
					if (matches) restored++;
				} catch {
					// A removed or inaccessible file must not prevent restoring the others.
				}
			}
			return restored;
		},
	};
}
