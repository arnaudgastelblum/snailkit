// The Home module's pure logic (src/modules/home/logic): the arrangement of the domains, the
// lines and counts of the blocks, the pages, the Today row, recent notes, tags and the Map's
// source. A small fictional vault stands in for Obsidian.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	arrange,
	deleteGroup,
	dropBlock,
	dropPath,
	EMPTY_ARRANGEMENT,
	feature,
	hide,
	liveBlocks,
	moveBlock,
	newGroup,
	normalizeArrangement,
	pullOut,
	putBack,
	readingOrder,
	renameGroup,
	renamePath,
	setGroup,
	show,
	type Arrangement,
} from "../src/modules/home/logic/arrange";
import { activity, blockLines, blockOf, emptyBlock, isPage, nearestPage, openTasksByBlock, pageContent, trailOf, visibleLines } from "../src/modules/home/logic/blocks";
import { dateLabel, dayKey, daysBetween, dueLabel, relLabel, splitDated, type DateWords } from "../src/modules/home/logic/dates";
import { autoChain, HomeMapSource, mapStateAt, usableState, VAULT_ROOT } from "../src/modules/home/logic/map";
import { cleanRecents, dropRecent, groupRecents, pushRecent, renameRecent, RECENTS_KEPT, seedRecents } from "../src/modules/home/logic/recents";
import { familyTags, hasTag, leafOf, tagFamilies } from "../src/modules/home/logic/tags";
import { typesInSearch } from "../src/modules/home/logic/keys";
import { dueCounts, oldDailyTasks, todayChips, toSortCount } from "../src/modules/home/logic/today";
import type { World } from "../src/modules/home/logic/world";
import { cleanSettings, migrateSettings, splitFolders, startLens, LENSES, nextZoom, zoomLevel } from "../src/modules/home/settings-logic";
import { applyOrder, cleanOrder, dropFromOrder, moveBefore, orderMentions, orderOf, renameInOrder, withOrder } from "../src/modules/home/logic/order";
import { cleanNoteName, dropRefusal, freeNotePath } from "../src/modules/home/logic/moves";

/** A note: its parent, when it was modified (higher is more recent), and what it is. */
interface Spec {
	up?: string;
	m?: number;
	brain?: boolean;
	drawing?: boolean;
}

function world(notes: Record<string, Spec>, home: string | null = "Home.md"): World & { notes: Record<string, Spec> } {
	const paths = Object.keys(notes);
	const children = (path: string) => paths.filter((p) => notes[p].up === path).sort();
	const top = (p: string) => {
		let at = p;
		const seen = new Set<string>();
		while (notes[at]?.up && !seen.has(at)) {
			seen.add(at);
			at = notes[at].up!;
		}
		return at;
	};
	const domains = () => {
		const out = new Set<string>();
		for (const p of paths) {
			if (!notes[p].up) continue;
			// Below the home page: its children that have children; without one, the top notes.
			if (home) {
				let at = p;
				while (notes[at]?.up && notes[at].up !== home) at = notes[at].up!;
				if (notes[at]?.up === home && at !== p) out.add(at);
			} else out.add(top(p));
		}
		return [...out];
	};
	return {
		notes,
		home: () => home,
		domains,
		children,
		hasChildren: (p) => children(p).length > 0,
		parent: (p) => notes[p]?.up ?? null,
		exists: (p) => p in notes,
		name: (p) => p.replace(/^.*\//, "").replace(/\.md$/, ""),
		mtime: (p) => notes[p]?.m ?? 0,
		isBrainstorm: (p) => !!notes[p]?.brain,
		isDrawing: (p) => !!notes[p]?.drawing,
		hue: (p) => p.length * 10,
	};
}

/** The fictional vault: Home, three domains (one with a sub-MOC), brainstorms, a loose note. */
function vault() {
	return world({
		"Home.md": { m: 1 },
		"Clients/Acme.md": { up: "Home.md", m: 5 },
		"Clients/Acme Intake.md": { up: "Clients/Acme.md", m: 6 },
		"Clients/Acme Budget.md": { up: "Clients/Acme Intake.md", m: 40 },
		"Clients/Acme Timeline.md": { up: "Clients/Acme Intake.md", m: 30 },
		"Clients/2026-10-01 Acme Review.md": { up: "Clients/Acme Intake.md", m: 20 },
		"Clients/Review questions.md": { up: "Clients/2026-10-01 Acme Review.md", m: 21, brain: true },
		"Clients/Acme Notes.md": { up: "Clients/Acme.md", m: 10 },
		"Areas/Practice.md": { up: "Home.md", m: 2 },
		"Areas/Weekly Review.md": { up: "Areas/Practice.md", m: 50 },
		"Areas/Time Log.md": { up: "Areas/Practice.md", m: 3 },
		"Areas/Capacity.md": { up: "Areas/Practice.md", m: 60, brain: true },
		"Reading/Reading List.md": { up: "Home.md", m: 4 },
		"Reading/Tracker.md": { up: "Reading/Reading List.md", m: 8 },
		"Inbox.md": { m: 99 },
		"Home note.md": { up: "Home.md", m: 7 },
	});
}

const words: DateWords = {
	today: "today",
	yesterday: "yesterday",
	tomorrow: "tomorrow",
	weekday: (ms) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(ms).getDay()],
	date: (ms, year) => {
		const d = new Date(ms);
		return `${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}${year ? " " + d.getFullYear() : ""}`;
	},
	time: (ms) => {
		const d = new Date(ms);
		return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	},
};

