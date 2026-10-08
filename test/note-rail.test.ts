// Pure logic of Note rail: contents, pins, tasks, daily notes and the calendar grid, settings helpers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TFile, type App, type HeadingCache } from "obsidian";
import { applyDailyTemplate, dailyPath, getDailyConfig, monthGrid, parseDailyPath, weekStartOf } from "../src/modules/note-rail/panels/calendar/daily";
import { checkTaskLine, locateTask, parseOpenTasks } from "../src/modules/note-rail/panels/tasks/parse";
import { buildToc, currentIndex, plainHeading } from "../src/modules/note-rail/panels/toc/headings";
import { hueOf, linkpathOf, parentLinkpath } from "../src/modules/note-rail/parents";
import { commandHotkeys, hotkeyText, pillAction } from "../src/modules/note-rail/rail/entry";
import { addNotePin, getNotePins, pinLinkpath, pinLinkpaths, pinsAdd, pinsRemove, pinsReorder, removeNotePin, reorderNotePins, type PinResolver } from "../src/modules/note-rail/pins";
import { cleanVaultPins, DEFAULT_SETTINGS, moveInOrder, pinsKey, railOrder, remapVaultPins } from "../src/modules/note-rail/settings";
import type { NoteRailSettings } from "../src/modules/note-rail/types";
import { editPinGroups, flattenPinGroups, readPinGroups, remapPinGroups } from "../src/modules/note-rail/vault-pins";
import { NoteRailController } from "../src/modules/note-rail/controller";
import type { NoteRailService } from "../src/core/services";

test("vault pin service: shared mutations, detached snapshots, events, unsubscribe and stopped service", async () => {
	const stored = structuredClone(DEFAULT_SETTINGS);
	stored.vaultPins = ["A.md", "B.md"];
	const files = new Map(["A.md", "B.md"].map((path) => [path, Object.assign(new TFile(), { path })]));
	let saves = 0;
	const ctx = {
		settings: stored,
		app: { vault: { getAbstractFileByPath: (path: string) => files.get(path) } },
		saveSettings: async () => { saves++; harness.pinsChanged(); },
	};
	const controller = new NoteRailController(ctx as unknown as ConstructorParameters<typeof NoteRailController>[0]);
	const harness = controller as unknown as { service(): NoteRailService; pinsChanged(): void; disposed: boolean };
	const service = harness.service();
	let changes = 0;
	const off = service.onPinsChange(() => changes++);
	const id = await service.createPinFolder("Reading");
	assert.ok(id);
	assert.equal(changes, 1);
	await service.movePin("B.md", 0, id);
	await service.renamePinFolder(id, "References");
	assert.equal(changes, 3);
	assert.deepEqual(service.listPins(), { loose: ["A.md"], folders: [{ id, name: "References", pins: ["B.md"] }] });
	service.listPins().folders[0].pins.length = 0;
	assert.deepEqual(service.vaultPins(), ["A.md", "B.md"]);
	await service.setPinned("B.md", false);
	assert.deepEqual(service.listPins().folders[0].pins, []);
	await service.setPinned("B.md", true);
	assert.deepEqual(service.listPins().loose, ["A.md", "B.md"]);
	await service.movePin("B.md", 0, id);
	await service.deletePinFolder(id);
	assert.deepEqual(service.listPins(), { loose: ["A.md", "B.md"], folders: [] });
	await service.setPinned("Deleted.md", true);
	assert.equal(service.isPinned("Deleted.md"), false);
	const heard = changes;
	off();
	await service.removePin("A.md");
	assert.equal(changes, heard);
	harness.disposed = true;
	const saved = saves;
	await service.removePin("B.md");
	assert.equal(await service.createPinFolder("Later"), null);
	assert.equal(saves, saved);
	assert.deepEqual(service.listPins(), { loose: [], folders: [] });
});

test("vault pin folders: legacy migration preserves loose order and sanitizes corrupt data", () => {
	assert.deepEqual(readPinGroups(["B.md", "A.md", "B.md", null, ""], undefined), { loose: ["B.md", "A.md"], folders: [] });
	const groups = readPinGroups(["A.md", "B.md", "C.md"], [
		null, { id: "", name: "Bad", pins: [] },
		{ id: "one", name: " Reading ", pins: ["B.md", "B.md", "Missing.md"] },
		{ id: "one", name: "Duplicate", pins: ["A.md"] },
		{ id: "two", name: "Projects", pins: ["B.md", "C.md"] },
	]);
	assert.deepEqual(groups, { loose: ["A.md"], folders: [
		{ id: "one", name: "Reading", pins: ["B.md"] }, { id: "two", name: "Projects", pins: ["C.md"] },
	] });
});

