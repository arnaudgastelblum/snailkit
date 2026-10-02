// Pure parsing regressions and destination-first safety checks for Move text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TFile, type Editor, type EditorPosition } from "obsidian";
import { Translator, LANGUAGES, type Lang } from "../src/i18n";
import { CORE_STRINGS } from "../src/i18n/core";
import { moveText } from "../src/modules/move-text";
import { MoveTextActions } from "../src/modules/move-text/actions";
import { AppendTargetModal, ExtractTargetModal } from "../src/modules/move-text/modals";
import type { Context } from "../src/modules/move-text/types";
import {
	fenceStates, frontmatterEnd, findZone, linkZoneInsertion, sectionBounds,
	proposeTitle, sanitizeFilename, newNotePath, leadingHeadingText,
	prepareSubnoteBody, trimmedBody, isArchiveBasename, formatProvenance,
} from "../src/modules/move-text/logic";

test("fences require the same character, sufficient length and no closing info string", () => {
	assert.deepEqual(fenceStates(["before", "````js", "```", "~~~~", "```` info", "`````", "after"]),
		[false, false, true, true, true, true, false, false]);
	assert.deepEqual(fenceStates(["~~~", "code", "~~~~  "]), [false, true, true, false]);
	assert.deepEqual(fenceStates(["```"]), [false, true]);
	assert.deepEqual(fenceStates([]), [false]);
});

test("frontmatter closes only at column zero and only after a first-line opener", () => {
	assert.equal(frontmatterEnd(["---", "value: |", "  ---", "---\t", "body"]), 3);
	assert.equal(frontmatterEnd(["", "---", "---"]), -1);
	assert.equal(frontmatterEnd(["---", "value: x"]), -1);
	assert.equal(frontmatterEnd(["--- ", "---"]), -1);
});

function insertLink(text: string, target: string): string {
	const lines = text.split(/\r?\n/);
	const insertion = linkZoneInsertion(lines, target);
	if (!insertion) return lines.join("\n");
	const { line, ch } = insertion.from;
	lines[line] = lines[line].slice(0, ch) + insertion.text + lines[line].slice(ch);
	return lines.join("\n");
}

test("link zones follow frontmatter and H1, recognize aliases and prevent duplicates", () => {
	const text = "---\r\nkind: note\r\n---\r\n\r\n# Project X\r\n\r\n- [[One#Section|Alias]]\r\n- [[Two]]\r\n\r\nBody";
	assert.deepEqual(findZone(text.split(/\r?\n/)), { zoneStart: 6, zoneEnd: 8, links: ["One", "Two"] });
	assert.equal(insertLink(text, "One"), text.replace(/\r/g, ""));
	const inserted = insertLink(text, "Three");
	assert.match(inserted, /- \[\[Two\]\]\n- \[\[Three\]\]\n\nBody$/);
	assert.equal(insertLink(inserted, "Three"), inserted);
	assert.equal(insertLink("# Project X\n\nBody", "One"), "# Project X\n\n- [[One]]\n\nBody");
	assert.equal(insertLink("- [[One]]", "Two"), "- [[One]]\n- [[Two]]");
	assert.equal(insertLink("", "One"), "\n- [[One]]");
});

test("nearest heading wins and sections stop at the same or a higher level", () => {
	const lines = ["intro", "## Parent", "text", "### Child", "body", "#### Detail", "detail", "### Sibling", "last", "## Next"];
	assert.deepEqual(sectionBounds(lines, 4), { start: 3, end: 6 });
	assert.deepEqual(sectionBounds(lines, 2), { start: 1, end: 8 });
	assert.deepEqual(sectionBounds(lines, 8), { start: 7, end: 8 });
	assert.deepEqual(sectionBounds(lines, 9), { start: 9, end: 9 });
	assert.equal(sectionBounds(lines, 0), null);
	assert.deepEqual(sectionBounds(["## Real", "```", "# Fake", "```", "body", "## End"], 3), { start: 0, end: 4 });
});

