// Tasks: line parsing, line rewriting, quick add, grouping, and the public API over a fake vault.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TFile } from "obsidian";
import { createTasksApi } from "../src/modules/tasks/api";
import {
	insertTaskLine, insertToken, locateLine, minimalChange, newTaskPath, removeTag, retagText, retitleText,
	setDoneLine, setDueText, setMarkerText, setPriorityText,
} from "../src/modules/tasks/edit";
import {
	addDays, buildTree, countTasks, daysBetween, dueLabel, dueState, fallbackHue, findNode, inScope, isIsoDate,
	matchesQuery, nextWeek, passesPriority, sortTasks, todayGroups, upcomingGroups,
} from "../src/modules/tasks/group";
import {
	flagSet, inlineParts, isInFolder, parseFolderList, parseTagList, parseTaskText, plainTitle, scanTasks, taskKey,
} from "../src/modules/tasks/parse";
import { normalizeWord, parseQuickAdd } from "../src/modules/tasks/quick-add";
import { TaskIndex } from "../src/modules/tasks/task-index";
import type { Context, Task, TasksSettings } from "../src/modules/tasks/types";
import { TaskWriter } from "../src/modules/tasks/writer";

const FLAGS = flagSet("urgent");

// ----- parsing -----

test("a task line gives its group tag, flags, priority, dates, markers and title", () => {
	const f = parseTaskText("Fix the footer #project/website #high #urgent 📅 2026-10-12 ⏰ 14:30 %%sync:abc1%% ^b1", FLAGS);
	assert.equal(f.primary, "project/website");
	assert.deepEqual(f.tags, ["project/website", "high", "urgent"]);
	assert.equal(f.priority, "high");
	assert.equal(f.due, "2026-10-12");
	assert.equal(f.title, "Fix the footer");
	assert.deepEqual(f.markers, { sync: "abc1" });
	// Secondary tags stay in the title; a leading star counts as high.
	const g = parseTaskText("⭐ Read #reading the book #home ✅ 2026-10-01", FLAGS);
	assert.equal(g.primary, "reading");
	assert.equal(g.priority, "high");
	assert.equal(g.title, "Read the book #home");
	assert.equal(g.doneDate, "2026-10-01");
	// Numbers are not tags, links are not tags, flags alone make no group.
	assert.equal(parseTaskText("Call at #3 about [[Note#Section]]", FLAGS).primary, null);
	assert.equal(parseTaskText("Something #urgent #low", FLAGS).primary, null);
	// Scheduled, start and created dates of the Tasks plugin never show in the title.
	assert.equal(parseTaskText("Plan #home ⏳ 2026-10-03 🛫 2026-10-01 ➕ 2026-09-30", FLAGS).title, "Plan");
});

test("the identity of a task is its tag and its words", () => {
	assert.equal(taskKey("home", "Call the bank, now!"), "home|call the bank now");
	const a = parseTaskText("Call the bank #home #high 📅 2026-10-12", FLAGS);
	const b = parseTaskText("Call the bank #home", FLAGS);
	assert.equal(taskKey(a.primary!, a.title), taskKey(b.primary!, b.title));
});

test("scanning a note skips frontmatter, code blocks, untagged and other statuses, and reads subtasks", () => {
	const lines = [
		"---",
		"- [ ] In properties #home",
		"---",
		"- [ ] Open #home",
		"\t- [x] Step one",
		"\t- [ ] Step two",
		"\t- [ ] Own task #reading",
		"\tsome note",
		"- [x] Done #home ✅ 2026-10-01",
		"- [>] Migrated #home",
		"- [ ] No tag",
		"```",
		"- [ ] In code #home",
		"```",
		"1. [ ] Numbered #project/website",
	];
	const tasks = scanTasks(lines, "Notes/A.md", FLAGS);
	assert.deepEqual(tasks.map((t) => [t.line, t.primary, t.done]), [
		[3, "home", false],
		[6, "reading", false],
		[8, "home", true],
		[14, "project/website", false],
	]);
	assert.deepEqual(tasks[0].subtasks.map((s) => [s.text, s.done]), [["Step one", true], ["Step two", false]]);
	assert.equal(tasks[0].raw, "- [ ] Open #home");
	assert.equal(tasks[0].path, "Notes/A.md");
});

