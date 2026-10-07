// Tags as the Home shows them: families (the first part of a tag) sorted by use, each with its
// sub-tags one level down; matching a tag and its sub-tags. Case is ignored, as Obsidian does. Pure.

export interface TagCount {
	/** Without "#", as first written. */
	tag: string;
	/** Uses of this tag and every tag below it. */
	count: number;
}

export interface TagFamily extends TagCount {
	/** One level down ("project/website"), each counting its own sub-tags, sorted by use. */
	kids: TagCount[];
}

const clean = (tag: string) => tag.replace(/^#/, "").trim();
export const foldTag = (tag: string) => clean(tag).toLowerCase();

/** Families from metadataCache.getTags() ({ "#tag": uses }), most used first, then by name. */
export function tagFamilies(counts: Record<string, number>): TagFamily[] {
	const families = new Map<string, { tag: string; count: number; kids: Map<string, TagCount> }>();
	for (const [raw, uses] of Object.entries(counts)) {
		const tag = clean(raw);
		if (!tag || !Number.isFinite(uses) || uses <= 0) continue;
		const parts = tag.split("/").filter(Boolean);
		if (!parts.length) continue;
		const key = parts[0].toLowerCase();
		let family = families.get(key);
		if (!family) families.set(key, (family = { tag: parts[0], count: 0, kids: new Map() }));
		family.count += uses;
		if (parts.length > 1) {
			const kidKey = `${key}/${parts[1].toLowerCase()}`;
			const kid = family.kids.get(kidKey);
			if (kid) kid.count += uses;
			else family.kids.set(kidKey, { tag: `${family.tag}/${parts[1]}`, count: uses });
		}
	}
	const byUse = (a: TagCount, b: TagCount) => b.count - a.count || a.tag.localeCompare(b.tag);
	return [...families.values()].map((f) => ({ tag: f.tag, count: f.count, kids: [...f.kids.values()].sort(byUse) })).sort(byUse);
}

/** True when `tags` hold `tag` or one of its sub-tags. */
export function hasTag(tags: readonly string[], tag: string): boolean {
	const want = foldTag(tag);
	return tags.some((t) => {
		const have = foldTag(t);
		return have === want || have.startsWith(want + "/");
	});
}

/** The sub-tags of a family, any depth, as written ("project/website"), sorted by use. */
export function familyTags(counts: Record<string, number>, family: string): TagCount[] {
	const root = foldTag(family).split("/")[0];
	const out = new Map<string, TagCount>();
	for (const [raw, uses] of Object.entries(counts)) {
		const tag = clean(raw);
		const key = tag.toLowerCase();
		if (!key.startsWith(root + "/") || uses <= 0) continue;
		const known = out.get(key);
		if (known) known.count += uses;
		else out.set(key, { tag, count: uses });
	}
	return [...out.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** The last part of a tag ("website" for "project/website"). */
export function leafOf(tag: string): string {
	const parts = clean(tag).split("/");
	return parts[parts.length - 1] || clean(tag);
}