const ids = (list: Array<{ id: string }>) => list.map((b) => b.id);
const layoutOf = (w: World, arr: Arrangement) => arrange(liveBlocks(w, arr), arr, (id) => activity(w, id), (id) => w.name(id));

// ----- arrangement -----

test("domains follow recent activity until the user places them", () => {
	const w = vault();
	const layout = layoutOf(w, EMPTY_ARRANGEMENT);
	// Practice holds the most recent note (60), then Acme (40), then Reading (8).
	assert.deepEqual(ids(readingOrder(layout)), ["Areas/Practice.md", "Clients/Acme.md", "Reading/Reading List.md"]);
	assert.equal(layout.sections.length, 1);
	assert.equal(layout.sections[0].group, null);
	const placed = layoutOf(w, { ...EMPTY_ARRANGEMENT, domainOrder: ["Reading/Reading List.md", "Gone.md"] });
	assert.deepEqual(ids(readingOrder(placed)), ["Reading/Reading List.md", "Areas/Practice.md", "Clients/Acme.md"]);
});

test("moving up and down stays within the section and freezes the order", () => {
	const w = vault();
	let arr = EMPTY_ARRANGEMENT;
	arr = moveBlock(arr, layoutOf(w, arr), "Clients/Acme.md", -1);
	assert.deepEqual(arr.domainOrder, ["Clients/Acme.md", "Areas/Practice.md", "Reading/Reading List.md"]);
	assert.equal(moveBlock(arr, layoutOf(w, arr), "Clients/Acme.md", -1), arr, "first cannot go up");
	arr = moveBlock(arr, layoutOf(w, arr), "Areas/Practice.md", 1);
	assert.deepEqual(ids(readingOrder(layoutOf(w, arr))), ["Clients/Acme.md", "Reading/Reading List.md", "Areas/Practice.md"]);
});

test("featured, hidden and shown again", () => {
	const w = vault();
	let arr = feature(EMPTY_ARRANGEMENT, "Reading/Reading List.md");
	let layout = layoutOf(w, arr);
	assert.equal(layout.featured?.id, "Reading/Reading List.md");
	assert.ok(!layout.sections.some((s) => s.blocks.some((b) => b.id === "Reading/Reading List.md")));
	arr = hide(arr, "Reading/Reading List.md");
	layout = layoutOf(w, arr);
	assert.equal(layout.featured, null, "hiding a featured domain stops featuring it");
	assert.deepEqual(ids(layout.hidden), ["Reading/Reading List.md"]);
	arr = show(arr, "Reading/Reading List.md");
	assert.deepEqual(layoutOf(w, arr).hidden, []);
	arr = feature(hide(arr, "Clients/Acme.md"), "Clients/Acme.md");
	assert.ok(!arr.hidden.includes("Clients/Acme.md"), "featuring shows it again");
});

test("groups: new, move, rename, delete; empty groups go", () => {
	const w = vault();
	let arr: Arrangement = EMPTY_ARRANGEMENT;
	const made = newGroup(arr, layoutOf(w, arr), "Clients/Acme.md", " Clients ");
	arr = made.arr;
	assert.deepEqual(arr.groups, [[made.group, "Clients"]]);
	let layout = layoutOf(w, arr);
	assert.equal(layout.sections[0].group?.name, "Clients");
	assert.deepEqual(ids(layout.sections[0].blocks), ["Clients/Acme.md"]);
	assert.equal(layout.sections[1].group, null, "the others come after, in no group");
	arr = setGroup(arr, layout, "Reading/Reading List.md", made.group);
	assert.deepEqual(ids(layoutOf(w, arr).sections[0].blocks), ["Clients/Acme.md", "Reading/Reading List.md"]);
	arr = renameGroup(arr, made.group, "Customers");
	assert.equal(arr.groups[0][1], "Customers");
	assert.equal(newGroup(arr, layoutOf(w, arr), "Areas/Practice.md", "  ").group, "", "no name, no group");
	arr = setGroup(arr, layoutOf(w, arr), "Clients/Acme.md", null);
	arr = setGroup(arr, layoutOf(w, arr), "Reading/Reading List.md", null);
	assert.deepEqual(arr.groups, [], "a group left empty goes");
	const two = newGroup(EMPTY_ARRANGEMENT, layoutOf(w, EMPTY_ARRANGEMENT), "Clients/Acme.md", "A").arr;
	assert.deepEqual(deleteGroup(two, two.groups[0][0]).domainGroups, []);
});

