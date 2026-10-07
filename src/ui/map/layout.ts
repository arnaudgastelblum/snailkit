import { MAP_LIMITS as L, type MapNode, type MapOptions, type MapSource, type MapState } from "./types";

export type MapMode = "columns" | "tree";
export interface MapRow {
	key: string;
	node: MapNode | null;
	parent: string | null;
	depth: number;
	position: number;
	size: number;
	more: number;
}
export interface PositionedRow extends MapRow {
	x: number;
	y: number;
	width: number;
}
export interface MapColumn {
	parent: string;
	depth: number;
	x: number;
	width: number;
	top: number;
	/** Height of all its rows. */
	height: number;
	/** Height shown (less than `height`: the column scrolls). */
	visible: number;
	/** Its "N more" was opened: every child shows. */
	grown: boolean;
	rows: PositionedRow[];
	labels: Array<{ text: string; y: number }>;
}
export interface MapGeometry {
	root: PositionedRow | null;
	columns: MapColumn[];
	width: number;
	/** Height of the stage: the usual 340 px, more when a column grew ("N more" opened). */
	height: number;
	gap: number;
	/** The root shows as a pill (the branch reaches the fourth level). */
	folded: boolean;
}

export const nodeKey = (id: string): string => `n:${id}`;
export const moreKey = (id: string): string => `m:${id}`;
export const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

export function mapMode(width: number, phone: boolean, mode: MapOptions["mode"] = "auto"): MapMode {
	return mode === "auto" ? phone || width < L.treeBelow ? "tree" : "columns" : mode;
}

/** The source owns ordering. Never sort it here, or let a cycle consume another level. */
export function childRows(source: MapSource, parent: string, depth: number, ancestors: readonly string[] = [], all = false): MapRow[] {
	const seen = new Set([...ancestors, parent]);
	const children = source.children(parent).filter((node) => {
		if (seen.has(node.id)) return false;
		seen.add(node.id);
		return true;
	});
	const shown = all ? children : children.slice(0, L.children);
	const more = Math.max(0, children.length - shown.length);
	const size = shown.length + Number(more > 0);
	const rows: MapRow[] = shown.map((node, index) => ({ key: nodeKey(node.id), node, parent, depth, position: index + 1, size, more: 0 }));
	if (more) rows.push({ key: moreKey(parent), node: null, parent, depth, position: size, size, more });
	return rows;
}

const NONE: ReadonlySet<string> = new Set();

export function pathFrom(source: MapSource, root: string, id: string | null | undefined): string[] {
	const path: string[] = [];
	const seen = new Set<string>();
	while (id && id !== root && !seen.has(id)) {
		seen.add(id);
		path.unshift(id);
		id = source.parent(id);
	}
	return id === root ? path : [];
}

/** Saved paths and current notes may be deleted, moved, cyclic, or beyond the eight visible children. */
export function validChain(source: MapSource, root: string, chain: readonly string[], grown: ReadonlySet<string> = NONE): string[] {
	const result: string[] = [];
	let parent = root;
	for (const id of chain.slice(0, L.depth)) {
		const row = childRows(source, parent, result.length + 1, [root, ...result], grown.has(parent)).find((r) => r.node?.id === id);
		if (!row) break;
		result.push(id);
		if (!row.node?.hasChildren) break;
		parent = id;
	}
	return result;
}

export function startingChain(source: MapSource, root: string, current?: string | null, fallback = true): string[] {
	const path = validChain(source, root, pathFrom(source, root, current));
	if (path.length || !fallback) return path;
	// Without a note to show, unfold no deeper than the columns beside a whole root.
	let parent = root;
	const chain: string[] = [];
	while (chain.length < L.columns - 1) {
		const next = childRows(source, parent, chain.length + 1, [root, ...chain]).find((row) => row.node?.hasChildren)?.node;
		if (!next) break;
		chain.push(next.id);
		parent = next.id;
	}
	return chain;
}

const HEAD_WIDTH = { root: 22, domain: 18, sub: 13, note: 6, brainstorm: 12, drawing: 6 };
export function naturalWidth(node: MapNode, measure: (text: string, node?: MapNode) => number): number {
	return Math.ceil(18 + HEAD_WIDTH[node.kind] + 7 + measure(node.label, node) + (node.hasChildren ? 22 : 0));
}

/**
 * True when the branch reaches the last level: the third unfolded node has children of its own, so
 * a fourth column shows and the root folds into a pill to make room.
 */
export function reachesLastLevel(source: MapSource, state: MapState, grown: ReadonlySet<string> = NONE): boolean {
	const chain = validChain(source, state.root, state.chain, grown);
	if (chain.length < L.columns) return false;
	const id = chain[L.columns - 1];
	return !!source.node(id)?.hasChildren && childRows(source, id, L.columns + 1, [state.root, ...chain.slice(0, L.columns)]).length > 0;
}

/**
 * Every column depends only on its parent and earlier columns, never on the unfolded descendants.
 * When the branch reaches the fourth level (or `folded` asks for it), the root folds into a pill:
 * every column then moves left by the same amount, keeping its width (the third one, no longer
 * the last, is bounded like the others).
 */
