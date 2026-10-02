// Pure helpers: heading cache in, contents entries out. No Obsidian runtime needed.
import type { HeadingCache } from "obsidian";

export interface TocEntry {
	/** 0-based line of the heading in the file. */
	line: number;
	/** Markdown level, 1 to 6. */
	level: number;
	/** Indent relative to the shallowest listed heading (0 = top). */
	depth: number;
	/** Display text, inline Markdown removed. */
	text: string;
}

/** Headings up to `maxLevel`, indented relative to the shallowest one listed. */
export function buildToc(headings: HeadingCache[] | undefined | null, maxLevel: number, untitled = "(untitled)"): TocEntry[] {
	const kept = (headings ?? []).filter((h) => h.level <= maxLevel);
	if (!kept.length) return [];
	const min = Math.min(...kept.map((h) => h.level));
	return kept.map((h) => ({
		line: h.position.start.line,
		level: h.level,
		depth: h.level - min,
		text: plainHeading(h.heading) || untitled,
	}));
}

/** Strips the inline Markdown a heading may carry: links, emphasis, code, highlights. Tags are kept. */
export function plainHeading(text: string): string {
	return text
		.replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
		.replace(/!?\[\[([^\]]*)\]\]/g, (_m, target: string) => target.replace(/#\^?/g, " > "))
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__|==|~~)(.+?)\1/g, "$2")
		.replace(/(^|[^\w*])[*_]([^*_]+)[*_](?=$|[^\w*])/g, "$1$2")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Index of the "current" entry: the last heading whose top is at or above `scrollTop + offset`.
 * At the very bottom of the note, the last heading that is on screen wins (short final sections).
 * `tops` are in the same coordinates as `scrollTop`; null tops are skipped.
 */
export function currentIndex(tops: (number | null)[], scrollTop: number, viewport: number, maxScroll: number, offset = 90): number {
	let idx = -1;
	const line = scrollTop + offset;
	for (let i = 0; i < tops.length; i++) {
		const t = tops[i];
		if (t !== null && t <= line) idx = i;
	}
	if (maxScroll > 0 && scrollTop >= maxScroll - 2) {
		for (let i = tops.length - 1; i > idx; i--) {
			const t = tops[i];
			if (t !== null && t < scrollTop + viewport) return i;
		}
	}
	return idx;
}
