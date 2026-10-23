import assert from "node:assert/strict";
import { test } from "node:test";
import { TFile } from "obsidian";
import { aroundTags, choosableTree, flatTree, tagChoices } from "../src/modules/tasks/around";
import { createTasksApi } from "../src/modules/tasks/api";
import type { TagNode } from "../src/modules/tasks/group";
import type { TaskIndex } from "../src/modules/tasks/task-index";
import type { Context, Task } from "../src/modules/tasks/types";
import type { TaskWriter } from "../src/modules/tasks/writer";

test("flatTree keeps parents before children in the supplied order", () => {
	const node = (tag: string, depth: number, count: number, children: TagNode[] = []): TagNode => ({ tag, name: tag, depth, count, children, own: [] });
	assert.deepEqual(flatTree([
		node("project", 0, 3, [node("project/z", 1, 2, [node("project/z/deep", 2, 1)]), node("project/a", 1, 1)]),
		node("books", 0, 1),
	]), [
		{ tag: "project", depth: 0, count: 3 },
		{ tag: "project/z", depth: 1, count: 2 },
		{ tag: "project/z/deep", depth: 2, count: 1 },
		{ tag: "project/a", depth: 1, count: 1 },
		{ tag: "books", depth: 0, count: 1 },
	]);
	assert.deepEqual(flatTree([]), []);
});

test("aroundTags puts the owner first, then local counts and alphabetical ties", () => {
	assert.deepEqual(aroundTags({
		path: "Note.md",
		owner: { tag: "OWNER", title: "Read the plan" },
		tasks: ["z", "B", "a", "b", "owner"].map((primary) => ({ path: "Note.md", primary })),
		limit: 10,
	}), [
		{ tag: "owner", where: { kind: "task", title: "Read the plan" } },
		{ tag: "b", where: { kind: "here", count: 2 } },
		{ tag: "a", where: { kind: "here", count: 1 } },
		{ tag: "z", where: { kind: "here", count: 1 } },
	]);
});

test("aroundTags keeps only used note groups in note order and deduplicates sources", () => {
	assert.deepEqual(aroundTags({
		path: "Note.md",
		owner: { tag: "", title: "Ignored" },
		tasks: [
			{ path: "Note.md", primary: "local" },
			{ path: "Other.md", primary: "books" },
			{ path: "Other.md", primary: "project" },
		],
		noteTags: ["unknown", "PROJECT", "LOCAL", "project", "Books"],
	}), [
		{ tag: "local", where: { kind: "here", count: 1 } },
		{ tag: "project", where: { kind: "note" } },
		{ tag: "books", where: { kind: "note" } },
	]);
});

test("aroundTags visits nearest levels first and counts level notes and descendants", () => {
	assert.deepEqual(aroundTags({
		path: "Note.md",
		tasks: [
			{ path: "Note.md", primary: "local" },
			{ path: "Parent.md", primary: "near" },
			{ path: "Child.md", primary: "NEAR" },
			{ path: "Child.md", primary: "alpha" },
			{ path: "Parent.md", primary: "beta" },
			{ path: "Area.md", primary: "far" },
			{ path: "Sibling.md", primary: "far" },
			{ path: "Elsewhere.md", primary: "outside" },
		],
		levels: [{ path: "Parent.md", name: "Parent" }, { path: "Area.md", name: "Area" }],
		chainOf: (path) => ["Note.md", "Child.md"].includes(path) ? ["Parent.md", "Area.md"] : ["Parent.md", "Sibling.md"].includes(path) ? ["Area.md"] : [],
		limit: 10,
	}), [
		{ tag: "local", where: { kind: "here", count: 1 } },
		{ tag: "near", where: { kind: "above", name: "Parent", path: "Parent.md", count: 2 } },
		{ tag: "alpha", where: { kind: "above", name: "Parent", path: "Parent.md", count: 1 } },
		{ tag: "beta", where: { kind: "above", name: "Parent", path: "Parent.md", count: 1 } },
		{ tag: "far", where: { kind: "above", name: "Area", path: "Area.md", count: 2 } },
	]);
});

test("aroundTags leaves out a tag seldom used above, and says where a tag of the note is used", () => {
	const tasks = [
		...Array.from({ length: 8 }, () => ({ path: "Parent.md", primary: "client/a" })),
		{ path: "Sibling.md", primary: "client/b" },
		{ path: "Sibling.md", primary: "client/c" },
		{ path: "Sibling.md", primary: "client/c" },
		{ path: "Elsewhere.md", primary: "practice" },
	];
	const input = { path: "Note.md", tasks, levels: [{ path: "Parent.md", name: "Parent" }], chainOf: (path: string) => (path === "Sibling.md" ? ["Parent.md"] : []), limit: 10 };
	// client/b (1 of 8) says little; client/c (2 of 8) stays.
	assert.deepEqual(aroundTags(input).map((a) => [a.tag, a.where.kind === "above" ? a.where.count : null]), [["client/a", 8], ["client/c", 2]]);
	// The note's own tags: where they are used above, else "tag of the note".
	assert.deepEqual(aroundTags({ ...input, noteTags: ["practice", "Client/A"] }).slice(0, 2), [
		{ tag: "practice", where: { kind: "note" } },
		{ tag: "client/a", where: { kind: "above", name: "Parent", path: "Parent.md", count: 8 } },
	]);
});

