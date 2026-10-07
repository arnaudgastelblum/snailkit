import assert from "node:assert/strict";
import { test } from "node:test";
import { nearestItem } from "../src/ui/surface";

const rect = (x: number, y: number, w = 100, h = 28) => ({ left: x, top: y, right: x + w, bottom: y + h });
test("surface: vertical movement favors the same column in a ragged grid", () => {
	assert.equal(nearestItem(rect(0, 30), [rect(160, 60), rect(0, 64), rect(0, 0)], "down"), 1);
	assert.equal(nearestItem(rect(0, 30), [rect(0, 60), rect(0, 0)], "up"), 1);
});
test("surface: horizontal movement picks the nearest overlapping row, not DOM order", () => {
	assert.equal(nearestItem(rect(0, 100), [rect(160, 0), rect(160, 110), rect(0, 140)], "right"), 1);
	assert.equal(nearestItem(rect(160, 100), [rect(0, 90), rect(0, 160)], "left"), 0);
});
test("surface: navigation stops at edges and supports unequal widths", () => {
	assert.equal(nearestItem(rect(0, 0), [rect(0, 30)], "left"), -1);
	assert.equal(nearestItem(rect(0, 0, 220), [rect(240, 0, 40), rect(240, 40, 180)], "right"), 0);
	assert.equal(nearestItem(rect(0, 0), [], "down"), -1);
});