test("lists in settings and folders", () => {
	assert.deepEqual(parseTagList(" #Urgent, someday ,, "), ["urgent", "someday"]);
	assert.deepEqual(parseFolderList("Templates, /Archive/ ,"), ["Templates", "Archive"]);
	assert.ok(isInFolder("Archive/2025/a.md", ["Archive"]));
	assert.ok(!isInFolder("Archives/a.md", ["Archive"]));
	assert.ok(flagSet("").has("high") && !flagSet("").has("todo"));
});

test("titles: plain text and inline Markdown parts", () => {
	assert.equal(plainTitle("Read **this** [[Folder/Note|the note]] and [[Other#Part]] `x`"), "Read this the note and Other x");
	assert.deepEqual(inlineParts("Fix `a` in [[Folder/Page]] **now**").map((p) => p.kind + ":" + p.text), [
		"text:Fix ",
		"code:a",
		"text: in ",
		"link:Page",
		"text: ",
		"strong:now",
	]);
});

// ----- rewriting lines -----

test("new tokens go before the trailing run of counters, stamps, comments and block ids", () => {
	assert.equal(insertToken("Call #home ↻2", "#high"), "Call #home #high ↻2");
	assert.equal(insertToken("Call #home %%sync:a%% ^b1", "📅 2026-10-12"), "Call #home 📅 2026-10-12 %%sync:a%% ^b1");
	assert.equal(insertToken("", "#home"), "#home");
});

test("priority replaces stars and priority tags, None removes them", () => {
	assert.equal(setPriorityText("⭐ Call #home #low ↻1", "medium"), "Call #home #medium ↻1");
	assert.equal(setPriorityText("Call #high #home", null), "Call #home");
	assert.equal(removeTag("#high Call #home", "high"), "Call #home");
	assert.equal(removeTag("Call #homework #home", "home"), "Call #homework");
});

test("the due date is changed where it stands, added, or removed; a reminder time is left alone", () => {
	assert.equal(setDueText("Call #home 📅 2026-10-12 ⏰ 14:30", "2026-10-20"), "Call #home 📅 2026-10-20 ⏰ 14:30");
	assert.equal(setDueText("Call #home 📅 2026-10-12 ⏰ 14:30", null), "Call #home ⏰ 14:30");
	assert.equal(setDueText("Call #home ✅ 2026-10-01", "2026-10-12"), "Call #home 📅 2026-10-12 ✅ 2026-10-01");
	assert.equal(setDueText("Call #home", null), "Call #home");
});

test("moving to a tag replaces the group tag in place", () => {
	assert.equal(retagText("#home Call the bank", "home", "project/website"), "#project/website Call the bank");
	assert.equal(retagText("Call #Home #home/garden", "home", "reading"), "Call #reading #home/garden");
	assert.equal(retagText("Call", "home", "reading"), "Call #reading");
});

test("renaming changes the title only", () => {
	assert.equal(retitleText("Call Bob #home 📅 2026-10-12", "Call Bob", "Call Alice"), "Call Alice #home 📅 2026-10-12");
	// Title split by a token: rebuilt as new title + tokens in order.
	assert.equal(retitleText("Call #home Bob #high ^b1", "Call Bob", "Write to Bob"), "Write to Bob #home #high ^b1");
	// A tag typed in the new title is not repeated.
	assert.equal(retitleText("Read #reading the book #home", "Read the book #home", "Read it #home"), "Read it #home #reading");
	// The old title found inside a token does not count.
	assert.equal(retitleText("home #home", "home", "garden"), "garden #home");
});

