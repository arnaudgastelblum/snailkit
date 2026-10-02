import type { SearchIndex } from "../search/SearchIndex";
import type { Availability } from "../types/host";
import type { SlashItem, SlashMenuSettings } from "../types/settings";

export interface MenuRow {
	item: SlashItem;
	availability: Availability;
	/** Indices of characters of item.name to highlight. */
	matches: number[];
	/** Category name shown discreetly on the right (search results). */
	categoryLabel?: string;
}

export interface MenuSection {
	/** Section title; undefined for a list without header. */
	title?: string;
	kind: "pinned" | "recent" | "category" | "results";
	rows: MenuRow[];
}

export interface MenuModelInput {
	settings: SlashMenuSettings;
	index: SearchIndex;
	query: string;
	availability: (item: SlashItem) => Availability;
	labels: { pinned: string; recent: string };
}

/**
 * Builds what the menu shows. Without a query: Pinned, Recent, then each
 * visible category. With a query: one ranked list.
 */
export function buildMenuModel({ settings, index, query, availability, labels }: MenuModelInput): MenuSection[] {
	const hiddenCats = new Set(settings.categories.filter((c) => c.hidden).map((c) => c.id));
	const catNames = new Map(settings.categories.map((c) => [c.id, c.name]));
	const cache = new Map<string, Availability>();
	const avail = (item: SlashItem): Availability => {
		let a = cache.get(item.id);
		if (!a) cache.set(item.id, (a = availability(item)));
		return a;
	};
	const visible = (item: SlashItem) => item.enabled && !hiddenCats.has(item.categoryId) && (settings.unavailableDisplay === "dim" || avail(item).available);
	const row = (item: SlashItem, matches: number[] = [], categoryLabel?: string): MenuRow => ({ item, availability: avail(item), matches, categoryLabel });

	const q = query.trim();
	if (q) {
		const results = index.search(q, visible, settings.maxResults);
		// Available entries first, the ranking decides inside each group.
		results.sort((a, b) => Number(avail(b.item).available) - Number(avail(a.item).available));
		return results.length
			? [{ kind: "results", rows: results.map((r) => row(r.item, r.nameMatches, settings.showCategories ? catNames.get(r.item.categoryId) : undefined)) }]
			: [];
	}

	const sections: MenuSection[] = [];
	const byId = new Map(settings.items.map((i) => [i.id, i]));

	if (settings.showPinned) {
		const pinned = settings.items.filter((i) => i.pinned && visible(i));
		if (pinned.length) sections.push({ kind: "pinned", title: labels.pinned, rows: pinned.map((i) => row(i)) });
	}
	if (settings.showRecent) {
		// Pinned entries already sit at the top: recent never pushes them out.
		const recent = settings.recent
			.map((id) => byId.get(id))
			.filter((i): i is SlashItem => !!i && visible(i) && !(settings.showPinned && i.pinned))
			.slice(0, settings.maxRecent);
		if (recent.length) sections.push({ kind: "recent", title: labels.recent, rows: recent.map((i) => row(i)) });
	}

	if (settings.showCategories) {
		for (const cat of settings.categories) {
			if (cat.hidden) continue;
			const rows = settings.items.filter((i) => i.categoryId === cat.id && visible(i)).map((i) => row(i));
			if (rows.length) sections.push({ kind: "category", title: cat.name, rows });
		}
	} else {
		const order = new Map(settings.categories.map((c, i) => [c.id, i]));
		const all = settings.items.filter(visible).sort((a, b) => (order.get(a.categoryId) ?? 0) - (order.get(b.categoryId) ?? 0));
		if (all.length) sections.push({ kind: "category", rows: all.map((i) => row(i)) });
	}
	return sections;
}
