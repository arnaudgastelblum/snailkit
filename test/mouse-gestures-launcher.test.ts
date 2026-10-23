import assert from "node:assert/strict";
import { test } from "node:test";
import { crumb, recentTabs, withLauncher } from "../src/modules/mouse-gestures/launcher-logic";

const defaults = {
	close: "DR", reopen: "LU", back: "L", forward: "R", newTab: "DU", nextTab: "UR",
	prevTab: "UL", launcher: "D", home: "U", tasks: "RD", brainstorm: "LD", newNote: "DL",
};

test("recentTabs: most recent first, preserving input order on ties", () => {
	assert.deepEqual(recentTabs([
		{ path: "A.md", activeTime: 2 },
		{ path: "B.md", activeTime: 4 },
		{ path: "C.md", activeTime: 4 },
	], null), ["B.md", "C.md", "A.md"]);
});

test("recentTabs: duplicates keep their latest time and first position on ties", () => {
	const tabs = Object.freeze([
		Object.freeze({ path: "A.md", activeTime: 1 }),
		Object.freeze({ path: "B.md", activeTime: 5 }),
		Object.freeze({ path: "A.md", activeTime: 5 }),
		Object.freeze({ path: "B.md", activeTime: 2 }),
	]);
	assert.deepEqual(recentTabs(tabs, null), ["A.md", "B.md"]);
	assert.deepEqual(recentTabs(tabs, "A.md"), ["B.md"]);
});

test("recentTabs: default and explicit limits, including zero and negative", () => {
	const tabs = Array.from({ length: 7 }, (_, i) => ({ path: `${i}.md`, activeTime: i }));
	assert.deepEqual(recentTabs(tabs, null), ["6.md", "5.md", "4.md", "3.md", "2.md"]);
	assert.deepEqual(recentTabs(tabs, "6.md", 2), ["5.md", "4.md"]);
	assert.deepEqual(recentTabs(tabs, null, 0), []);
	assert.deepEqual(recentTabs(tabs, null, -1), []);
	assert.deepEqual(recentTabs([], null), []);
});

test("crumb: nearest two parents, top first, with home only when alone", () => {
	assert.equal(crumb(Object.freeze(["Brindle Intake", "Brindle Loomworks", "Home"]), "Home"), "Brindle Loomworks › Brindle Intake");
	assert.equal(crumb(["Home"], "Home"), "Home");
	assert.equal(crumb(["A", "B", "C", "D"], null), "B › A");
	assert.equal(crumb([], "Home"), "");
	assert.equal(crumb(["A"], "Home"), "A");
	assert.equal(crumb(["A", "Home", "B"], "Home"), "B › A");
});

test("withLauncher: move the older New tab gesture", () => {
	assert.deepEqual(withLauncher({ newTab: "D" }, defaults), { newTab: "DU", launcher: "D" });
});

test("withLauncher: preserve a customized or disabled New tab gesture", () => {
	for (const newTab of ["UD", "R", ""]) {
		assert.deepEqual(withLauncher({ newTab }, defaults), { newTab, launcher: "D" });
	}
});

test("withLauncher: do not take D from another action", () => {
	assert.deepEqual(withLauncher({ newTab: "UD", close: "D" }, defaults), { newTab: "UD", close: "D", launcher: "" });
});

test("withLauncher: disable New tab when DU belongs to another action", () => {
	assert.deepEqual(withLauncher({ newTab: "D", reopen: "DU" }, defaults), { newTab: "", reopen: "DU", launcher: "D" });
});

test("withLauncher: existing launcher keys are copied unchanged", () => {
	for (const launcher of ["", "UD", null, undefined]) {
		const stored = Object.freeze({ launcher, newTab: "D" });
		const result = withLauncher(stored, defaults);
		assert.deepEqual(result, stored);
		assert.notEqual(result, stored);
	}
});

test("withLauncher: preserve inputs and ignore non-action keys", () => {
	const stored = Object.freeze({ newTab: "D", trail: "DU", extra: "D" });
	assert.deepEqual(withLauncher(stored, Object.freeze({ ...defaults })), {
		newTab: "DU", trail: "DU", extra: "D", launcher: "D",
	});
	assert.deepEqual(stored, { newTab: "D", trail: "DU", extra: "D" });
});

test("withLauncher: missing actions use defaults for both conflicts", () => {
	assert.deepEqual(withLauncher({}, defaults), { launcher: "D" });
	assert.deepEqual(withLauncher({}, { ...defaults, newTab: "D" }), { newTab: "DU", launcher: "D" });
	assert.deepEqual(withLauncher({ newTab: "D" }, { ...defaults, reopen: "DU" }), { newTab: "", launcher: "D" });
	assert.deepEqual(withLauncher({}, { ...defaults, close: "D" }), { launcher: "" });
	assert.deepEqual(withLauncher({ newTab: null }, defaults), { newTab: null, launcher: "D" });
});