test("drag and drop: before, after, into a group", () => {
	const w = vault();
	let arr = newGroup(EMPTY_ARRANGEMENT, layoutOf(w, EMPTY_ARRANGEMENT), "Clients/Acme.md", "Clients").arr;
	const group = arr.groups[0][0];
	arr = dropBlock(arr, layoutOf(w, arr), "Reading/Reading List.md", { before: "Clients/Acme.md" });
	let layout = layoutOf(w, arr);
	assert.deepEqual(ids(layout.sections[0].blocks), ["Reading/Reading List.md", "Clients/Acme.md"], "takes the group of the block it lands next to");
	arr = dropBlock(arr, layout, "Reading/Reading List.md", { group: null });
	layout = layoutOf(w, arr);
	assert.deepEqual(ids(layout.sections[0].blocks), ["Clients/Acme.md"]);
	assert.equal(layout.sections[0].group?.id, group);
	arr = dropBlock(arr, layout, "Areas/Practice.md", { after: "Clients/Acme.md" });
	assert.deepEqual(ids(layoutOf(w, arr).sections[0].blocks), ["Clients/Acme.md", "Areas/Practice.md"]);
	assert.equal(dropBlock(arr, layoutOf(w, arr), "Areas/Practice.md", { before: "Areas/Practice.md" }), arr);
});

test("pulling a sub-MOC out and putting it back", () => {
	const w = vault();
	let arr = pullOut(EMPTY_ARRANGEMENT, layoutOf(w, EMPTY_ARRANGEMENT), "Clients/Acme Intake.md", "Clients/Acme.md");
	const layout = layoutOf(w, arr);
	const order = ids(readingOrder(layout));
	assert.equal(order[order.indexOf("Clients/Acme.md") + 1], "Clients/Acme Intake.md", "right after its domain");
	const pulled = layout.order.find((b) => b.id === "Clients/Acme Intake.md")!;
	assert.equal(pulled.kind, "pulled");
	assert.equal(pulled.domain, "Clients/Acme.md");
	// A note that is no longer a sub-MOC is not a block.
	assert.ok(!liveBlocks(w, { ...arr, pulledOut: ["Clients/Acme Notes.md"] }).some((b) => b.id === "Clients/Acme Notes.md"));
	arr = putBack(arr, "Clients/Acme Intake.md");
	assert.deepEqual(arr.pulledOut, []);
	assert.ok(!arr.domainOrder.includes("Clients/Acme Intake.md"));
});

test("renames and deletions are followed", () => {
	let arr: Arrangement = {
		domainOrder: ["A.md", "B.md"],
		featured: "A.md",
		groups: [["g1", "One"]],
		domainGroups: [["A.md", "g1"]],
		hidden: ["B.md"],
		pulledOut: ["S.md"],
	};
	arr = renamePath(arr, "A.md", "Z/A.md");
	assert.deepEqual(arr.domainOrder, ["Z/A.md", "B.md"]);
	assert.equal(arr.featured, "Z/A.md");
	assert.deepEqual(arr.domainGroups, [["Z/A.md", "g1"]]);
	arr = dropPath(arr, "Z/A.md");
	assert.equal(arr.featured, "");
	assert.deepEqual(arr.groups, [], "its group, left empty, goes");
	assert.deepEqual(dropPath(arr, "S.md").pulledOut, []);
});

test("stored settings are cleaned: unknown ids, empty groups, duplicates, bad values", () => {
	const arr = normalizeArrangement({
		domainOrder: ["A.md", "A.md", 3, "", "B.md"],
		featured: 7,
		groups: [["g1", " One "], ["g1", "Again"], ["g2", ""], ["g3", "Empty"], "bad"],
		domainGroups: [["A.md", "g1"], ["A.md", "g3"], ["B.md", "nope"], ["C.md"]],
		hidden: "x",
		pulledOut: [null, "S.md"],
	});
	assert.deepEqual(arr, { domainOrder: ["A.md", "B.md"], featured: "", groups: [["g1", "One"]], domainGroups: [["A.md", "g1"]], hidden: [], pulledOut: ["S.md"] });
	const settings = cleanSettings({ lens: "graph", homePage: "  Home.md ", ignoredFolders: "a", domainOrder: [], featured: "", groups: [], domainGroups: [], hidden: [], pulledOut: [], lensChosen: false, pinsOnTop: false, mapZoom: 1, noteOrder: [] });
	assert.equal(settings.lens, "map");
	assert.equal(settings.homePage, "Home.md");
	assert.deepEqual(splitFolders(" Templates, /Archive/ ,, Templates"), ["Templates", "Archive"]);
});

// ----- blocks and pages -----

test("a block lists its sub-MOCs with their notes, then its notes, brainstorms left out", () => {
	const w = vault();
	const acme = { id: "Clients/Acme.md", kind: "domain" as const, domain: "Clients/Acme.md" };
	const lines = blockLines(w, acme, new Set());
	assert.deepEqual(
		lines.map((l) => [l.kind, w.name(l.path), l.count ?? null]),
		[
			["sub", "Acme Intake", 3],
			["kid", "Acme Budget", null],
			["kid", "Acme Timeline", null],
			["kid", "2026-10-01 Acme Review", null],
			["note", "Acme Notes", null],
		],
	);
	assert.deepEqual(visibleLines(lines, false).more, 1);
	assert.deepEqual(visibleLines(lines, true).more, 0);
	// Pulled out: the sub-MOC is not repeated in its domain.
	assert.deepEqual(blockLines(w, acme, new Set(["Clients/Acme Intake.md"])).map((l) => w.name(l.path)), ["Acme Notes"]);
	const pulled = blockLines(w, { id: "Clients/Acme Intake.md", kind: "pulled", domain: "Clients/Acme.md" }, new Set());
	assert.deepEqual(pulled.map((l) => w.name(l.path)), ["Acme Budget", "Acme Timeline", "2026-10-01 Acme Review"]);
	const practice = blockLines(w, { id: "Areas/Practice.md", kind: "domain", domain: "Areas/Practice.md" }, new Set());
	assert.deepEqual(practice.map((l) => w.name(l.path)), ["Weekly Review", "Time Log"], "most recent first, no brainstorm");
});