test("title proposals ignore fenced headings and use at most six words or sixty characters", () => {
	assert.equal(proposeTitle(["First words", "```", "# Fake", "```", "## Real title"]), "Real title");
	assert.equal(proposeTitle(["", "- **one** two three four five six seven"]), "one two three four five six");
	assert.equal(proposeTitle(["x".repeat(70)]), "x".repeat(60));
	assert.equal(proposeTitle(["```", "# Fake", "```"]), "");
});

test("subnote bodies preserve custom titles and fenced headings", () => {
	const lines = ["", "## Meeting notes", "", "### Details", "```", "### Code", "```", ""];
	assert.equal(leadingHeadingText(lines), "Meeting notes");
	assert.equal(leadingHeadingText(["paragraph", "## Later"]), null);
	assert.equal(prepareSubnoteBody(lines, true), "## Details\n```\n### Code\n```");
	assert.equal(prepareSubnoteBody(lines, false), "## Meeting notes\n\n### Details\n```\n### Code\n```");
	assert.equal(trimmedBody(["", "  indented  ", " "]), "  indented  ");
	assert.equal(prepareSubnoteBody(["", " "], true), "");
});

test("file names and new note paths sanitize OS and wikilink delimiters", () => {
	assert.equal(sanitizeFilename(' .. Project   X: [Idea] #1^ / \\ * ? " < > | .. '), "Project X- -Idea- -1- - - - - - - - -");
	assert.equal(sanitizeFilename("...  "), "");
	const origin = { parent: { path: "Notes" } };
	assert.equal(newNotePath("Meeting notes.md", origin), "Notes/Meeting notes.md");
	assert.equal(newNotePath("/Project X/Idea: one.MD", origin), "Project X/Idea- one.md");
	assert.equal(newNotePath(".././Meeting notes", origin), "Meeting notes.md");
	assert.equal(newNotePath("...", origin), null);
	assert.equal(newNotePath("Meeting notes", { parent: null }), "Meeting notes.md");
});

const translators = LANGUAGES.map((lang) => new Translator(lang, [moveText.strings, CORE_STRINGS]));

test("archives in every language are recognized after switching language", () => {
	const suffixes = translators.map((t) => t.t("note.archive-suffix"));
	assert.deepEqual(suffixes, [" (archive)", " (archive)", " (archief)", " (archivo)"]);
	for (const suffix of suffixes) assert.ok(isArchiveBasename("Project X" + suffix, "Project X", suffixes));
	assert.ok(isArchiveBasename("Project- X (archief)", "Project: X", suffixes));
	assert.equal(isArchiveBasename("Project X - Meeting notes", "Project X", suffixes), false);
	assert.equal(isArchiveBasename("Other (archive)", "Project X", suffixes), false);
});

test("provenance templates format all three operations in each language", () => {
	const expected = {
		en: ["Extracted from", "Moved from", "Copied from", "on"],
		fr: ["Extrait de", "Déplacé depuis", "Copié depuis", "le"],
		nl: ["Afgesplitst van", "Verplaatst van", "Gekopieerd van", "op"],
		es: ["Extraído de", "Movido de", "Copiado de", "el"],
	};
	for (const t of translators) {
		for (const [i, action] of ["extracted", "moved", "copied"].entries()) {
			assert.equal(formatProvenance(t.t(`note.${action}`), "Project X", "2026-10-02"),
				`${expected[t.lang][i]} [[Project X]] ${expected[t.lang][3]} 2026-10-02`);
		}
	}
	assert.equal(formatProvenance("{origin} {date}", "Project {date}", "2026-10-02"), "Project {date} 2026-10-02");
});

