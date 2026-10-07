// Pure logic of the tag picker: which tags the column offers, in which order and why, how a tag
// is shown inside a parent, what part of it matches the filter. No Obsidian here: tested in
// test/tag-picker.test.ts.

/** Why a tag ranks where it does in the column (shown in small type next to it). */
export type ChipWhy =
	| { kind: "chosen" }
	| { kind: "learned"; word: string | null }
	| { kind: "recent" }
	| { kind: "near" }
	| { kind: "parent" };

/** Rows that belong together; a thin gap separates two groups. */
export type ChipGroup = "top" | "near" | "recent" | "all" | "level" | "hits" | "new";

export interface Chip {
	tag: string;
	group: ChipGroup;
	/** A new tag, created when chosen. */
	create?: boolean;
	/** The tag has sub-tags (Tab goes into them). */
	parent?: boolean;
	suggested?: boolean;
	why?: ChipWhy;
	/** The last part of each direct sub-tag, shown in grey behind the tag. */
	kids: string[];
}

export interface ChipQuery {
	/** What is typed in the tag field. */
	filter: string;
	/** The parent tag whose sub-tags are shown (after Tab), or null. */
	level: string | null;
	/** The chosen tag, the suggested one (and the word that earned the suggestion). */
	tag: string | null;
	suggested: string | null;
	suggestedWord?: string | null;
	/** Tags of the note and of its area: before the vault. */
	near: readonly string[];
	/** Tags chosen recently, most recent first: after the near ones. */
	recent?: readonly string[];
	/** Every tag of the vault, most used first. */
	all: readonly string[];
	limit?: number;
}

const TAG_NAME = /^[\p{L}\p{N}_-]+(\/[\p{L}\p{N}_-]+)*$/u;

/** A name Obsidian accepts as a tag: letters, digits, "_", "-" and "/", with at least one character that is not a digit. */
export function isTagName(name: string): boolean {
	return TAG_NAME.test(name) && /[\p{L}_-]/u.test(name);
}

/** Letters compared without their accents, one for one (so a match keeps its place in the text). */
const foldChars = (s: string) => Array.from(s.toLowerCase(), (ch) => ch.normalize("NFD").replace(/[̀-ͯ]/g, "")[0] ?? ch).join("");

/** The tags offered in the picker, in order. The filter ignores case and accents; the tags keep their spelling. */
export function chipList(q: ChipQuery): Chip[] {
	const limit = q.limit ?? 14;
	const lower = (t: string) => t.toLowerCase();
	const recent = q.recent ?? [];
	const known = new Map<string, string>();
	for (const t of [...q.near, ...recent, ...q.all]) if (!known.has(lower(t))) known.set(lower(t), t);
	const keys = [...known.keys()];
	const folded = new Map(keys.map((k) => [k, foldChars(k)]));
	const fold = (k: string) => folded.get(k) ?? foldChars(k);
	const isParent = (key: string) => keys.some((k) => k.startsWith(key + "/"));
	const kidsOf = (key: string) => keys.filter((k) => k.startsWith(key + "/") && !k.slice(key.length + 1).includes("/")).map((k) => (known.get(k) ?? k).split("/").pop()!);
	const has = (list: readonly string[], tag: string) => list.some((t) => lower(t) === lower(tag));
	const why = (tag: string): ChipWhy | undefined => {
		if (q.tag && lower(tag) === lower(q.tag)) return { kind: "chosen" };
		if (q.suggested && lower(tag) === lower(q.suggested)) return { kind: "learned", word: q.suggestedWord ?? null };
		if (has(q.near, tag)) return { kind: "near" };
		if (has(recent, tag)) return { kind: "recent" };
		return undefined;
	};
	const chip = (tag: string, group: ChipGroup): Chip => ({ tag, group, parent: isParent(lower(tag)), suggested: !!q.suggested && lower(tag) === lower(q.suggested), why: why(tag), kids: kidsOf(lower(tag)) });
	const typed = lower(q.filter.trim().replace(/^#/, ""));
	const f = foldChars(typed);
	const out: Chip[] = [];
	const seen = new Set<string>();
	const push = (tag: string | null | undefined, group: ChipGroup) => {
		if (!tag || seen.has(lower(tag))) return;
		seen.add(lower(tag));
		out.push(chip(known.get(lower(tag)) ?? tag, group));
	};
	if (f) {
		const scope = q.level ? keys.filter((k) => k.startsWith(lower(q.level!) + "/")) : [];
		const tier = (k: string) => (fold(k).startsWith(f) ? 0 : fold(k).split("/").some((p) => p.startsWith(f)) ? 1 : fold(k).includes(f) ? 2 : 3);
		const order = (list: string[]) => list.filter((k) => tier(k) < 3).sort((a, b) => tier(a) - tier(b) || Number(fold(b) === f) - Number(fold(a) === f));
		for (const k of [...order(scope), ...order(keys)]) push(k, "hits");
		// The new name keeps what was typed (lowercased); none is offered when a tag spelled like it exists.
		const full = q.level && !typed.includes("/") ? lower(q.level) + "/" + typed : typed.replace(/\/+$/, "");
		const result = out.slice(0, limit);
		if (!keys.some((k) => fold(k) === foldChars(full)) && isTagName(full)) result.push({ tag: full, group: "new", create: true, kids: [] });
		return result;
	}
	if (q.level) {
		push(q.level, "level");
		if (out.length) out[0].why = { kind: "parent" };
		for (const k of keys.filter((k) => k.startsWith(lower(q.level!) + "/") && !k.slice(q.level!.length + 1).includes("/"))) push(k, "level");
		for (const k of keys.filter((k) => k.startsWith(lower(q.level!) + "/"))) push(k, "level");
		return out.slice(0, limit);
	}
	push(q.tag, "top");
	push(q.suggested, "top");
	for (const t of q.near) push(t, "near");
	for (const t of recent) push(t, "recent");
	for (const t of q.all) if (!t.includes("/")) push(t, "all");
	return out.slice(0, limit);
}

/**
 * The name shown for a tag in the column: inside a parent (`level`), its direct sub-tags lose the
 * parent's prefix ("car" for home/car under home); anything else keeps its full path.
 */
export function shownName(tag: string, level: string | null): string {
	if (level && tag.toLowerCase().startsWith(level.toLowerCase() + "/")) return tag.slice(level.length + 1);
	return tag;
}

/** The pieces of a tag name, the part that matches the filter marked (accents and case ignored). */
export function highlight(text: string, filter: string): Array<{ text: string; hit: boolean }> {
	const f = foldChars(filter.trim().replace(/^#/, ""));
	if (!f) return [{ text, hit: false }];
	const at = foldChars(text).indexOf(f);
	if (at < 0) return [{ text, hit: false }];
	const out: Array<{ text: string; hit: boolean }> = [];
	if (at > 0) out.push({ text: text.slice(0, at), hit: false });
	out.push({ text: text.slice(at, at + f.length), hit: true });
	if (at + f.length < text.length) out.push({ text: text.slice(at + f.length), hit: false });
	return out;
}