export function columnLayout(source: MapSource, state: MapState, width: number, home: string,
	measure: (text: string, node?: MapNode) => number, moreText: (count: number) => string, folded = false,
	grown: ReadonlySet<string> = NONE): MapGeometry {
	const node = source.node(state.root);
	if (!node) return { root: null, columns: [], width, height: L.height, gap: L.gapMax, folded: false };
	folded = folded || reachesLastLevel(source, state, grown);
	const fullWidth = clamp(naturalWidth(node, measure), L.rootMinWidth, 176);
	const rootWidth = folded ? L.rootPill : fullWidth;
	const shift = fullWidth - rootWidth;
	const gap = clamp((width - fullWidth - L.columns * L.columnMin) / L.columns, 20, L.gapMax);
	const root: PositionedRow = { key: nodeKey(node.id), node, parent: null, depth: 0, position: 1, size: 1, more: 0,
		x: 0, y: (L.height - L.nodeHeight) / 2, width: rootWidth };
	const columns: MapColumn[] = [];
	let parent = root;
	let x = rootWidth + gap;
	const ancestors = [state.root];
	for (let depth = 1; depth <= L.depth; depth++) {
		const id = parent.node!.id;
		const capped = childRows(source, id, depth, ancestors);
		if (!capped.length) break;
		// "N more" opened: every child, the column keeps the place it had and grows downward.
		const all = grown.has(id) && capped.some((row) => !row.node);
		const rows = all ? childRows(source, id, depth, ancestors, true) : capped;
		// The last column has no column after it: it may use all the room left, so long note names
		// show whole instead of being cut at the usual column width. The others keep room for the
		// columns after them, measured as if the root were whole (folding only moves them left).
		const last = depth === L.depth || (!folded && depth === L.columns);
		const cap = last
			? Math.max(L.columnMin, width - x - 8)
			: depth < L.columns
				? clamp(width - (x + shift) - (L.columns - depth) * (L.columnMin + gap), L.columnMin, L.columnMax)
				: clamp(width - x - (L.columnMin + gap), L.columnMin, L.columnMax);
		const colWidth = clamp(Math.max(...rows.map((row) => row.node ? naturalWidth(row.node, measure) : measure(moreText(row.more)) + 38)), L.columnMin, cap);
		const stack = (list: MapRow[]) => {
			let h = 0, previous: string | null = null;
			for (const row of list) {
				const group = depth === 1 && state.root === home ? row.node?.group : null;
				if (group && group !== previous) h += 18;
				previous = group ?? null;
				h += L.rowStep;
			}
			return h - (L.rowStep - L.nodeHeight);
		};
		let height = 0;
		let previousGroup: string | null = null;
		const labels: MapColumn["labels"] = [];
		const placed = rows.map((row): PositionedRow => {
			const group = depth === 1 && state.root === home ? row.node?.group : null;
			if (group && group !== previousGroup) {
				labels.push({ text: group, y: height });
				height += 18;
			}
			previousGroup = group ?? null;
			const y = height;
			height += L.rowStep;
			return { ...row, x, y, width: colWidth };
		});
		height -= L.rowStep - L.nodeHeight;
		// The block centers on its parent, within the usual height (or down to its parent when that
		// one sits lower, in a column that grew).
		const bottom = Math.max(L.height, parent.y + L.nodeHeight + 8);
		const cappedVisible = Math.min(all ? stack(capped) : height, L.height - 16);
		const top = clamp(parent.y + L.nodeHeight / 2 - cappedVisible / 2, 8, bottom - 8 - cappedVisible);
		const visible = all ? Math.min(height, L.maxHeight - 8 - top) : Math.min(height, Math.min(bottom, L.maxHeight) - 8 - top);
		placed.forEach((row) => row.y += top);
		labels.forEach((label) => label.y += top);
		columns.push({ parent: id, depth, x, width: colWidth, top, height, visible, grown: all, rows: placed, labels });
		const next = placed.find((row) => row.node?.id === state.chain[depth - 1]);
		if (!next?.node?.hasChildren) break;
		parent = next;
		ancestors.push(next.node.id);
		x += colWidth + gap;
	}
	const stage = Math.min(L.maxHeight, Math.max(L.height, ...columns.map((col) => col.top + col.visible + 8)));
	return { root, columns, gap, folded, height: stage, width: Math.max(width, ...columns.map((col) => col.x + col.width)) };
}

/**
 * A branch from the parent's name to the child. With `run` (the right edge of the parent's
 * column), it goes straight to there first and only then curves, so steep branches of a long
 * column never cross the names of the parent's siblings.
 */
export function branchPath(x1: number, y1: number, x2: number, y2: number, run?: number): string {
	if (run === undefined) {
		const mid = (x1 + x2) / 2;
		return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
	}
	const start = Math.min(Math.max(x1, run), x2 - 8);
	const mid = (start + x2) / 2;
	return `M ${x1} ${y1} L ${start} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

export interface Point { x: number; y: number }
export function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
	const cross = (u: Point, v: Point, w: Point) => (u.x - w.x) * (v.y - w.y) - (v.x - w.x) * (u.y - w.y);
	if (Math.abs(cross(a, b, c)) < 0.001) return false;
	const signs = [cross(p, a, b), cross(p, b, c), cross(p, c, a)];
	return !(signs.some((n) => n < 0) && signs.some((n) => n > 0));
}
