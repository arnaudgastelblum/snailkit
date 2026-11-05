import assert from "node:assert/strict";
import { test } from "node:test";
import { LATER_DAYS, laterUntil, pruneLater, updateFirstSeen, worthALook } from "../src/modules/tasks/today-plan";
import type { LookOptions } from "../src/modules/tasks/today-plan";
import type { Task } from "../src/modules/tasks/types";

function task(key: string, fields: Partial<Task> = {}): Task {
	return {
		key, baseKey: key, title: key, primary: "project/website", tags: ["project/website"],
		priority: null, due: null, doneDate: null, noteLink: null, markers: {},
		path: "Tasks.md", line: 0, raw: `- [ ] ${key} #project/website`, indent: "",
		text: `${key} #project/website`, done: false, subtasks: [], description: "", ...fields,
	};
}

const today = "2026-11-04";
const options: LookOptions = { today, firstSeen: new Map(), later: new Map() };

test("soon includes tomorrow through day seven, excluding today, overdue and day eight", () => {
	const tasks = ["2026-11-03", today, "2026-11-05", "2026-11-11", "2026-11-12"]
		.map((due) => task(due, { due, priority: "high" }));
	const firstSeen = new Map(tasks.map((t) => [t.key, today]));
	assert.deepEqual(worthALook(tasks, { ...options, firstSeen }), { soon: tasks.slice(2, 4), high: [], fresh: [] });
});

test("soonDays accepts a custom inclusive boundary and zero", () => {
	const tasks = [task("edge", { due: "2026-11-06" }), task("outside", { due: "2026-11-07" })];
	assert.deepEqual(worthALook(tasks, { ...options, soonDays: 2 }).soon, [tasks[0]]);
	assert.deepEqual(worthALook(tasks, { ...options, soonDays: 0 }).soon, []);
});

test("soon sorts by date, priority, note path and line without changing input", () => {
	const fields = { due: "2026-11-06" };
	const tasks = Object.freeze([
		task("none", fields), task("low", { ...fields, priority: "low" }),
		task("medium", { ...fields, priority: "medium" }),
		task("high-z", { ...fields, priority: "high", path: "Z.md" }),
		task("high-line", { ...fields, priority: "high", path: "A.md", line: 2 }),
		task("high-first", { ...fields, priority: "high", path: "A.md", line: 1 }),
		task("earliest", { due: "2026-11-05" }),
	].map((t) => Object.freeze(t)));
	const before = [...tasks];
	assert.deepEqual(worthALook(tasks, options).soon, [...tasks].reverse());
	assert.deepEqual(tasks, before);
});

test("high contains only undated high priority tasks in note order", () => {
	const tasks = [
		task("last", { priority: "high", path: "Z.md" }),
		task("second", { priority: "high", path: "A.md", line: 2 }),
		task("first", { priority: "high", path: "A.md", line: 1 }),
		task("medium", { priority: "medium" }), task("low", { priority: "low" }),
		task("distant", { priority: "high", due: "2026-12-01" }),
	];
	assert.deepEqual(worthALook(tasks, options), { soon: [], high: tasks.slice(0, 3).reverse(), fresh: [] });
});

test("fresh includes ages zero through two and future dates, excluding empty and unknown dates", () => {
	const tasks = ["today", "yesterday", "two", "three", "old", "future", "seeded", "unknown"].map((key) => task(key));
	const firstSeen = new Map([
		["today", today], ["yesterday", "2026-11-03"], ["two", "2026-11-02"],
		["three", "2026-11-01"], ["old", "2026-10-01"], ["future", "2026-11-05"], ["seeded", ""],
	]);
	assert.deepEqual(worthALook(tasks, { ...options, firstSeen }).fresh, [tasks[5], ...tasks.slice(0, 3)]);
	assert.deepEqual(worthALook(tasks, { ...options, firstSeen, newDays: 1 }).fresh, [tasks[5], tasks[0]]);
	assert.deepEqual(worthALook(tasks, { ...options, firstSeen, newDays: 0 }).fresh, []);
});

test("fresh sorts newest first and breaks equal dates by note path and line", () => {
	const tasks = [task("old"), task("z", { path: "Z.md" }), task("a2", { path: "A.md", line: 2 }), task("a1", { path: "A.md", line: 1 })];
	const firstSeen = new Map(tasks.map((t) => [t.key, t.key === "old" ? "2026-11-03" : today]));
	assert.deepEqual(worthALook(tasks, { ...options, firstSeen }).fresh, [...tasks].reverse());
});

test("recently seen tasks with priorities or due dates are never fresh and appear in at most one group", () => {
	const tasks = [
		task("soon-high", { priority: "high", due: "2026-11-05" }),
		task("high", { priority: "high" }), task("medium", { priority: "medium" }),
		task("low", { priority: "low" }), task("distant", { due: "2026-12-01" }),
		task("today", { due: today }), task("overdue", { due: "2026-11-03" }), task("fresh"),
	];
	const firstSeen = new Map(tasks.map((t) => [t.key, today]));
	assert.deepEqual(worthALook(tasks, { ...options, firstSeen }), { soon: [tasks[0]], high: [tasks[1]], fresh: [tasks[7]] });
});

