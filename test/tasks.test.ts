// Tasks: line parsing, line rewriting, quick add, grouping, and the public API over a fake vault.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TFile } from "obsidian";
import { moduleWorkbench, WorkbenchCore } from "../src/core/workbench";
import { createTasksApi, resolveWorkbench, type ViewTab } from "../src/modules/tasks/api";
import { TasksHub } from "../src/modules/tasks/hub";
import {
	insertTaskLine, insertToken, locateLine, minimalChange, newTaskPath, removeTag, retagText, retitleText,
	editLines, removeBlock, removeBlocks, restoreBlock, restoreBlocks, revertLines, setDoneLine, setDueLines, setDueText, setMarkerText, setNoteLinkText, setPriorityText,
} from "../src/modules/tasks/edit";
import {
	addDays, buildTree, countTasks, daysBetween, dueLabel, dueState, fallbackHue, findNode, inScope, isIsoDate,
	matchesQuery, moveInOrder, nextWeek, passesPriority, sinceDays, sortTasks, todayGroups, upcomingGroups,
} from "../src/modules/tasks/group";
import {
	flagSet, inlineParts, isInFolder, parseFolderList, parseTagList, parseTaskText, plainTitle, scanTasks, taskKey,
} from "../src/modules/tasks/parse";
import { normalizeWord, parseQuickAdd } from "../src/modules/tasks/quick-add";
import { TaskIndex } from "../src/modules/tasks/task-index";
import type { Context, Task, TasksSettings } from "../src/modules/tasks/types";
import { TaskWriter } from "../src/modules/tasks/writer";
import { noteWindow } from "../src/modules/tasks/note-window";

test("note preview bounds its context and marks only the selected occurrence", () => {
	const lines = Array.from({ length: 150 }, (_, n) => `Line ${n}`);
	lines[70] = lines[72] = "- [ ] Read #reading";
	const task = { line: 72, raw: lines[72] };
	const excerpt = noteWindow(lines.join("\r\n"), task);
	assert.equal(excerpt.start, 32);
	assert.equal(excerpt.end, 113);
	assert.equal(excerpt.truncated, true);
	assert.equal(excerpt.markdown.split("\n").length, 81);
	assert.equal(excerpt.markdown.split("sk-tasks-note-anchor").length, 2);
	assert.match(excerpt.markdown.split("\n")[40], /note-anchor/);
	const whole = noteWindow(lines.join("\n"), task, true);
	assert.equal(whole.start, 0);
	assert.equal(whole.end, 150);
	assert.equal(whole.truncated, false);
});

test("note preview relocates an exact task and avoids marking missing or ambiguous tasks", () => {
	const raw = "  1. [ ] Read #reading";
	const moved = noteWindow(`Heading\nText\n${raw}`, { line: 0, raw });
	assert.equal(moved.line, 2);
	assert.match(moved.markdown, /1\. \[ \] <span/);
	assert.equal(moved.truncated, false);
	for (const text of ["", "Other text", `${raw}\n${raw}`]) {
		const missing = noteWindow(text, { line: 9, raw });
		assert.equal(missing.line, -1);
		assert.doesNotMatch(missing.markdown, /note-anchor/);
	}
});

test("note preview skips partial fences and properties before the task", () => {
	const raw = "- [ ] Read #reading";
	for (const delimiter of ["```", "~~~~", "---"]) {
		const lines = [delimiter, ...Array(90).fill("content"), delimiter, raw];
		const excerpt = noteWindow(lines.join("\n"), { line: 92, raw });
		assert.equal(excerpt.start, 92);
		assert.match(excerpt.markdown, /^- \[ \] <span/);
		assert.equal(noteWindow(lines.join("\n"), { line: 92, raw }, true).start, 0);
	}
});

const FLAGS = flagSet("urgent");

test("task-note links in every position leave titles and identity unchanged", () => {
	for (const target of ["Task - Read", "Tasks/Task - Read", "Tasks/Task - Read.md"]) {
		const link = `[[${target}|📝]]`;
		for (const text of [`${link} Read a book #reading`, `Read ${link} a book #reading`, `Read a book ${link} #reading`, `Read a book #reading ${link}`]) {
			const [parsed] = scanTasks(["- [ ] " + text], "A.md", FLAGS);
			assert.equal(parsed.noteLink, target.replace(/\.md$/, ""));
			assert.equal(parsed.title, "Read a book");
			assert.equal(plainTitle(parsed.title), "Read a book");
			assert.equal(parsed.key, "reading|read a book");
		}
	}
	for (const link of ["[[Read]]", "[[Read|alias]]", "[[Read|📝 extra]]", "[[Read| 📝]]"]) {
		const parsed = parseTaskText(`Read ${link} #reading`, FLAGS);
		assert.equal(parsed.noteLink, null);
		assert.equal(parsed.title, `Read ${link}`);
	}
	const parsed = parseTaskText("Read [[Tasks/With #home #high ⭐ 📅 2026-10-12 ⏰ 12:00 ↻2 ✅ 2026-10-13 %%sync:abc%%|📝]] #reading", FLAGS);
	assert.deepEqual(parsed.tags, ["reading"]);
	assert.equal(parsed.title, "Read");
	assert.equal(parsed.priority, null);
	assert.equal(parsed.due, null);
	assert.equal(parsed.doneDate, null);
	assert.deepEqual(parsed.markers, {});
});

