import assert from "node:assert/strict";
import { test } from "node:test";
import { scanTasks } from "../src/modules/tasks/parse";
import { foldGroup, sortByWeight, weightOf } from "../src/modules/tasks/weight";

const tasks = scanTasks([
	"- [ ] A #project #low",
	"- [ ] B #project #high",
	"- [ ] C #project",
	"- [ ] D #project #medium",
	"- [ ] E #project #low",
	"- [ ] F #project #high #waiting #someday",
	"- [ ] G #project #someday",
	"- [ ] H #project #waiting",
], "Tasks.md", new Set(["high", "medium", "low", "waiting", "someday"]));
const opts = { room: false, waitingFlag: "waiting", somedayFlag: "someday" };

test("weights place unprioritized tasks before low priority", () => {
	assert.deepEqual(tasks.slice(0, 4).map(weightOf), [3, 0, 2, 1]);
});

test("All fills from the first lighter tasks while preserving input order", () => {
	const before = [...tasks];
	assert.deepEqual(foldGroup(tasks, opts), {
		shown: [tasks[0], tasks[1], tasks[3]], lighter: [tasks[2], tasks[4]],
		waiting: [tasks[5], tasks[7]], someday: [tasks[6]],
	});
	assert.deepEqual(tasks, before);
	assert.deepEqual(foldGroup(tasks, { ...opts, minShown: 0 }).shown, [tasks[1], tasks[3]]);
	assert.deepEqual(foldGroup(tasks, { ...opts, minShown: 4 }).shown, tasks.slice(0, 4));
	assert.deepEqual(foldGroup(tasks, { ...opts, minShown: 20 }).shown, tasks.slice(0, 5));
	assert.deepEqual(foldGroup(tasks, { ...opts, minShown: 20 }).lighter, []);
	assert.deepEqual(foldGroup([], opts), { shown: [], lighter: [], waiting: [], someday: [] });
	assert.deepEqual(foldGroup([tasks[0], tasks[2]], opts).shown, [tasks[0], tasks[2]]);
});

test("room shows all active tasks and waiting takes precedence over someday", () => {
	assert.deepEqual(foldGroup(tasks, { ...opts, room: true }), {
		shown: tasks.slice(0, 5), lighter: [], waiting: [tasks[5], tasks[7]], someday: [tasks[6]],
	});
});

test("null flags do not park tasks", () => {
	assert.deepEqual(foldGroup(tasks, { room: true, waitingFlag: null, somedayFlag: null }), {
		shown: tasks, lighter: [], waiting: [], someday: [],
	});
	const all = foldGroup(tasks, { room: false, waitingFlag: null, somedayFlag: null });
	assert.deepEqual(all.shown, [tasks[1], tasks[3], tasks[5]]);
	assert.deepEqual(all.lighter, [tasks[0], tasks[2], tasks[4], tasks[6], tasks[7]]);
	assert.deepEqual(foldGroup(tasks, { ...opts, waitingFlag: null }).someday, [tasks[5], tasks[6]]);
	assert.deepEqual(foldGroup(tasks, { ...opts, somedayFlag: null }).waiting, [tasks[5], tasks[7]]);
});

test("sortByWeight applies tie breaks, stays stable and leaves input untouched", () => {
	const input = Object.freeze([...tasks]);
	assert.deepEqual(sortByWeight(input, () => 0), [tasks[1], tasks[5], tasks[3], tasks[2], tasks[6], tasks[7], tasks[0], tasks[4]]);
	assert.deepEqual(sortByWeight(input, (a, b) => b.line - a.line), [tasks[5], tasks[1], tasks[3], tasks[7], tasks[6], tasks[2], tasks[4], tasks[0]]);
	assert.deepEqual(input, tasks);
});
