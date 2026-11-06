// The rows of the area panel, pure: the chain from the top down to the note, then its children.
// Tested in test/note-rail.test.ts.

export interface PlaceRow<T = { path: string; basename: string }> {
	file: T;
	/** The home page, a parent on the way down, the note itself, or a note under it. */
	kind: "home" | "parent" | "self" | "child";
	/** Indent: 0 for the top row, one more per level. */
	depth: number;
}

/**
 * `chain` lists the parents from the nearest up (as placeOf gives it). The home page, when it tops
 * the chain, is drawn as such; children are sorted by name.
 */
export function placeRows<T extends { path: string; basename: string }>(file: T, chain: readonly T[], homePath: string | null, children: readonly T[]): PlaceRow<T>[] {
	const down = chain.slice().reverse();
	const rows: PlaceRow<T>[] = down.map((f, i) => ({ file: f, kind: i === 0 && homePath !== null && f.path === homePath ? "home" : "parent", depth: i }));
	const selfDepth = down.length;
	rows.push({ file, kind: "self", depth: selfDepth });
	const kids = children.filter((c) => c.path !== file.path).sort((a, b) => a.basename.localeCompare(b.basename) || a.path.localeCompare(b.path));
	for (const c of kids) rows.push({ file: c, kind: "child", depth: selfDepth + 1 });
	return rows;
}
