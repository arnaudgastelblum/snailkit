import assert from "node:assert/strict";
import { test } from "node:test";
import { branchPath, childRows, columnLayout, inTriangle, mapMode, nodeKey, pathFrom, reachesLastLevel, startingChain, validChain } from "../src/ui/map/layout";
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
		const layout = columnLayout(source, state(["a", "a0"]), width, "home", measure, more);
		assert.equal(layout.folded, false);
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
	assert.deepEqual(startingChain(source, "home", "missing"), ["a", "a0"]);
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

test("map keyboard: right at depth three enters the fourth column, at depth four shifts one column", () => {
	const { source } = fixture();
	let s = state(["a", "a0", "deep"]);
	let layout = columnLayout(source, s, 760, "home", measure, more);
	let rows = [layout.root!, ...layout.columns.flatMap((col) => col.rows)];
	const deep = rows.find((row) => row.node?.id === "deep")!;
	const inside = keyMove("ArrowRight", deep, rows, s, source, "home", "columns", new Set(), new Map())!;
	assert.equal(inside.root, undefined);
	assert.equal(inside.key, nodeKey("end"));
	s = state(["a", "a0", "deep", "end"]);
	layout = columnLayout(source, s, 760, "home", measure, more);
	rows = [layout.root!, ...layout.columns.flatMap((col) => col.rows)];
	const end = rows.find((row) => row.node?.id === "end")!;
	assert.equal(end.depth, 4);
	const result = keyMove("ArrowRight", end, rows, s, source, "home", "columns", new Set(), new Map())!;
	assert.equal(result.root, "a");
	assert.deepEqual(result.chain, ["a0", "deep", "end", "leaf"]);
	assert.equal(result.key, nodeKey("leaf"));
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

test("map geometry: the last column uses the room left, so long note names show whole", () => {
	const { source, nodes } = fixture();
	nodes.get("deep")!.label = "A long note name that would be cut at the usual column width";
	const layout = columnLayout(source, state(["a", "a0"]), 1200, "home", measure, more);
	const last = layout.columns[2];
	assert.ok(last.width > 240);
	assert.ok(last.x + last.width <= 1200);
	const narrow = columnLayout(source, state(["a", "a0"]), 600, "home", measure, more);
	assert.ok(narrow.columns[2].x + narrow.columns[2].width <= 600 || narrow.columns[2].width === 132);
});

test("map fourth level: the root folds into a pill, the columns slide left together", () => {
	const { source } = fixture();
	for (const width of [760, 1200]) {
		const three = columnLayout(source, state(["a", "a0"]), width, "home", measure, more);
		const four = columnLayout(source, state(["a", "a0", "deep"]), width, "home", measure, more);
		assert.equal(three.folded, false);
		assert.equal(four.folded, true);
		assert.equal(four.columns.length, 4);
		assert.equal(four.root!.width, 30);
		assert.equal(four.root!.y, three.root!.y);
		const shift = three.root!.width - four.root!.width;
		// The first two columns keep their width and height and move left by the same amount.
		for (const i of [0, 1]) {
			assert.equal(four.columns[i].width, three.columns[i].width);
			assert.equal(four.columns[i].top, three.columns[i].top);
			assert.equal(four.columns[i].x, three.columns[i].x - shift);
		}
		// The third is bounded like a middle column; the fourth takes the room left.
		assert.ok(four.columns[2].width <= 240);
		assert.equal(four.columns[3].x, four.columns[2].x + four.columns[2].width + four.gap);
		assert.ok(four.columns[3].x + four.columns[3].width <= Math.max(width, four.width));
	}
});

test("map fourth level: unfolding deeper keeps the folded columns still; a kept fold stays", () => {
	const { source } = fixture();
	const four = columnLayout(source, state(["a", "a0", "deep"]), 900, "home", measure, more);
	const deeper = columnLayout(source, state(["a", "a0", "deep", "end"]), 900, "home", measure, more);
	assert.deepEqual(deeper.columns.slice(0, 3), four.columns.slice(0, 3));
	assert.equal(deeper.columns.length, 4);
	// Pointer back in the first column: the fold is kept while asked (no sliding under the pointer).
	const kept = columnLayout(source, state(["a"]), 900, "home", measure, more, true);
	assert.equal(kept.folded, true);
	assert.equal(kept.columns[0].x, four.columns[0].x);
	assert.equal(columnLayout(source, state(["a"]), 900, "home", measure, more).folded, false);
});

test("map fourth level: reached only when the third unfolded node has children", () => {
	const { source } = fixture();
	assert.equal(reachesLastLevel(source, state(["a", "a0"])), false);
	assert.equal(reachesLastLevel(source, state(["a", "a0", "deep"])), true);
	assert.equal(reachesLastLevel(source, state(["a", "a1", "deep"])), false);
	assert.deepEqual(validChain(source, "home", ["a", "a0", "deep", "end", "leaf"]), ["a", "a0", "deep", "end"]);
	// Without a note to follow, the Map arrives with three columns and the root whole.
	assert.deepEqual(startingChain(source, "home", null), ["a", "a0"]);
	assert.equal(reachesLastLevel(source, state(startingChain(source, "home", null))), false);
	assert.equal(startingChain(source, "home", "leaf").length, 4);
});

test("map drop zones: thirds on a sibling, the middle onto it, hysteresis near the borders", async () => {
	const { dropZone, nextAfter, sameOrder } = await import("../src/ui/map/drop");
	assert.equal(dropZone(0.1, true, true, null), "before");
	assert.equal(dropZone(0.5, true, true, null), "into");
	assert.equal(dropZone(0.9, true, true, null), "after");
	// Held a little past the border, in both directions.
	assert.equal(dropZone(0.35, true, true, "before"), "before");
	assert.equal(dropZone(0.38, true, true, null), "into");
	assert.equal(dropZone(0.25, true, true, "into"), "into");
	assert.equal(dropZone(0.15, true, true, "into"), "before");
	assert.equal(dropZone(0.65, true, true, "after"), "after");
	// A sibling that cannot be a parent: halves, with the same holding.
	assert.equal(dropZone(0.4, true, false, null), "before");
	assert.equal(dropZone(0.55, true, false, "before"), "before");
	assert.equal(dropZone(0.7, true, false, "before"), "after");
	// Another node: onto it, or nothing.
	assert.equal(dropZone(0.1, false, true, null), "into");
	assert.equal(dropZone(0.5, false, false, null), null);
	// Order: after a sibling means before the next child, hidden ones counted.
	const all = ["a", "b", "c", "d"];
	assert.equal(nextAfter(all, "a", "c"), "d");
	assert.equal(nextAfter(all, "a", "d"), null);
	assert.equal(nextAfter(all, "c", "b"), "d");
	assert.equal(sameOrder(all, "b", "c"), true);
	assert.equal(sameOrder(all, "b", "b"), true);
	assert.equal(sameOrder(all, "b", "a"), false);
	assert.equal(sameOrder(all, "d", null), true);
});

test("map N more: the column grows in place, the stage grows, long columns scroll", () => {
	const { source } = fixture();
	const before = columnLayout(source, state(["a"]), 900, "home", measure, more);
	const grown = columnLayout(source, state(["a"]), 900, "home", measure, more, false, new Set(["a"]));
	const col = before.columns[1], big = grown.columns[1];
	assert.equal(col.rows.length, 9);
	assert.equal(big.rows.length, 12);
	assert.ok(big.rows.every((r) => r.node));
	// Same place for the rows already shown, the others below; earlier columns unchanged.
	assert.equal(big.top, col.top);
	for (let i = 0; i < 8; i++) assert.equal(big.rows[i].y, col.rows[i].y);
	assert.deepEqual(grown.columns[0], before.columns[0]);
	assert.equal(before.height, 340);
	assert.ok(grown.height > 340 && grown.height <= 640);
	assert.equal(big.visible, big.height);
	// A chain into a child beyond the eighth stays valid only while its column is grown.
	assert.deepEqual(validChain(source, "home", ["a", "a10"], new Set(["a"])), ["a", "a10"]);
	assert.deepEqual(validChain(source, "home", ["a", "a10"]), ["a"]);
	// Very long: the column scrolls within the tallest stage.
	const { source: s2, nodes, parents } = fixture();
	for (let i = 12; i < 40; i++) { nodes.set(`a${i}`, { id: `a${i}`, label: `Note ${i}`, kind: "note", hue: null, hasChildren: false }); parents.set(`a${i}`, "a"); }
	const huge = columnLayout(s2, state(["a"]), 900, "home", measure, more, false, new Set(["a"]));
	assert.ok(huge.columns[1].visible < huge.columns[1].height);
	assert.ok(huge.height <= 640);
});

test("map branches run straight to the column's edge before curving", () => {
	assert.equal(branchPath(10, 20, 100, 80, 40), "M 10 20 L 40 20 C 70 20, 70 80, 100 80");
	// The run never reaches past the child.
	assert.equal(branchPath(10, 20, 50, 80, 60), "M 10 20 L 42 20 C 46 20, 46 80, 50 80");
	// A label longer than the run: no backward step.
	assert.equal(branchPath(30, 20, 100, 80, 20), "M 30 20 L 30 20 C 65 20, 65 80, 100 80");
});
