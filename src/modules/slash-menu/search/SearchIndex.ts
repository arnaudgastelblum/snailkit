import type { SlashCategory, SlashItem } from "../types/settings";

/** Lowercase, no diacritics ("Détails" -> "details"), collapsed spaces. */
export function normalize(s: string): string {
	return s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

// Match strength, best first. Final score = strength * field weight.
const EXACT = 100;
const PREFIX = 80;
const WORD_PREFIX = 62;
const SUBSTRING = 40;
const FUZZY_MAX = 30;

const WEIGHT = { name: 1, alias: 0.96, keyword: 0.72, category: 0.5 };

interface Entry {
	item: SlashItem;
	order: number;
	name: string;
	aliases: string[];
	keywords: string[];
	category: string;
}

export interface SearchResult {
	item: SlashItem;
	score: number;
	/** Indices of matched characters in item.name, for highlighting. */
	nameMatches: number[];
}

/**
 * Scores `query` against `text`. Returns 0 when there is no match.
 * exact > prefix > word prefix > substring > fuzzy (subsequence).
 */
export function matchScore(query: string, text: string, lengthBonus = false): number {
	if (!query || !text) return 0;
	if (text === query) return EXACT;
	// The bonus favors "Table" over "Table of contents" for "tab"; only used on names,
	// so that aliases/keywords never reorder entries the user sorted by hand.
	if (text.startsWith(query)) return PREFIX + (lengthBonus ? Math.min(10, (query.length / text.length) * 10) : 0);
	const words = text.split(/[\s\-_/:.]+/);
	if (words.some((w) => w.startsWith(query))) return WORD_PREFIX;
	if (text.includes(query)) return SUBSTRING;
	return fuzzyScore(query, text);
}

/** Subsequence match; tighter matches score higher. */
export function fuzzyScore(query: string, text: string): number {
	if (query.length < 2) return 0;
	let ti = 0;
	let first = -1;
	let gaps = 0;
	let last = -1;
	for (const ch of query) {
		const found = text.indexOf(ch, ti);
		if (found < 0) return 0;
		if (first < 0) first = found;
		if (last >= 0) gaps += found - last - 1;
		last = found;
		ti = found + 1;
	}
	const span = last - first + 1;
	const compactness = query.length / span;
	// Very scattered matches are noise.
	if (compactness < 0.34) return 0;
	return Math.max(1, FUZZY_MAX * compactness - gaps * 0.5 - first * 0.3);
}

/** Character indices of `query` inside `name` (for bold highlighting). */
export function highlightIndices(query: string, name: string): number[] {
	if (!query) return [];
	const norm = normalize(name);
	// normalize() keeps one char per char for Latin text, except collapsed spaces;
	// good enough for highlighting, and we bail out when lengths differ.
	if (norm.length !== name.length) return [];
	const at = norm.indexOf(query);
	if (at >= 0) return Array.from({ length: query.length }, (_, i) => at + i);
	const out: number[] = [];
	let ti = 0;
	for (const ch of query) {
		if (ch === " ") continue;
		const found = norm.indexOf(ch, ti);
		if (found < 0) return [];
		out.push(found);
		ti = found + 1;
	}
	return out;
}

/**
 * Precomputed search index over the menu items. Build it once per settings
 * change; search() then only walks small arrays of normalized strings.
 */
export class SearchIndex {
	private entries: Entry[] = [];

	build(items: SlashItem[], categories: SlashCategory[]): void {
		const catName = new Map(categories.map((c) => [c.id, normalize(c.name)]));
		this.entries = items.map((item, order) => ({
			item,
			order,
			name: normalize(item.name),
			aliases: item.aliases.map(normalize).filter(Boolean),
			keywords: item.keywords.map(normalize).filter(Boolean),
			category: catName.get(item.categoryId) ?? "",
		}));
	}

	get size(): number {
		return this.entries.length;
	}

	search(rawQuery: string, accept: (item: SlashItem) => boolean, limit: number): SearchResult[] {
		const query = normalize(rawQuery);
		const results: (SearchResult & { order: number })[] = [];
		for (const e of this.entries) {
			if (!accept(e.item)) continue;
			const score = query ? scoreEntry(query, e) : 1;
			if (score <= 0) continue;
			results.push({ item: e.item, score, order: e.order, nameMatches: highlightIndices(query, e.item.name) });
		}
		results.sort((a, b) => b.score - a.score || a.order - b.order);
		return results.slice(0, limit).map(({ item, score, nameMatches }) => ({ item, score, nameMatches }));
	}
}

function bestFieldScore(query: string, e: Entry): number {
	let best = matchScore(query, e.name, true) * WEIGHT.name;
	for (const a of e.aliases) best = Math.max(best, matchScore(query, a) * WEIGHT.alias);
	for (const k of e.keywords) {
		// Fuzzy on keywords creates too much noise: only real matches count.
		const s = matchScore(query, k);
		if (s > FUZZY_MAX) best = Math.max(best, s * WEIGHT.keyword);
	}
	const c = matchScore(query, e.category);
	if (c > FUZZY_MAX) best = Math.max(best, c * WEIGHT.category);
	return best;
}

function scoreEntry(query: string, e: Entry): number {
	const whole = bestFieldScore(query, e);
	if (!query.includes(" ")) return whole;
	// Multi-word query ("callout warn"): every word must match somewhere.
	const words = query.split(" ").filter(Boolean);
	let sum = 0;
	for (const w of words) {
		const s = bestFieldScore(w, e);
		if (s <= 0) return whole;
		sum += s;
	}
	return Math.max(whole, (sum / words.length) * 0.9);
}
