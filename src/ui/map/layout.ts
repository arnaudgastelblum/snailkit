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
	height: number;
	rows: PositionedRow[];
	labels: Array<{ text: string; y: number }>;
}
export interface MapGeometry {
	root: PositionedRow | null;
	columns: MapColumn[];
	width: number;
	gap: number;
}

export const nodeKey = (id: string): string => `n:${id}`;
export const moreKey = (id: string): string => `m:${id}`;
export const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));

export function mapMode(width: number, phone: boolean, mode: MapOptions["mode"] = "auto"): MapMode {
	return mode === "auto" ? phone || width < L.treeBelow ? "tree" : "columns" : mode;
}

/** The source owns ordering. Never sort it here, or let a cycle consume another level. */
export function childRows(source: MapSource, parent: string, depth: number, ancestors: readonly string[] = []): MapRow[] {
	const seen = new Set([...ancestors, parent]);
	const children = source.children(parent).filter((node) => {
		if (seen.has(node.id)) return false;
		seen.add(node.id);
		return true;
	});
	const shown = children.slice(0, L.children);
	const more = Math.max(0, children.length - shown.length);
	const size = shown.length + Number(more > 0);
	const rows: MapRow[] = shown.map((node, index) => ({ key: nodeKey(node.id), node, parent, depth, position: index + 1, size, more: 0 }));
	if (more) rows.push({ key: moreKey(parent), node: null, parent, depth, position: size, size, more });
	return rows;
}

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
export function validChain(source: MapSource, root: string, chain: readonly string[]): string[] {
	const result: string[] = [];
	let parent = root;
	for (const id of chain.slice(0, L.depth)) {
		const row = childRows(source, parent, result.length + 1, [root, ...result]).find((r) => r.node?.id === id);
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
	let parent = root;
	const chain: string[] = [];
	while (chain.length < L.depth) {
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

/** Every column depends only on its parent and earlier columns, never on the unfolded descendants. */
export function columnLayout(source: MapSource, state: MapState, width: number, home: string,
	measure: (text: string, node?: MapNode) => number, moreText: (count: number) => string): MapGeometry {
	const node = source.node(state.root);
	if (!node) return { root: null, columns: [], width, gap: L.gapMax };
	const rootWidth = clamp(naturalWidth(node, measure), L.rootMinWidth, 176);
	const gap = clamp((width - rootWidth - L.depth * L.columnMin) / L.depth, 20, L.gapMax);
	const root: PositionedRow = { key: nodeKey(node.id), node, parent: null, depth: 0, position: 1, size: 1, more: 0,
		x: 0, y: (L.height - L.nodeHeight) / 2, width: rootWidth };
	const columns: MapColumn[] = [];
	let parent = root;
	let x = rootWidth + gap;
	const ancestors = [state.root];
	for (let depth = 1; depth <= L.depth; depth++) {
		const rows = childRows(source, parent.node!.id, depth, ancestors);
		if (!rows.length) break;
		const cap = clamp(width - x - (L.depth - depth) * (L.columnMin + gap), L.columnMin, L.columnMax);
		const colWidth = clamp(Math.max(...rows.map((row) => row.node ? naturalWidth(row.node, measure) : measure(moreText(row.more)) + 38)), L.columnMin, cap);
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
		const visibleHeight = Math.min(height, L.height - 16);
		const top = clamp(parent.y + L.nodeHeight / 2 - visibleHeight / 2, 8, L.height - 8 - visibleHeight);
		placed.forEach((row) => row.y += top);
		labels.forEach((label) => label.y += top);
		columns.push({ parent: parent.node!.id, depth, x, width: colWidth, top, height, rows: placed, labels });
		const next = placed.find((row) => row.node?.id === state.chain[depth - 1]);
		if (!next?.node?.hasChildren) break;
		parent = next;
		ancestors.push(next.node.id);
		x += colWidth + gap;
	}
	return { root, columns, gap, width: Math.max(width, ...columns.map((col) => col.x + col.width)) };
}

export function branchPath(x1: number, y1: number, x2: number, y2: number): string {
	const mid = (x1 + x2) / 2;
	return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

export interface Point { x: number; y: number }
export function inTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
	const cross = (u: Point, v: Point, w: Point) => (u.x - w.x) * (v.y - w.y) - (v.x - w.x) * (u.y - w.y);
	if (Math.abs(cross(a, b, c)) < 0.001) return false;
	const signs = [cross(p, a, b), cross(p, b, c), cross(p, c, a)];
	return !(signs.some((n) => n < 0) && signs.some((n) => n > 0));
}