test("checking stamps the date before a block id, unchecking removes it", () => {
	assert.equal(setDoneLine("- [ ] Call #home ^b1", true, "2026-10-02"), "- [x] Call #home ✅ 2026-10-02 ^b1");
	assert.equal(setDoneLine("\t* [ ] Call #home", true, null), "\t* [x] Call #home");
	assert.equal(setDoneLine("- [x] Call #home ✅ 2026-10-02", false, "2026-10-03"), "- [ ] Call #home");
	assert.equal(setDoneLine("Not a task", true, null), null);
});

test("markers are set, replaced and removed", () => {
	assert.equal(setMarkerText("Call #home ↻1", "sync", "a1"), "Call #home %%sync:a1%% ↻1");
	assert.equal(setMarkerText("Call #home %%sync:a1%%", "sync", "b2"), "Call #home %%sync:b2%%");
	assert.equal(setMarkerText("Call #home %%sync:a1%% %%other:x%%", "sync", null), "Call #home %%other:x%%");
});

test("a line is found again only when it is certain", () => {
	assert.equal(locateLine(["a", "b", "c"], 1, "b"), 1);
	assert.equal(locateLine(["x", "a", "b"], 1, "b"), 2);
	assert.equal(locateLine(["b", "a", "b"], 1, "b"), -1);
	assert.equal(locateLine(["a"], 3, "b"), -1);
});

test("a new task goes under its ## #tag heading, else at the end of the note", () => {
	const note = ["# Day", "", "## #home", "- [ ] A #home", "", "## #reading", "- [ ] B #reading", "", ""];
	assert.deepEqual(insertTaskLine(note, "- [ ] C #home", "home"), {
		lines: ["# Day", "", "## #home", "- [ ] A #home", "- [ ] C #home", "", "## #reading", "- [ ] B #reading", "", ""],
		at: 4,
	});
	assert.deepEqual(insertTaskLine(note, "- [ ] D #work", "work").lines.slice(-2), ["- [ ] B #reading", "- [ ] D #work"]);
	// A heading inside a code block does not count; an open code block is never entered.
	assert.equal(insertTaskLine(["```", "## #home", "```"], "- [ ] E #home", "home").at, 3);
	assert.equal(insertTaskLine(["## #home", "```", "code"], "- [ ] F #home", "home").at, 1);
	assert.deepEqual(insertTaskLine([""], "- [ ] G #home", "home"), { lines: ["- [ ] G #home"], at: 0 });
});

test("the editor change is the smallest one", () => {
	assert.deepEqual(minimalChange("- [ ] Call #home", "- [x] Call #home"), { from: 3, to: 4, text: "x" });
	assert.deepEqual(minimalChange("abc", "abc"), { from: 3, to: 3, text: "" });
});

test("where new tasks go", () => {
	const date = () => "2026-10-02";
	assert.deepEqual(newTaskPath(" /Inbox ", null, "Tasks", date), { path: "Inbox.md", daily: false });
	assert.deepEqual(newTaskPath("", { folder: "/Journal/", format: "" }, "Tasks", date), { path: "Journal/2026-10-02.md", daily: true });
	assert.deepEqual(newTaskPath("", null, "Tasks", date), { path: "Tasks.md", daily: false });
});

// ----- quick add -----

test("quick add reads priority and due date shortcuts in every language", () => {
	const words = { today: ["today", "aujourdhui", "hoy"], tomorrow: ["tomorrow", "demain", "morgen", "mañana"] };
	assert.deepEqual(parseQuickAdd("Call the bank !1 @tomorrow", "2026-10-02", words), { text: "Call the bank", priority: "high", due: "2026-10-03" });
	assert.deepEqual(parseQuickAdd("@2026-10-12 Pay !3 #home", "2026-10-02", words), { text: "Pay #home", priority: "low", due: "2026-10-12" });
	assert.equal(parseQuickAdd("Appeler @aujourd'hui", "2026-10-02", words).due, "2026-10-02");
	assert.equal(parseQuickAdd("Llamar @MANANA", "2026-10-02", words).due, "2026-10-03");
	// Unknown words and impossible dates stay in the text.
	assert.deepEqual(parseQuickAdd("Ask @bob about !5 @2026-02-30", "2026-10-02", words), { text: "Ask @bob about !5 @2026-02-30", priority: null, due: null });
	assert.equal(normalizeWord("Mañana"), "manana");
});

