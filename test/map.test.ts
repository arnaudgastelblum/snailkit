import assert from "node:assert/strict";
import { test } from "node:test";
import { branchPath, childRows, columnLayout, inTriangle, mapMode, nodeKey, pathFrom, startingChain, validChain } from "../src/ui/map/layout";
import { keyMove } from "../src/ui/map/keys";
import type { MapNode, MapSource, MapState } from "../src/ui/map/types";

function fixture() {
	const nodes = new Map<string, MapNode>();
	const parents = new Map<string, string>();
	const add = (id: string, parent?: string, label = id, group?: string) => {
		nodes.set(id, { id, label, kind: parent ? "note" : "root", hue: null, hasChildren: false, group });
		if (parent) { parents.set(id, parent); nodes.get(parent)!.hasChildren = true; }
	};
	add("home"); add("a", "home", "Project A", "Work"); add("b", "home", "Project B", "Work"); add("c", "home", "Reading", "Personal");
	for (let i = 0; i < 12; i++) add(`a${i}`, "a", i === 3 ? "Long title ".repeat(30) : `Note ${i}`);
	add("deep", "a0"); add("end", "deep"); add("leaf", "end");
	add("b0", "b");
	const source: MapSource = { node: (id) => nodes.get(id) ?? null, parent: (id) => parents.get(id) ?? null,
		children: (id) => [...nodes.values()].filter((node) => parents.get(node.id) === id) };
	return { source, nodes, parents };
}
const state = (chain: string[] = []): MapState => ({ root: "home", chain, focus: null });
const measure = (text: string) => text.length * 7;
const more = (n: number) => `${n} more`;

test("map geometry: bounded widths, root centering, group labels and gaps", () => {
	const { source } = fixture();
	for (const width of [600, 760, 1200]) {
		const layout = columnLayout(source, state(["a", "a0", "deep"]), width, "home", measure, more);
		assert.equal(layout.root!.y, 156);
		assert.ok(layout.root!.width >= 104);
		assert.ok(layout.gap <= 44);
		assert.equal(layout.columns.length, 3);
		assert.equal(layout.columns[0].x, layout.root!.width + layout.gap);
		for (const [i, col] of layout.columns.entries()) {
			assert.ok(col.width >= 132 && col.width <= 240);
			assert.ok(col.top >= 8);
			assert.ok(col.top + col.height <= 332);
			if (i) assert.equal(col.x, layout.columns[i - 1].x + layout.columns[i - 1].width + layout.gap);
		}
		assert.equal(layout.columns[0].labels.length, 2);
		assert.equal(layout.columns[0].rows[0].y - layout.columns[0].labels[0].y, 18);
		assert.equal(layout.columns[1].rows[1].y - layout.columns[1].rows[0].y, 30);
	}
});

test("map geometry: each block centers on its parent, then clamps at top or bottom", () => {
	const { source } = fixture();
	const layout = columnLayout(source, state(["a", "a0"]), 760, "home", measure, more);
	for (const col of layout.columns) {
		const parent = col.depth === 1 ? layout.root! : layout.columns[col.depth - 2].rows.find((row) => row.node?.id === col.parent)!;
		assert.equal(col.top, Math.max(8, Math.min(332 - col.height, parent.y + 14 - col.height / 2)));
	}
});

test("map stability: deeper unfolding and a wide descendant cannot move shallower columns", () => {
	const { source } = fixture();
	const shallow = columnLayout(source, state(), 760, "home", measure, more);
	for (const chain of [["a"], ["a", "a0"], ["b", "b0"]]) {
		const deep = columnLayout(source, state(chain), 760, "home", measure, more);
		assert.deepEqual(deep.root, shallow.root);
		assert.deepEqual(deep.columns[0], shallow.columns[0]);
	}
	const one = columnLayout(source, state(["a"]), 760, "home", measure, more);
	const two = columnLayout(source, state(["a", "a0"]), 760, "home", measure, more);
	assert.deepEqual(one.columns, two.columns.slice(0, 2));
});

test("map cut: exactly eight real children and one translated page action", () => {
	const { source } = fixture();
	const rows = childRows(source, "a", 2);
	assert.equal(rows.length, 9);
	assert.equal(rows[8].more, 4);
	assert.equal(rows[8].parent, "a");
	assert.equal(rows[8].position, 9);
	assert.ok(rows.every((row) => row.size === 9));
	assert.equal(rows[7].node!.id, "a7");
});