test("vault pin folders: moves use final indices and keep each pin in exactly one list", () => {
	const source = readPinGroups(["A.md", "B.md", "C.md"], [{ id: "one", name: "Reading", pins: ["C.md"] }]);
	const original = structuredClone(source);
	let next = editPinGroups(source, { kind: "move", path: "A.md", index: 1 });
	assert.deepEqual(next.loose, ["B.md", "A.md"]);
	next = editPinGroups(next, { kind: "move", path: "A.md", index: 0, folderId: "one" });
	assert.deepEqual(next.folders[0].pins, ["A.md", "C.md"]);
	next = editPinGroups(next, { kind: "move", path: "A.md", index: Infinity, folderId: "one" });
	assert.deepEqual(next.folders[0].pins, ["C.md", "A.md"]);
	next = editPinGroups(next, { kind: "move", path: "C.md", index: -20, folderId: null });
	assert.deepEqual(next.loose, ["C.md", "B.md"]);
	assert.deepEqual(editPinGroups(next, { kind: "move", path: "B.md", index: 0, folderId: "missing" }), next);
	assert.deepEqual(editPinGroups(next, { kind: "move", path: "missing.md", index: 0 }), next);
	assert.deepEqual(source, original);
	assert.equal(new Set(flattenPinGroups(next)).size, 3);
});

test("vault pin folders: rename, reorder, deletion keeps pins loose, empty names are ignored", () => {
	let next = readPinGroups(["A.md", "B.md", "C.md"], [{ id: "one", name: "Reading", pins: ["B.md", "C.md"] }]);
	next = editPinGroups(next, { kind: "create-folder", id: "two", name: " Projects " });
	next = editPinGroups(next, { kind: "move-folder", id: "two", index: 0 });
	assert.deepEqual(next.folders.map((f) => f.id), ["two", "one"]);
	next = editPinGroups(next, { kind: "rename-folder", id: "one", name: " References " });
	assert.equal(next.folders[1].name, "References");
	assert.deepEqual(editPinGroups(next, { kind: "rename-folder", id: "one", name: " " }), next);
	assert.deepEqual(editPinGroups(next, { kind: "create-folder", id: "three", name: " " }), next);
	next = editPinGroups(next, { kind: "delete-folder", id: "one" });
	assert.deepEqual(next.loose, ["A.md", "B.md", "C.md"]);
	assert.deepEqual(next.folders, [{ id: "two", name: "Projects", pins: [] }]);
	assert.deepEqual(editPinGroups(next, { kind: "delete-folder", id: "missing" }), next);
});

test("vault pin folders: removal and old flat writers cannot resurrect grouped pins", () => {
	const source = readPinGroups(["A.md", "B.md"], [{ id: "one", name: "Reading", pins: ["B.md"] }]);
	const next = editPinGroups(source, { kind: "remove", path: "B.md" });
	assert.deepEqual(flattenPinGroups(next), ["A.md"]);
	assert.deepEqual(next.folders[0].pins, []);
	assert.deepEqual(readPinGroups(["A.md"], source.folders).folders[0].pins, []);
	const snapshot = readPinGroups(flattenPinGroups(source), source.folders);
	snapshot.folders[0].pins.push("C.md");
	assert.deepEqual(source.folders[0].pins, ["B.md"]);
});

test("vault pin folders: file and directory renames and deletes preserve groups and sibling prefixes", () => {
	const source = readPinGroups(["Notes/A.md", "Notes/B.md", "Notes-other/C.md"], [
		{ id: "one", name: "Reading", pins: ["Notes/B.md", "Notes-other/C.md"] },
	]);
	let next = remapPinGroups(source, "Notes", "Archive", false);
	assert.deepEqual(next.loose, ["Archive/A.md"]);
	assert.deepEqual(next.folders[0].pins, ["Archive/B.md", "Notes-other/C.md"]);
	next = remapPinGroups(next, "Archive/B.md", "Archive/D.md", true);
	assert.deepEqual(next.folders[0].pins, ["Archive/D.md", "Notes-other/C.md"]);
	next = remapPinGroups(next, "Archive", null, false);
	assert.deepEqual(flattenPinGroups(next), ["Notes-other/C.md"]);
	next = remapPinGroups(next, "Notes-other/C.md", null, true);
	assert.deepEqual(next, { loose: [], folders: [{ id: "one", name: "Reading", pins: [] }] });
	assert.deepEqual(source.loose, ["Notes/A.md"]);
});

