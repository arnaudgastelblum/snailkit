// What a domain block and a domain page list, how many open tasks each block holds, how recently
// each was active, and which page a note belongs to. Pure over World.
import { isSubMoc, type Block } from "./arrange";
import { ancestors, byRecent, descendants, type World } from "./world";

export interface BlockLine {
	/** "sub": a sub-MOC (tree icon, its count); "kid": a note of that sub-MOC (indented); "note": a note of the block. */
	kind: "sub" | "kid" | "note";
	path: string;
	/** For "sub": how many notes it holds. */
	count?: number;
}

/** Lines shown in a block before "N more": 4, or 6 for the featured block. */
export const BLOCK_LINES = 4;
export const FEATURED_LINES = 6;

/** Most recent activity in a note and everything below it (ms). */
export function activity(world: World, path: string, memo?: Map<string, number>): number {
	const known = memo?.get(path);
	if (known !== undefined) return known;
	let best = world.mtime(path);
	for (const child of descendants(world, path)) best = Math.max(best, world.mtime(child));
	memo?.set(path, best);
	return best;
}

const notBrainstorm = (world: World) => (path: string) => !world.isBrainstorm(path);

/**
 * The lines of a block, in order: for a domain, its sub-MOCs (most recently active first), each
 * followed by its notes, then the domain's other notes, most recent first; for a pulled-out
 * sub-MOC, its notes. Brainstorms are left out (they have their own tab). Pulled-out sub-MOCs are
 * not repeated in their domain's block.
 */
export function blockLines(world: World, block: Block, pulledOut: ReadonlySet<string>, memo?: Map<string, number>): BlockLine[] {
	const recent = byRecent(world);
	const kids = (path: string) => world.children(path).filter(notBrainstorm(world)).sort(recent);
	if (block.kind === "pulled") return kids(block.id).map((path) => ({ kind: "note" as const, path }));
	const children = world.children(block.id).filter(notBrainstorm(world));
	const subs = children
		.filter((p) => world.hasChildren(p) && !pulledOut.has(p))
		.sort((a, b) => activity(world, b, memo) - activity(world, a, memo) || world.name(a).localeCompare(world.name(b)));
	const out: BlockLine[] = [];
	for (const sub of subs) {
		const list = kids(sub);
		out.push({ kind: "sub", path: sub, count: list.length });
		for (const path of list) out.push({ kind: "kid", path });
	}
	for (const path of children.filter((p) => !world.hasChildren(p)).sort(recent)) out.push({ kind: "note", path });
	return out;
}

/**
 * Why a block has no line (blockLines is empty), for a sentence that says what is there:
 * "brainstorms" (only brainstorms, listed on its page), "pulled" (every sub-MOC has a block of its
 * own), "both", or "nothing" (no note below it for now). `brainstorms`: how many hang from it.
 */
export function emptyBlock(world: World, block: Block, pulledOut: ReadonlySet<string>): { kind: "brainstorms" | "pulled" | "both" | "nothing"; brainstorms: number } {
	const children = world.children(block.id);
	const brainstorms = children.filter((p) => world.isBrainstorm(p)).length;
	const pulled = block.kind === "domain" ? children.filter((p) => !world.isBrainstorm(p) && pulledOut.has(p) && world.hasChildren(p)).length : 0;
	const kind = pulled && brainstorms ? "both" : pulled ? "pulled" : brainstorms ? "brainstorms" : "nothing";
	return { kind, brainstorms };
}

/** The lines shown, and how many more the block holds. */
export function visibleLines(lines: BlockLine[], featured: boolean): { shown: BlockLine[]; more: number } {
	const limit = featured ? FEATURED_LINES : BLOCK_LINES;
	return { shown: lines.slice(0, limit), more: Math.max(0, lines.length - limit) };
}

/**
 * The block a note counts for: the nearest pulled-out sub-MOC or domain among the note and its
 * parents, or null. `memo` keeps answers across calls (one render).
 */
