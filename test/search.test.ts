import assert from "node:assert/strict";
import { test } from "node:test";
import { performance } from "node:perf_hooks";
import { capText, tokenInput, insertLink, linkAtCursor, fold, parseQuery, matchTitle, search, excerpt, creationTitle, readableText, compactText, textRanges, ORDER, LIMITS, type Entry } from "../src/modules/search/engine";
import { excluded, Sources } from "../src/modules/search/sources";
import type { ModuleContext } from "../src/core/context";
import type { SearchSettings } from "../src/modules/search/types";
import { MarkdownView, Platform, type TFile, type Editor } from "obsidian";

function entry(title: string, extra: Partial<Entry> = {}): Entry {
	return { kind: "note", title, folded: fold(title), path: title + ".md", line: null, tags: [], domain: "", hue: null, trail: "", modified: 0, ...extra };
}
test("search fold preserves offsets, accents, case, ligatures and surrogate pairs", () => {
	assert.equal(fold("ÉTUDE À Noël"), "etude a noel");
	assert.equal(fold("Œuvre Æther Straße"), "ouvre ather strase");
	for (const text of ["e\u0301tude", "😀 ÉTUDE", "İ Œ ﬃ"]) assert.equal(fold(text).length, text.length);
	const original = "😀 Une Étude";
	const at = fold(original).indexOf("etude"); assert.equal(original.slice(at, at + 5), "Étude");
});
test("search content cap counts UTF-8 bytes and never splits a character", () => {
	assert.equal(capText("Étude", 3), "Ét");
	assert.equal(capText("😀 note", 3), "");
	assert.equal(capText("😀 note", 4), "😀");
	assert.equal(capText("A😀 note", 2), "A");
	assert.equal(capText("Neutral", 3), "Neu");
});
test("search parses completed filters, leaf tags and unfinished parent tags", () => {
	const query = parseQuery("#project/site in:design route");
	assert.deepEqual(query.tokens, [{ kind: "tag", value: "project/site" }, { kind: "domain", value: "design" }]);
	assert.equal(query.text, "route");
	assert.equal(parseQuery("in:design").tokens.length, 0);
	assert.equal(parseQuery("#project", ["project", "project/site"]).tagPrefix, "project");
	assert.deepEqual(parseQuery("#project/site", ["project", "project/site"]).tokens, [{ kind: "tag", value: "project/site" }]);
	assert.equal(parseQuery("in:design ").text, "");
	assert.equal(parseQuery("#missing ").tokens[0].value, "missing");
});
test("search ranking keeps exact, prefix, word start, substring, fuzzy and alias order", () => {
	const rows = search([
		entry("A route"), entry("Route"), entry("Routes"), entry("Enroute"), entry("Rough template"),
		entry("An alias", { aliases: ["route"] }),
	], parseQuery("route"))[0].results;
	assert.deepEqual(rows.map(row => row.title), ["Route", "An alias", "Routes", "A route", "Enroute"]);
	assert.ok(matchTitle("brindle", "brndl"));
	assert.equal(matchTitle("brindle", "br" )?.score, 90);
	assert.equal(matchTitle("a bridle", "bd"), null);
	assert.equal(matchTitle("abrindle", "brndl"), null);
	assert.equal(matchTitle("b very distant r n d l", "brndl"), null);
});
test("search multiword matches merge original title ranges", () => {
	assert.deepEqual(matchTitle("route project route", "project route")?.ranges, [[0, 5], [6, 13]]);
	assert.deepEqual(matchTitle("route", "route rout")?.ranges, [[0, 5]]);
});
test("search recency and current domain bonuses only break close ranks", () => {
	const rows = search([entry("Route", { modified: 0 }), entry("Routes", { modified: 9999999999999, domain: "design" })], parseQuery("route"), { now: 100, domain: "design" })[0].results;
	assert.equal(rows[0].title, "Route"); assert.ok(rows[1].score <= 90.8);
});
test("search fixed groups, bounded top results, chips and explicit limits", () => {
	const entries = ORDER.flatMap(kind => Array.from({ length: 25 }, (_, i) => entry("Route " + i, { kind })));
	const groups = search(entries, parseQuery("route"));
	assert.deepEqual(groups.map(group => group.kind), ORDER);
	assert.deepEqual(groups.map(group => group.results.length), ORDER.map(kind => LIMITS[kind]));
	assert.equal(search(entries, parseQuery("route"), { filter: "tasks" })[0].results.length, 14);
	assert.deepEqual(search(entries, parseQuery("route"), { filter: "notes" }).map(group => group.kind), ["note", "section", "content"]);
	assert.deepEqual(search(entries, parseQuery("route"), { filter: "brainstorms" }).map(group => group.kind), ["brainstorm"]);
	assert.ok(search(entries, parseQuery("route"), { limit: 2 }).every(group => group.results.length === 2));
	assert.deepEqual(search(entries, parseQuery("route"), { limit: 0 }), []);
});
test("search task and brainstorm filters intersect tags, descendants and domains", () => {
	const entries = [entry("Route task", { kind: "task", tags: ["project/site/sub"], domain: "design team" }), entry("Route ideas", { kind: "brainstorm", tags: ["project/site"], domain: "design team" }), entry("Route elsewhere", { kind: "brainstorm", tags: ["project/site"], domain: "other" }), entry("Route untagged", { kind: "task", domain: "design team" })];
	const groups = search(entries, parseQuery("#project/site in:design route"));
	assert.deepEqual(groups.flatMap(group => group.results.map(row => row.title)), ["Route task", "Route ideas"]);
	assert.equal(search(entries, parseQuery("#project/sites route")).length, 0);
});
test("search hides empty groups and offers creation only for free text", () => {
	const query = parseQuery("zzz"), groups = search([entry("Route")], query);
	assert.deepEqual(groups, []); assert.equal(creationTitle(query, groups), "zzz");
	assert.equal(creationTitle(parseQuery("#missing"), []), null);
	assert.equal(creationTitle(parseQuery("in:design "), []), null);
	assert.equal(creationTitle(parseQuery("route"), search([entry("Route")], parseQuery("route"))), null);
});
test("search excerpts retain accents and return the matched line", () => {
	const text = "First line\n" + "Neutral words ".repeat(30) + "\nUne Étude précise\nLast line";
	const hit = excerpt(text, ["etude"], 15);
	assert.ok(hit.text.includes("Étude précise")); assert.equal(hit.line, 2); assert.ok(hit.text.startsWith("…"));
	// A match in the body never shows the properties above it; a match in them still does.
	const note = "---\ntags: [x]\n---\nThe route is short.";
	const body = note.indexOf("The");
	assert.equal(excerpt(note, ["route"], 100, undefined, body).text, "…The route is short.");
	assert.ok(excerpt(note, ["tags"], 100, undefined, body).text.startsWith("---"));
});
test("search excluded file fallback handles literal filters and regex", () => {
	assert.ok(excluded("Archive/Route.md", ["archive/"]));
	assert.ok(excluded("Notes/Hidden.md", ["/Hidden\\.md$/"]));
	assert.equal(excluded("Notes/Route.md", ["/[/", "private/"]), false);
});