test("task-note links are added, replaced and removed before trailing tokens", () => {
	const tail = "#reading ⭐ 📅 2026-10-12 ⏰ 12:00 ⏳ 2026-10-11 ↻2 ✅ 2026-10-13 %%sync:abc%% ^block";
	const link = "[[Tasks/Read|📝]]";
	assert.equal(setNoteLinkText(`Read ${tail}`, "Tasks/Read.md"), `Read ${link} ${tail}`);
	assert.equal(setNoteLinkText(`[[Old|📝]] Read ${tail}`, "Tasks/Read"), `Read ${link} ${tail}`);
	assert.equal(setNoteLinkText(`Read ${tail} [[Old|📝]]`, "Tasks/Read"), `Read ${link} ${tail}`);
	assert.equal(setNoteLinkText(`Read  ${link}  ${tail}`, null), `Read ${tail}`);
	assert.equal(setNoteLinkText("Read", "Tasks/Read"), `Read ${link}`);
	assert.equal(setNoteLinkText("#reading Read", "Tasks/Read"), `#reading Read ${link}`);
	assert.equal(setNoteLinkText("Read [[other|alias]] #reading", "Tasks/Read"), `Read [[other|alias]] ${link} #reading`);
	assert.equal(setNoteLinkText(`Read ${link} [[Old|📝]] #reading`, "Tasks/Read"), `Read ${link} #reading`);
});

test("task edits preserve the task-note link even with token-like text in its target", () => {
	const link = "[[Tasks/Read #reading #high ⭐ 📅 2026-01-01 ✅ 2026-01-02 %%sync:old%%|📝]]";
	const text = `Read ${link} #reading #high ⭐ 📅 2026-10-12 %%sync:abc%%`;
	assert.equal(retitleText(text, "Read", "Write"), `Write ${link} #reading #high ⭐ 📅 2026-10-12 %%sync:abc%%`);
	assert.equal(retitleText(`Read ${link} a book #reading`, "Read a book", "Write"), `Write ${link} #reading`);
	assert.equal(retagText(text, "reading", "work"), `Read ${link} #work #high ⭐ 📅 2026-10-12 %%sync:abc%%`);
	assert.equal(setDueText(text, "2026-10-14"), `Read ${link} #reading #high ⭐ 📅 2026-10-14 %%sync:abc%%`);
	assert.equal(setDueText(text, null), `Read ${link} #reading #high ⭐ %%sync:abc%%`);
	assert.ok(setPriorityText(text, "low").includes(link));
	assert.equal(parseTaskText(setPriorityText(text, "low"), FLAGS).priority, "low");
	assert.equal(setMarkerText(text, "sync", "new"), `Read ${link} #reading #high ⭐ 📅 2026-10-12 %%sync:new%%`);
	const done = setDoneLine(`- [ ] ${text}`, true, "2026-10-15");
	assert.equal(done, `- [x] ${text} ✅ 2026-10-15`);
	assert.equal(setDoneLine(done!, false, null), `- [ ] ${text}`);
});

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

test("descriptions collect two lines and stop at the end of the task block", () => {
	const [task] = scanTasks([
		"- [ ] Reorganise the garage #home",
		"\tClear the back shelf first.",
		"\tCheck the wall brackets.",
		"Next paragraph",
		"\tOutside the block",
	], "Notes/A.md", FLAGS);
	assert.equal(task.description, "Clear the back shelf first.\nCheck the wall brackets.");
});

test("descriptions preserve empty paragraphs and remove only common indentation", () => {
	const [task] = scanTasks([
		"  - [ ] Plan #project/website",
		"    ",
		"    First paragraph.",
		" \t ",
		"      More detail.",
		"\tLast paragraph.",
		"    ",
		"    - [ ] Final step",
	], "Notes/A.md", FLAGS);
	assert.equal(task.description, "First paragraph.\n\n  More detail.\nLast paragraph.");
});

test("descriptions exclude all checkbox lines among their text", () => {
	const [task] = scanTasks([
		"- [ ] Plan #home",
		"\tFirst line.",
		"\t- [ ] Step one",
		"\t- [x] Step two",
		"\t- [>] Deferred step",
		"\t- [ ] Tagged step #project/website",
		"\tLast line.",
	], "Notes/A.md", FLAGS);
	assert.equal(task.description, "First line.\nLast line.");
	assert.equal(task.subtasks.length, 2);
});

test("descriptions are empty when there is no block text", () => {
	const tasks = scanTasks([
		"- [ ] No block #home",
		"- [ ] Only subtasks #home",
		"\t- [ ] Step",
		"\t ",
	], "Notes/A.md", FLAGS);
	assert.deepEqual(tasks.map((task) => task.description), ["", ""]);
});