test("map starting branch: current first, otherwise the first child with descendants", () => {
	const { source } = fixture();
	assert.deepEqual(startingChain(source, "home", "deep"), ["a", "a0", "deep"]);
	assert.deepEqual(startingChain(source, "home", "b0"), ["b", "b0"]);
	assert.deepEqual(startingChain(source, "home", "missing"), ["a", "a0", "deep"]);
	assert.deepEqual(startingChain(source, "home", null, false), []);
	assert.deepEqual(startingChain(source, "home", "b0", false), ["b", "b0"]);
	assert.deepEqual(validChain(source, "home", ["a", "a10"]), ["a"]);
});

test("map handles missing nodes, duplicate children and parent cycles", () => {
	const { source, parents } = fixture();
	parents.set("home", "deep");
	assert.deepEqual(pathFrom(source, "missing", "deep"), []);
	assert.ok(startingChain(source, "home").length <= 3);
	assert.equal(columnLayout(source, { ...state(), root: "missing" }, 760, "home", measure, more).root, null);
	const duplicate: MapSource = { ...source, children: (id) => [...source.children(id), ...source.children(id)] };
	assert.equal(childRows(duplicate, "home", 1).length, 3);
});

test("map keyboard: same column, bounds, remembered children and parent", () => {
	const { source } = fixture();
	const s = state(["a", "a0", "deep"]);
	const layout = columnLayout(source, s, 760, "home", measure, more);
	const rows = [layout.root!, ...layout.columns.flatMap((col) => col.rows)];
	const a = rows.find((row) => row.node?.id === "a")!;
	const move = (key: string) => keyMove(key, a, rows, s, source, "home", "columns", new Set(), new Map([["a", "a3"]]));
	assert.equal(move("ArrowDown")!.key, nodeKey("b"));
	assert.equal(move("ArrowUp")!.key, undefined);
	assert.equal(move("End")!.key, nodeKey("c"));
	assert.equal(move("Home")!.key, nodeKey("a"));
	assert.equal(move("ArrowRight")!.key, nodeKey("a3"));
	assert.equal(move("ArrowLeft")!.key, nodeKey("home"));
	assert.equal(move("Escape")!.escape, true);
	assert.equal(move("Tab"), null);
});

test("map keyboard: right at depth three shifts one column and enters the children", () => {
	const { source } = fixture(), s = state(["a", "a0", "deep"]);
	const layout = columnLayout(source, s, 760, "home", measure, more);
	const rows = [layout.root!, ...layout.columns.flatMap((col) => col.rows)];
	const deep = rows.find((row) => row.node?.id === "deep")!;
	const result = keyMove("ArrowRight", deep, rows, s, source, "home", "columns", new Set(), new Map())!;
	assert.equal(result.root, "a");
	assert.deepEqual(result.chain, ["a0", "deep", "end"]);
	assert.equal(result.key, nodeKey("end"));
});

test("map tree keyboard: first right expands, second enters, left collapses", () => {
	const { source } = fixture();
	const rows = childRows(source, "home", 1), a = rows[0];
	assert.deepEqual(keyMove("ArrowRight", a, rows, state(), source, "home", "tree", new Set(), new Map()), { expand: "a" });
	assert.equal(keyMove("ArrowRight", a, rows, state(), source, "home", "tree", new Set(["a"]), new Map())!.key, nodeKey("a0"));
	assert.deepEqual(keyMove("ArrowLeft", a, rows, state(), source, "home", "tree", new Set(["a"]), new Map()), { collapse: "a" });
});

test("map mode switches precisely at 600 px, with phone and explicit overrides", () => {
	assert.equal(mapMode(599, false), "tree"); assert.equal(mapMode(600, false), "columns");
	assert.equal(mapMode(1200, true), "tree"); assert.equal(mapMode(1200, false, "tree"), "tree");
	assert.equal(mapMode(400, false, "columns"), "columns");
});

test("map branches and safety triangle use stable endpoints", () => {
	assert.equal(branchPath(10, 20, 50, 80), "M 10 20 C 30 20, 30 80, 50 80");
	const a = { x: 0, y: 50 }, b = { x: 100, y: 0 }, c = { x: 100, y: 100 };
	assert.equal(inTriangle({ x: 50, y: 50 }, a, b, c), true);
	assert.equal(inTriangle({ x: 50, y: 90 }, a, b, c), false);
	assert.equal(inTriangle(a, a, a, a), false);
});

test("map tree left on a closed child focuses its parent without collapsing it", () => {
	const { source } = fixture();
	const rows = childRows(source, "a", 2);
	for (const child of rows.slice(0, 2)) {
		const result = keyMove("ArrowLeft", child, rows, state(), source, "home", "tree", new Set(["a"]), new Map())!;
		assert.equal(result.key, nodeKey("a")); assert.equal(result.collapse, undefined);
	}
});
