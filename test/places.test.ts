// Where notes belong (src/core/places): the rule moved from the note rail (unchanged with the
// default options), the Home module's options (home page, ignored folders), and the index of
// parents behind children and domains, kept up to date as notes change.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TFile, type App } from "obsidian";
import { createPlaces, ParentIndex } from "../src/core/places";
import { areaOf, chainOf, cleanFolders, inFolders, parentOf, PlaceFinder } from "../src/core/places/rule";
import { placeFinder as railFinder } from "../src/modules/note-rail/parents";

(globalThis as { window?: unknown }).window ??= globalThis;
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A note: its "up" property, or its first link (on `line`, 0 = first line after the properties). */
interface Spec {
	up?: string;
	link?: string;
	line?: number;
}

function fakeApp(notes: Record<string, Spec>) {
	const files = new Map<string, TFile>();
	const make = (path: string) => Object.assign(new TFile(), { path, extension: "md", basename: path.replace(/^.*\//, "").replace(/\.md$/, "") });
	for (const path of Object.keys(notes)) files.set(path, make(path));
	const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
	const events = {
		on: (name: string, cb: (...args: unknown[]) => void) => {
			if (!handlers.has(name)) handlers.set(name, new Set());
			handlers.get(name)!.add(cb);
			return { name, cb };
		},
		offref: (ref: { name: string; cb: (...args: unknown[]) => void }) => handlers.get(ref.name)?.delete(ref.cb),
	};
	const emit = (name: string, ...args: unknown[]) => handlers.get(name)?.forEach((cb) => cb(...args));
	const app = {
		vault: {
			...events,
			getMarkdownFiles: () => [...files.values()],
			getAbstractFileByPath: (path: string) => files.get(path) ?? null,
			getFileByPath: (path: string) => files.get(path) ?? null,
		},
		metadataCache: {
			...events,
			getFileCache: (file: TFile) => {
				const spec = notes[file.path];
				if (!spec) return null;
				return {
					frontmatter: spec.up ? { up: `[[${spec.up}]]` } : undefined,
					links: spec.link ? [{ link: spec.link, original: `[[${spec.link}]]`, position: { start: { line: spec.line ?? 0, col: 0, offset: 1 }, end: { line: spec.line ?? 0, col: 0, offset: 5 } } }] : [],
				};
			},
			getFirstLinkpathDest: (linkpath: string) => [...files.values()].find((f) => f.basename === linkpath || f.path === linkpath) ?? null,
		},
	};
	return {
		app: app as unknown as App,
		notes,
		files,
		/** Adds, changes or removes a note and tells the listeners as Obsidian would. */
		set(path: string, spec: Spec | null) {
			if (spec === null) {
				const file = files.get(path)!;
				delete notes[path];
				files.delete(path);
				emit("delete", file);
				return;
			}
			const created = !files.has(path);
			notes[path] = spec;
			if (created) files.set(path, make(path));
			emit(created ? "create" : "changed", files.get(path));
			if (created) emit("changed", files.get(path));
		},
		rename(from: string, to: string) {
			notes[to] = notes[from];
			delete notes[from];
			const file = files.get(from)!;
			files.delete(from);
			Object.assign(file, { path: to, basename: to.replace(/\.md$/, "") });
			files.set(to, file);
			emit("rename", file, from);
		},
	};
}

/** A small vault: a home page holding two domains, one with a sub-MOC, and loose notes. */
const VAULT: Record<string, Spec> = {
	"Home.md": {},
	"Work.md": { up: "Home" },
	"Life.md": { link: "Home" },
	"Project X.md": { link: "Work" },
	"Project X - notes.md": { up: "Project X" },
	"Meeting notes.md": { link: "Work", line: 2 },
	"Far link.md": { link: "Work", line: 3 },
	"Garden.md": { link: "Life" },
	"Loose.md": {},
	"Archive/Old plan.md": { link: "Work" },
};

test("the rule is the note rail's: the rail's finder is the core's", () => {
	const { app } = fakeApp({ ...VAULT });
	assert.equal(railFinder(app), railFinder(app));
	assert.ok(railFinder(app) instanceof PlaceFinder);
});

test("parents, chains and areas with the default options (as the rail always did)", () => {
	const { app, files } = fakeApp({ ...VAULT });
	const finder = new PlaceFinder(app);
	const f = (path: string) => files.get(path)!;
	assert.equal(parentOf(app, f("Project X.md"))?.path, "Work.md");
	assert.equal(parentOf(app, f("Meeting notes.md"))?.path, "Work.md", "a first link within the first three lines");
	assert.equal(parentOf(app, f("Far link.md")), null, "a first link further down is no parent");
	assert.deepEqual(chainOf(app, f("Project X - notes.md")).map((x) => x.path), ["Project X.md", "Work.md", "Home.md"]);
	assert.equal(finder.homePath(), "Home.md", "the top note holding most of the vault");
	assert.equal(finder.placeOf(f("Project X - notes.md")).area?.path, "Work.md");
	assert.equal(finder.placeOf(f("Work.md")).area?.path, "Work.md", "an area note is its own area");
	assert.equal(finder.placeOf(f("Loose.md")).area, null);
	assert.equal(finder.placeOf(f("Archive/Old plan.md")).area?.path, "Work.md");
});

test("options: a chosen home page and ignored folders change the rule only when set", () => {
	const { app, files } = fakeApp({ ...VAULT });
	const finder = new PlaceFinder(app);
	const f = (path: string) => files.get(path)!;
	finder.configure({ ignoredFolders: ["/Archive/ ", "Archive", ""] });
	assert.deepEqual(finder.options.ignoredFolders, ["Archive"]);
	assert.equal(finder.isIgnored("Archive/Old plan.md"), true);
	assert.equal(finder.isIgnored("Archived.md"), false);
	assert.equal(finder.placeOf(f("Archive/Old plan.md")).area, null, "a note in an ignored folder has no parent");
	finder.configure({ home: "Work.md" });
	assert.equal(finder.homePath(), "Work.md");
	assert.equal(finder.placeOf(f("Project X - notes.md")).area?.path, "Project X.md", "below a chosen home page, the level under it");
	assert.equal(finder.placeOf(f("Garden.md")).area?.path, "Home.md", "outside it, the top note");
	finder.configure({ home: "Missing.md" });
	assert.equal(finder.homePath(), "Home.md", "a chosen page that does not exist: the detected one");
	finder.configure({ home: "", ignoredFolders: [] });
	assert.equal(finder.placeOf(f("Archive/Old plan.md")).area?.path, "Work.md", "back to the defaults");
	assert.deepEqual(cleanFolders(["a\\b/", "a/b", " "]), ["a/b"]);
	assert.equal(inFolders("a/b/c.md", ["a/b"]), true);
	assert.equal(inFolders("a/bc.md", ["a/b"]), false);
});

test("areaOf: detected home pages are top notes, chosen ones may sit anywhere", () => {
	const n = (path: string) => ({ path });
	const chain = [n("B"), n("A"), n("Top")];
	assert.equal(areaOf(n("C"), chain, null, false)?.path, "Top");
	assert.equal(areaOf(n("C"), chain, "Top", false)?.path, "A");
	assert.equal(areaOf(n("C"), chain, "A", false)?.path, "Top", "a detected home page counts only at the top");
	assert.equal(areaOf(n("C"), chain, "A", true)?.path, "B");
	assert.equal(areaOf(n("C"), chain, "B", true)?.path, "C");
	assert.equal(areaOf(n("C"), [], "Top", false), null);
});

test("the index of parents: children both ways, chains and domains", () => {
	const index = new ParentIndex();
	index.set("Home", null);
	index.set("Work", "Home");
	index.set("Life", "Home");
	index.set("P", "Work");
	index.set("Q", "P");
	index.set("Loose", null);
	assert.deepEqual(index.children("Home"), ["Life", "Work"]);
	assert.equal(index.hasChildren("Life"), false);
	assert.deepEqual(index.chain("Q"), ["P", "Work", "Home"]);
	assert.deepEqual(index.domains("Home").sort(), ["Work"], "Life holds nothing: not a domain");
	assert.deepEqual(index.domains(null).sort(), ["Home"], "without a home page: the top notes that have children");
	assert.deepEqual(index.domains("Work"), ["P"], "a chosen home page anywhere: its children that have children");
	index.set("P", "Life");
	assert.deepEqual(index.children("Work"), []);
	assert.deepEqual(index.children("Life"), ["P"]);
	assert.equal(index.set("P", "Life"), false, "no change");
	index.set("A", "B");
	index.set("B", "A");
	assert.deepEqual(index.chain("A"), ["B"], "a loop stops");
});

test("the places service: children and domains (here the areas of placeOf) follow every change", async () => {
	const vault = fakeApp({ ...VAULT });
	const places = createPlaces(vault.app);
	const domainsByPlace = () => {
		const out = new Set<string>();
		for (const file of vault.files.values()) {
			const area = places.placeOf(file).area;
			if (area && area.path !== file.path) out.add(area.path);
		}
		return [...out].sort();
	};
	const domains = () => places.domains().map((f) => f.path).sort();
	const kids = (path: string) => places.childrenOf(path).map((f) => f.path);
	let changes = 0;
	const off = places.onChange(() => changes++);
	assert.deepEqual(domains(), domainsByPlace());
	assert.deepEqual(domains(), ["Life.md", "Work.md"]);
	assert.deepEqual(kids("Work.md"), ["Archive/Old plan.md", "Meeting notes.md", "Project X.md"]);
	assert.equal(places.hasChildren("Loose.md"), false);
	// A first link edited: that note moves at once.
	vault.set("Loose.md", { link: "Life" });
	assert.deepEqual(kids("Life.md"), ["Garden.md", "Loose.md"]);
	assert.deepEqual(domains(), domainsByPlace());
	// A note created, renamed and deleted: the index is built again (at most every 500 ms).
	await tick(520);
	vault.set("New.md", { link: "Garden" });
	await tick(520);
	assert.deepEqual(kids("Garden.md"), ["New.md"]);
	assert.deepEqual(domains(), domainsByPlace());
	await tick(520);
	vault.rename("New.md", "Renamed.md");
	await tick(520);
	assert.deepEqual(kids("Garden.md"), ["Renamed.md"]);
	await tick(520);
	vault.set("Renamed.md", null);
	await tick(520);
	assert.deepEqual(kids("Garden.md"), []);
	assert.deepEqual(domains(), domainsByPlace());
	// The Home module's options.
	places.configure({ ignoredFolders: ["Archive"] });
	await tick(520);
	assert.deepEqual(kids("Work.md"), ["Meeting notes.md", "Project X.md"]);
	assert.equal(places.isIgnored("Archive/Old plan.md"), true);
	places.configure({ home: "Work.md" });
	assert.deepEqual(domains(), ["Project X.md"], "below a chosen home page: its children that have children");
	assert.equal(places.placeOf(vault.files.get("Garden.md")!).area?.path, "Home.md", "outside it, the rail's pill still names the top note");
	places.configure({ home: "", ignoredFolders: [] });
	assert.deepEqual(places.options, { home: "", ignoredFolders: [] });
	await tick(350);
	assert.ok(changes > 0, "listeners hear about changes");
	off();
	assert.equal(places.service.version, 1);
	assert.equal(Object.prototype.hasOwnProperty.call(places.service, "configure"), false, "the published service cannot change the options");
	places.dispose();
});

/**
 * A vault where the note holding most linked notes is not the one called "Home": "Home" hangs from
 * "Project X" (a link in its first lines) and gathers the brainstorms, while "Index" heads a
 * smaller tree of its own.
 */
const SPLIT: Record<string, Spec> = {
	"Project X.md": {},
	"Home.md": { link: "Project X", line: 2 },
	"Project X - Redesign idea.md": { link: "Project X" },
	"Archives/Project X (archive).md": { link: "Project X" },
	"Session 1.md": { link: "Home", line: 1 },
	"Session 2.md": { link: "Home", line: 1 },
	"Session 3.md": { link: "Home", line: 1 },
	"Session 4.md": { link: "Home", line: 1 },
	"Session 5.md": { link: "Home", line: 1 },
	"Index.md": { link: "Work", line: 3 },
	"Work.md": { link: "Index", line: 1 },
	"Garden.md": { link: "Index", line: 1 },
	"Client brief.md": { link: "Work", line: 1 },
	"Quarter plan.md": { link: "Work", line: 1 },
	"Seeds.md": { link: "Garden", line: 1 },
	"Reading list.md": {},
};

test("domains hang from the detected home page; the rail's area pill is unchanged", () => {
	const vault = fakeApp({ ...SPLIT });
	const places = createPlaces(vault.app);
	const f = (path: string) => vault.files.get(path)!;
	// 8 of the 13 linked notes end at Project X: more than half, the home page.
	assert.equal(places.homePath(), "Project X.md");
	assert.deepEqual(places.domains().map((x) => x.path), ["Home.md"], "its children that have children, and nothing else");
	for (const domain of places.domains()) assert.equal(places.parentOf(domain)?.path, places.homePath(), "every domain is a child of the home page");
	// The pill, as the rail always showed it: below the home page the level under it, elsewhere the top note.
	assert.equal(places.placeOf(f("Session 1.md")).area?.path, "Home.md");
	assert.equal(places.placeOf(f("Project X - Redesign idea.md")).area?.path, "Project X - Redesign idea.md");
	assert.equal(places.placeOf(f("Client brief.md")).area?.path, "Index.md");
	assert.equal(places.placeOf(f("Seeds.md")).area?.path, "Index.md");
	assert.equal(places.placeOf(f("Reading list.md")).area, null);
	places.dispose();
});

test("without a home page, the domains are the top notes that have children", () => {
	// Two trees of the same size: neither holds more than half of the linked notes.
	const vault = fakeApp({
		"A.md": {},
		"A1.md": { up: "A" },
		"A2.md": { up: "A" },
		"A21.md": { up: "A2" },
		"B.md": {},
		"B1.md": { up: "B" },
		"B2.md": { up: "B" },
		"B3.md": { up: "B" },
		"Loose.md": {},
		"Loop 1.md": { up: "Loop 2" },
		"Loop 2.md": { up: "Loop 1" },
	});
	const places = createPlaces(vault.app);
	assert.equal(places.homePath(), null);
	assert.deepEqual(places.domains().map((x) => x.path), ["A.md", "B.md"], "top notes with children; loops and loose notes are no domain");
	assert.equal(places.placeOf(vault.files.get("A21.md")!).area?.path, "A.md", "the pill names the top note, as before");
	places.dispose();
});

test("moving a note: the parent key kept (up, parent or moc), else up", async () => {
	const { parentKeyIn, parentValue } = await import("../src/core/places/move");
	assert.equal(parentKeyIn(undefined), "up");
	assert.equal(parentKeyIn({ tags: ["a"] }), "up");
	assert.equal(parentKeyIn({ up: "[[A]]" }), "up");
	assert.equal(parentKeyIn({ parent: "[[A]]" }), "parent");
	assert.equal(parentKeyIn({ MOC: "[[A]]" }), "MOC");
	// The key the rule reads wins over an empty one earlier in the order.
	assert.equal(parentKeyIn({ up: "", moc: "[[A]]" }), "moc");
	// An empty parent key is filled rather than adding "up" beside it.
	assert.equal(parentKeyIn({ parent: null }), "parent");
	assert.equal(parentValue("[[A]]", "[[B]]"), "[[B]]");
	assert.equal(parentValue(undefined, "[[B]]"), "[[B]]");
	assert.deepEqual(parentValue(["[[A]]", "[[C]]"], "[[B]]"), ["[[B]]", "[[C]]"]);
	assert.equal(parentValue(["[[A]]"], "[[B]]"), "[[B]]");
});

test("moving a note: refused on itself or below itself", async () => {
	const { wouldLoop } = await import("../src/core/places/move");
	const parents: Record<string, string | null> = { home: null, a: "home", b: "a", c: "b", x: "home", loop1: "loop2", loop2: "loop1" };
	const parentOf = (p: string) => parents[p] ?? null;
	assert.equal(wouldLoop("a", "a", parentOf), true);
	assert.equal(wouldLoop("a", "c", parentOf), true);
	assert.equal(wouldLoop("a", "x", parentOf), false);
	assert.equal(wouldLoop("c", "a", parentOf), false);
	assert.equal(wouldLoop("a", "home", parentOf), false);
	// An existing loop elsewhere ends the walk.
	assert.equal(wouldLoop("a", "loop1", parentOf), false);
});

test("moving a note: a loop is found however deep the chain", async () => {
	const { wouldLoop } = await import("../src/core/places/move");
	// n0 <- n1 <- ... <- n199: moving n0 under n199 would close a loop 200 levels down.
	const parentOf = (p: string) => { const i = Number(p.slice(1)); return i > 0 ? `n${i - 1}` : null; };
	assert.equal(wouldLoop("n0", "n199", parentOf), true);
	assert.equal(wouldLoop("n150", "n10", parentOf), false);
});

test("moving a note: Undo puts the old value back only while the move's value is still there", async () => {
	const { undoParent } = await import("../src/core/places/move");
	// Key added by the move: removed again.
	let fm: Record<string, unknown> = { up: "[[B]]", tags: ["x"] };
	assert.equal(undoParent(fm, { key: "up", had: false, before: undefined, written: "[[B]]" }), true);
	assert.deepEqual(fm, { tags: ["x"] });
	// Old value put back.
	fm = { parent: "[[B]]" };
	assert.equal(undoParent(fm, { key: "parent", had: true, before: "[[A]]", written: "[[B]]" }), true);
	assert.deepEqual(fm, { parent: "[[A]]" });
	// Changed since (by hand or by a sync): nothing undone, nothing lost.
	fm = { up: "[[C]]" };
	assert.equal(undoParent(fm, { key: "up", had: false, before: undefined, written: "[[B]]" }), false);
	assert.deepEqual(fm, { up: "[[C]]" });
	fm = { mocs: ["[[B]]", "[[D]]", "[[E]]"] };
	assert.equal(undoParent(fm, { key: "mocs", had: true, before: ["[[A]]", "[[D]]"], written: ["[[B]]", "[[D]]"] }), false);
	assert.deepEqual(fm, { mocs: ["[[B]]", "[[D]]", "[[E]]"] });
	// Removed since: stays removed.
	fm = {};
	assert.equal(undoParent(fm, { key: "up", had: true, before: "[[A]]", written: "[[B]]" }), false);
	assert.deepEqual(fm, {});
	// Lists compared by content.
	fm = { mocs: ["[[B]]", "[[D]]"] };
	assert.equal(undoParent(fm, { key: "mocs", had: true, before: ["[[A]]", "[[D]]"], written: ["[[B]]", "[[D]]"] }), true);
	assert.deepEqual(fm, { mocs: ["[[A]]", "[[D]]"] });
});
