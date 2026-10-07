// The arrangement of the domains on the Home: which blocks exist (each domain, plus the sub-MOCs
// the user pulled out), their order, the featured one, the groups and what is hidden. Kept in the
// settings (never in the notes), followed through renames and deletions. Pure: every change
// returns a new Arrangement, the caller saves it.
import type { World } from "./world";

export interface Arrangement {
	/** Blocks the user placed, in their order; the others follow, most recently active first. */
	domainOrder: string[];
	featured: string;
	/** [group id, name], in order. */
	groups: Array<[string, string]>;
	/** [block path, group id]. */
	domainGroups: Array<[string, string]>;
	hidden: string[];
	/** Sub-MOCs shown as their own block. */
	pulledOut: string[];
}

export const EMPTY_ARRANGEMENT: Arrangement = { domainOrder: [], featured: "", groups: [], domainGroups: [], hidden: [], pulledOut: [] };

export interface Block {
	/** The block's note: a domain, or a pulled-out sub-MOC. */
	id: string;
	kind: "domain" | "pulled";
	/** The domain it belongs to (itself for a domain). */
	domain: string;
}

export interface Section {
	/** The group, or null for the domains in no group. */
	group: { id: string; name: string } | null;
	blocks: Block[];
}

export interface Layout {
	featured: Block | null;
	/** The user's groups in their order (those with a visible block), then the domains in no group. */
	sections: Section[];
	hidden: Block[];
	/** Every live block in the arranged order (featured and hidden included). */
	order: Block[];
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : []);
const pairs = (value: unknown): Array<[string, string]> =>
	Array.isArray(value)
		? value.filter((p): p is [string, string] => Array.isArray(p) && p.length >= 2 && typeof p[0] === "string" && typeof p[1] === "string" && !!p[0] && !!p[1]).map((p) => [p[0], p[1]])
		: [];
const unique = (list: string[]) => [...new Set(list)];

/**
 * Cleans what was stored (or hand-edited): strings only, no duplicates, group names trimmed, each
 * block in one known group at most, groups without a block dropped. Paths are not checked against
 * the vault here (a note may not be loaded yet): rendering skips missing ones.
 */
export function normalizeArrangement(raw: Partial<Record<keyof Arrangement, unknown>>): Arrangement {
	const groups: Array<[string, string]> = [];
	for (const [id, name] of pairs(raw.groups)) {
		const clean = name.trim();
		if (clean && !groups.some(([g]) => g === id)) groups.push([id, clean]);
	}
	const known = new Set(groups.map(([id]) => id));
	const domainGroups: Array<[string, string]> = [];
	for (const [path, group] of pairs(raw.domainGroups)) {
		if (known.has(group) && !domainGroups.some(([p]) => p === path)) domainGroups.push([path, group]);
	}
	const used = new Set(domainGroups.map(([, g]) => g));
	return {
		domainOrder: unique(strings(raw.domainOrder)),
		featured: typeof raw.featured === "string" ? raw.featured : "",
		groups: groups.filter(([id]) => used.has(id)),
		domainGroups,
		hidden: unique(strings(raw.hidden)),
		pulledOut: unique(strings(raw.pulledOut)),
	};
}

/** True when `path` is a sub-MOC: a child of a domain that has children of its own. */
export function isSubMoc(world: World, path: string, domains: ReadonlySet<string>): boolean {
	if (domains.has(path)) return false;
	const parent = world.parent(path);
	return parent !== null && domains.has(parent) && world.hasChildren(path);
}

/** The blocks that exist now: each domain, and each pulled-out note that is still a sub-MOC. */
export function liveBlocks(world: World, arr: Arrangement): Block[] {
	const domains = new Set(world.domains());
	const out: Block[] = [...domains].map((id) => ({ id, kind: "domain" as const, domain: id }));
	for (const id of arr.pulledOut) {
		if (!world.exists(id) || !isSubMoc(world, id, domains)) continue;
		out.push({ id, kind: "pulled", domain: world.parent(id)! });
	}
	return out;
}

export function groupOf(arr: Arrangement, id: string): string | null {
	return arr.domainGroups.find(([path]) => path === id)?.[1] ?? null;
}

/**
 * Orders the live blocks: those in domainOrder first, in that order, then the others by
 * `activity` (most recent first, then by name).
 */