const settings = (over: Partial<NoteRailSettings> = {}): NoteRailSettings => ({ ...structuredClone(DEFAULT_SETTINGS), ...over });

// ---- Contents ------------------------------------------------------------------------

const heading = (level: number, text: string, line: number): HeadingCache =>
	({ level, heading: text, position: { start: { line, col: 0, offset: 0 }, end: { line, col: 0, offset: 0 } } }) as HeadingCache;

test("contents: levels filtered, depth relative to the shallowest heading kept", () => {
	const headings = [heading(2, "Overview", 3), heading(3, "Goals", 8), heading(4, "Detail", 12), heading(2, "Next steps", 20)];
	assert.deepEqual(buildToc(headings, 6).map((e) => [e.line, e.level, e.depth, e.text]), [
		[3, 2, 0, "Overview"], [8, 3, 1, "Goals"], [12, 4, 2, "Detail"], [20, 2, 0, "Next steps"],
	]);
	assert.deepEqual(buildToc(headings, 3).map((e) => e.text), ["Overview", "Goals", "Next steps"]);
	assert.deepEqual(buildToc(headings, 1), []);
	assert.deepEqual(buildToc(undefined, 6), []);
	assert.equal(buildToc([heading(1, "<span></span>", 0)], 6, "(sans titre)")[0].text, "(sans titre)");
});

test("contents: inline Markdown is stripped from headings, tags kept", () => {
	assert.equal(plainHeading("Read [[Reading list|the list]] and [[Project X#Plan]]"), "Read the list and Project X > Plan");
	assert.equal(plainHeading("**Bold**, *italic*, `code`, ==mark== and [site](https://example.com)"), "Bold, italic, code, mark and site");
	assert.equal(plainHeading("Plan #project/website"), "Plan #project/website");
	assert.equal(plainHeading("snake_case_name stays"), "snake_case_name stays");
});

test("contents: current section is the last heading above the reading line, last one at the bottom", () => {
	const tops = [0, 400, 900, 1300];
	assert.equal(currentIndex(tops, 0, 500, 1000, 90), 0);
	assert.equal(currentIndex(tops, 350, 500, 1000, 90), 1);
	assert.equal(currentIndex([200, 400], 0, 500, 1000, 90), -1);
	// At the very bottom, a short last section on screen wins.
	assert.equal(currentIndex(tops, 1000, 500, 1000, 90), 3);
	assert.equal(currentIndex([0, null, 900], 950, 500, 2000, 90), 2);
});

// ---- Pins ------------------------------------------------------------------------------

test("pins: link paths of frontmatter values", () => {
	assert.equal(pinLinkpath("[[Project X]]"), "Project X");
	assert.equal(pinLinkpath("[[Project X|alias]]"), "Project X");
	assert.equal(pinLinkpath("[[Meeting notes#Agenda]]"), "Meeting notes");
	assert.equal(pinLinkpath("  Reading list "), "Reading list");
	assert.equal(pinLinkpath("[[broken"), null);
	assert.equal(pinLinkpath(42), null);
	assert.equal(pinLinkpath("[[]]"), null);
	assert.deepEqual(pinLinkpaths("[[A]]"), ["A"]);
	assert.deepEqual(pinLinkpaths(["[[A]]", null, 7, "[[B|b]]", "C"]), ["A", "B", "C"]);
	assert.deepEqual(pinLinkpaths(undefined), []);
});

const resolve: PinResolver = (entry) => {
	const linkpath = pinLinkpath(entry);
	return linkpath && ["A", "B", "C", "D"].includes(linkpath) ? `${linkpath}.md` : null;
};

test("pins: edits keep entries they do not touch, unresolved ones included", () => {
	assert.deepEqual(pinsAdd(["[[A]]"], resolve, "[[B]]", "B.md"), ["[[A]]", "[[B]]"]);
	const same = ["[[A|alias]]"];
	assert.equal(pinsAdd(same, resolve, "[[A]]", "A.md"), same);
	assert.deepEqual(pinsAdd(["[[Missing]]"], resolve, "[[A]]", "A.md"), ["[[Missing]]", "[[A]]"]);
	assert.deepEqual(pinsRemove(["[[A]]", "[[B]]", "[[A|x]]", "[[Missing]]"], resolve, "A.md"), ["[[B]]", "[[Missing]]"]);
	assert.deepEqual(pinsReorder(["[[Missing]]", "[[A]]", "[[B]]", "[[C]]"], resolve, ["C.md", "A.md", "B.md"]), ["[[C]]", "[[A]]", "[[B]]", "[[Missing]]"]);
	assert.deepEqual(pinsReorder(["[[A]]", "[[D]]", "[[B]]"], resolve, ["B.md", "A.md"]), ["[[B]]", "[[A]]", "[[D]]"]);
	assert.deepEqual(pinsReorder(["[[A]]", "[[B]]"], resolve, ["Gone.md", "B.md"]), ["[[B]]", "[[A]]"]);
});