export function blockOf(world: World, path: string, blocks: ReadonlySet<string>, memo?: Map<string, string | null>): string | null {
	const known = memo?.get(path);
	if (known !== undefined) return known;
	let found: string | null = null;
	if (blocks.has(path)) found = path;
	else {
		for (const parent of ancestors(world, path)) {
			if (blocks.has(parent)) {
				found = parent;
				break;
			}
		}
	}
	memo?.set(path, found);
	return found;
}

/** Open tasks per block (tasks under a pulled-out sub-MOC count for that block, not its domain). */
export function openTasksByBlock(world: World, tasks: Iterable<{ path: string; done: boolean }>, blocks: Block[]): Map<string, number> {
	const ids = new Set(blocks.map((b) => b.id));
	const memo = new Map<string, string | null>();
	const out = new Map<string, number>();
	for (const task of tasks) {
		if (task.done) continue;
		const block = blockOf(world, task.path, ids, memo);
		if (block) out.set(block, (out.get(block) ?? 0) + 1);
	}
	return out;
}

/** True when the note has a page: a domain, a sub-MOC, or a pulled-out sub-MOC. */
export function isPage(world: World, path: string, domains: ReadonlySet<string>, pulledOut: ReadonlySet<string>): boolean {
	if (!world.exists(path)) return false;
	return domains.has(path) || pulledOut.has(path) || isSubMoc(world, path, domains);
}

/**
 * The page a note belongs to: the nearest domain or sub-MOC among the note itself and its
 * parents. Null when the note has none (no parent, or above the domains).
 */
export function nearestPage(world: World, path: string, domains: ReadonlySet<string>, pulledOut: ReadonlySet<string>): string | null {
	for (const candidate of [path, ...ancestors(world, path)]) {
		if (isPage(world, candidate, domains, pulledOut)) return candidate;
	}
	return null;
}

/** The domain a note is in: itself when it is one, else its nearest parent that is one. */
export function domainOf(world: World, path: string, domains: ReadonlySet<string>): string | null {
	if (domains.has(path)) return path;
	for (const parent of ancestors(world, path)) if (domains.has(parent)) return parent;
	return null;
}

export interface PageContent {
	/** Sub-MOCs of a domain (most recently active first); empty on a sub-MOC page. */
	subs: string[];
	/** The other notes below the page's note, most recent first (brainstorms left out). */
	notes: string[];
	/** Brainstorms below the page's note, most recent first. */
	brainstorms: string[];
	/** The page's note and everything below it: tasks in these notes are the page's. */
	members: Set<string>;
}

/** What a domain or sub-MOC page lists. */
export function pageContent(world: World, path: string, domains: ReadonlySet<string>): PageContent {
	const all = descendants(world, path);
	const recent = byRecent(world);
	const memo = new Map<string, number>();
	const subs = domains.has(path)
		? world
				.children(path)
				.filter((p) => !world.isBrainstorm(p) && world.hasChildren(p))
				.sort((a, b) => activity(world, b, memo) - activity(world, a, memo) || world.name(a).localeCompare(world.name(b)))
		: [];
	const subSet = new Set(subs);
	return {
		subs,
		notes: all.filter((p) => !subSet.has(p) && !world.isBrainstorm(p)).sort(recent),
		brainstorms: all.filter((p) => world.isBrainstorm(p)).sort(recent),
		members: new Set([path, ...all]),
	};
}

/** Notes below a page's note (for the counts of a sub-MOC line): brainstorms left out. */
export function noteCount(world: World, path: string): number {
	return descendants(world, path).filter(notBrainstorm(world)).length;
}

/** The trail of a note under its domain, as names: ["Domain", "Sub-MOC"] (the nearest sub-MOC only). */
export function trailOf(world: World, path: string, domains: ReadonlySet<string>): string[] {
	const chain = [path, ...ancestors(world, path)];
	const at = chain.findIndex((p) => domains.has(p));
	if (at < 0) return [];
	const domain = chain[at];
	const sub = at >= 1 && isSubMoc(world, chain[at - 1], domains) ? chain[at - 1] : null;
	if (sub === path) return [world.name(domain)];
	return sub ? [world.name(domain), world.name(sub)] : domain === path ? [] : [world.name(domain)];
}