test("descriptions exclude fence delimiters and contents", () => {
	const tasks = scanTasks([
		"- [ ] Plan #home",
		"\tBefore code.",
		"\t```text",
		"\tHidden text",
		"\t- [ ] Hidden task #home",
		"\t```",
		"\tAfter code.",
		"- [ ] Only code #home",
		"\t~~~",
		"\tHidden text",
		"\t~~~",
	], "Notes/A.md", FLAGS);
	assert.deepEqual(tasks.map((task) => task.description), ["Before code.\nAfter code.", ""]);
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
	const base = { path: "A.md", line: 0, raw: "", indent: "", text: "", done: false, tags: [], primary: "home", priority: null, due: null, doneDate: null, title: "t", markers: {}, baseKey: "", key: "", subtasks: [], description: "" };
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
	// Today first; what waits since earlier, the most recent first. The former order on request.
	assert.deepEqual(groups.overdue.map((t) => t.title), ["later late", "late"]);
	assert.deepEqual(todayGroups(tasks, today, true).overdue.map((t) => t.title), ["late", "later late"]);
	assert.deepEqual(groups.today.map((t) => t.title), ["high today", "low today"]);
	assert.deepEqual(upcomingGroups(tasks, today).map((g) => [g.date, g.tasks.length]), [["2026-10-05", 2], ["2026-11-01", 1]]);
	assert.deepEqual(countTasks(tasks, today), { all: 8, overdue: 2, today: 4, upcoming: 3 });
	assert.ok(passesPriority({ priority: null }, []) && passesPriority({ priority: null }, ["none"]) && !passesPriority({ priority: "low" }, ["high"]));
	const t = task({ title: "Fix the footer", path: "Projects/Website.md", primary: "project/website" });
	assert.ok(matchesQuery(t, "footer website") && matchesQuery(t, "#project") && !matchesQuery(t, "#home"));
	assert.equal(fallbackHue("home"), fallbackHue("home"));
});

// ----- the public API over a fake vault -----