/** A tiny vault: notes by path, frontmatter objects, links resolved by base name. */
function fakeVault(frontmatter: Record<string, unknown>) {
	const files = new Map<string, TFile>();
	const add = (path: string) => {
		const file = Object.assign(new TFile(), { path, basename: path.replace(/\.md$/, ""), extension: "md" });
		files.set(path, file);
		return file;
	};
	["Project X.md", "Meeting notes.md", "Reading list.md", "Ideas.md"].forEach(add);
	const writes: unknown[] = [];
	const app = {
		metadataCache: {
			getFileCache: () => ({ frontmatter }),
			getFirstLinkpathDest: (linkpath: string) => files.get(`${linkpath}.md`) ?? null,
			fileToLinktext: (file: TFile) => file.basename,
		},
		fileManager: {
			processFrontMatter: async (_file: TFile, edit: (fm: Record<string, unknown>) => void) => {
				edit(frontmatter);
				writes.push(structuredClone(frontmatter));
			},
		},
	} as unknown as App;
	return { app, file: (path: string) => files.get(path)!, writes };
}

test("pins: reading resolves, drops self, duplicates and unknown notes, in order", () => {
	const { app, file } = fakeVault({ pins: ["[[Reading list]]", "[[Project X]]", "[[Nope]]", "[[Reading list|again]]", "[[Meeting notes]]"] });
	assert.deepEqual(getNotePins(app, file("Project X.md"), settings()).map((f) => f.path), ["Reading list.md", "Meeting notes.md"]);
	const { app: other, file: f2 } = fakeVault({ links: ["[[Ideas]]"] });
	assert.deepEqual(getNotePins(other, f2("Project X.md"), settings({ pinsKey: " links " })).map((f) => f.path), ["Ideas.md"]);
});

test("pins: writing goes through processFrontMatter, one queued edit at a time", async () => {
	const fm: Record<string, unknown> = { status: "draft", pins: ["[[Unknown]]"] };
	const { app, file } = fakeVault(fm);
	const note = file("Project X.md");
	const s = settings();
	await Promise.all([addNotePin(app, note, file("Reading list.md"), s), addNotePin(app, note, file("Ideas.md"), s)]);
	assert.deepEqual(fm.pins, ["[[Unknown]]", "[[Reading list]]", "[[Ideas]]"]);
	await addNotePin(app, note, note, s);
	assert.deepEqual(fm.pins, ["[[Unknown]]", "[[Reading list]]", "[[Ideas]]"], "a note is never pinned to itself");
	await reorderNotePins(app, note, ["Ideas.md", "Reading list.md"], s);
	assert.deepEqual(fm.pins, ["[[Ideas]]", "[[Reading list]]", "[[Unknown]]"]);
	await removeNotePin(app, note, file("Ideas.md"), s);
	await removeNotePin(app, note, file("Reading list.md"), s);
	assert.deepEqual(fm.pins, ["[[Unknown]]"], "unresolved entries are never removed");
	assert.equal(fm.status, "draft");
	fm.pins = ["[[Ideas]]"];
	await removeNotePin(app, note, file("Ideas.md"), s);
	assert.ok(!("pins" in fm), "the property goes away with its last entry");
});

// ---- Tasks -------------------------------------------------------------------------------

test("tasks: open tasks only, with list markers, quotes and callouts", () => {
	for (const marker of ["-", "*", "+", "1.", "2)"]) assert.equal(parseOpenTasks([`${marker} [ ] Call the printer`]).length, 1, marker);
	for (const status of ["x", "X", "-", "/", ">"]) assert.equal(parseOpenTasks([`- [${status}] Done`]).length, 0, status);
	assert.equal(parseOpenTasks(["[ ] not a list item"]).length, 0);
	assert.deepEqual(parseOpenTasks(["> - [ ] Quoted", "> [!todo]", "> - [ ] In a callout"]).map((t) => t.text), ["Quoted", "In a callout"]);
	assert.equal(parseOpenTasks(["- [ ]"])[0].text, "");
});