test("an empty block says why: only brainstorms, sub-MOCs pulled out, or both", () => {
	const w = world({
		"Home.md": { m: 1 },
		"Ideas.md": { up: "Home.md", m: 2 },
		"Idea 1.md": { up: "Ideas.md", m: 3, brain: true },
		"Idea 2.md": { up: "Ideas.md", m: 4, brain: true },
		"Work.md": { up: "Home.md", m: 5 },
		"Work/Client.md": { up: "Work.md", m: 6 },
		"Work/Client notes.md": { up: "Work/Client.md", m: 7 },
		"Life.md": { up: "Home.md", m: 8 },
		"Life/Garden.md": { up: "Life.md", m: 9 },
		"Life/Seeds.md": { up: "Life/Garden.md", m: 10, brain: true },
		"Life/Morning.md": { up: "Life.md", m: 11, brain: true },
	});
	const domain = (id: string) => ({ id, kind: "domain" as const, domain: id });
	const pulled = new Set(["Work/Client.md", "Life/Garden.md"]);
	for (const [block, kind, brainstorms] of [
		[domain("Ideas.md"), "brainstorms", 2],
		[domain("Work.md"), "pulled", 0],
		[domain("Life.md"), "both", 1],
		[{ id: "Life/Garden.md", kind: "pulled" as const, domain: "Life.md" }, "brainstorms", 1],
	] as const) {
		assert.deepEqual(blockLines(w, block, pulled), [], `${block.id} has no line`);
		assert.deepEqual(emptyBlock(w, block, pulled), { kind, brainstorms }, block.id);
	}
	assert.deepEqual(emptyBlock(w, domain("Work.md"), new Set()), { kind: "nothing", brainstorms: 0 }, "nothing pulled, no brainstorm (a block with lines never asks)");
});

test("open tasks count for their nearest block", () => {
	const w = vault();
	const tasks = [
		{ path: "Clients/Acme Budget.md", done: false },
		{ path: "Clients/Acme Budget.md", done: true },
		{ path: "Clients/Acme Notes.md", done: false },
		{ path: "Clients/Acme.md", done: false },
		{ path: "Areas/Time Log.md", done: false },
		{ path: "Inbox.md", done: false },
	];
	const domains = liveBlocks(w, EMPTY_ARRANGEMENT);
	const counts = openTasksByBlock(w, tasks, domains);
	assert.equal(counts.get("Clients/Acme.md"), 3);
	assert.equal(counts.get("Areas/Practice.md"), 1);
	assert.equal(counts.get("Reading/Reading List.md"), undefined);
	const withPulled = liveBlocks(w, { ...EMPTY_ARRANGEMENT, pulledOut: ["Clients/Acme Intake.md"] });
	const split = openTasksByBlock(w, tasks, withPulled);
	assert.equal(split.get("Clients/Acme.md"), 2);
	assert.equal(split.get("Clients/Acme Intake.md"), 1);
	assert.equal(blockOf(w, "Inbox.md", new Set(["Clients/Acme.md"])), null);
});

test("the nearest page of a note, for the rail's area pill", () => {
	const w = vault();
	const domains = new Set(w.domains());
	const none = new Set<string>();
	assert.equal(nearestPage(w, "Clients/Acme Budget.md", domains, none), "Clients/Acme Intake.md");
	assert.equal(nearestPage(w, "Clients/Review questions.md", domains, none), "Clients/Acme Intake.md");
	assert.equal(nearestPage(w, "Clients/Acme Notes.md", domains, none), "Clients/Acme.md");
	assert.equal(nearestPage(w, "Clients/Acme.md", domains, none), "Clients/Acme.md");
	assert.equal(nearestPage(w, "Clients/Acme Intake.md", domains, none), "Clients/Acme Intake.md");
	assert.equal(nearestPage(w, "Inbox.md", domains, none), null, "no parent, no page");
	assert.equal(nearestPage(w, "Home note.md", domains, none), null, "above the domains");
	assert.equal(nearestPage(w, "Home.md", domains, none), null);
	assert.ok(isPage(w, "Clients/Acme Intake.md", domains, none));
	assert.ok(!isPage(w, "Clients/Acme Budget.md", domains, none));
	assert.ok(!isPage(w, "Gone.md", domains, none));
});

test("a page lists sub-MOCs, notes (recent first), brainstorms, and its members", () => {
	const w = vault();
	const domains = new Set(w.domains());
	const acme = pageContent(w, "Clients/Acme.md", domains);
	assert.deepEqual(acme.subs, ["Clients/Acme Intake.md"]);
	assert.deepEqual(acme.notes.map((p) => w.name(p)), ["Acme Budget", "Acme Timeline", "2026-10-01 Acme Review", "Acme Notes"]);
	assert.deepEqual(acme.brainstorms, ["Clients/Review questions.md"]);
	assert.ok(acme.members.has("Clients/Acme.md") && acme.members.has("Clients/Review questions.md"));
	const intake = pageContent(w, "Clients/Acme Intake.md", domains);
	assert.deepEqual(intake.subs, [], "a sub-MOC page has no sub-MOC section");
	assert.equal(intake.notes.length, 3);
	assert.deepEqual(trailOf(w, "Clients/Acme Budget.md", domains), ["Acme", "Acme Intake"]);
	assert.deepEqual(trailOf(w, "Clients/Acme Notes.md", domains), ["Acme"]);
	assert.deepEqual(trailOf(w, "Clients/Acme Intake.md", domains), ["Acme"]);
	assert.deepEqual(trailOf(w, "Clients/Acme.md", domains), []);
	assert.deepEqual(trailOf(w, "Inbox.md", domains), []);
});

