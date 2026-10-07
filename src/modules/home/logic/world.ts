// What the Home logic knows of the vault: notes by path, their parents and children under the
// places rule, and a few facts about each note. The runtime implements it over Obsidian (world
// in runtime.ts); tests give a plain object. Everything in logic/ is pure over this interface.

export interface World {
	/** The home page (detected or chosen), or null. */
	home(): string | null;
	/** The domains (places.domains()), in any order. */
	domains(): string[];
	/** Direct children under the rule, sorted by path. */
	children(path: string): string[];
	hasChildren(path: string): boolean;
	/** The parent under the rule, or null. */
	parent(path: string): string | null;
	exists(path: string): boolean;
	/** The note's name (basename, no extension). */
	name(path: string): string;
	/** Last modification (ms), 0 when unknown. */
	mtime(path: string): number;
	/** A Brainstorm note (shown with a bolt, kept out of the domain blocks). */
	isBrainstorm(path: string): boolean;
	/** An Excalidraw drawing ("*.excalidraw.md"). */
	isDrawing(path: string): boolean;
	/** The stable hue (0-359) of a domain. */
	hue(path: string): number;
}

/** Deepest level followed below a note (the rule stops chains at 8 too). */
export const MAX_LEVELS = 8;
/** Most notes visited below one note (a guard for huge vaults). */
export const MAX_NODES = 20000;

/** Every note below `root` (not `root` itself), breadth first, each once. */
export function descendants(world: World, root: string, limit = MAX_NODES): string[] {
	const out: string[] = [];
	const seen = new Set([root]);
	let level = [root];
	for (let depth = 0; depth < MAX_LEVELS && level.length && out.length < limit; depth++) {
		const next: string[] = [];
		for (const path of level) {
			for (const child of world.children(path)) {
				if (seen.has(child)) continue;
				seen.add(child);
				out.push(child);
				next.push(child);
				if (out.length >= limit) return out;
			}
		}
		level = next;
	}
	return out;
}

/** Parents from the nearest up (stops on a loop or after MAX_LEVELS). */
export function ancestors(world: World, path: string): string[] {
	const out: string[] = [];
	const seen = new Set([path]);
	let current = world.parent(path);
	while (current !== null && !seen.has(current) && out.length < MAX_LEVELS) {
		out.push(current);
		seen.add(current);
		current = world.parent(current);
	}
	return out;
}

/** Most recent first, then by name. */
export function byRecent(world: World): (a: string, b: string) => number {
	return (a, b) => world.mtime(b) - world.mtime(a) || world.name(a).localeCompare(world.name(b));
}