class TestEditor {
	from = { line: 0, ch: 0 };
	to = { line: 0, ch: 0 };
	writes = 0;
	constructor(public value: string) {}
	getValue() { return this.value; }
	getLine(line: number) { return this.value.split(/\r?\n/)[line]; }
	lineCount() { return this.value.split(/\r?\n/).length; }
	getCursor(which?: string) { return which === "to" ? this.to : this.from; }
	somethingSelected() { return this.from.line !== this.to.line || this.from.ch !== this.to.ch; }
	offset(pos: EditorPosition) {
		return this.value.split(/\r?\n/).slice(0, pos.line).reduce((n, line) => n + line.length + 1, 0) + pos.ch;
	}
	getRange(from: EditorPosition, to: EditorPosition) { return this.value.slice(this.offset(from), this.offset(to)); }
	replaceRange(text: string, from: EditorPosition, to = from) {
		this.value = this.value.slice(0, this.offset(from)) + text + this.value.slice(this.offset(to));
		this.writes++;
	}
	get editor() { return this as unknown as Editor; }
}

function fixture(value = "## Meeting notes\nKeep this information\n## Next\nLater", lang: Lang = "en") {
	const files = new Map<string, TFile>();
	const contents = new Map<string, string>();
	const events: string[] = [];
	const editor = new TestEditor(value);
	function add(path: string, content: string) {
		const basename = path.split("/").pop()!.replace(/\.md$/, "");
		const file = Object.assign(Object.create(TFile.prototype), {
			path, basename, extension: "md", parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/" },
		}) as TFile;
		files.set(path, file);
		contents.set(path, content);
		return file;
	}
	const origin = add("Notes/Project X.md", value);
	const current = new Translator(lang, [moveText.strings, CORE_STRINGS]);
	const vault = {
		getAbstractFileByPath: (path: string) => files.get(path) ?? null,
		getMarkdownFiles: () => [...files.values()],
		createFolder: async () => undefined,
		create: async (path: string, data: string) => {
			events.push("create");
			assert.equal(editor.writes, 0, "destination creation precedes source edits");
			if (files.has(path)) throw new Error("Already exists");
			return add(path, data);
		},
		process: async (file: TFile, update: (data: string) => string) => {
			events.push("process");
			assert.equal(editor.writes, 0, "destination processing precedes source edits");
			const result = update(contents.get(file.path)!);
			contents.set(file.path, result);
			return result;
		},
	};
	let active: { file: TFile; editor: Editor } | null = null;
	const context = {
		app: {
			vault,
			workspace: { getActiveViewOfType: () => active },
			metadataCache: {
				getFirstLinkpathDest: (link: string) => [...files.values()].find((f) => f.basename === link || f.path === link + ".md") ?? null,
				fileToLinktext: (file: TFile) => file.basename,
			},
		},
		settings: { ...moveText.defaults },
		t: current.t.bind(current),
		translators: () => translators,
		toast: (message: string) => events.push(message),
	} as unknown as Context;
	const actions = new MoveTextActions(context);
	const clipboard: string[] = [];
	actions.copyLinkToClipboard = async (file) => { clipboard.push(`[[${file.basename}]]`); return true; };
	return { actions, context, editor, origin, add, files, contents, events, vault, clipboard,
		setActive: (file: TFile, target: TestEditor) => { active = { file, editor: target.editor }; } };
}

test("extraction writes first, promotes headings and always adds a top link", async () => {
	const f = fixture();
	const block = f.actions.getBlock(f.editor.editor)!;
	await f.actions.doExtract(f.editor.editor, f.origin, block, { type: "create", name: "Project X - Meeting notes" });
	assert.match(f.contents.get("Notes/Project X - Meeting notes.md")!, /^Extracted from \[\[Project X\]\] on .*\n\nKeep this information\n$/);
	assert.equal(f.editor.value, "- [[Project X - Meeting notes]]\n\n## Next\nLater");
	assert.equal(f.events[0], "create");
});