// ----- Today -----

test("Today chips: empty ones left out", () => {
	assert.deepEqual(todayChips({ daily: false, due: null, toSort: null, old: null }), [{ kind: "daily", exists: false }]);
	assert.deepEqual(
		todayChips({ daily: true, due: { overdue: 2, today: 0 }, toSort: 0, old: 12 }).map((c) => c.kind),
		["daily", "due", "old"],
	);
	assert.deepEqual(todayChips({ daily: true, due: { overdue: 0, today: 0 }, toSort: 3, old: 0 }).map((c) => c.kind), ["daily", "brainstorms"]);
	const tasks = [
		{ due: "2026-10-05", done: false },
		{ due: "2026-10-06", done: false },
		{ due: "2026-10-06", done: true },
		{ due: "2026-10-09", done: false },
		{ due: null, done: false },
		{ due: "soon", done: false },
	];
	assert.deepEqual(dueCounts(tasks, "2026-10-06"), { overdue: 1, today: 1 });
	assert.equal(toSortCount([{ state: "to-sort" }, { state: "open" }, { state: "to-sort" }]), 2);
});

test("tasks of older daily notes, grouped by note, newest note first", () => {
	const dayOf = (p: string) => (/^Daily\/(\d{4}-\d{2}-\d{2})\.md$/.exec(p)?.[1] ?? null);
	const tasks = [
		{ path: "Daily/2026-10-03.md", line: 4, done: false },
		{ path: "Daily/2026-10-03.md", line: 2, done: false },
		{ path: "Daily/2026-10-05.md", line: 1, done: false },
		{ path: "Daily/2026-10-06.md", line: 1, done: false },
		{ path: "Daily/2026-09-30.md", line: 1, done: true },
		{ path: "Notes/Other.md", line: 1, done: false },
	];
	const groups = oldDailyTasks(tasks, dayOf, "2026-10-06");
	assert.deepEqual(groups.map((g) => g.day), ["2026-10-05", "2026-10-03"]);
	assert.deepEqual(groups[1].tasks.map((t) => t.line), [2, 4]);
	const kept = oldDailyTasks(tasks, dayOf, "2026-10-06", (t) => t.path === "Daily/2026-09-30.md");
	assert.equal(kept.length, 3, "a task just checked stays until the page is left");
});

// ----- recent notes -----

test("recent notes: opened ones first, each once, grouped by day", () => {
	const now = new Date(2026, 9, 6, 9, 40).getTime();
	const day = 86_400_000;
	let list = seedRecents(["A.md", "pic.png", "B.md", "A.md"]);
	assert.deepEqual(list, [{ path: "A.md", at: 0 }, { path: "B.md", at: 0 }]);
	list = pushRecent(list, "B.md", now - 60_000);
	list = pushRecent(list, "C.md", now - day);
	list = pushRecent(list, "D.md", now - 3 * day);
	list = pushRecent(list, "E.md", now);
	assert.deepEqual(list.map((r) => r.path), ["E.md", "D.md", "C.md", "B.md", "A.md"]);
	const groups = groupRecents(list, now, (p) => p !== "D.md");
	assert.deepEqual(groups.map((g) => [g.group, g.items.map((r) => r.path)]), [
		["today", ["E.md", "B.md"]],
		["yesterday", ["C.md"]],
		["earlier", ["A.md"]],
	]);
	assert.deepEqual(groupRecents(pushRecent(list, "D.md", now - 3 * day), now).map((g) => g.group), ["today", "yesterday", "week", "earlier"]);
	list = renameRecent(list, "E.md", "F.md");
	assert.equal(list[0].path, "F.md");
	assert.ok(!dropRecent(list, "F.md").some((r) => r.path === "F.md"));
	let many: ReturnType<typeof cleanRecents> = [];
	for (let i = 0; i < 40; i++) many = pushRecent(many, `${i}.md`, now - i);
	assert.equal(many.length, RECENTS_KEPT);
	assert.equal(groupRecents(many, now)[0].items.length, 10, "ten shown");
	assert.deepEqual(cleanRecents([{ path: "A.md", at: -3 }, { path: 4 }, null, { path: "A.md", at: 9 }]), [{ path: "A.md", at: 0 }]);
	assert.deepEqual(cleanRecents("nope"), []);
});

// ----- dates -----