function fakeSources() {
	const events = new Map<string, (...args: unknown[]) => void>();
	const services = new Map<string, unknown>();
	const cleanup: Array<() => void> = [];
	const files = new Map<string, TFile>();
	const texts = new Map<string, string>();
	let reads = 0;
	let delayed: ((file: TFile) => Promise<string>) | null = null;
	const file = { path: "Neutral.md", basename: "Neutral", extension: "md", stat: { mtime: 1 } } as TFile;
	files.set(file.path, file); texts.set(file.path, "First line\nA searchable accent Étude.");
	const on = (name: string, callback: (...args: unknown[]) => void) => { events.set(name, callback); return { name }; };
	const ctx = {
		settings: { content: true },
		app: {
			workspace: { containerEl: { ownerDocument: { defaultView: globalThis } }, getActiveViewOfType: () => null, getActiveFile: () => null, on },
			metadataCache: { on, getFileCache: () => ({ frontmatter: { aliases: ["Alternate title"] }, headings: [] }), getTags: () => ({}) },
			vault: { on, getMarkdownFiles: () => [...files.values()].filter(file => file.extension === "md"), getFileByPath: (path: string) => files.get(path), getConfig: () => [], cachedRead: async (file: TFile) => { reads++; return delayed ? delayed(file) : texts.get(file.path)!; } },
		},
		places: { placeOf: () => ({ chain: [], area: null }), homePath: () => null, domains: () => [], onChange: (fn: () => void) => { events.set("places", fn); return () => {}; } },
		service: (name: string) => services.get(name), registerEvent: () => {}, register: (fn: () => void) => cleanup.push(fn), onSettingsChange: () => {}, onServicesChange: (fn: () => void) => events.set("services", fn),
	} as unknown as ModuleContext<SearchSettings>;
	return { sources: new Sources(ctx), file, files, texts, events, services, reads: () => reads, delay: (fn: (file: TFile) => Promise<string>) => { delayed = fn; }, stop: () => cleanup.forEach(fn => fn()) };
}
test("search brainstorm classification follows service activation and retains aliases", async () => {
	const fake = fakeSources();
	try {
		await fake.sources.ensureReady();
		assert.equal(fake.sources.titles("neutral")[0].kind, "note");
		fake.services.set("sessions", { version: 1, list: () => [{ path: fake.file.path, title: "Neutral ideas" }] });
		fake.events.get("services")!();
		assert.deepEqual(fake.sources.titles("neutral").map(group => group.kind), ["brainstorm"]);
		assert.equal(fake.sources.titles("alternate")[0].kind, "brainstorm");
		assert.deepEqual(fake.sources.titles("neutral", { filter: "notes" }), []);
		assert.equal(fake.sources.titles("neutral", { filter: "brainstorms" })[0].results.length, 1);
		fake.services.delete("sessions"); fake.events.get("services")!();
		assert.equal(fake.sources.titles("neutral")[0].kind, "note");
	} finally { fake.stop(); }
});
test("search readable excerpts hide metadata and multiline comments before slicing", () => {
	const raw = '\uFEFF---\r\nsecret: hidden\r\n---\r\n%%tt:neutral\r\nhidden comment%%\r\n- [x] **Étude** [[Folder/Note|project]] and [route](https://example.org) ~~done~~ `code` _word_\r\n> ## Next';
	const clean = readableText(raw);
	assert.equal(clean.length, raw.length);
	assert.equal(clean.split("\n").length, raw.split("\n").length);
	assert.equal(compactText(clean), "Étude project and route done code word\r\nNext");
	assert.equal(clean.indexOf("Étude"), raw.indexOf("Étude"));
	const hit = excerpt(clean, ["etude"], 100);
	assert.equal(hit.line, 5);
	assert.ok(!hit.text.includes("hidden"));
	assert.equal(compactText(readableText("Visible %% unfinished\ncomment")), "Visible");
	assert.equal(compactText(readableText("---\n---\n![[Note]] **Bold**")), "Note Bold");
});
test("search highlights all visible words after cleaning, preserving accents and merging overlaps", () => {
	const text = compactText(readableText("**Étude** and [[Note|route]]: étude route"));
	const ranges = textRanges(text, ["etude", "route", "rout"]);
	assert.deepEqual(ranges.map(([start, end]) => text.slice(start, end)), ["Étude", "route", "étude", "route"]);
});
test("search desktop and phone exclude hidden content and open the original matched line", async () => {
	const mobile = Platform.isMobile;
	try {
		for (const phone of [false, true]) {
			Platform.isMobile = phone;
			const fake = fakeSources();
			try {
				fake.texts.set(fake.file.path, "---\nsecret: hidden\n---\n%%tt:internal\ncomment hidden%%\n- [ ] **Étude** [[Note|route]]");
				await fake.sources.ensureReady();
				while (fake.sources.contentIndexing) await new Promise(resolve => setTimeout(resolve, 1));
				const signal = new AbortController().signal;
				assert.deepEqual(await fake.sources.textResults(parseQuery("hidden"), signal), []);
				const result = (await fake.sources.textResults(parseQuery("etude route"), signal))[0].results[0];
				assert.equal(result.line, 5);
				assert.ok(result.snippet?.includes("Étude route"));
				assert.ok(!/[\[\]*%]|secret|internal/.test(result.snippet!));
			} finally { fake.stop(); }
		}
	} finally { Platform.isMobile = mobile; }
});
test("search sources are lazy and a deleted file cannot be resurrected by a pending read", async () => {
	const fake = fakeSources();
	assert.equal(fake.reads(), 0);
	let release!: (text: string) => void;
	fake.delay(() => new Promise(resolve => { release = resolve; }));
	await fake.sources.ensureReady();
	assert.equal(fake.sources.titles("alternate")[0].results[0].title, "Neutral");
	await new Promise(resolve => setTimeout(resolve, 10));
	fake.files.delete(fake.file.path); fake.events.get("delete")!(fake.file);
	release("Late searchable text"); await new Promise(resolve => setTimeout(resolve, 10));
	assert.equal(fake.sources.content.size, 0); assert.equal(fake.sources.catalog.size, 0);
	fake.stop();
});
test("search phone reads cancel on the next request and keep no content index", async () => {
	const mobile = Platform.isMobile; Platform.isMobile = true;
	const fake = fakeSources();
	try {
		await fake.sources.ensureReady(); assert.equal(fake.reads(), 0);
		const aborted = new AbortController(); aborted.abort();
		assert.deepEqual(await fake.sources.textResults(parseQuery("etude"), aborted.signal), []);
		assert.equal(fake.reads(), 0);
		const groups = await fake.sources.textResults(parseQuery("etude"), new AbortController().signal);
		assert.equal(groups[0].results[0].line, 1); assert.ok(groups[0].results[0].snippet?.includes("Étude"));
		assert.equal(fake.sources.content.size, 0);
	} finally { fake.stop(); Platform.isMobile = mobile; }
});
test("search stopping during a read releases data and ignores its late result", async () => {
	const fake = fakeSources(); let release!: (text: string) => void;
	fake.delay(() => new Promise(resolve => { release = resolve; }));
	await fake.sources.ensureReady(); await new Promise(resolve => setTimeout(resolve, 10));
	fake.stop(); release("Late content"); await new Promise(resolve => setTimeout(resolve, 10));
	assert.equal(fake.sources.content.size, 0); assert.equal(fake.sources.catalog.size, 0);
});
test("search bulk metadata resolution cannot perpetually restart the catalog", async () => {
	const fake = fakeSources();
	const timer = setInterval(() => fake.events.get("resolved")!(), 1);
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([fake.sources.ensureReady(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Catalog did not settle")), 500); })]);
		assert.equal(fake.sources.building, false);
	} finally { clearInterval(timer); clearTimeout(timeout); fake.stop(); }
});
test("search desktop content ranks across the whole index, beyond the first twenty matches", async () => {
	const fake = fakeSources();
	for (let i = 0; i < 25; i++) {
		const file = { path: `Neutral ${i}.md`, basename: `Neutral ${i}`, extension: "md", stat: { mtime: i === 24 ? Date.now() : 1 } } as TFile;
		fake.files.set(file.path, file); fake.texts.set(file.path, "A shared keyword.");
	}
	try {
		await fake.sources.ensureReady();
		while (fake.sources.contentIndexing) await new Promise(resolve => setTimeout(resolve, 1));
		const groups = await fake.sources.textResults(parseQuery("keyword"), new AbortController().signal, 2);
		assert.equal(groups[0].results.length, 2); assert.equal(groups[0].results[0].title, "Neutral 24");
	} finally { fake.stop(); }
});
test("search benchmark: 20,000 neutral catalog entries", () => {
	const before = process.memoryUsage().heapUsed;
	const entries = Array.from({ length: 20000 }, (_, i) => entry(`Project ${i} route review`, { tags: ["project/site"], domain: "design" }));
	const memory = process.memoryUsage().heapUsed - before;
	for (let i = 0; i < 5; i++) search(entries, parseQuery("route"));
	const times: number[] = [];
	for (const text of ["r", "ro", "route", "prj", "zzz", "review", "#project/site route"]) {
		const query = parseQuery(text), start = performance.now(); search(entries, query); times.push(performance.now() - start);
	}
	console.log(`Search 20k: median ${times.slice().sort((a,b) => a-b)[3].toFixed(2)} ms, maximum ${Math.max(...times).toFixed(2)} ms; catalog heap delta ${(memory / 1048576).toFixed(2)} MiB`);
	assert.equal(search(entries, parseQuery("route"))[0].results.length, 5);
});

test("search filter extraction preserves a separator and waits for ambiguous tags", () => {
	for (const raw of ["route #client ", "route in:design "]) assert.equal(tokenInput(raw, parseQuery(raw)), "route ");
	assert.equal(tokenInput("#client ", parseQuery("#client ")), "");
	assert.equal(parseQuery("#work", ["work", "workshop"]).tokens.length, 0);
	assert.equal(parseQuery("#WORK", ["work", "Workshop"]).tagPrefix, "work");
	assert.equal(parseQuery("#work ", ["work", "workshop"]).tokens.length, 1);
});
test("search multiword ranking uses the weakest word match", () => {
	assert.equal(matchTitle("route plan", "plan route")?.score, 80);
	assert.equal(matchTitle("explanation of reroutes", "plan route")?.score, 60);
	assert.equal(matchTitle("plan route", "plan route")?.score, 100);
	assert.equal(matchTitle("plan route overview", "plan route")?.score, 90);
});
test("search fallback insertion preserves frontmatter, line endings and empty notes", () => {
	assert.equal(insertLink("", "[[X]]"), "[[X]]\n");
	assert.equal(insertLink("Body", "[[X]]"), "[[X]]\nBody");
	assert.equal(insertLink("---\n---\nBody", "[[X]]"), "---\n---\n[[X]]\nBody");
	assert.equal(insertLink("---\ntags: [test]\n---\nBody", "[[X]]"), "---\ntags: [test]\n---\n[[X]]\nBody");
	assert.equal(insertLink("---\r\ntitle: Test\r\n---", "[[X]]"), "---\r\ntitle: Test\r\n---\r\n[[X]]\r\n");
});
test("search ignores attachment events and releases revision bookkeeping", async () => {
	const fake = fakeSources();
	try {
		await fake.sources.ensureReady();
		while (fake.sources.contentIndexing) await new Promise(resolve => setTimeout(resolve, 1));
		const before = fake.reads();
		for (const extension of ["png", "pdf", "canvas"]) {
			const file = { path: "Attachment." + extension, extension } as TFile; fake.files.set(file.path, file);
			fake.events.get("create")!(file); fake.events.get("modify")!(file); fake.events.get("rename")!(file, "Old." + extension);
		}
		await new Promise(resolve => setTimeout(resolve, 10));
		assert.equal(fake.reads(), before); assert.equal(fake.sources.content.size, 1);
		fake.events.get("delete")!(fake.file);
		assert.equal((fake.sources as unknown as { revisions: Map<string, number> }).revisions.size, 0);
	} finally { fake.stop(); }
});
test("search places refresh preserves catalog entries without a rebuild", async () => {
	const fake = fakeSources();
	try {
		await fake.sources.ensureReady(); const rows = fake.sources.catalog.get(fake.file.path);
		fake.events.get("places")!();
		assert.equal(fake.sources.building, false); assert.equal(fake.sources.catalog.get(fake.file.path), rows);
	} finally { fake.stop(); }
});
test("search desktop queries never read unfinished index entries", async () => {
	const fake = fakeSources(); let release!: (text: string) => void;
	fake.delay(() => new Promise(resolve => { release = resolve; }));
	try {
		await fake.sources.ensureReady(); await new Promise(resolve => setTimeout(resolve, 10));
		const before = fake.reads();
		assert.deepEqual(await fake.sources.textResults(parseQuery("keyword"), new AbortController().signal), []);
		assert.equal(fake.reads(), before);
		release("keyword"); while (fake.sources.contentIndexing) await new Promise(resolve => setTimeout(resolve, 1));
	} finally { fake.stop(); }
});

test("search insertion resolves only live editing views of the original note", () => {
	const fake = fakeSources();
	const editor = {} as Editor, other = {} as Editor;
	let mode = "preview", path = fake.file.path;
	const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { file: { path }, editor, getMode: () => mode });
	let leaves = [{ view }];
	Object.assign(fake.sources.ctx.app.workspace, { getLeavesOfType: () => leaves, getActiveViewOfType: () => view });
	try {
		const source = { file: fake.file, editor };
		assert.equal(fake.sources.resolveSource(source)?.editor, null);
		mode = "source"; assert.equal(fake.sources.resolveSource(source)?.editor, editor);
		view.file.path = "Other.md"; assert.equal(fake.sources.resolveSource(source)?.editor, null);
		view.file.path = path; leaves = []; assert.equal(fake.sources.resolveSource(source)?.editor, null);
		leaves = [{ view }]; view.editor = other; assert.equal(fake.sources.resolveSource(source)?.editor, other);
		fake.events.get("file-open")!(); assert.equal(fake.sources.lastSource?.file.path, path); assert.equal(fake.sources.lastSource?.editor, null);
		fake.files.delete(path); assert.equal(fake.sources.resolveSource(source), null);
	} finally { fake.stop(); }
});

test("a link inserted at the start of a line with text gets a line of its own", () => {
	assert.equal(linkAtCursor("# Budget", 0, "[[Time Log]]"), "[[Time Log]]\n");
	assert.equal(linkAtCursor("", 0, "[[Time Log]]"), "[[Time Log]]");
	assert.equal(linkAtCursor("See ", 4, "[[Time Log]]"), "[[Time Log]]");
});