function fakeVault(files: Record<string, string>, settings: Partial<TasksSettings> = {}, mtimes: Record<string, number> = {}) {
	const make = (path: string) => Object.assign(new TFile(), { path, extension: "md", basename: path.replace(/^.*\//, "").replace(/\.md$/, ""), stat: { mtime: mtimes[path] ?? Date.now(), ctime: 0, size: 0 } });
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
	return { api, index, writer, files, stop: () => (alive = false) };
}

test("writing a task-note link preserves duplicate keys, order and undo", async () => {
	const { index, writer, files } = fakeVault({ "A.md": "- [ ] Read #reading\n- [ ] Read #reading" });
	await index.build();
	const keys = index.list.map((task) => task.key);
	const written = await writer.setNoteLink(index.list[0], "Tasks/Read", true);
	assert.ok(written);
	assert.equal(files["A.md"], "- [ ] Read [[Tasks/Read|📝]] #reading\n- [ ] Read #reading");
	assert.deepEqual(index.list.map((task) => task.key), keys);
	assert.equal(await written.undo(), true);
	assert.equal(files["A.md"], "- [ ] Read #reading\n- [ ] Read #reading");
});

test("task-note API resolves paths and delegates open and done tasks to the current service", async () => {
	const { hub, api, stop } = fakeHub();
	const resolved: string[][] = [];
	hub.ctx.app.metadataCache.getFirstLinkpathDest = (target, source) => {
		resolved.push([target, source]);
		return target === "Missing" ? null : Object.assign(new TFile(), { path: "Tasks/Read.md" });
	};
	hub.index.set("A.md", "- [ ] Read [[Read.md|📝]] #reading\n- [x] Finished [[Tasks/Read|📝]] #reading\n- [ ] Missing [[Missing|📝]] #reading\n- [ ] Plain #reading");
	const all = api.getTasks({ includeDone: true });
	assert.deepEqual(all.map((task) => task.notePath), ["Tasks/Read.md", "Tasks/Read.md", null, null]);
	assert.deepEqual(resolved, [["Read", "A.md"], ["Tasks/Read", "A.md"], ["Missing", "A.md"]]);
	assert.equal(api.find(all[0])?.notePath, "Tasks/Read.md");
	assert.equal(await api.taskNote!.read(all[0].key), null);
	assert.equal(await api.taskNote!.write(all[0].key, "Body"), false);
	const writes: string[][] = [];
	hub.taskNotes = {
		file: () => null,
		read: async (task) => task.noteLink ? task.title : null,
		write: async (task, body) => { writes.push([task.key, body]); },
	};
	for (const task of all.slice(0, 2)) {
		assert.equal(await api.taskNote!.read(task.key), task.title);
		assert.equal(await api.taskNote!.write(task.key, "Body"), true);
	}
	assert.equal(writes.length, 2);
	assert.equal(await api.taskNote!.read("unknown"), null);
	assert.equal(await api.taskNote!.write("unknown", "Body"), false);
	stop();
	assert.equal(await api.taskNote!.read(all[0].key), null);
	assert.equal(await api.taskNote!.write(all[0].key, "Body"), false);
});

test("the version 1 API returns descriptions when reading and updating tasks", async () => {
	const { api, index } = fakeVault({
		"Projects/Website.md": "- [ ] Fix the footer #project/website\n\tCheck the links.\n\t\n\tReview the layout.\n- [ ] Publish #project/website",
	});
	await index.build();
	const [footer, publish] = api.getTasks();
	const description = "Check the links.\n\nReview the layout.";
	assert.equal(api.version, 1);
	assert.equal(footer.description, description);
	assert.equal(publish.description, "");
	assert.equal(api.find(footer)?.description, description);
	footer.description = "Changed copy";
	assert.equal(api.find(footer)?.description, description);
	assert.equal((await api.setPriority(footer, "high"))?.description, description);
});

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
	const hub = { openWorkbench: async () => {}, addViewTab: () => () => undefined, viewActions: new Set<() => null>(), refreshes: 0, refreshViews() { this.refreshes++; }, showTag: async () => true };
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

/** A running Tasks hub over a fake vault, with the core's Workbench registry; stop() stops the module. */
function fakeHub() {
	(globalThis as { window?: unknown }).window ??= globalThis;
	const core = new WorkbenchCore();
	const cleanups: Array<() => unknown> = [];
	const { index } = fakeVault({});
	const ctx = {
		...(index as unknown as { ctx: Context }).ctx,
		workbench: moduleWorkbench(core, (cleanup) => cleanups.push(cleanup)),
		service: () => undefined,
		translators: () => [],
	} as unknown as Context;
	const hub = new TasksHub(ctx);
	let alive = true;
	const api = createTasksApi(hub.index, hub.writer, () => alive, hub);
	const stop = () => {
		alive = false;
		hub.dispose();
		for (const cleanup of cleanups.splice(0)) cleanup();
	};
	return { core, hub, api, stop };
}

test("view tabs: registered in the core after Snailkit's tabs, unique ids, removal and a stopped module", () => {
	const { core, api, stop } = fakeHub();
	core.addTab({ id: "sessions", order: 30, icon: "zap", label: "Brainstorms", mount() {} });
	core.addTab({ id: "home", order: 10, icon: "house", label: "Home", mount() {} });
	const tab: ViewTab = { id: "example-tab", icon: "zap", label: "Example", mount() {} };
	const remove = api.addViewTab(tab);
	assert.equal(api.version, 1);
	assert.equal(core.get(tab.id), tab);
	assert.deepEqual(core.ids(), ["home", "sessions", "example-tab"]);
	api.addViewTab({ ...tab })();
	for (const id of ["", "tasks", "home", "sessions", "Bad", "two words", "tab1", "tab/thing", "tab_thing"]) api.addViewTab({ ...tab, id })();
	assert.deepEqual(core.ids(), ["home", "sessions", "example-tab"]);
	assert.equal(core.get("sessions")?.label, "Brainstorms", "a companion never replaces Snailkit's own tabs");
	remove();
	remove();
	assert.equal(core.get(tab.id), undefined);
	const removeAgain = api.addViewTab(tab);
	remove();
	assert.equal(core.get(tab.id), tab, "an old remover cannot remove a new registration");
	stop();
	assert.equal(core.get(tab.id), undefined, "the tab goes away when the Tasks module stops");
	removeAgain();
	api.addViewTab(tab)();
	assert.equal(core.get(tab.id), undefined);
	createTasksApi({} as TaskIndex, {} as TaskWriter, () => true).addViewTab(tab)();
	core.dispose();
});

test("the Tasks tab joins the core Workbench in its place", () => {
	const { core, hub, stop } = fakeHub();
	core.addTab({ id: "sessions", order: 30, icon: "zap", label: "Brainstorms", mount() {} });
	core.addTab({ id: "other", icon: "x", label: "Other", mount() {} });
	hub.ctx.workbench.addTab(hub.tab());
	core.addTab({ id: "home", order: 10, icon: "house", label: "Home", mount() {} });
	assert.deepEqual(core.ids(), ["home", "tasks", "sessions", "other"]);
	assert.equal(core.get("tasks")?.icon, "list-checks");
	stop();
	assert.deepEqual(core.ids(), ["home", "sessions", "other"]);
	core.dispose();
});

test("openTag: opens the list on a clean tag, refuses bad ones and a stopped module", async () => {
	const shown: string[] = [];
	let alive = true;
	const hub = { openWorkbench: async () => {}, addViewTab: () => () => undefined, viewActions: new Set<() => null>(), refreshViews() {}, showTag: async (tag: string) => { shown.push(tag); return true; } };
	const api = createTasksApi({ flags: () => new Set() } as unknown as TaskIndex, {} as TaskWriter, () => alive, hub);
	assert.equal(await api.openTag("#Project/Website"), true);
	assert.deepEqual(shown, ["project/website"]);
	assert.equal(await api.openTag("not a tag"), false);
	alive = false;
	assert.equal(await api.openTag("project"), false);
	assert.equal(shown.length, 1);
});


test("Workbench destinations resolve tabs and only apply scopes to Tasks", () => {
	const tabs = new Map<string, ViewTab>([["sessions", { id: "sessions", icon: "zap", label: "Sessions", mount() {} }]]);
	assert.deepEqual(resolveWorkbench({ tab: "sessions" }, { has: (id) => id === "sessions" }), { tab: "sessions" }, "any registry with has()");
	assert.deepEqual(resolveWorkbench(undefined, tabs), { tab: "tasks" });
	assert.deepEqual(resolveWorkbench({ tab: "unknown" }, tabs), { tab: "tasks" });
	assert.deepEqual(resolveWorkbench({ tab: "unknown", scope: "today" }, tabs), { tab: "tasks", scope: "today" });
	assert.deepEqual(resolveWorkbench({ tab: "tasks", scope: "all" }, tabs), { tab: "tasks", scope: "all" });
	assert.deepEqual(resolveWorkbench({ scope: "today" }, tabs), { tab: "tasks", scope: "today" });
	assert.deepEqual(resolveWorkbench({ tab: "sessions", scope: "today" }, tabs), { tab: "sessions" });
});

test("the API opens the Workbench only while the module runs", async () => {
	const shown: unknown[] = [];
	let alive = true;
	const hub = {
		addViewTab: () => () => undefined, viewActions: new Set<() => null>(),
		refreshViews() {}, showTag: async () => true,
		openWorkbench: async (options?: { tab?: string; scope?: "all" | "today" }) => { shown.push(options); },
	};
	const api = createTasksApi({} as TaskIndex, {} as TaskWriter, () => alive, hub);
	assert.equal(api.version, 1);
	await api.openWorkbench({ tab: "sessions", scope: "today" });
	await api.openWorkbench();
	assert.deepEqual(shown, [{ tab: "sessions", scope: "today" }, undefined]);
	alive = false;
	await api.openWorkbench({ tab: "tasks", scope: "all" });
	assert.equal(shown.length, 2);
	await createTasksApi({} as TaskIndex, {} as TaskWriter, () => true).openWorkbench();
});

test("the tags of the navigator follow the order the user gave them, the others by name", () => {
	const tasks = ["work", "home", "reading", "home/car", "home/garden"].map((primary) => task({ primary }));
	const names = (order: string[]) => buildTree(tasks, order).map((n) => n.tag);
	assert.deepEqual(names([]), ["home", "reading", "work"]);
	assert.deepEqual(names(["work"]), ["work", "home", "reading"]);
	assert.deepEqual(buildTree(tasks, ["home/garden"])[0].children.map((n) => n.tag), ["home/garden", "home/car"]);
	const roots = ["home", "reading", "work"];
	assert.deepEqual(moveInOrder([], roots, "work", "home", false), ["work", "home", "reading"]);
	assert.deepEqual(moveInOrder([], roots, "home", "work", true), ["reading", "work", "home"]);
	assert.deepEqual(moveInOrder(["home/car", "work", "home"], ["work", "home", "reading"], "reading", "work", false), ["home/car", "reading", "work", "home"], "other levels keep their order");
	assert.deepEqual(moveInOrder(["a"], roots, "work", "nope", false), ["a"], "an unknown target changes nothing");
});

test("tasks can be put in the user's own order within their tag", () => {
	const a = task({ title: "a", line: 1 }), b = task({ title: "b", line: 2 }), c = task({ title: "c", line: 3 });
	const keys = (list: Task[]) => list.map((t) => t.title);
	assert.deepEqual(keys(sortTasks([a, b, c], "manual", [])), ["a", "b", "c"], "nothing placed: note order");
	const order = moveInOrder([], [a.key, b.key, c.key], c.key, a.key, false);
	assert.deepEqual(keys(sortTasks([a, b, c], "manual", order)), ["c", "a", "b"]);
	const d = task({ title: "d", line: 0 });
	assert.deepEqual(keys(sortTasks([a, b, c, d], "manual", order)), ["c", "a", "b", "d"], "a new task comes after the placed ones");
	assert.deepEqual(keys(sortTasks([a, b, c], "notes", order)), ["a", "b", "c"], "other sorts ignore the order");
});

// ----- Today without a wall of overdue tasks -----

test("Today: 3 due today first, 40 from earlier below, the most recent first; how long each waited", () => {
	const today = "2026-10-08";
	const tasks = [
		...Array.from({ length: 40 }, (_, i) => task({ title: "old " + i, due: addDays(today, -1 - i), line: i })),
		...[0, 1, 2].map((i) => task({ title: "today " + i, due: today, line: 100 + i })),
	];
	const groups = todayGroups(tasks, today);
	assert.equal(groups.today.length, 3);
	assert.equal(groups.overdue.length, 40);
	assert.deepEqual(groups.overdue.slice(0, 2).map((t) => t.due), ["2026-10-07", "2026-10-06"]);
	assert.equal(sinceDays("2026-10-02", today), 6);
	assert.equal(sinceDays("2026-10-07", today), 1);
	assert.equal(sinceDays("2026-10-09", today), 0);
});

test("moving many dates at once: found again line by line, taken back only where untouched", () => {
	const lines = ["# Notes", "- [ ] Call #home 📅 2026-10-01", "- [ ] Write #work 📅 2026-09-20", "- [ ] Read #home"];
	const refs = [{ line: 1, raw: lines[1] }, { line: 2, raw: lines[2] }, { line: 9, raw: "- [ ] Gone #home" }];
	const moved = setDueLines(lines, refs, "2026-10-09")!;
	assert.deepEqual(moved.lines.slice(1, 3), ["- [ ] Call #home 📅 2026-10-09", "- [ ] Write #work 📅 2026-10-09"]);
	assert.equal(moved.changes.length, 2);
	// Removing the dates.
	assert.deepEqual(setDueLines(lines, refs, null)!.lines.slice(1, 3), ["- [ ] Call #home", "- [ ] Write #work"]);
	// Nothing to change: no write.
	assert.equal(setDueLines(moved.lines, [{ line: 1, raw: moved.lines[1] }], "2026-10-09"), null);
	// Undo: every date back; a line edited since stays as the user left it.
	assert.deepEqual(revertLines(moved.lines, moved.changes).lines, lines);
	const edited = [...moved.lines];
	edited[2] = "- [ ] Write the report #work 📅 2026-10-09";
	const back = revertLines(edited, moved.changes);
	assert.equal(back.restored, 1);
	assert.equal(back.lines[1], lines[1]);
	assert.equal(back.lines[2], edited[2]);
});

test("bulk Undo never puts a date on another task that came to read the same", () => {
	const lines = ["- [ ] Call #home 📅 2026-10-01", "- [ ] Call #home 📅 2026-09-20"];
	const moved = setDueLines(lines, lines.map((raw, line) => ({ line, raw })), "2026-10-09")!;
	assert.equal(moved.lines[0], moved.lines[1]);
	// The first one edited since: the second keeps its own date back, the first is left as is.
	const edited = ["- [ ] Call Sam #home 📅 2026-10-09", moved.lines[1]];
	const back = revertLines(edited, moved.changes);
	assert.deepEqual(back.lines, ["- [ ] Call Sam #home 📅 2026-10-09", "- [ ] Call #home 📅 2026-09-20"]);
	assert.equal(back.restored, 1);
	// Both moved and still identical: each gets one of the two dates back (they cannot be told apart).
	const shifted = ["# Top", moved.lines[0], moved.lines[1]];
	assert.deepEqual(revertLines(shifted, moved.changes).lines.slice(1).sort(), [...lines].sort());
});

/** A line break, for notes built in tests. */
const NL = String.fromCharCode(10);

test("All to tomorrow: 40 tasks in two notes, one write per note, one Undo for all", async () => {
	const a = Array.from({ length: 25 }, (_, i) => `- [ ] Task a${i} #home 📅 2026-09-${String(1 + (i % 28)).padStart(2, "0")}`).join(NL);
	const b = Array.from({ length: 15 }, (_, i) => `- [ ] Task b${i} #work 📅 2026-08-${String(1 + i).padStart(2, "0")}`).join(NL);
	const { index, writer, files } = fakeVault({ "A.md": a, "B.md": b });
	await index.build();
	const vault = (writer as unknown as { ctx: Context }).ctx.app.vault;
	const process = vault.process.bind(vault);
	let writes = 0;
	vault.process = (async (file: TFile, fn: (data: string) => string) => {
		writes++;
		return process(file, fn);
	}) as typeof vault.process;
	const tasks = index.open().filter((t) => t.due && t.due < "2026-10-08");
	assert.equal(tasks.length, 40);
	const { count, undo } = await writer.setDueAll(tasks, "2026-10-09");
	assert.equal(count, 40);
	assert.equal(writes, 2);
	assert.equal(index.open().filter((t) => t.due === "2026-10-09").length, 40);
	assert.equal(await undo(), true);
	assert.deepEqual([files["A.md"], files["B.md"]], [a, b]);
});

test("deleting a task takes its subtasks and description, and Undo puts them back in place", async () => {
	const note = ["# Home", "- [ ] Paint the hall #home", "\t- [ ] Buy paint", "\tBlue, two coats.", "- [ ] Call Sam #work", ""].join(NL);
	const { index, writer, files } = fakeVault({ "A.md": note });
	await index.build();
	const paint = index.open().find((t) => t.title === "Paint the hall")!;
	const written = await writer.deleteTask(paint, true);
	assert.ok(written);
	assert.equal(files["A.md"], ["# Home", "- [ ] Call Sam #work", ""].join(NL));
	assert.equal(index.open().length, 1);
	assert.equal(await written.undo(), true);
	assert.equal(files["A.md"], note);
	// Pure: put back after the line that preceded it, even when lines were added above meanwhile.
	const lines = ["a", "- [ ] T #x", "\tdesc", "b"];
	const { lines: left, block } = removeBlock(lines, 1, 2);
	assert.deepEqual(left, ["a", "b"]);
	assert.deepEqual(restoreBlock(["new", ...left], block), ["new", ...lines]);
	// Its neighbours changed: nothing is put back.
	assert.equal(restoreBlock(["a", "c"], block), null);
});

test("renaming a task whose line changed meanwhile: found again by its tag and words, the change kept", async () => {
	const { index, writer, files } = fakeVault({ "A.md": ["# Notes", "- [ ] Call the garage #home", ""].join(NL) });
	await index.build();
	const stale = index.open()[0];
	// Meanwhile a sync adds a marker and a line is typed above (the task is read again later).
	files["A.md"] = ["# Notes", "New line", "- [ ] Call the garage #home %%sync:42%%", ""].join(NL);
	const written = await writer.rename(stale, "Call the garage back", true);
	assert.ok(written);
	assert.equal(files["A.md"], ["# Notes", "New line", "- [ ] Call the garage back #home %%sync:42%%", ""].join(NL));
	// Two lines with the same tag and words: which one is unknown, nothing is written.
	files["A.md"] = ["- [ ] Call the garage #home 📅 2026-10-09", "- [ ] Call the garage #home 📅 2026-10-10"].join(NL);
	assert.equal(await writer.rename(stale, "Call them", true), null);
});

// ----- tasks without a tag -----
import { scanUntagged, untaggedInScope } from "../src/modules/tasks/parse";

test("untagged checkboxes: on their own only, never a subtask, in code or done; their line untouched", () => {
	const lines = [
		"---", "todo: - [ ] in properties", "---",
		"- [ ] Rappeler le garage",
		"- [ ] Paint the hall #home",
		"\t- [ ] Buy paint",
		"- [ ] Pack the bags",
		"\t- [ ] Socks",
		"- [x] Already done",
		"```", "- [ ] In code", "```",
		"- [ ] ",
		"- [ ] Call Sam #high",
	];
	assert.deepEqual(scanUntagged(lines, "Daily.md", flagSet("")).map((t) => [t.line, t.title, t.primary]), [[3, "Rappeler le garage", ""], [6, "Pack the bags", ""], [13, "Call Sam", ""]]);
	const day = 86_400_000;
	assert.ok(untaggedInScope(100 * day, 110 * day, 30));
	assert.ok(!untaggedInScope(100 * day, 280 * day, 30));
	assert.ok(!untaggedInScope(100 * day, 100 * day, 0));
});

test("No tag: a fresh daily note is listed, an old template checklist is not; tagging moves the task to its group", async () => {
	const now = Date.now();
	const { index, writer, files } = fakeVault(
		{ "Daily/2026-10-08.md": "- [ ] Rappeler le garage\n- [ ] Pay the bill #home", "Old/Checklist.md": "- [ ] Pack the tent\n- [ ] Check the oil" },
		{ untaggedDays: 30 },
		{ "Daily/2026-10-08.md": now, "Old/Checklist.md": now - 180 * 86_400_000 },
	);
	await index.build();
	assert.deepEqual(index.untagged.map((t) => [t.path, t.title]), [["Daily/2026-10-08.md", "Rappeler le garage"]]);
	// Kept apart: counts, Today, the API (and the sync that reads it) see only tagged tasks.
	assert.deepEqual(index.open().map((t) => t.title), ["Pay the bill"]);
	const garage = index.untagged[0];
	assert.equal(index.get(garage.key), garage);
	const written = await writer.addTag(garage, "car", true);
	assert.ok(written);
	assert.equal(files["Daily/2026-10-08.md"], "- [ ] Rappeler le garage #car\n- [ ] Pay the bill #home");
	assert.deepEqual(index.untagged, []);
	assert.ok(index.open().some((t) => t.title === "Rappeler le garage" && t.primary === "car"));
	// Off with 0.
	const off = fakeVault({ "A.md": "- [ ] Plain" }, { untaggedDays: 0 });
	await off.index.build();
	assert.deepEqual(off.index.untagged, []);
});

test("review: no twin taken for a stale task, an emptied note gets its task back, old notes stay out when read again", async () => {
	// Two "Call" tasks with their own sync ids; the first was checked meanwhile: the stale rename writes nothing.
	const { index, writer, files } = fakeVault({ "A.md": ["- [ ] Call #home %%sync:1%%", "- [ ] Call #home %%sync:2%%"].join(NL) });
	await index.build();
	const first = index.open()[0];
	files["A.md"] = ["- [x] Call #home %%sync:1%%", "- [ ] Call #home %%sync:2%%"].join(NL);
	assert.equal(await writer.rename(first, "Call back", true), null);
	assert.equal(files["A.md"], ["- [x] Call #home %%sync:1%%", "- [ ] Call #home %%sync:2%%"].join(NL));
	// The only task of a note, without a final line break: deleted, then put back.
	const solo = fakeVault({ "B.md": "- [ ] Only #home" });
	await solo.index.build();
	const gone = await solo.writer.deleteTask(solo.index.open()[0], true);
	assert.equal(solo.files["B.md"], "");
	assert.equal(await gone!.undo(), true);
	assert.equal(solo.files["B.md"], "- [ ] Only #home");
	// An old note read again (cache event, rename) keeps its age: its checklist stays out.
	const old = fakeVault({ "Old.md": "- [ ] Pack the tent" }, { untaggedDays: 30 }, { "Old.md": Date.now() - 200 * 86_400_000 });
	await old.index.build();
	old.index.set("Old.md", "- [ ] Pack the tent\n- [ ] Check the oil");
	assert.deepEqual(old.index.untagged, []);
	// A recent one that ages leaves at the next check.
	const fresh = fakeVault({ "New.md": "- [ ] Water the plants" }, { untaggedDays: 30 });
	await fresh.index.build();
	assert.equal(fresh.index.untagged.length, 1);
	fresh.index.expireUntagged(Date.now() + 31 * 86_400_000);
	assert.deepEqual(fresh.index.untagged, []);
	// A renamed untagged task keeps a key that follows its new words.
	const loose = fakeVault({ "C.md": "- [ ] Water the plants" }, { untaggedDays: 30 });
	await loose.index.build();
	const plants = loose.index.untagged[0];
	assert.equal(loose.writer.keyAfterRename(plants, "Water the lemon tree"), "|water the lemon tree");
	assert.ok(await loose.writer.rename(plants, "Water the lemon tree", true));
	assert.equal(loose.index.get("|water the lemon tree")?.title, "Water the lemon tree");
});

// ----- several tasks at once -----

test("many lines of a note at once: each its own change, one write, all taken back", () => {
	const lines = ["- [ ] A #home", "- [ ] B #work", "- [ ] C #home"];
	const result = editLines(lines, [
		{ line: 0, raw: lines[0], fn: (l) => l.replace("[ ]", "[x]") },
		{ line: 2, raw: lines[2], fn: (l) => l + " #high" },
		{ line: 9, raw: "gone", fn: (l) => l },
	])!;
	assert.deepEqual(result.lines, ["- [x] A #home", "- [ ] B #work", "- [ ] C #home #high"]);
	assert.deepEqual(revertLines(result.lines, result.changes).lines, lines);
});

test("deleting several tasks of a note: blocks removed from the bottom, put back in place", () => {
	const lines = ["# Top", "- [ ] A #home", "	desc A", "- [ ] B #home", "- [ ] C #home", "	- [ ] sub C", "end"];
	const ends = (ls: readonly string[], at: number) => (ls[at + 1]?.startsWith("	") ? at + 1 : at);
	const result = removeBlocks(lines, [{ line: 1, raw: lines[1] }, { line: 4, raw: lines[4] }], ends)!;
	assert.deepEqual(result.lines, ["# Top", "- [ ] B #home", "end"]);
	assert.equal(result.blocks.length, 2);
	assert.deepEqual(restoreBlocks(result.lines, result.blocks).lines, lines);
	// The neighbour of one block changed meanwhile: that one stays out, the other comes back.
	const partial = restoreBlocks(["# Top", "- [ ] B #home", "end changed"], result.blocks);
	assert.equal(partial.restored, 1);
	assert.deepEqual(partial.lines, ["# Top", "- [ ] A #home", "\tdesc A", "- [ ] B #home", "end changed"]);
	// A task and a task inside its block, both picked: the outer block goes once, with everything in it.
	const nested = ["- [ ] P #work", "\t- [ ] C #work", "\t\tdesc C", "after"];
	const deep = (ls: readonly string[], at: number) => {
		const w = /^\t*/.exec(ls[at])![0].length;
		let end = at;
		for (let j = at + 1; j < ls.length && /^\t*/.exec(ls[j])![0].length > w; j++) end = j;
		return end;
	};
	const both = removeBlocks(nested, [{ line: 0, raw: nested[0] }, { line: 1, raw: nested[1] }], deep)!;
	assert.deepEqual(both.lines, ["after"]);
	assert.deepEqual(restoreBlocks(both.lines, both.blocks).lines, nested);
});

test("bulk on the tasks of two notes: one write per note, one Undo for all", async () => {
	const a = ["- [ ] A1 #home", "- [ ] A2 #work"].join(NL);
	const b = ["- [ ] B1 #home", "	note", "- [ ] B2 #home"].join(NL);
	const { index, writer, files } = fakeVault({ "A.md": a, "B.md": b });
	await index.build();
	const vault = (writer as unknown as { ctx: Context }).ctx.app.vault;
	const process = vault.process.bind(vault);
	let writes = 0;
	vault.process = (async (file: TFile, fn: (data: string) => string) => {
		writes++;
		return process(file, fn);
	}) as typeof vault.process;
	const all = index.open();
	const moved = await writer.editMany(all.map((task) => ({ task, fn: (line: string) => line.replace(/#(home|work)/, "#errands") })));
	assert.equal(moved.count, 4);
	assert.equal(writes, 2);
	assert.equal(index.open().filter((t) => t.primary === "errands").length, 4);
	assert.equal(await moved.undo(), true);
	assert.deepEqual([files["A.md"], files["B.md"]], [a, b]);
	const gone = await writer.deleteMany(index.open().filter((t) => t.path === "B.md"));
	assert.equal(gone.count, 2);
	assert.equal(files["B.md"], "");
	assert.equal(await gone.undo(), true);
	assert.equal(files["B.md"], b);
});