// ----- grouping -----

function task(over: Partial<Task>): Task {
	const base = { path: "A.md", line: 0, raw: "", indent: "", text: "", done: false, tags: [], primary: "home", priority: null, due: null, doneDate: null, title: "t", markers: {}, baseKey: "", key: "", subtasks: [] };
	const t = { ...base, ...over } as Task;
	t.key = t.key || `${t.primary}|${t.title}|${t.path}|${t.line}`;
	if (!over.tags) t.tags = [t.primary];
	return t;
}

test("dates are computed without time zones", () => {
	assert.equal(addDays("2026-10-31", 1), "2026-11-01");
	assert.equal(daysBetween("2026-12-30", "2027-01-02"), 3);
	assert.equal(nextWeek("2026-10-02"), "2026-10-05"); // Friday -> Monday
	assert.equal(nextWeek("2026-10-05"), "2026-10-12"); // Monday -> next Monday
	assert.ok(isIsoDate("2028-02-29") && !isIsoDate("2026-02-29") && !isIsoDate("2026-1-2"));
	assert.equal(dueState("2026-10-01", "2026-10-02"), "overdue");
	assert.equal(dueState("2026-10-08", "2026-10-02"), "soon");
	assert.equal(dueState("2026-10-09", "2026-10-02"), "later");
	assert.deepEqual(dueLabel("2026-09-29", "2026-10-02"), { kind: "overdue", days: 3 });
	assert.deepEqual(dueLabel("2026-10-01", "2026-10-02"), { kind: "yesterday" });
	assert.deepEqual(dueLabel("2026-10-06", "2026-10-02"), { kind: "weekday" });
	assert.deepEqual(dueLabel("2027-01-05", "2026-10-02"), { kind: "date", sameYear: false });
});

test("the tag tree nests tags inside their parent with counts", () => {
	const tasks = [task({ primary: "project/website" }), task({ primary: "project/website/footer" }), task({ primary: "project" }), task({ primary: "home" })];
	const tree = buildTree(tasks);
	assert.deepEqual(tree.map((n) => [n.tag, n.count]), [["home", 1], ["project", 3]]);
	const website = findNode(tree, "project/website")!;
	assert.equal(website.name, "website");
	assert.equal(website.depth, 1);
	assert.equal(website.count, 2);
	assert.equal(website.own.length, 1);
	assert.equal(findNode(tree, "project/website/footer")!.depth, 2);
	assert.ok(inScope("project/website", "project") && !inScope("projects", "project"));
});

test("sort modes: notes order, priority, due date", () => {
	const a = task({ path: "B.md", line: 1, priority: "low", due: "2026-10-03", title: "a" });
	const b = task({ path: "A.md", line: 5, priority: null, due: "2026-10-01", title: "b" });
	const c = task({ path: "A.md", line: 2, priority: "high", due: null, title: "c" });
	assert.deepEqual(sortTasks([a, b, c], "notes").map((t) => t.title), ["c", "b", "a"]);
	assert.deepEqual(sortTasks([a, b, c], "priority").map((t) => t.title), ["c", "a", "b"]);
	assert.deepEqual(sortTasks([a, b, c], "due").map((t) => t.title), ["b", "a", "c"]);
});