export function arrange(blocks: Block[], arr: Arrangement, activity: (id: string) => number, name: (id: string) => string): Layout {
	const byId = new Map(blocks.map((b) => [b.id, b]));
	const placed = arr.domainOrder.filter((id) => byId.has(id));
	const placedSet = new Set(placed);
	const rest = blocks
		.filter((b) => !placedSet.has(b.id))
		.sort((a, b) => activity(b.id) - activity(a.id) || name(a.id).localeCompare(name(b.id)) || a.id.localeCompare(b.id))
		.map((b) => b.id);
	const order = [...placed, ...rest].map((id) => byId.get(id)!);
	const hidden = new Set(arr.hidden);
	const featured = arr.featured && byId.has(arr.featured) && !hidden.has(arr.featured) ? byId.get(arr.featured)! : null;
	const visible = order.filter((b) => !hidden.has(b.id) && b !== featured);
	const sections: Section[] = [];
	for (const [id, groupName] of arr.groups) {
		const inGroup = visible.filter((b) => groupOf(arr, b.id) === id);
		if (inGroup.length) sections.push({ group: { id, name: groupName }, blocks: inGroup });
	}
	const known = new Set(arr.groups.map(([id]) => id));
	const loose = visible.filter((b) => {
		const g = groupOf(arr, b.id);
		return g === null || !known.has(g);
	});
	if (loose.length) sections.push({ group: null, blocks: loose });
	return { featured, sections, hidden: order.filter((b) => hidden.has(b.id)), order };
}

/** The visible blocks in reading order: the featured one, then section by section. */
export function readingOrder(layout: Layout): Block[] {
	return [...(layout.featured ? [layout.featured] : []), ...layout.sections.flatMap((s) => s.blocks)];
}

function sectionOf(layout: Layout, id: string): Section | null {
	return layout.sections.find((s) => s.blocks.some((b) => b.id === id)) ?? null;
}

/** Moves a block one step up (-1) or down (+1) within its section. Unchanged when it cannot move. */
export function moveBlock(arr: Arrangement, layout: Layout, id: string, step: -1 | 1): Arrangement {
	const section = sectionOf(layout, id);
	if (!section) return arr;
	const at = section.blocks.findIndex((b) => b.id === id);
	const other = section.blocks[at + step];
	if (!other) return arr;
	const order = layout.order.map((b) => b.id);
	const i = order.indexOf(id);
	const j = order.indexOf(other.id);
	[order[i], order[j]] = [order[j], order[i]];
	return { ...arr, domainOrder: order };
}

/** Drops a block before or after another (taking that block's group), or at the start of a group (null: no group). */
export function dropBlock(arr: Arrangement, layout: Layout, id: string, target: { before: string } | { after: string } | { group: string | null }): Arrangement {
	const order = layout.order.map((b) => b.id).filter((x) => x !== id);
	if (!layout.order.some((b) => b.id === id)) return arr;
	let next = arr;
	if ("group" in target) {
		next = setGroupOnly(arr, id, target.group);
		const section = layout.sections.find((s) => (s.group?.id ?? null) === target.group);
		const first = section?.blocks.find((b) => b.id !== id);
		order.splice(first ? order.indexOf(first.id) : order.length, 0, id);
	} else {
		const ref = "before" in target ? target.before : target.after;
		if (ref === id || !order.includes(ref)) return arr;
		next = setGroupOnly(arr, id, groupOf(arr, ref));
		order.splice(order.indexOf(ref) + ("before" in target ? 0 : 1), 0, id);
	}
	return { ...next, domainOrder: order, featured: next.featured === id ? "" : next.featured };
}

/** Features a block (first, full width), or none with "". */
export function feature(arr: Arrangement, id: string): Arrangement {
	return { ...arr, featured: id, hidden: id ? arr.hidden.filter((h) => h !== id) : arr.hidden };
}

function setGroupOnly(arr: Arrangement, id: string, group: string | null): Arrangement {
	const domainGroups = arr.domainGroups.filter(([path]) => path !== id);
	if (group !== null && arr.groups.some(([g]) => g === group)) domainGroups.push([id, group]);
	return { ...arr, domainGroups };
}

