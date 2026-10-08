// Task notes (src/modules/tasks/task-note.ts): the file name, and what is the body of a note.
import assert from "node:assert/strict";
import { test } from "node:test";
import { splitTaskNote, taskNoteName } from "../src/modules/tasks/task-note";

test("a task note is named after its task, safely", () => {
	assert.equal(taskNoteName("Task - ", "Reload the budget data"), "Task - Reload the budget data");
	assert.equal(taskNoteName("Task - ", "Ask: what/why? #now [x]"), "Task - Ask what why now x");
	assert.equal(taskNoteName("", "con"), "Task con");
	assert.equal(taskNoteName("", "..."), "Task");
	assert.equal(taskNoteName("Task - ", "x".repeat(200)).length, 80);
	assert.ok(!taskNoteName("Task - ", "Ends with a dot.").endsWith("."));
});

test("the body of a task note is what follows its breadcrumb", () => {
	assert.deepEqual(splitTaskNote("\n[[Meeting notes]]\n\nFirst idea\n\nSecond"), { head: "\n[[Meeting notes]]\n\n", body: "First idea\n\nSecond" });
	assert.deepEqual(splitTaskNote("[[Meeting notes]]\nText"), { head: "[[Meeting notes]]\n", body: "Text" });
	assert.deepEqual(splitTaskNote("Just text\n[[Not a crumb]]"), { head: "", body: "Just text\n[[Not a crumb]]" });
	assert.deepEqual(splitTaskNote("---\nstatus: open\n---\n\n[[Source]]\n\nBody"), { head: "---\nstatus: open\n---\n\n[[Source]]\n\n", body: "Body" });
	assert.deepEqual(splitTaskNote("---\nstatus: open\n---\nBody"), { head: "---\nstatus: open\n---\n", body: "Body" });
	const { head, body } = splitTaskNote("\n[[Source]]\n\nOld");
	assert.equal(head + "New body", "\n[[Source]]\n\nNew body", "writing the body keeps the breadcrumb");
	assert.equal(body, "Old");
});
