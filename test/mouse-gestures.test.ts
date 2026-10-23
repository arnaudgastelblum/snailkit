import assert from "node:assert/strict";
import { test } from "node:test";
import * as g from "../src/modules/mouse-gestures/logic";
import { mouseGestures } from "../src/modules/mouse-gestures";

function feed(tracker: g.GestureTracker, path: ReadonlyArray<readonly [number, number]>): boolean[] {
	return path.map(([x, y]) => {
		const before = tracker.gesture;
		const changed = tracker.move(x, y);
		assert.equal(changed, tracker.gesture !== before);
		return changed;
	});
}

function map(overrides: Partial<g.GestureMap> = {}): g.GestureMap {
	return { close: "", reopen: "", back: "", forward: "", newTab: "", nextTab: "", prevTab: "", launcher: "", home: "", tasks: "", brainstorm: "", newNote: "", ...overrides };
}

test("defaults: every action has its own valid gesture", () => {
	const gestures = g.ACTIONS.map((action) => mouseGestures.defaults[action]);
	for (const gesture of gestures) assert.equal(g.isGesture(gesture), true);
	assert.equal(new Set(gestures).size, gestures.length);
});

test("GESTURES: exact order, membership and no duplicates", () => {
	assert.deepEqual(g.GESTURES, ["L", "R", "U", "D", "DR", "DL", "UR", "UL", "RD", "RU", "LD", "LU", "UD", "DU", "LR", "RL"]);
	assert.equal(new Set(g.GESTURES).size, 16);
	for (const gesture of g.GESTURES) assert.equal(g.isGesture(gesture), true);
	for (const gesture of ["", "DD", "DRUL", "r", " R", "X"]) assert.equal(g.isGesture(gesture), false);
});

test("arrows: spacing, empty input and unknown characters", () => {
	assert.equal(g.arrows("DR"), "↓ →");
	assert.equal(g.arrows("L"), "←");
	assert.equal(g.arrows("LURD"), "← ↑ → ↓");
	assert.equal(g.arrows(""), "");
	assert.equal(g.arrows("?D xR!"), "↓ →");
	assert.equal(g.arrows("xyz"), "");
});

test("actionFor: priority, disabled actions and invalid gestures", () => {
	assert.deepEqual(g.ACTIONS, ["close", "reopen", "back", "forward", "newTab", "nextTab", "prevTab", "launcher", "home", "tasks", "brainstorm", "newNote"]);
	for (const action of g.ACTIONS) assert.equal(g.actionFor(map({ [action]: "DR" }), "DR"), action);
	assert.equal(g.actionFor(map({ back: "L", close: "L", reopen: "L" }), "L"), "close");
	assert.equal(g.actionFor(map({ forward: "R", back: "R" }), "R"), "back");
	assert.equal(g.actionFor(map(), ""), null);
	assert.equal(g.actionFor(map(), "L"), null);
	for (const invalid of ["X", "DD", "DRUL", "r"]) {
		assert.equal(g.actionFor(map({ close: invalid }), invalid), null);
	}
});

test("sharing: other actions in priority order, empty and unique gestures", () => {
	const gestures = map({ close: "D", back: "D", nextTab: "D", forward: "R" });
	assert.deepEqual(g.sharing(gestures, "back"), ["close", "nextTab"]);
	assert.deepEqual(g.sharing(gestures, "close"), ["back", "nextTab"]);
	assert.deepEqual(g.sharing(gestures, "forward"), []);
	assert.deepEqual(g.sharing(gestures, "reopen"), []);
});

test("tracker: short moves remain a plain click", () => {
	const tracker = new g.GestureTracker(10, 20);
	assert.equal(tracker.gesture, "");
	assert.deepEqual(feed(tracker, [[10, 20], [10, 27], [10, 43]]), [false, false, false]);
	assert.equal(tracker.gesture, "");
});

test("tracker: straight lines in all screen directions", () => {
	for (const [x, y, direction] of [[0, 100, "D"], [100, 0, "R"], [0, -100, "U"], [-100, 0, "L"]] as const) {
		const tracker = new g.GestureTracker(0, 0);
		assert.deepEqual(feed(tracker, [[x, y], [2 * x, 2 * y]]), [true, false]);
		assert.equal(tracker.gesture, direction);
	}
});

test("tracker: corners and reversals preserve stroke order", () => {
	const cases: [g.Gesture, [number, number][]][] = [
		["DR", [[0, 80], [80, 80]]], ["LU", [[-80, 0], [-80, -80]]],
		["DU", [[0, 80], [0, 0]]], ["UD", [[0, -80], [0, 0]]],
	];
	for (const [expected, path] of cases) {
		const tracker = new g.GestureTracker(0, 0);
		assert.deepEqual(feed(tracker, path), [true, true]);
		assert.equal(tracker.gesture, expected);
	}
});