test("dates: dated titles, relative labels, due labels", () => {
	assert.deepEqual(splitDated("2026-10-01 Acme Review"), { label: "Acme Review", date: "2026-10-01" });
	assert.deepEqual(splitDated("2026-02-30 Nope"), { label: "2026-02-30 Nope", date: null });
	assert.deepEqual(splitDated("Weekly Review"), { label: "Weekly Review", date: null });
	assert.deepEqual(splitDated("2026-10-06"), { label: "2026-10-06", date: null }, "a daily note keeps its name");
	const now = new Date(2026, 9, 6, 9, 40).getTime();
	assert.equal(relLabel(new Date(2026, 9, 6, 8, 5).getTime(), now, words), "08:05");
	assert.equal(relLabel(new Date(2026, 9, 5, 22, 0).getTime(), now, words), "yesterday");
	assert.equal(relLabel(new Date(2026, 9, 2, 12, 0).getTime(), now, words), "Fri");
	assert.equal(relLabel(new Date(2026, 8, 20, 12, 0).getTime(), now, words), "20 Sep");
	assert.equal(relLabel(new Date(2025, 8, 20, 12, 0).getTime(), now, words), "20 Sep 2025");
	assert.equal(relLabel(0, now, words), "");
	assert.deepEqual(dueLabel("2026-10-06", "2026-10-06", words), { text: "today", late: false });
	assert.deepEqual(dueLabel("2026-10-05", "2026-10-06", words), { text: "yesterday", late: true });
	assert.deepEqual(dueLabel("2026-10-02", "2026-10-06", words), { text: "2 Oct", late: true });
	assert.deepEqual(dueLabel("2026-10-07", "2026-10-06", words), { text: "tomorrow", late: false });
	assert.equal(dateLabel("2026-10-06", "2026-10-06", words), "6 Oct");
	assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2, "across a clock change");
	assert.equal(dayKey(new Date(2026, 0, 2, 23, 59).getTime()), "2026-01-02");
});

// ----- tags -----

test("tags: families sorted by use, sub-tags one level down", () => {
	const families = tagFamilies({ "#project/website": 3, "#project/website/footer": 1, "#Project/app": 5, "#reading": 2, "#idea": 9, "#zero": 0 });
	assert.deepEqual(families.map((f) => [f.tag, f.count]), [["idea", 9], ["project", 9], ["reading", 2]]);
	assert.deepEqual(families[1].kids, [{ tag: "project/app", count: 5 }, { tag: "project/website", count: 4 }]);
	assert.ok(hasTag(["Project/Website/footer"], "project/website"));
	assert.ok(hasTag(["project"], "#Project"));
	assert.ok(!hasTag(["projects"], "project"));
	assert.deepEqual(familyTags({ "#project/website": 3, "#project/website/footer": 1, "#idea": 2 }, "project/website").map((t) => t.tag), ["project/website", "project/website/footer"]);
	assert.equal(leafOf("project/website"), "website");
});

// ----- the Map's source -----

test("the Map: domains in the Domains order under the root, then parents, notes, brainstorms", () => {
	const w = vault();
	const roots = () => [
		{ path: "Reading/Reading List.md", group: "Side" },
		{ path: "Clients/Acme.md", group: "Clients" },
		{ path: "Areas/Practice.md", group: "Clients" },
	];
	const source = new HomeMapSource(w, roots, "Vault");
	const top = source.children("Home.md");
	assert.deepEqual(top.map((n) => [n.label, n.kind, n.group ?? null]), [
		["Reading List", "domain", "Side"],
		["Acme", "domain", "Clients"],
		["Practice", "domain", null],
	]);
	assert.equal(source.node("Home.md")?.kind, "root");
	assert.deepEqual(source.children("Clients/Acme.md").map((n) => [n.label, n.kind]), [
		["Acme Intake", "sub"],
		["Acme Notes", "note"],
	]);
	assert.deepEqual(source.children("Clients/Acme Intake.md").map((n) => n.label), ["Acme Review", "Acme Budget", "Acme Timeline"], "parents first, then recent first");
	const review = source.node("Clients/2026-10-01 Acme Review.md")!;
	assert.equal(review.title, "2026-10-01 Acme Review");
	assert.equal(review.hue, w.hue("Clients/Acme.md"));
	assert.equal(source.node("Clients/Review questions.md")?.kind, "brainstorm");
	assert.deepEqual(source.children("Areas/Practice.md").map((n) => n.label), ["Weekly Review", "Time Log", "Capacity"], "brainstorms last");
	assert.equal(source.parent("Clients/Acme.md"), "Home.md");
	assert.equal(source.parent("Home.md"), null);
	assert.equal(source.node("Gone.md"), null);
	assert.equal(source.node("Inbox.md")?.hue, null);
});

test("the Map without a home page hangs the domains under the vault", () => {
	const w = world({ "A.md": { m: 1 }, "A1.md": { up: "A.md", m: 2 }, "B.md": { m: 3 }, "B1.md": { up: "B.md", m: 4 } }, null);
	const source = new HomeMapSource(w, () => w.domains().map((path) => ({ path, group: null })), "Vault");
	assert.equal(source.home(), VAULT_ROOT);
	assert.equal(source.node(VAULT_ROOT)?.label, "Vault");
	assert.deepEqual(source.children(VAULT_ROOT).map((n) => n.id).sort(), ["A.md", "B.md"]);
	assert.equal(source.parent("A.md"), VAULT_ROOT);
	assert.equal(source.parent(VAULT_ROOT), null);
});

