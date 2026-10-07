// Pure line processing and note naming, independent of Obsidian.
export const HEADING_RE = /^(#{1,6})\s+(.*)$/;
export const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
const ZONE_LINK_RE = /^- \[\[([^\]]+)\]\]\s*$/;
// Beyond the OS-forbidden characters, # ^ [ ] would break the [[wikilink]]
// syntax of the links this plugin writes.
const FORBIDDEN_CHARS_RE = /[\\/:*?"<>|#^[\]]/g;

// ---------------------------------------------------------------- utilities

export function sanitizeFilename(name: string) {
	return name
		.replace(FORBIDDEN_CHARS_RE, "-")
		.replace(/\s+/g, " ")
		.replace(/^[\s.]+|[\s.]+$/g, "");
}

// state[i] = true when line i sits inside a code fence opened on an earlier
// line. state has lines.length + 1 entries: the last one is the state right
// after the final line, so a selection ending on a fence opener is caught.
export function fenceStates(lines: readonly string[]) {
	const state = new Array<boolean>(lines.length + 1).fill(false);
	let inside = false;
	let marker = "";
	for (let i = 0; i < lines.length; i++) {
		state[i] = inside;
		const m = lines[i].match(FENCE_RE);
		if (m) {
			if (!inside) {
				inside = true;
				marker = m[1];
			} else if (
				// CommonMark: the closing fence uses the same character, is at
				// least as long as the opening one, and has no info string.
				m[1][0] === marker[0] &&
				m[1].length >= marker.length &&
				m[2].trim() === ""
			) {
				inside = false;
				marker = "";
			}
		}
	}
	state[lines.length] = inside;
	return state;
}

export function frontmatterEnd(lines: readonly string[]) {
	if (lines[0] !== "---") return -1;
	for (let i = 1; i < lines.length; i++) {
		// Column 0 only: an indented "---" (e.g. inside a YAML block scalar)
		// does not close the frontmatter in Obsidian.
		if (/^---[ \t]*$/.test(lines[i])) return i;
	}
	return -1;
}

// The link zone: consecutive "- [[...]]" lines right after the frontmatter
// (and after a leading H1 title, if any). Returns line indexes into `lines`.
export function findZone(lines: readonly string[]) {
	let i = frontmatterEnd(lines) + 1;
	while (i < lines.length && lines[i].trim() === "") i++;
	if (i < lines.length && /^#\s/.test(lines[i])) {
		i++;
		while (i < lines.length && lines[i].trim() === "") i++;
	}
	const zoneStart = i;
	const links = [];
	while (i < lines.length) {
		const m = lines[i].match(ZONE_LINK_RE);
		if (!m) break;
		links.push(m[1].split("|")[0].split("#")[0].trim());
		i++;
	}
	return { zoneStart, zoneEnd: i, links };
}

// Title suggested for the sub-note: first heading of the block, else the
// first words of the first non-empty line.
export function proposeTitle(lines: readonly string[]) {
	const state = fenceStates(lines);
	for (let i = 0; i < lines.length; i++) {
		if (state[i]) continue;
		const m = lines[i].match(HEADING_RE);
		if (m) return m[2].trim();
	}
	let firstText = "";
	for (let i = 0; i < lines.length; i++) {
		if (state[i] || FENCE_RE.test(lines[i]) || lines[i].trim() === "") continue;
		firstText = lines[i];
		break;
	}
	if (!firstText) return "";
	return firstText
		.replace(/[#>*`[\]]/g, "")
		.replace(/^\s*(?:[-+]|\d+\.)\s+/, "")
		.trim()
		.split(/\s+/)
		.slice(0, 6)
		.join(" ")
		.slice(0, 60);
}

// Text of the block's leading heading (first non-blank line), or null.
export function leadingHeadingText(lines: readonly string[]) {
	const first = lines.find((l) => l.trim() !== "");
	const m = first ? first.match(HEADING_RE) : null;
	return m ? m[2].trim() : null;
}

// Body of the new sub-note. dropHeading is true only when the sub-note title
// reuses the block's leading heading: the heading then becomes the file name,
// so it is dropped and the remaining headings are promoted one level. With a
// custom title the heading is kept: dropping it would lose its text.
export function prepareSubnoteBody(lines: readonly string[], dropHeading: boolean) {
	const body = [...lines];
	while (body.length && body[0].trim() === "") body.shift();
	while (body.length && body[body.length - 1].trim() === "") body.pop();
	if (!body.length) return "";
	if (dropHeading && HEADING_RE.test(body[0])) {
		body.shift();
		while (body.length && body[0].trim() === "") body.shift();
		const state = fenceStates(body);
		for (let i = 0; i < body.length; i++) {
			if (state[i]) continue;
			const h = body[i].match(HEADING_RE);
			if (h && h[1].length > 1) {
				body[i] = "#".repeat(h[1].length - 1) + " " + h[2];
			}
		}
	}
	return body.join("\n");
}

export function trimmedBody(lines: readonly string[]) {
	const body = [...lines];
	while (body.length && body[0].trim() === "") body.shift();
	while (body.length && body[body.length - 1].trim() === "") body.pop();
	return body.join("\n");
}

// Path of the note to create from what was typed in the "Append to" dialog.
// A plain name goes next to the origin note; "Folder/Name" is taken from the
// vault root. Each part is cleaned like any file name. null if nothing left.
export function newNotePath(query: string, originFile: { parent: { path: string } | null }) {
	const q = query.trim().replace(/\.md$/i, "");
	const fromRoot = q.includes("/");
	const parts = q
		.split("/")
		.map((part) => sanitizeFilename(part))
		.filter(Boolean);
	if (!parts.length) return null;
	if (!fromRoot) {
		const parent = originFile.parent;
		if (parent && parent.path && parent.path !== "/") parts.unshift(parent.path);
	}
	return parts.join("/") + ".md";
}

// The nearest heading owns the section, including its deeper subsections.
export function sectionBounds(lines: readonly string[], cursor: number): { start: number; end: number } | null {
	const state = fenceStates(lines);
	let start = -1;
	let level = 0;
	for (let i = Math.min(cursor, lines.length - 1); i >= 0; i--) {
		if (state[i]) continue;
		const heading = lines[i].match(HEADING_RE);
		if (heading) {
			start = i;
			level = heading[1].length;
			break;
		}
	}
	if (start === -1) return null;
	for (let i = start + 1; i < lines.length; i++) {
		if (state[i]) continue;
		const heading = lines[i].match(HEADING_RE);
		if (heading && heading[1].length <= level) return { start, end: i - 1 };
	}
	return { start, end: lines.length - 1 };
}

export interface Position { line: number; ch: number }
export interface Insertion { text: string; from: Position }

// Return an editor insertion without tying the line logic to Obsidian.
export function linkZoneInsertion(lines: readonly string[], target: string): Insertion | null {
	const { zoneStart, zoneEnd, links } = findZone(lines);
	if (links.includes(target)) return null;
	const text = "- [[" + target + "]]";
	if (zoneEnd >= lines.length) {
		const last = lines.length - 1;
		return { text: "\n" + text, from: { line: last, ch: lines[last].length } };
	}
	const blank = zoneStart === zoneEnd && lines[zoneEnd].trim() !== "";
	return { text: text + "\n" + (blank ? "\n" : ""), from: { line: zoneEnd, ch: 0 } };
}

export function isArchiveBasename(name: string, origin: string, suffixes: readonly string[]): boolean {
	return suffixes.some((suffix) => name === sanitizeFilename(origin + suffix));
}

export function formatProvenance(template: string, origin: string, date: string): string {
	return template.replace(/\{(origin|date)\}/g, (_, key: string) => key === "origin" ? origin : date);
}