test("tracker: downward travel tolerates a five pixel wobble", () => {
	const tracker = new g.GestureTracker(0, 0);
	const wobble = [0, 5, 0, -5];
	for (let step = 1; step <= 15; step++) feed(tracker, [[wobble[step % 4], step * 8]]);
	assert.equal(tracker.gesture, "D");
});

test("tracker: short hooks reset without repeating the last direction", () => {
	const tracker = new g.GestureTracker(0, 0);
	assert.deepEqual(feed(tracker, [[0, 80], [16, 80], [16, 120], [32, 120], [32, 160]]), [true, false, false, false, false]);
	assert.equal(tracker.gesture, "D");
});

test("tracker: diagonal ties stay horizontal and use Euclidean length", () => {
	const tracker = new g.GestureTracker(0, 0);
	assert.deepEqual(feed(tracker, [[6, 6], [12, 12], [18, 18]]), [false, false, true]);
	for (let step = 4; step <= 20; step++) feed(tracker, [[step * 6, step * 6]]);
	assert.ok(tracker.gesture.length <= 1);
	assert.equal(tracker.gesture, "R");
});

test("tracker: gesture length is uncapped", () => {
	const tracker = new g.GestureTracker(0, 0);
	assert.deepEqual(feed(tracker, [[0, 80], [80, 80], [80, 0], [0, 0]]), [true, true, true, true]);
	assert.equal(tracker.gesture, "DRUL");
	assert.equal(g.actionFor(map({ close: "DRUL" }), tracker.gesture), null);
	feed(tracker, [[0, 80]]);
	assert.equal(tracker.gesture, "DRULD");
});

test("tracker: ignored moves keep the anchor and changes return true exactly", () => {
	const tracker = new g.GestureTracker(0, 0);
	assert.deepEqual(feed(tracker, [[0, 4], [0, 8], [0, 16], [0, 23], [0, 24], [0, 32], [8, 32], [16, 32], [24, 32]]), [false, false, false, false, true, false, false, false, true]);
	assert.equal(tracker.gesture, "DR");
});

test("tracker: a different candidate replaces pending travel", () => {
	const tracker = new g.GestureTracker(0, 0);
	assert.deepEqual(feed(tracker, [[16, 0], [16, 8], [32, 8], [40, 8]]), [false, false, false, true]);
	assert.equal(tracker.gesture, "R");
});

test("tracker: points include ignored moves and trim the oldest positions", () => {
	const tracker = new g.GestureTracker(10, 20, { maxPoints: 3 });
	assert.deepEqual(tracker.points, [[10, 20]]);
	feed(tracker, [[11, 21]]);
	assert.deepEqual(tracker.points, [[10, 20], [11, 21]]);
	feed(tracker, [[11, 21], [12, 22]]);
	assert.deepEqual(tracker.points, [[11, 21], [11, 21], [12, 22]]);
	const defaults = new g.GestureTracker(0, 0);
	for (let x = 1; x <= 2001; x++) defaults.move(x, 0);
	assert.equal(defaults.points.length, 2000);
	assert.deepEqual(defaults.points[0], [2, 0]);
	assert.deepEqual(defaults.points[1999], [2001, 0]);
});

test("tracker: custom sample and stroke thresholds are inclusive", () => {
	const tracker = new g.GestureTracker(100, 100, { sample: 10, stroke: 30 });
	assert.deepEqual(feed(tracker, [[109, 100], [110, 100], [120, 100], [129, 100], [130, 100]]), [false, false, false, false, true]);
	assert.equal(tracker.gesture, "R");
	const small = new g.GestureTracker(0, 0, { sample: 2, stroke: 6 });
	assert.deepEqual(feed(small, [[0, -2], [0, -4], [0, -6]]), [false, false, true]);
	assert.equal(small.gesture, "U");
});

test("cleanCustom: drops invalid entries, cleans gestures and keeps order", () => {
	for (const value of [undefined, null, false, 42, "D", {}]) assert.deepEqual(g.cleanCustom(value), []);
	assert.deepEqual(g.cleanCustom([
		null, undefined, false, 42, "D", [], {}, { gesture: "D" },
		{ command: "" }, { command: 42 }, { command: null },
		{ command: "app:first", gesture: "DR" },
		{ command: "plugin:second", gesture: "DD" },
		{ command: "app:third", gesture: "" },
		{ command: "app:fourth", gesture: 42 },
		{ command: "app:fifth" },
	]), [
		{ command: "app:first", gesture: "DR" },
		{ command: "plugin:second", gesture: "" },
		{ command: "app:third", gesture: "" },
		{ command: "app:fourth", gesture: "" },
		{ command: "app:fifth", gesture: "" },
	]);
});