test("the Map: parent() and children() agree, a tree beside the home page stays off the Map", () => {
	// B heads a tree of its own beside the home page H: it is no domain (places.domains), so the
	// Map lists A only, and every node it lists names as parent the node it is listed under.
	const w = world({ "H.md": { m: 1 }, "A.md": { up: "H.md", m: 2 }, "A1.md": { up: "A.md", m: 3 }, "A11.md": { up: "A1.md", m: 4 }, "B.md": { m: 5 }, "B1.md": { up: "B.md", m: 6 } }, "H.md");
	assert.deepEqual(w.domains(), ["A.md"]);
	const source = new HomeMapSource(w, () => w.domains().map((path) => ({ path, group: null })), "Vault");
	assert.deepEqual(source.children("H.md").map((n) => n.id), ["A.md"]);
	const walk = (id: string, depth: number) => {
		for (const child of source.children(id)) {
			assert.equal(source.parent(child.id), id, `${child.id} hangs from ${id}`);
			if (depth < 3) walk(child.id, depth + 1);
		}
	};
	walk(source.home(), 0);
	assert.equal(source.parent("B.md"), null, "off the Map: no parent");
	assert.equal(source.parent("B1.md"), "B.md");
	assert.deepEqual(autoChain(source, "H.md", "B1.md"), ["A.md", "A1.md"], "a note off the Map: the first branch with children");
	const bare = world({ "A.md": { m: 1 }, "A1.md": { up: "A.md", m: 2 }, "B.md": { m: 3 }, "B1.md": { up: "B.md", m: 4 } }, null);
	const vaultSource = new HomeMapSource(bare, () => bare.domains().map((path) => ({ path, group: null })), "Vault");
	for (const child of vaultSource.children(VAULT_ROOT)) assert.equal(vaultSource.parent(child.id), VAULT_ROOT);
});

test("the Map's first branch: toward the note just opened, else the first node with children", () => {
	const w = vault();
	const order = () => w.domains().sort().map((path) => ({ path, group: null }));
	const source = new HomeMapSource(w, order, "Vault");
	assert.deepEqual(autoChain(source, "Home.md", "Clients/Acme Budget.md"), ["Clients/Acme.md", "Clients/Acme Intake.md", "Clients/Acme Budget.md"]);
	assert.deepEqual(autoChain(source, "Home.md", "Clients/Review questions.md"), ["Clients/Acme.md", "Clients/Acme Intake.md", "Clients/2026-10-01 Acme Review.md", "Clients/Review questions.md"], "four levels toward a note");
	assert.deepEqual(autoChain(source, "Home.md", "Inbox.md"), ["Areas/Practice.md"], "elsewhere: the first node with children, down");
	assert.deepEqual(autoChain(source, "Clients/Acme Intake.md", null), ["Clients/2026-10-01 Acme Review.md"]);
	assert.deepEqual(mapStateAt(source, "Clients/Acme.md", "Clients/Acme Budget.md"), { root: "Clients/Acme.md", chain: ["Clients/Acme Intake.md", "Clients/Acme Budget.md"], focus: null });
	assert.ok(usableState(source, { root: "Home.md", chain: [], focus: null }));
	assert.ok(!usableState(source, { root: "Gone.md", chain: [], focus: null }));
	assert.ok(!usableState(source, null));
	source.invalidate();
	assert.equal(source.children("Home.md").length, 3);
});

test("keys on the Home itself: a typed character searches, shortcuts and modified keys do not", () => {
	const plain = { ctrl: false, meta: false, alt: false, composing: false };
	// A word typed after Esc in the empty field goes to the search, its first letter included
	// (T would open today's note and send the rest of the word into it).
	for (const key of ["t", "T", "h", "i", "Z", "é", "3", "#"]) assert.equal(typesInSearch(key, plain), true, key);
	// Keys that keep their meaning on the Home, and keys that are not a character.
	for (const key of ["/", "?", " ", "Enter", "Escape", "ArrowDown", "Tab", "Dead", "F2", "Shift"]) assert.equal(typesInSearch(key, plain), false, key);
	// Shortcuts with a modifier, and a character still being composed by an input method.
	assert.equal(typesInSearch("t", { ...plain, ctrl: true }), false);
	assert.equal(typesInSearch("t", { ...plain, meta: true }), false);
	assert.equal(typesInSearch("1", { ...plain, alt: true }), false);
	assert.equal(typesInSearch("a", { ...plain, composing: true }), false);
});

// ----- the Map: order of the notes, moves, new notes, first view -----