test("Today and Upcoming views, counts and filters", () => {
	const today = "2026-10-02";
	const tasks = [
		task({ title: "late", due: "2026-09-30", line: 1 }),
		task({ title: "later late", due: "2026-10-01", line: 2 }),
		task({ title: "low today", due: today, priority: "low", line: 3 }),
		task({ title: "high today", due: today, priority: "high", line: 4 }),
		task({ title: "next", due: "2026-10-05", line: 5 }),
		task({ title: "next too", due: "2026-10-05", line: 6 }),
		task({ title: "far", due: "2026-11-01", line: 7 }),
		task({ title: "none", line: 8 }),
	];
	const groups = todayGroups(tasks, today);
	assert.deepEqual(groups.overdue.map((t) => t.title), ["late", "later late"]);
	assert.deepEqual(groups.today.map((t) => t.title), ["high today", "low today"]);
	assert.deepEqual(upcomingGroups(tasks, today).map((g) => [g.date, g.tasks.length]), [["2026-10-05", 2], ["2026-11-01", 1]]);
	assert.deepEqual(countTasks(tasks, today), { all: 8, overdue: 2, today: 4, upcoming: 3 });
	assert.ok(passesPriority({ priority: null }, []) && passesPriority({ priority: null }, ["none"]) && !passesPriority({ priority: "low" }, ["high"]));
	const t = task({ title: "Fix the footer", path: "Projects/Website.md", primary: "project/website" });
	assert.ok(matchesQuery(t, "footer website") && matchesQuery(t, "#project") && !matchesQuery(t, "#home"));
	assert.equal(fallbackHue("home"), fallbackHue("home"));
});

// ----- the public API over a fake vault -----