test("aroundTags defaults to three and stops before looking further", () => {
	const input = {
		path: "Note.md",
		tasks: ["d", "c", "b", "a"].map((primary) => ({ path: "Note.md", primary })),
		levels: [{ path: "Parent.md", name: "Parent" }],
		chainOf: () => { throw new Error("Should stop at the limit"); },
	};
	assert.deepEqual(aroundTags(input).map((entry) => entry.tag), ["a", "b", "c"]);
	assert.equal(aroundTags({ ...input, limit: 1 }).length, 1);
	assert.deepEqual(aroundTags({ ...input, limit: 0 }), []);
});

function fixture() {
	const files = ["Note", "Parent", "Area", "Home", "Child"].map((name) => Object.assign(new TFile(), { path: `${name}.md`, basename: name }));
	const [note, parent, area, home, child] = files;
	const list = [
		{ path: note.path, primary: "local", done: true },
		{ path: parent.path, primary: "project/z", done: false },
		{ path: child.path, primary: "project/a", done: false },
		{ path: child.path, primary: "project/a", done: true },
		{ path: home.path, primary: "home", done: true },
	] as Task[];
	const index = { list, open: () => list.filter((task) => !task.done), ownerOf: () => null, flags: () => new Set(["high", "medium", "low"]) } as unknown as TaskIndex;
	const calls = new Map<string, number>();
	const places = {
		version: 1,
		placeOf(file: TFile) {
			calls.set(file.path, (calls.get(file.path) ?? 0) + 1);
			return { chain: file === note ? [parent, area, home] : file === child ? [area, home] : [], area };
		},
	};
	const ctx = {
		settings: { tagOrder: ["project/z", "project/a"] },
		app: { vault: { getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null }, metadataCache: { getFileCache: () => null } },
		service: () => places,
	} as unknown as Context;
	return { index, ctx, places, calls };
}

test("tagChoices uses open tasks for the ordered tree and all tasks around a note, stopping at its area", () => {
	const { index, ctx, calls } = fixture();
	assert.deepEqual(tagChoices(index, ctx, "Note.md"), {
		tree: [{ tag: "project", depth: 0, count: 2 }, { tag: "project/z", depth: 1, count: 1 }, { tag: "project/a", depth: 1, count: 1 }],
		around: [
			{ tag: "local", where: { kind: "here", count: 1 } },
			{ tag: "project/z", where: { kind: "above", name: "Parent", path: "Parent.md", count: 1 } },
			{ tag: "project/a", where: { kind: "above", name: "Area", path: "Area.md", count: 2 } },
		],
	});
	assert.ok([...calls.values()].every((count) => count === 1));
	assert.deepEqual(tagChoices(index, ctx, null).around, []);
	assert.deepEqual(tagChoices(index, ctx, "Missing.md").around, []);
	assert.equal(tagChoices(index, undefined, null).tree.length, 3);
});

test("tagChoices keeps local tags when places fails or its area is outside the chain", () => {
	const { index, ctx, places } = fixture();
	const local = [{ tag: "local", where: { kind: "here", count: 1 } }];
	const placeOf = places.placeOf;
	places.placeOf = (file) => {
		if (file.path === "Child.md") throw new Error("Unavailable");
		return placeOf(file);
	};
	assert.deepEqual(tagChoices(index, ctx, "Note.md").around, local);
	places.placeOf = () => ({ chain: [], area: new TFile() });
	assert.deepEqual(tagChoices(index, ctx, "Note.md").around, local);
});

test("Tasks API exposes tag choices and returns empty choices after shutdown", () => {
	const { index } = fixture();
	let alive = true;
	const api = createTasksApi(index, {} as TaskWriter, () => alive);
	assert.equal(api.tagChoices!(null).tree.length, 3);
	alive = false;
	assert.deepEqual(api.tagChoices!(null), { tree: [], around: [] });
});

test("the tree never offers a parent a task cannot take as its group: priority, flag, digits only", () => {
	const entries = [
		{ tag: "high", depth: 0, count: 1 },
		{ tag: "high/project", depth: 1, count: 1 },
		{ tag: "2026", depth: 0, count: 2 },
		{ tag: "2026/plan", depth: 1, count: 2 },
		{ tag: "2026/plan/q1", depth: 2, count: 1 },
		{ tag: "waiting", depth: 0, count: 1 },
		{ tag: "waiting/bank", depth: 1, count: 1 },
		{ tag: "home", depth: 0, count: 1 },
		{ tag: "home/car", depth: 1, count: 1 },
	];
	assert.deepEqual(choosableTree(entries, new Set(["high", "medium", "low", "waiting"])), [
		{ tag: "high/project", depth: 0, count: 1 },
		{ tag: "2026/plan", depth: 0, count: 2 },
		{ tag: "2026/plan/q1", depth: 1, count: 1 },
		{ tag: "waiting/bank", depth: 0, count: 1 },
		{ tag: "home", depth: 0, count: 1 },
		{ tag: "home/car", depth: 1, count: 1 },
	]);
});