test("Map order: the order made per parent, notes never placed first", () => {
	assert.deepEqual(applyOrder(["a", "b", "c"], undefined), ["a", "b", "c"]);
	assert.deepEqual(applyOrder(["a", "b", "c"], ["c", "a", "b"]), ["c", "a", "b"]);
	// A new child (d) comes first; a child gone (x) is skipped; duplicates count once.
	assert.deepEqual(applyOrder(["d", "a", "b", "c"], ["c", "x", "a", "b", "c"]), ["d", "c", "a", "b"]);
	assert.deepEqual(moveBefore(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
	assert.deepEqual(moveBefore(["a", "b", "c"], "a", null), ["b", "c", "a"]);
	assert.deepEqual(moveBefore(["a", "b", "c"], "a", "c"), ["b", "a", "c"]);
	assert.deepEqual(moveBefore(["a", "b"], "z", "a"), ["a", "b"]);
	let order = withOrder([], "P.md", ["b", "a"]);
	order = withOrder(order, "Q.md", ["x"]);
	assert.deepEqual(orderOf(order, "P.md"), ["b", "a"]);
	assert.deepEqual(orderOf(withOrder(order, "P.md", ["a", "b"]), "P.md"), ["a", "b"]);
	assert.ok(orderMentions(order, "a") && orderMentions(order, "Q.md") && !orderMentions(order, "z"));
	assert.deepEqual(renameInOrder(order, "P.md", "R.md"), [["R.md", ["b", "a"]], ["Q.md", ["x"]]]);
	assert.deepEqual(renameInOrder(order, "a", "A"), [["P.md", ["b", "A"]], ["Q.md", ["x"]]]);
	assert.deepEqual(dropFromOrder(order, "x"), [["P.md", ["b", "a"]]]);
	assert.deepEqual(dropFromOrder(order, "P.md"), [["Q.md", ["x"]]]);
	assert.deepEqual(cleanOrder([["P.md", ["a", "a", 3]], ["P.md", ["b"]], "junk", ["E.md", []]]), [["P.md", ["a"]]]);
	assert.deepEqual(cleanOrder(null), []);
});

test("Map order: the Map's children follow the order made, the root keeps the domains' order", () => {
	const w = vault();
	const order = withOrder([], "Clients/Acme Intake.md", ["Clients/Acme Timeline.md", "Clients/Acme Budget.md"]);
	const source = new HomeMapSource(w, () => w.domains().sort().map((path) => ({ path, group: null })), "Vault", (parent) => orderOf(order, parent));
	// The dated review was never placed: it comes first, then the order made.
	assert.deepEqual(source.children("Clients/Acme Intake.md").map((n) => n.id), [
		"Clients/2026-10-01 Acme Review.md",
		"Clients/Acme Timeline.md",
		"Clients/Acme Budget.md",
	]);
	assert.deepEqual(source.children("Home.md").map((n) => n.id), ["Areas/Practice.md", "Clients/Acme.md", "Reading/Reading List.md"]);
});

test("Map moves: refused on itself, below itself, where it already is, or on the vault", () => {
	const w = vault();
	assert.equal(dropRefusal(w, "Clients/Acme Budget.md", "Areas/Practice.md"), null);
	assert.equal(dropRefusal(w, "Clients/Acme Intake.md", "Clients/Acme Intake.md"), "loop");
	assert.equal(dropRefusal(w, "Clients/Acme Intake.md", "Clients/Acme Budget.md"), "loop");
	assert.equal(dropRefusal(w, "Clients/Acme.md", "Clients/Review questions.md"), "loop");
	assert.equal(dropRefusal(w, "Clients/Acme Budget.md", "Clients/Acme Intake.md"), "same");
	assert.equal(dropRefusal(w, "Clients/Acme Budget.md", "/"), "root");
	assert.equal(dropRefusal(w, "Clients/Acme Budget.md", "Gone.md"), "gone");
	// A note without a parent can go under any note.
	assert.equal(dropRefusal(w, "Inbox.md", "Reading/Reading List.md"), null);
});

test("New note on the Map: a safe name, the first free path in the folder", () => {
	assert.equal(cleanNoteName("  Family / trips: 2026?  "), "Family trips 2026");
	assert.equal(cleanNoteName("[[Note]]#x"), "Note x");
	assert.equal(cleanNoteName("..hidden"), "hidden");
	assert.equal(cleanNoteName("   "), "");
	const taken = new Set(["perso/untitled.md", "perso/untitled 1.md"]);
	assert.equal(freeNotePath("Perso", "Untitled", (p) => taken.has(p.toLowerCase())), "Perso/Untitled 2.md");
	assert.equal(freeNotePath("", "Untitled", () => false), "Untitled.md");
	assert.equal(freeNotePath("/", "Untitled", () => false), "Untitled.md");
});

test("first view: the Map, unless the user picked another one", () => {
	assert.deepEqual(LENSES, ["map", "domains", "tags"]);
	assert.equal(startLens({ lens: "domains", lensChosen: false }), "map");
	assert.equal(startLens({ lens: "domains", lensChosen: true }), "domains");
	assert.equal(startLens({ lens: "tags", lensChosen: true }), "tags");
	assert.equal(startLens({ lens: "nonsense", lensChosen: true }), "map");
	// Saved before: "domains" was the default (maybe never picked), the others were picked.
	assert.equal(migrateSettings({ lens: "domains" }).lensChosen, false);
	assert.equal(migrateSettings({ lens: "tags" }).lensChosen, true);
	assert.equal(migrateSettings({ lens: "map" }).lensChosen, true);
	assert.equal(migrateSettings({}).lensChosen, false);
	assert.equal(migrateSettings({ lens: "domains", lensChosen: true }).lensChosen, true);
});

test("the zoom of the Map goes by steps and comes back to a step", () => {
	assert.equal(zoomLevel(undefined), 1);
	assert.equal(zoomLevel("big"), 1);
	assert.equal(zoomLevel(1.3), 1.25);
	assert.equal(nextZoom(1, 1), 1.1);
	assert.equal(nextZoom(1, -1), 0.9);
	assert.equal(nextZoom(1.6, 1), 1.6, "the nearest stays the nearest");
	assert.equal(nextZoom(0.6, -1), 0.6, "the farthest stays the farthest");
});