test("tasks: frontmatter and code blocks are skipped, line numbers kept", () => {
	assert.deepEqual(parseOpenTasks(["---", "- [ ] Hidden", "---", "- [ ] Visible"]).map((t) => t.line), [3]);
	assert.deepEqual(parseOpenTasks(["---", "- [ ] Hidden"]), []);
	assert.deepEqual(parseOpenTasks(["```", "~~~", "``` text", "- [ ] Hidden", "````", "- [ ] Visible"]).map((t) => t.text), ["Visible"]);
	assert.deepEqual(parseOpenTasks(["> ~~~", "> - [ ] Hidden", "> ~~~", "> - [ ] Visible"]).map((t) => t.text), ["Visible"]);
});

test("tasks: nesting, display text, due date and tags", () => {
	assert.deepEqual(parseOpenTasks(["- Plan", "    - [ ] Child", "        - [x] Done", "            - [ ] Grandchild", "- [ ] Peer"]).map((t) => t.indent), [1, 3, 0]);
	assert.deepEqual(parseOpenTasks(["- [ ] First", "Text", "    - [ ] Second"]).map((t) => t.indent), [0, 0]);
	const [task] = parseOpenTasks(["- [ ] Send **draft** of [[Project X|the plan]] #project/website 📅 2026-10-12 #project/website"]);
	assert.equal(task.display, "Send draft of the plan #project/website 📅 2026-10-12 #project/website");
	assert.equal(task.due, "2026-10-12");
	assert.deepEqual(task.tags, ["#project/website"]);
});

test("tasks: checking changes only the box, finding the task again never guesses", () => {
	assert.equal(checkTaskLine("\t> 1) [ ] Text [ ] later  "), "\t> 1) [x] Text [ ] later  ");
	assert.equal(checkTaskLine("- [x] Done"), null);
	const task = { line: 1, raw: "- [ ] Same" };
	assert.equal(locateTask(["a", task.raw], task), 1);
	assert.equal(locateTask(["a", "b", task.raw], task), 2);
	assert.equal(locateTask([task.raw, "b", task.raw], task), -1);
	assert.equal(locateTask(["a", "b"], task), -1);
});

// ---- Daily notes and calendar ------------------------------------------------------------------

const cfg = { folder: "Journal", format: "YYYY-MM-DD", template: "" };

test("daily notes: path from a day and back, strict parse", () => {
	assert.equal(dailyPath("2026-10-02", cfg), "Journal/2026-10-02.md");
	assert.equal(dailyPath("2026-10-02", { ...cfg, folder: "", format: "YYYY/MM/DD-ddd" }), "2026/10/02-Fri.md");
	assert.equal(parseDailyPath("Journal/2026-10-02.md", cfg), "2026-10-02");
	assert.equal(parseDailyPath("2026/10/02-Fri.md", { ...cfg, folder: "", format: "YYYY/MM/DD-ddd" }), "2026-10-02");
	for (const path of ["Journal/2026-10-02 notes.md", "Other/2026-10-02.md", "Journal/2026-13-02.md", "Journal/2026-10-02.txt", "Journal/2026-1-2.md"]) {
		assert.equal(parseDailyPath(path, cfg), null, path);
	}
});

test("daily notes: settings override the core plugin, which overrides the defaults", () => {
	const empty = { calendarFolder: "", calendarFormat: "", calendarTemplate: "" };
	assert.deepEqual(getDailyConfig({} as App, empty), { folder: "", format: "YYYY-MM-DD", template: "" });
	const core = { internalPlugins: { getPluginById: () => ({ instance: { options: { folder: "/Journal/", format: "YYYY/MM/DD", template: "Templates/Day" } } }) } } as unknown as App;
	assert.deepEqual(getDailyConfig(core, empty), { folder: "Journal", format: "YYYY/MM/DD", template: "Templates/Day" });
	assert.deepEqual(getDailyConfig(core, { calendarFolder: "Days", calendarFormat: "", calendarTemplate: "Templates/Other" }), { folder: "Days", format: "YYYY/MM/DD", template: "Templates/Other" });
	const broken = { internalPlugins: { getPluginById: () => ({ instance: { options: { folder: 3, format: false } } }) } } as unknown as App;
	assert.deepEqual(getDailyConfig(broken, empty), { folder: "", format: "YYYY-MM-DD", template: "" });
	const throwing = { get internalPlugins(): never { throw new Error("no access"); } } as unknown as App;
	assert.deepEqual(getDailyConfig(throwing, empty), { folder: "", format: "YYYY-MM-DD", template: "" });
});