test("cleanCustom: unreadable values never throw", () => {
	const unreadable = { get command(): string { throw new Error("Unreadable"); } };
	const revoked = Proxy.revocable([], {});
	revoked.revoke();
	assert.deepEqual(g.cleanCustom(revoked.proxy), []);
	assert.deepEqual(g.cleanCustom([unreadable, { command: "app:ok", gesture: "D" }]), [{ command: "app:ok", gesture: "D" }]);
});

test("customFor: first match wins, empty and unsupported gestures never match", () => {
	const custom = [
		{ command: "app:first", gesture: "D" },
		{ command: "app:second", gesture: "D" },
		{ command: "app:off", gesture: "" },
		{ command: "app:invalid", gesture: "DD" },
	];
	assert.equal(g.customFor(custom, "D"), custom[0]);
	for (const gesture of ["R", "", "DD"]) assert.equal(g.customFor(custom, gesture), null);
	assert.equal(g.customFor([], "D"), null);
});

test("freeGesture: skips actions and custom entries in offered order", () => {
	assert.equal(g.freeGesture(map(), []), "L");
	assert.equal(g.freeGesture(map({ close: "L", back: "U" }), [
		{ command: "app:first", gesture: "R" }, { command: "app:off", gesture: "" },
	]), "D");
	const gestures = map();
	g.ACTIONS.forEach((action, index) => { gestures[action] = g.GESTURES[index]; });
	const custom = g.GESTURES.slice(g.ACTIONS.length).map((gesture) => ({ command: "app:command", gesture }));
	assert.equal(g.freeGesture(gestures, custom), "");
});

test("assign: an action takes its gesture from every other owner", () => {
	const result = g.assign(map({ close: "D", back: "D", forward: "R" }), [
		{ command: "app:first", gesture: "D" }, { command: "app:second", gesture: "U" },
	], { action: "home" }, "D");
	assert.deepEqual(result, {
		map: map({ home: "D", forward: "R" }),
		custom: [{ command: "app:first", gesture: "" }, { command: "app:second", gesture: "U" }],
	});
});

test("assign: a custom entry takes its gesture from every other owner", () => {
	const result = g.assign(map({ close: "D", back: "D", forward: "R" }), [
		{ command: "app:first", gesture: "D" }, { command: "app:second", gesture: "U" },
		{ command: "app:third", gesture: "D" },
	], { custom: 1 }, "D");
	assert.deepEqual(result, {
		map: map({ forward: "R" }),
		custom: [{ command: "app:first", gesture: "" }, { command: "app:second", gesture: "D" }, { command: "app:third", gesture: "" }],
	});
});

test("assign: an empty gesture turns off only the owner", () => {
	const gestures = map({ close: "D", back: "D" });
	const custom = [{ command: "app:first", gesture: "D" }, { command: "app:second", gesture: "D" }];
	assert.deepEqual(g.assign(gestures, custom, { action: "close" }, ""), { map: map({ back: "D" }), custom });
	assert.deepEqual(g.assign(gestures, custom, { custom: 0 }, ""), {
		map: gestures, custom: [{ command: "app:first", gesture: "" }, custom[1]],
	});
});

test("assign: copies inputs and preserves extra map keys", () => {
	const custom = Object.freeze([Object.freeze({ command: "app:first", gesture: "D" }), Object.freeze({ command: "app:second", gesture: "U" })]);
	const gestures = Object.freeze({ ...map({ close: "D" }), trail: "D", custom });
	const result = g.assign(gestures, custom, { custom: 0 }, "U");
	assert.deepEqual(gestures, { ...map({ close: "D" }), trail: "D", custom });
	assert.deepEqual(custom, [{ command: "app:first", gesture: "D" }, { command: "app:second", gesture: "U" }]);
	assert.deepEqual(result.map, gestures);
	assert.notEqual(result.map, gestures);
	assert.notEqual(result.custom, custom);
	for (let index = 0; index < custom.length; index++) assert.notEqual(result.custom[index], custom[index]);
	assert.deepEqual(g.assign(gestures, custom, { action: "back" }, "D").map, { ...map({ back: "D" }), trail: "D", custom });
});

test("assign: unknown custom indices change nothing and still return copies", () => {
	const gestures = map({ close: "D" });
	const custom = [{ command: "app:first", gesture: "D" }];
	for (const index of [-1, 1, 0.5, NaN, Infinity]) {
		const result = g.assign(gestures, custom, { custom: index }, "D");
		assert.deepEqual(result, { map: gestures, custom });
		assert.notEqual(result.map, gestures);
		assert.notEqual(result.custom, custom);
		assert.notEqual(result.custom[0], custom[0]);
	}
	assert.deepEqual(g.assign(gestures, [], { custom: 0 }, "D"), { map: gestures, custom: [] });
});