/** Puts a block in a group (null: in none), at the end of it. Not featured any more. */
export function setGroup(arr: Arrangement, layout: Layout, id: string, group: string | null): Arrangement {
	const next = setGroupOnly(arr, id, group);
	const order = layout.order.map((b) => b.id).filter((x) => x !== id);
	order.push(id);
	return normalizeArrangement({ ...next, domainOrder: order, featured: next.featured === id ? "" : next.featured });
}

/** A new group with that name, holding the block. Returns the arrangement and the group's id. */
export function newGroup(arr: Arrangement, layout: Layout, id: string, name: string): { arr: Arrangement; group: string } {
	const clean = name.trim();
	let n = arr.groups.length + 1;
	while (arr.groups.some(([g]) => g === `g${n}`)) n++;
	const group = `g${n}`;
	if (!clean) return { arr, group: "" };
	const withGroup = { ...arr, groups: [...arr.groups, [group, clean] as [string, string]] };
	return { arr: setGroup(withGroup, layout, id, group), group };
}

export function renameGroup(arr: Arrangement, group: string, name: string): Arrangement {
	const clean = name.trim();
	if (!clean) return arr;
	return { ...arr, groups: arr.groups.map(([g, n]) => [g, g === group ? clean : n] as [string, string]) };
}

/** Removes a group; its blocks stay, in no group. */
export function deleteGroup(arr: Arrangement, group: string): Arrangement {
	return { ...arr, groups: arr.groups.filter(([g]) => g !== group), domainGroups: arr.domainGroups.filter(([, g]) => g !== group) };
}

/** Shows a sub-MOC as its own block, right after its domain, in the same group. */
export function pullOut(arr: Arrangement, layout: Layout, sub: string, domain: string): Arrangement {
	if (arr.pulledOut.includes(sub)) return arr;
	const order = layout.order.map((b) => b.id).filter((x) => x !== sub);
	const at = order.indexOf(domain);
	order.splice(at < 0 ? order.length : at + 1, 0, sub);
	const next = setGroupOnly({ ...arr, pulledOut: [...arr.pulledOut, sub] }, sub, groupOf(arr, domain));
	return { ...next, domainOrder: order };
}

/** A pulled-out sub-MOC goes back into its domain's block. */
export function putBack(arr: Arrangement, sub: string): Arrangement {
	return dropPath({ ...arr, pulledOut: arr.pulledOut.filter((p) => p !== sub) }, sub);
}

export function hide(arr: Arrangement, id: string): Arrangement {
	if (arr.hidden.includes(id)) return arr;
	return { ...arr, hidden: [...arr.hidden, id], featured: arr.featured === id ? "" : arr.featured };
}

export function show(arr: Arrangement, id: string): Arrangement {
	return { ...arr, hidden: arr.hidden.filter((h) => h !== id) };
}

/** A note was renamed or moved: every mention follows. */
export function renamePath(arr: Arrangement, from: string, to: string): Arrangement {
	const swap = (p: string) => (p === from ? to : p);
	return normalizeArrangement({
		domainOrder: arr.domainOrder.map(swap),
		featured: swap(arr.featured),
		groups: arr.groups,
		domainGroups: arr.domainGroups.map(([p, g]) => [swap(p), g]),
		hidden: arr.hidden.map(swap),
		pulledOut: arr.pulledOut.map(swap),
	});
}

/** A note was deleted: every mention goes (a group left empty goes too). */
export function dropPath(arr: Arrangement, path: string): Arrangement {
	const keep = (p: string) => p !== path;
	return normalizeArrangement({
		domainOrder: arr.domainOrder.filter(keep),
		featured: arr.featured === path ? "" : arr.featured,
		groups: arr.groups,
		domainGroups: arr.domainGroups.filter(([p]) => keep(p)),
		hidden: arr.hidden.filter(keep),
		pulledOut: arr.pulledOut.filter(keep),
	});
}

/** True when the arrangement mentions the path anywhere. */
export function mentions(arr: Arrangement, path: string): boolean {
	return arr.domainOrder.includes(path) || arr.featured === path || arr.domainGroups.some(([p]) => p === path) || arr.hidden.includes(path) || arr.pulledOut.includes(path);
}

export function sameArrangement(a: Arrangement, b: Arrangement): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}