test("calendar: always 6 weeks starting on the chosen day", () => {
	const monday = monthGrid(2026, 9, 1, "2026-10-02");
	assert.equal(monday.length, 42);
	assert.equal(monday[0].key, "2026-09-28");
	assert.equal(monday[41].key, "2026-11-08");
	assert.equal(monday.filter((d) => d.inMonth).length, 31);
	assert.deepEqual(monday.filter((d) => d.isToday).map((d) => d.key), ["2026-10-02"]);
	const sunday = monthGrid(2026, 9, 0, "");
	assert.equal(sunday[0].key, "2026-09-27");
	assert.equal(sunday[0].weekday, 0);
	// A month that starts on the first day of the week has no leading days.
	assert.equal(monthGrid(2026, 10, 0, "")[0].key, "2026-11-01");
	const february = monthGrid(2027, 1, 1, "");
	assert.equal(february[0].key, "2027-02-01");
	assert.equal(february.length, 42);
});

test("calendar: ISO week numbers across the year boundary", () => {
	const january = monthGrid(2027, 0, 1, "");
	assert.equal(january.find((d) => d.key === "2027-01-01")?.isoWeek, 53);
	assert.equal(january.find((d) => d.key === "2027-01-04")?.isoWeek, 1);
	assert.equal(monthGrid(2026, 0, 1, "").find((d) => d.key === "2026-01-01")?.isoWeek, 1);
});

test("calendar: first day of the week from the setting or the language", () => {
	assert.equal(weekStartOf("monday", "en"), 1);
	assert.equal(weekStartOf("sunday", "fr"), 0);
	assert.equal(weekStartOf("anything", "en"), 1);
	assert.equal(weekStartOf("language", "en"), 0);
});

test("daily notes: template tokens use the day of the note and the given clock", () => {
	const now = new Date(2026, 9, 2, 9, 5);
	const text = "# {{title}}\n{{date}} · {{date:dddd D MMMM YYYY}} · {{ time }} · {{time:HH}}h · {{title:x}} · {{other}}";
	assert.equal(applyDailyTemplate(text, "2026-10-05", "2026-10-05", now), "# 2026-10-05\n2026-10-05 · Monday 5 October 2026 · 09:05 · 09h · {{title:x}} · {{other}}");
});

// ---- Settings helpers ---------------------------------------------------------------------------

test("settings: rail order is sanitized and moved one step at a time", () => {
	assert.deepEqual(railOrder(["calendar", "trail", "toc", "calendar", 4]), ["calendar", "toc", "bookmarks", "tasks"]);
	assert.deepEqual(railOrder(undefined), ["toc", "bookmarks", "tasks", "calendar"]);
	assert.deepEqual(moveInOrder(["toc", "bookmarks", "tasks", "calendar"], "tasks", -1), ["toc", "tasks", "bookmarks", "calendar"]);
	assert.deepEqual(moveInOrder(["toc", "bookmarks", "tasks", "calendar"], "toc", -1), ["toc", "bookmarks", "tasks", "calendar"]);
	assert.deepEqual(moveInOrder(["toc", "bookmarks", "tasks", "calendar"], "calendar", 1), ["toc", "bookmarks", "tasks", "calendar"]);
});

test("settings: vault pins follow renames and deletes of notes and folders", () => {
	const pins = ["Projects/Project X.md", "Reading list.md", "Projects/Sub/Ideas.md"];
	assert.deepEqual(remapVaultPins(pins, "Reading list.md", "Books/Reading list.md", true), ["Projects/Project X.md", "Books/Reading list.md", "Projects/Sub/Ideas.md"]);
	assert.deepEqual(remapVaultPins(pins, "Projects", "Work", false), ["Work/Project X.md", "Reading list.md", "Work/Sub/Ideas.md"]);
	assert.deepEqual(remapVaultPins(pins, "Reading list.md", null, true), ["Projects/Project X.md", "Projects/Sub/Ideas.md"]);
	assert.deepEqual(remapVaultPins(pins, "Projects", null, false), ["Reading list.md"]);
	assert.equal(remapVaultPins(pins, "Other.md", "Else.md", true), null);
	assert.equal(remapVaultPins(pins, "Project", "P", false), null, "a folder prefix must be a whole folder");
	assert.deepEqual(cleanVaultPins(["a.md", "", "a.md", 3, " ", "b.md"]), ["a.md", "b.md"]);
	assert.deepEqual(cleanVaultPins("a.md"), []);
	assert.equal(pinsKey(settings({ pinsKey: "  " })), "pins");
	assert.equal(pinsKey(settings({ pinsKey: " related " })), "related");
});

