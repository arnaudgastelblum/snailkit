import { childRows, nodeKey, pathFrom, type MapMode, type MapRow } from "./layout";
import { MAP_LIMITS as L, type MapSource, type MapState } from "./types";

export interface KeyMove { key?: string; root?: string; chain?: string[]; expand?: string; collapse?: string; escape?: boolean }

/** Returns an intent, without DOM, timers, focus, or callbacks. */
export function keyMove(key: string, current: MapRow, rows: readonly MapRow[], state: MapState,
	source: MapSource, home: string, mode: MapMode, open: ReadonlySet<string>, last: ReadonlyMap<string, string>): KeyMove | null {
	const siblings = mode === "tree" ? rows : rows.filter((row) => row.depth === current.depth);
	const at = siblings.findIndex((row) => row.key === current.key);
	if (key === "ArrowUp" || key === "ArrowDown") return { key: siblings[at + (key === "ArrowDown" ? 1 : -1)]?.key };
	if (key === "Home" || key === "End") return { key: siblings[key === "Home" ? 0 : siblings.length - 1]?.key };
	if (key === "Escape" || key === "ArrowLeft" && current.depth === 0) {
		const parent = state.root === home ? null : source.parent(state.root);
		return parent && source.node(parent) ? { root: parent, chain: [state.root], key: nodeKey(state.root) } : { escape: key === "Escape" };
	}
	if (key === "ArrowLeft") {
		if (mode === "tree" && current.node && open.has(current.node.id) && current.depth > 0) return { collapse: current.node.id };
		const parent = current.parent;
		return parent ? { key: nodeKey(parent), chain: pathFrom(source, state.root, parent), ...(mode === "tree" ? {} : { collapse: parent }) } : {};
	}
	if (key !== "ArrowRight") return null;
	if (!current.node?.hasChildren) return {};
	const id = current.node.id;
	const children = childRows(source, id, current.depth + 1, [state.root, ...pathFrom(source, state.root, id)]);
	const child = children.find((row) => row.node && row.node.id === last.get(id)) ?? children[0];
	if (!child) return {};
	const path = pathFrom(source, state.root, id);
	if (current.depth === L.depth) {
		const root = path[0];
		return { root, chain: [...path.slice(1), ...(child.node ? [child.node.id] : [])], key: child.key, expand: id };
	}
	if (mode === "tree" && current.depth > 0 && !open.has(id)) return { expand: id };
	return { key: child.key, chain: path, expand: id };
}