function fakeVault(files: Record<string, string>, settings: Partial<TasksSettings> = {}) {
	const make = (path: string) => Object.assign(new TFile(), { path, extension: "md", basename: path.replace(/^.*\//, "").replace(/\.md$/, "") });
	const app = {
		vault: {
			getMarkdownFiles: () => Object.keys(files).map(make),
			getAbstractFileByPath: (path: string) => (path in files ? make(path) : null),
			cachedRead: async (file: TFile) => files[file.path],
			process: async (file: TFile, fn: (data: string) => string) => (files[file.path] = fn(files[file.path])),
			create: async (path: string, data: string) => {
				files[path] = data;
				return make(path);
			},
			createFolder: async () => undefined,
		},
		metadataCache: { getFileCache: () => null, getTags: () => ({ "#home": 1, "#urgent": 1 }) },
		workspace: { iterateAllLeaves: () => undefined },
	};
	const ctx = {
		app,
		settings: { excludedFolders: "Archive", flagTags: "urgent", stampDone: true, newTaskNote: "", sortMode: "notes", priorityFilter: [], collapsed: [], ...settings },
		t: (key: string, vars?: Record<string, unknown>) => (key === "note.inbox" ? "Tasks" : key + (vars ? JSON.stringify(vars) : "")),
		register: () => undefined,
	} as unknown as Context;
	const index = new TaskIndex(ctx);
	const writer = new TaskWriter(ctx, index);
	let alive = true;
	const api = createTasksApi(index, writer, () => alive);
	return { api, index, files, stop: () => (alive = false) };
}

test("the API reads tasks, writes them back, and refuses lines that moved away", async () => {
	const { api, index, files, stop } = fakeVault({
		"Projects/Website.md": "# Website\n- [ ] Fix the footer #project/website #urgent\n- [x] Old #project/website ✅ 2026-09-01",
		"Archive/Old.md": "- [ ] Hidden #home",
	});
	let changes = 0;
	const off = api.on("change", () => changes++);
	assert.equal(api.isReady(), false);
	await index.build();
	assert.equal(api.isReady(), true);
	assert.ok(changes >= 1);
	const [footer] = api.getTasks();
	assert.equal(api.getTasks().length, 1);
	assert.equal(api.getTasks({ includeDone: true }).length, 2);
	assert.deepEqual([footer.tag, footer.title, footer.line, footer.priority], ["project/website", "Fix the footer", 1, null]);
	assert.deepEqual(api.getTags(), ["home", "project/website"]);

	const dated = await api.setDue(footer, "2026-10-12");
	assert.equal(dated?.due, "2026-10-12");
	assert.match(files["Projects/Website.md"], /Fix the footer #project\/website #urgent 📅 2026-10-12/);
	// The old location is stale now: find() relocates nothing (the raw text changed).
	assert.equal(api.find(footer), null);
	assert.equal(await api.setDue(footer, "2026-10-13"), null);

	const marked = await api.setMarker(dated!, "sync", "x1");
	assert.deepEqual(marked?.markers, { sync: "x1" });
	const renamed = await api.rename(marked!, "Fix the header");
	assert.equal(renamed?.title, "Fix the header");
	assert.deepEqual(renamed?.markers, { sync: "x1" });
	const moved = await api.moveToTag(renamed!, "#home");
	assert.equal(moved?.tag, "home");
	assert.equal(await api.moveToTag(moved!, "urgent"), null, "a flag is not a group");
	const prio = await api.setPriority(moved!, "high");
	assert.equal(prio?.priority, "high");
	const done = await api.setDone(prio!, true);
	assert.equal(done?.done, true);
	assert.match(done!.raw, /^- \[x\] Fix the header #home #urgent 📅 2026-10-12 #high %%sync:x1%% ✅ \d{4}-\d{2}-\d{2}$/);
	assert.equal(api.getTasks().length, 0);
	assert.equal((await api.setDone(done!, false))?.done, false);

	const added = await api.addTask({ title: "Buy stamps", tag: "#home", priority: "low", due: "2026-10-20", markers: { sync: "y2", "Bad Name": "z" } });
	assert.equal(files["Tasks.md"], "- [ ] Buy stamps #home #low 📅 2026-10-20 %%sync:y2%%");
	assert.deepEqual([added?.path, added?.line, added?.tag], ["Tasks.md", 0, "home"]);
	assert.equal(await api.addTask({ title: "  ", tag: "home" }), null);
	assert.equal(await api.setDue(added!, "someday"), null);

	off();
	const before = changes;
	await api.setDue(added!, null);
	assert.equal(changes, before, "unsubscribed");
	stop();
	assert.deepEqual(api.getTasks(), []);
	assert.equal(await api.setDone(added!, true), null);
});

test("identical tasks get their own keys, and the index keeps live edits made during a full read", async () => {
	const { index } = fakeVault({ "A.md": "- [ ] Call #home\n- [ ] Call #home", "B.md": "- [ ] Call #home" });
	await index.build();
	assert.deepEqual(index.list.map((t) => t.key), ["home|call", "home|call#2", "home|call#3"]);
	const build = index.build();
	index.set("B.md", "- [ ] Write #reading");
	await build;
	assert.deepEqual(index.list.map((t) => t.primary), ["home", "home", "reading"]);
});

test("view actions: added, refreshed, removed, and refused once the module is off", () => {
	const hub = { viewActions: new Set<() => null>(), refreshes: 0, refreshViews() { this.refreshes++; }, showTag: async () => true };
	let alive = true;
	const api = createTasksApi({} as TaskIndex, {} as TaskWriter, () => alive, hub);
	const get = () => null;
	const remove = api.addViewAction(get);
	assert.equal(hub.viewActions.size, 1);
	api.refreshViews();
	assert.equal(hub.refreshes, 2);
	remove();
	remove();
	assert.equal(hub.viewActions.size, 0);
	assert.equal(hub.refreshes, 3);
	alive = false;
	api.addViewAction(get);
	assert.equal(hub.viewActions.size, 0);
});

test("openTag: opens the list on a clean tag, refuses bad ones and a stopped module", async () => {
	const shown: string[] = [];
	let alive = true;
	const hub = { viewActions: new Set<() => null>(), refreshViews() {}, showTag: async (tag: string) => { shown.push(tag); return true; } };
	const api = createTasksApi({ flags: () => new Set() } as unknown as TaskIndex, {} as TaskWriter, () => alive, hub);
	assert.equal(await api.openTag("#Project/Website"), true);
	assert.deepEqual(shown, ["project/website"]);
	assert.equal(await api.openTag("not a tag"), false);
	alive = false;
	assert.equal(await api.openTag("project"), false);
	assert.equal(shown.length, 1);
});