// ----- where a note belongs -----

test("parent: a parent property wins, else the first link at the top of the note", () => {
	const link = (text: string, line: number, offset: number) => ({ link: text, original: `[[${text}]]`, position: { start: { line, col: 0, offset }, end: { line, col: 0, offset: offset + 4 } } });
	assert.equal(linkpathOf("[[Work|my work]]"), "Work");
	assert.equal(linkpathOf(["[[Areas/Work#Goals]]", "[[Other]]"]), "Areas/Work");
	assert.equal(linkpathOf("Work"), "Work");
	assert.equal(linkpathOf(42), null);
	// Property first, whatever its case.
	assert.equal(parentLinkpath({ frontmatter: { Up: "[[Home]]" }, links: [link("Work", 1, 1)] } as never), "Home");
	// Else the first link, by position, when it sits in the first lines.
	assert.equal(parentLinkpath({ links: [link("Later", 2, 30), link("Work", 1, 1)] } as never), "Work");
	assert.equal(parentLinkpath({ links: [link("Work#Goals", 0, 0)] } as never), "Work");
	// A link far down the note is not a parent; lines are counted after the properties.
	assert.equal(parentLinkpath({ links: [link("Deep", 5, 80)] } as never), null);
	assert.equal(parentLinkpath({ frontmatterPosition: { end: { line: 4 } }, frontmatter: {}, links: [link("Work", 6, 60)] } as never), "Work");
	assert.equal(parentLinkpath(null), null);
	assert.equal(hueOf("Work.md"), hueOf("Work.md"));
	assert.ok(hueOf("Work.md") >= 0 && hueOf("Work.md") < 360);
});

// ---- Open on hover, vault summary, idea sessions ------------------------------------

import { headingToPanel, inTriangle } from "../src/modules/note-rail/rail/hover";
import { countDue, dueBadge, summaryParts } from "../src/modules/note-rail/panels/tasks/summary";
import { sessionsToSort, toSortCount } from "../src/modules/note-rail/panels/session/list";
import type { SessionEntry } from "../src/modules/note-rail/types";

test("hover: triangle test, edges included", () => {
	const a = { x: 0, y: 0 }, b = { x: 10, y: 0 }, c = { x: 0, y: 10 };
	assert.equal(inTriangle({ x: 2, y: 2 }, a, b, c), true);
	assert.equal(inTriangle({ x: 5, y: 5 }, a, b, c), true);
	assert.equal(inTriangle({ x: 8, y: 8 }, a, b, c), false);
	assert.equal(inTriangle({ x: -1, y: 1 }, a, b, c), false);
});

test("hover: the corridor toward a panel on the right of a left rail", () => {
	const panel = { left: 100, top: 80, right: 380, bottom: 360 };
	// Diagonal toward the panel, crossing the button below: still heading there.
	assert.equal(headingToPanel({ x: 73, y: 240 }, { x: 86, y: 272 }, panel, "left"), true);
	// Straight down: not toward the panel.
	assert.equal(headingToPanel({ x: 73, y: 240 }, { x: 73, y: 272 }, panel, "left"), false);
	// Moving away from the panel.
	assert.equal(headingToPanel({ x: 80, y: 240 }, { x: 70, y: 250 }, panel, "left"), false);
	// Toward a point below the panel: outside the triangle.
	assert.equal(headingToPanel({ x: 73, y: 200 }, { x: 90, y: 400 }, { left: 100, top: 88, right: 380, bottom: 187 }, "left"), false);
	// Already past the near edge: not "on the way" any more.
	assert.equal(headingToPanel({ x: 95, y: 240 }, { x: 105, y: 245 }, panel, "left"), false);
});

test("hover: the corridor mirrors for a rail on the right", () => {
	const panel = { left: 1100, top: 80, right: 1430, bottom: 360 };
	assert.equal(headingToPanel({ x: 1471, y: 240 }, { x: 1458, y: 272 }, panel, "right"), true);
	assert.equal(headingToPanel({ x: 1471, y: 240 }, { x: 1484, y: 272 }, panel, "right"), false);
	assert.equal(headingToPanel({ x: 1471, y: 240 }, { x: 1471, y: 272 }, panel, "right"), false);
});