test("later hides every group until the return day, including the day before", () => {
	const tasks = [task("soon", { due: "2026-11-08" }), task("high", { priority: "high" }), task("fresh")];
	const firstSeen = new Map([["fresh", today]]);
	const later = new Map(tasks.map((t) => [t.key, "2026-11-06"]));
	const before = [...later];
	for (const date of [today, "2026-11-05"]) {
		assert.deepEqual(worthALook(tasks, { ...options, today: date, firstSeen, later }), { soon: [], high: [], fresh: [] });
	}
	assert.deepEqual(worthALook(tasks, { ...options, today: "2026-11-06", firstSeen, later }), {
		soon: [tasks[0]], high: [tasks[1]], fresh: [tasks[2]],
	});
	assert.deepEqual(worthALook(tasks, { ...options, today: "2026-11-07", firstSeen, later, newDays: 4 }).fresh, [tasks[2]]);
	assert.deepEqual([...later], before);
	assert.deepEqual([...firstSeen], [["fresh", today]]);
});

test("empty tasks return empty groups", () => {
	assert.deepEqual(worthALook([], options), { soon: [], high: [], fresh: [] });
});

test("first seen preserves dates and empty sentinels, adds today and drops missing keys", () => {
	const prev = Object.freeze([Object.freeze(["old", "2026-10-01"] as const), Object.freeze(["seeded", ""] as const), Object.freeze(["gone", today] as const)]);
	const keys = Object.freeze(["new", "seeded", "old", "new", "old"]);
	assert.deepEqual(updateFirstSeen(prev, keys, today, false), {
		next: [["new", today], ["seeded", ""], ["old", "2026-10-01"]], changed: true,
	});
	assert.deepEqual(prev, [["old", "2026-10-01"], ["seeded", ""], ["gone", today]]);
});

test("seeding marks new keys as old while preserving existing dates", () => {
	assert.deepEqual(updateFirstSeen([["known", "2026-11-01"]], ["new", "known", "new"], today, true), {
		next: [["new", ""], ["known", "2026-11-01"]], changed: true,
	});
	assert.deepEqual(updateFirstSeen([], ["a", "b"], today, true), { next: [["a", ""], ["b", ""]], changed: true });
});

test("first seen changed compares content and order, ignoring duplicate current keys", () => {
	const prev: Array<[string, string]> = [["a", ""], ["b", today]];
	assert.deepEqual(updateFirstSeen(prev, ["a", "b", "a"], today, false), { next: prev, changed: false });
	assert.deepEqual(updateFirstSeen(prev, ["b", "a"], today, false), { next: [prev[1], prev[0]], changed: true });
	assert.deepEqual(updateFirstSeen([["a", ""]], ["b"], today, true), { next: [["b", ""]], changed: true });
	assert.deepEqual(updateFirstSeen([["a", today], ["a", today]], ["a"], today, false), { next: [["a", today]], changed: true });
	assert.deepEqual(updateFirstSeen(prev, [], today, false), { next: [], changed: true });
	assert.deepEqual(updateFirstSeen([], [], today, false), { next: [], changed: false });
});

test("laterUntil defaults to three days and supports custom days across calendar boundaries", () => {
	assert.equal(LATER_DAYS, 3);
	assert.equal(laterUntil(today), "2026-11-07");
	assert.equal(laterUntil(today, 0), today);
	assert.equal(laterUntil("2026-12-30"), "2027-01-02");
	assert.equal(laterUntil("2028-02-28", 2), "2028-03-01");
});

test("pruneLater drops absent keys and expired dates, preserving pair order and duplicates", () => {
	const prev = Object.freeze([
		Object.freeze(["b", "2026-11-08"] as const), Object.freeze(["gone", "2026-11-08"] as const),
		Object.freeze(["today", today] as const), Object.freeze(["past", "2026-11-03"] as const),
		Object.freeze(["a", "2026-11-05"] as const), Object.freeze(["b", "2026-11-09"] as const),
	]);
	assert.deepEqual(pruneLater(prev, ["a", "b", "today", "past", "a"], today), {
		next: [prev[0], prev[4], prev[5]], changed: true,
	});
	assert.equal(prev.length, 6);
});

test("pruneLater changed is false for identical pairs regardless of current key order", () => {
	const prev: Array<[string, string]> = [["b", "2026-11-08"], ["a", "2026-11-05"]];
	assert.deepEqual(pruneLater(prev, ["a", "b", "a"], today), { next: prev, changed: false });
	assert.deepEqual(pruneLater(prev, [], today), { next: [], changed: true });
	assert.deepEqual(pruneLater([], ["a"], today), { next: [], changed: false });
});