test("failed destination writes leave the origin intact", async () => {
	for (const action of ["extract", "archive", "append"] as const) {
		const f = fixture();
		const original = f.editor.value;
		f.vault.create = async () => { throw new Error("Write failed"); };
		const block = f.actions.getBlock(f.editor.editor)!;
		const operation = action === "extract"
			? f.actions.doExtract(f.editor.editor, f.origin, block, { type: "create", name: "Meeting notes" })
			: action === "archive" ? f.actions.doArchive(f.editor.editor, f.origin, block, "")
				: f.actions.doAppendTo(f.editor.editor, f.origin, { block, text: trimmedBody(block.lines) }, { type: "create", path: "Target.md" }, false);
		await assert.rejects(operation, /Write failed/);
		assert.equal(f.editor.value, original);
		assert.equal(f.editor.writes, 0);
	}
});

test("source changes elsewhere or editor navigation preserve the entire source", async () => {
	for (const change of ["elsewhere", "navigation", "during-write"] as const) {
		const f = fixture();
		const block = f.actions.getBlock(f.editor.editor)!;
		if (change === "elsewhere") f.editor.value += "\nNew information";
		if (change === "navigation") block.isCurrent = () => false;
		if (change === "during-write") {
			const create = f.vault.create;
			f.vault.create = async (path, data) => {
				const file = await create(path, data);
				f.editor.value += "\nNew information";
				return file;
			};
		}
		await f.actions.doExtract(f.editor.editor, f.origin, block, { type: "create", name: "Meeting notes" });
		assert.ok(f.contents.get("Notes/Meeting notes.md")!.includes("Keep this information"));
		assert.ok(f.editor.value.includes("Keep this information"));
		assert.equal(f.editor.writes, 0);
	}
});