test("vault summary: overdue and today, done and undated tasks left out", () => {
	const tasks = [
		{ due: "2026-10-01", done: false },
		{ due: "2026-09-30", done: false },
		{ due: "2026-10-05", done: false },
		{ due: "2026-10-05", done: true },
		{ due: "2026-10-06", done: false },
		{ due: null, done: false },
		{ due: "soon", done: false },
	];
	assert.deepEqual(countDue(tasks, "2026-10-05"), { overdue: 2, today: 1 });
	assert.deepEqual(countDue([], "2026-10-05"), { overdue: 0, today: 0 });
	assert.deepEqual(summaryParts({ overdue: 2, today: 1 }), [{ kind: "overdue", count: 2 }, { kind: "today", count: 1 }]);
	assert.deepEqual(summaryParts({ overdue: 0, today: 3 }), [{ kind: "today", count: 3 }]);
	assert.deepEqual(summaryParts({ overdue: 0, today: 0 }), []);
	// Today only by default; overdue too (in orange) with "Include overdue in the badge".
	assert.deepEqual(dueBadge({ overdue: 2, today: 1 }), { count: 1, warn: false });
	assert.deepEqual(dueBadge({ overdue: 2, today: 0 }), { count: null, warn: false });
	assert.deepEqual(dueBadge({ overdue: 2, today: 1 }, true), { count: 3, warn: true });
	assert.deepEqual(dueBadge({ overdue: 0, today: 1 }), { count: 1, warn: false });
	assert.deepEqual(dueBadge({ overdue: 0, today: 0 }), { count: null, warn: false });
});

test("sessions panel: the sessions to sort, newest first, five at most", () => {
	const s = (path: string, created: number, state: SessionEntry["state"]): SessionEntry => ({ path, title: path.replace(/\.md$/, ""), created, state, tasks: 1, undecided: 0 });
	const list = [
		s("A.md", 1, "to-sort"), s("B.md", 7, "to-sort"), s("C.md", 3, "open"), s("D.md", 5, "to-sort"),
		s("E.md", 4, "closed"), s("F.md", 2, "to-sort"), s("G.md", 6, "to-sort"), s("H.md", 8, "to-sort"),
	];
	assert.deepEqual(sessionsToSort(list).map((x) => x.title), ["H", "B", "G", "D", "F"]);
	assert.deepEqual(sessionsToSort(list, 2).map((x) => x.title), ["H", "B"]);
	assert.equal(toSortCount(list), 6);
	assert.deepEqual(sessionsToSort(undefined), []);
	assert.equal(toSortCount(null), 0);
});

test("rail search: the tooltip shows the command's hotkey the platform's way", () => {
	assert.equal(hotkeyText([{ modifiers: ["Mod"], key: "o" }], false), "Ctrl+O");
	assert.equal(hotkeyText([{ modifiers: ["Mod"], key: "o" }], true), "⌘O");
	assert.equal(hotkeyText([{ modifiers: ["Shift", "Mod"], key: "F" }], false), "Ctrl+Shift+F");
	assert.equal(hotkeyText([{ modifiers: ["Shift", "Alt"], key: "ArrowUp" }], true), "⌥⇧ArrowUp");
	assert.equal(hotkeyText([], false), "");
	assert.equal(hotkeyText(undefined, false), "");
	// The user's own hotkeys win, an empty list included (hotkey removed); else the defaults.
	const defaults = [{ modifiers: ["Mod"], key: "o" }];
	assert.deepEqual(commandHotkeys(undefined, defaults), defaults);
	assert.deepEqual(commandHotkeys([], defaults), []);
	assert.deepEqual(commandHotkeys([{ modifiers: ["Alt"], key: "s" }], defaults), [{ modifiers: ["Alt"], key: "s" }]);
	assert.deepEqual(commandHotkeys(undefined, undefined), []);
});

test("rail pill: the page of the area with Home, the old way without it or with Ctrl or Cmd", () => {
	const base = { home: true, mobile: false, isArea: false, mod: false };
	assert.equal(pillAction(base), "place");
	assert.equal(pillAction({ ...base, mobile: true }), "place");
	assert.equal(pillAction({ ...base, isArea: true }), "place");
	assert.equal(pillAction({ ...base, mod: true }), "note");
	assert.equal(pillAction({ ...base, mod: true, isArea: true }), "menu");
	assert.equal(pillAction({ ...base, home: false }), "note");
	assert.equal(pillAction({ ...base, home: false, mobile: true }), "menu");
	assert.equal(pillAction({ ...base, home: false, isArea: true }), "menu");
});