test("archive reuse works in the folder or via a link in another language", async () => {
	for (const linked of [false, true]) {
		const f = fixture(linked ? "- [[Old/Project X (archief)]]\n\n## Meeting notes\nText" : undefined, "es");
		const file = f.add((linked ? "Old/" : "Archives/") + "Project X (archief).md", "Archief van [[Project X]]\n\nOld text");
		if (linked) f.editor.from = f.editor.to = { line: 3, ch: 0 };
		assert.equal(f.actions.findArchive(f.editor.editor, f.origin), file);
		assert.ok(!f.actions.findSubnotes(f.editor.editor, f.origin).includes(file));
		await f.actions.doArchive(f.editor.editor, f.origin, f.actions.getBlock(f.editor.editor)!, "Meeting notes");
		assert.match(f.contents.get(file.path)!, /Old text\n\n## Meeting notes \(/);
		assert.ok(!f.files.has("Archives/Project X (archivo).md"));
		assert.equal(findZone(f.editor.value.split(/\r?\n/)).links.length, 1);
	}
	const f = fixture(undefined, "es");
	await f.actions.doArchive(f.editor.editor, f.origin, f.actions.getBlock(f.editor.editor)!, "");
	assert.match(f.contents.get("Archives/Project X (archivo).md")!, /^Archivo de \[\[Project X\]\]\n\n## \d{4}-\d{2}-\d{2}/);
});

test("append moves exact characters, copies on request and copies the destination link", async () => {
	for (const keep of [false, true]) {
		const f = fixture("Before selected after");
		f.editor.from = { line: 0, ch: 7 };
		f.editor.to = { line: 0, ch: 15 };
		const target = f.add("Target.md", "");
		await f.actions.doAppendTo(f.editor.editor, f.origin, f.actions.getSelectionPayload(f.editor.editor)!, { type: "file", file: target }, keep);
		assert.match(f.contents.get("Target.md")!, new RegExp(`^${keep ? "Copied" : "Moved"} from`));
		assert.match(f.contents.get("Target.md")!, /\n\nselected\n$/);
		assert.equal(f.editor.value, keep ? "Before selected after" : "Before  after");
		assert.deepEqual(f.clipboard, ["[[Target]]"]);
	}
});

test("selection guards distinguish whole fences, cut fences and selections inside code", () => {
	const f = fixture("```\ncode\nmore\n```\nAfter");
	f.editor.from = { line: 1, ch: 0 };
	f.editor.to = { line: 2, ch: 4 };
	assert.equal(f.actions.getBlock(f.editor.editor), null);
	assert.equal(f.actions.getSelectionPayload(f.editor.editor)!.text, "code\nmore");
	f.editor.to = { line: 3, ch: 3 };
	assert.equal(f.actions.getSelectionPayload(f.editor.editor), null);
	f.editor.from = { line: 0, ch: 0 };
	f.editor.to = { line: 4, ch: 0 };
	assert.equal(f.actions.getBlock(f.editor.editor)!.end, 3);
	const frontmatter = fixture("---\nkey: value\n---\nBody");
	frontmatter.editor.to = { line: 1, ch: 3 };
	assert.equal(frontmatter.actions.getBlock(frontmatter.editor.editor), null);
	assert.equal(frontmatter.actions.getSelectionPayload(frontmatter.editor.editor), null);
});

test("append removes whole lines and aborts removal if the source changed", async () => {
	for (const changed of [false, true]) {
		const f = fixture("First\nSelected\nLast");
		f.editor.from = { line: 1, ch: 0 };
		f.editor.to = { line: 2, ch: 0 };
		const payload = f.actions.getSelectionPayload(f.editor.editor)!;
		if (changed) f.editor.value += "\nNew";
		await f.actions.doAppendTo(f.editor.editor, f.origin, payload, { type: "create", path: "Target.md" }, false);
		assert.equal(f.editor.value, changed ? "First\nSelected\nLast\nNew" : "First\nLast");
	}
});

test("concurrent destination creation appends without overwriting", async () => {
	const f = fixture();
	f.vault.create = async (path) => { f.add(path, "Concurrent text"); throw new Error("Already exists"); };
	await f.actions.doAppendTo(f.editor.editor, f.origin, f.actions.getSelectionPayload(f.editor.editor)!, { type: "create", path: "Target.md" }, false);
	assert.match(f.contents.get("Target.md")!, /^Concurrent text\n\nMoved from/);
	assert.ok(!f.editor.value.includes("Keep this information"));
});

test("active destinations use their editor and settings are read live", async () => {
	const f = fixture();
	const target = f.add("Target.md", "Disk text");
	const targetEditor = new TestEditor("Unsaved text");
	f.setActive(target, targetEditor);
	f.context.settings.provenanceLine = false;
	await f.actions.doAppendTo(f.editor.editor, f.origin, f.actions.getSelectionPayload(f.editor.editor)!, { type: "file", file: target }, true);
	assert.match(targetEditor.value, /^Unsaved text\n\n## Meeting notes/);
	assert.equal(f.contents.get("Target.md"), "Disk text");
	assert.equal(f.editor.writes, 0);
});

test("suggestions filter on every path word and avoid offering the source for creation", () => {
	const f = fixture();
	const target = f.add("Projects/Meeting notes.md", "");
	const receiver = { files: [target], originFile: f.origin } as unknown as AppendTargetModal;
	assert.deepEqual(AppendTargetModal.prototype.getSuggestions.call(receiver, "Meeting Projects")[0], { type: "file", file: target });
	assert.deepEqual(AppendTargetModal.prototype.getSuggestions.call(receiver, "Project X"), []);
	assert.deepEqual(AppendTargetModal.prototype.getSuggestions.call(receiver, "New note"), [{ type: "create", path: "Notes/New note.md" }]);
	const extract = { prefix: "Project X - " } as unknown as ExtractTargetModal;
	assert.equal(ExtractTargetModal.prototype.composeName.call(extract, "Project X - Meeting notes"), "Project X - Meeting notes");
});
