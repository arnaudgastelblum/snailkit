// Pure helpers of PDF export: markdown preparation, geometry, link and image targets, CSS rule
// filtering, print options and cancellation of the waits.
import assert from "node:assert/strict";
import { test } from "node:test";
import { pdfExport } from "../src/modules/pdf-export";
import {
	ExportCancelled, appUrlToFileUrl, appUrlToVaultPath, backgroundCss, bodyClassList, canvasSize, clamp,
	contentWidthPx, fileNameOf, filterCssRule, folderPath, frontmatterEnd, imageHref, internalLinkHref,
	isDarkScheme, linkTarget, mmToInches, obsidianUri, pageBreakCss, pageSizeMm, placeholderFor, prepareMarkdown,
	printOptions, safeStyleText, slugify, tempHtmlName, toArrayBuffer, vaultPdfPath, withTimeout,
	type LinkContext,
} from "../src/modules/pdf-export/logic";
import { PRINT_CSS } from "../src/modules/pdf-export/print-css";

const BREAK = '<div class="sk-pdf-export-page-break"></div>';

test("the cut settings are gone and the save folder is remembered", () => {
	const keys = Object.keys(pdfExport.defaults);
	assert.ok(!keys.includes("renderTimeoutSec") && !keys.includes("debugHtml"));
	assert.equal(pdfExport.defaults.lastSaveDir, "");
	assert.equal(pdfExport.desktopOnly, true);
});

test("frontmatter closes only at column zero and only after a first-line opener", () => {
	assert.equal(frontmatterEnd(["# Title", "text"]), -1);
	assert.equal(frontmatterEnd(["---", "tags: a", "---", "body"]), 2);
	assert.equal(frontmatterEnd(["---", "note: |", "  ---", "  more", "---", "body"]), 4);
	assert.equal(frontmatterEnd(["---", "tags: a"]), -1);
	assert.equal(frontmatterEnd(["", "---", "a", "---"]), -1);
	assert.equal(frontmatterEnd(["---  ", "tags: a", "---", "body"]), 2);
	assert.equal(frontmatterEnd([]), -1);
	assert.equal(frontmatterEnd(["---"]), -1);
});

test("markdown loses its frontmatter and keeps its body", () => {
	const off = { addTitle: false, pageBreakMarker: "" };
	assert.equal(prepareMarkdown("---\ntags: a\n---\nBody line", "Note", off), "Body line");
	assert.equal(prepareMarkdown("Body line\nsecond", "Note", off), "Body line\nsecond");
	assert.equal(prepareMarkdown("---\nnote: |\n  ---\n---\nBody", "Note", off), "Body");
	assert.equal(prepareMarkdown("---\r\na: 1\r\n---\r\nBody\r\nmore", "Note", off), "Body\nmore");
});

test("page break markers become a break isolated by blank lines, never inside code", () => {
	const marker = { addTitle: false, pageBreakMarker: "%% pagebreak %%" };
	assert.equal(prepareMarkdown("one\n%% pagebreak %%\ntwo", "Note", marker), `one\n\n${BREAK}\n\ntwo`);
	assert.equal(prepareMarkdown("one\n   %% pagebreak %%  \ntwo", "Note", marker), `one\n\n${BREAK}\n\ntwo`);
	assert.equal(prepareMarkdown("```\n%% pagebreak %%\n```\nafter", "Note", marker), "```\n%% pagebreak %%\n```\nafter");
	assert.equal(prepareMarkdown("~~~\n%% pagebreak %%\n~~~", "Note", marker), "~~~\n%% pagebreak %%\n~~~");
	assert.equal(prepareMarkdown("```js\ncode\n```\n%% pagebreak %%\nend", "Note", marker), `\`\`\`js\ncode\n\`\`\`\n\n${BREAK}\n\nend`);
	assert.equal(prepareMarkdown("one\n%% pagebreak %%\ntwo", "Note", { addTitle: false, pageBreakMarker: "" }), "one\n%% pagebreak %%\ntwo");
	assert.equal(prepareMarkdown("see %% pagebreak %% here", "Note", marker), "see %% pagebreak %% here");
});

test("the note name becomes the title only when the note has no level 1 heading first", () => {
	const title = { addTitle: true, pageBreakMarker: "%% pagebreak %%" };
	assert.equal(prepareMarkdown("Some text", "Meeting notes", title), "# Meeting notes\n\nSome text");
	assert.equal(prepareMarkdown("# Real Title\n\nText", "Meeting notes", title), "# Real Title\n\nText");
	assert.equal(prepareMarkdown("\n\n# Real Title", "Meeting notes", title), "\n\n# Real Title");
	assert.equal(prepareMarkdown("## Section", "Meeting notes", title), "# Meeting notes\n\n## Section");
	assert.equal(prepareMarkdown("---\na: 1\n---\ntext", "Meeting notes", title), "# Meeting notes\n\ntext");
	assert.equal(prepareMarkdown("#tag", "Meeting notes", title), "# Meeting notes\n\n#tag");
});

test("slugs drop accents and collapse punctuation", () => {
	assert.equal(slugify("Café à Paris"), "cafe-a-paris");
	assert.equal(slugify("Étape 1 : le début !"), "etape-1-le-debut");
	assert.equal(slugify("  -- Hello -- "), "hello");
	assert.equal(slugify(""), "");
	assert.equal(slugify(null), "");
});

test("page geometry follows size, orientation and margins", () => {
	assert.equal(mmToInches(25.4), 1);
	assert.equal(mmToInches(0), 0);
	assert.deepEqual(pageSizeMm("A4", false), { width: 210, height: 297 });
	assert.deepEqual(pageSizeMm("A4", true), { width: 297, height: 210 });
	assert.deepEqual(pageSizeMm("Nope", false), { width: 210, height: 297 });
	assert.equal(contentWidthPx("A4", false, 15), 680);
	assert.ok(contentWidthPx("A4", true, 15) > contentWidthPx("A4", false, 15));
	assert.ok(contentWidthPx("A5", false, 40) >= 100);
	assert.equal(clamp(-5, 0, 40), 0);
	assert.equal(clamp(500, 50, 150), 150);
	assert.equal(clamp("abc", 2, 30), 2);
});

test("obsidian:// links drop .md for notes and encode everything", () => {
	assert.equal(obsidianUri("My Vault", "Folder/Meeting notes.md"), "obsidian://open?vault=My%20Vault&file=Folder%2FMeeting%20notes");
	assert.equal(obsidianUri("My Vault", "Images/a b.png"), "obsidian://open?vault=My%20Vault&file=Images%2Fa%20b.png");
	assert.equal(obsidianUri("Vault é", "Notes/Été.md"), "obsidian://open?vault=Vault%20%C3%A9&file=Notes%2F%C3%89t%C3%A9");
});

test("app:// URLs become file:// URLs and vault paths", () => {
	assert.equal(appUrlToFileUrl("app://abc123/C:/Users/x/Vault/Images/a%20b.png?12345", "C:\\Users\\x\\Vault"), "file:///C:/Users/x/Vault/Images/a%20b.png");
	assert.equal(appUrlToFileUrl("app://abc/C:/Vault/Images/%C3%A9t%C3%A9.png?1", "C:\\Vault"), "file:///C:/Vault/Images/%C3%A9t%C3%A9.png");
	assert.equal(appUrlToFileUrl("app://abc/home/x/Vault/img.png?1", "/home/x/Vault"), "file:///home/x/Vault/img.png");
	assert.equal(appUrlToFileUrl("app://abc/C:/Vault/a%23b%3F.png?1", "C:/Vault"), "file:///C:/Vault/a%23b%3F.png");
	assert.equal(appUrlToFileUrl("data:image/svg+xml,<svg/>", "C:/V"), null);
	assert.equal(appUrlToFileUrl("https://a/b.png", "C:/V"), null);
	assert.equal(appUrlToVaultPath("app://abc/C:/Users/x/Vault/Images/a%20b.png?1", "C:\\Users\\x\\Vault"), "Images/a b.png");
	assert.equal(appUrlToVaultPath("app://abc/c:/Users/x/Vault/note.md?1", "C:\\Users\\x\\Vault"), "note.md");
	assert.equal(appUrlToVaultPath("app://abc/C:/Other/a.png?1", "C:\\Users\\x\\Vault"), null);
});

test("link targets keep only the file part", () => {
	assert.equal(linkTarget("Folder/Note"), "Folder/Note");
	assert.equal(linkTarget("Note#Heading"), "Note");
	assert.equal(linkTarget("Note#^abc123"), "Note");
	assert.equal(linkTarget("Images/a b.png|300"), "Images/a b.png");
	assert.equal(linkTarget("#Heading"), "");
	assert.equal(linkTarget(null), "");
});

const files: Record<string, string> = { "Project X": "Projects/Project X.md", "diagram.png": "Images/diagram.png", "talk.mp4": "Media/talk.mp4" };
const ctx = (internalLinks = "obsidian"): LinkContext => ({
	basePath: "C:/Vault",
	vaultName: "Vault",
	internalLinks,
	resolve: (linkpath) => files[linkTarget(linkpath)] ?? null,
});

test("internal links open Obsidian, stay in the document, or lose their target", () => {
	assert.equal(internalLinkHref("Project X", ctx()), "obsidian://open?vault=Vault&file=Projects%2FProject%20X");
	assert.equal(internalLinkHref("Project X#Goals", ctx()), "obsidian://open?vault=Vault&file=Projects%2FProject%20X");
	assert.equal(internalLinkHref("#Next steps", ctx()), "#next-steps");
	assert.equal(internalLinkHref("#^abc", ctx()), null);
	assert.equal(internalLinkHref("Project X#^abc", ctx()), null);
	assert.equal(internalLinkHref("Missing note", ctx()), null);
	assert.equal(internalLinkHref("", ctx()), null);
	assert.equal(internalLinkHref("Project X", ctx("none")), null);
	assert.equal(internalLinkHref("#Next steps", ctx("none")), null);
});

test("images link to their vault file, their web page, or nothing", () => {
	assert.equal(imageHref("diagram.png", "app://x/C:/Vault/Images/diagram.png?1", ctx()), "obsidian://open?vault=Vault&file=Images%2Fdiagram.png");
	assert.equal(imageHref("", "app://x/C:/Vault/Other/photo.jpg?1", ctx()), "obsidian://open?vault=Vault&file=Other%2Fphoto.jpg");
	assert.equal(imageHref("", "https://example.com/a.png", ctx()), "https://example.com/a.png");
	assert.equal(imageHref("", "data:image/png;base64,AAA", ctx()), null);
	assert.equal(imageHref("", "app://x/D:/Elsewhere/a.png?1", ctx()), null);
});

test("unprintable embeds become a labelled link", () => {
	assert.deepEqual(placeholderFor("talk.mp4", "app://x/C:/Vault/Media/talk.mp4", "VIDEO", ctx()), {
		label: "talk.mp4",
		href: "obsidian://open?vault=Vault&file=Media%2Ftalk.mp4",
	});
	assert.deepEqual(placeholderFor("", "https://example.com/v/clip.mp4?t=3", "VIDEO", ctx()), { label: "clip.mp4", href: "https://example.com/v/clip.mp4?t=3" });
	assert.deepEqual(placeholderFor("", "", "IFRAME", ctx()), { label: "iframe", href: null });
	assert.equal(fileNameOf("app://x/C:/V/My%20File.pdf?123"), "My File.pdf");
	assert.equal(fileNameOf("Drawing.excalidraw.md"), "Drawing.excalidraw.md");
});

const mediaRule = (condition: string, inner: string[] = []) => ({
	type: 4,
	media: { mediaText: condition },
	conditionText: condition,
	cssRules: inner.map((cssText) => ({ cssText })),
	cssText: "@media " + condition + " { " + inner.join(" ") + " }",
});

test("print media and @page rules are dropped, screen rules are unwrapped, the rest passes", () => {
	assert.equal(filterCssRule(mediaRule("print", ["body{color:#000}"])), null);
	assert.equal(filterCssRule(mediaRule("only print", ["body{color:#000}"])), null);
	assert.equal(filterCssRule(mediaRule("screen", ["body{color:red}", ".a{top:0}"])), "body{color:red}\n.a{top:0}");
	assert.equal(filterCssRule(mediaRule("(max-width: 600px)", [".a{top:0}"])), "@media (max-width: 600px) { .a{top:0} }");
	assert.equal(filterCssRule(mediaRule("screen and (min-width: 100px)", [".a{top:0}"])), "@media screen and (min-width: 100px) { .a{top:0} }");
	assert.equal(filterCssRule({ type: 6, cssText: "@page { margin: 1in }" }), null);
	assert.equal(filterCssRule({ cssText: "@page { margin: 1in }" }), null);
	assert.equal(filterCssRule({ type: 1, cssText: ".a { color: red }" }), ".a { color: red }");
	assert.equal(filterCssRule({ type: 5, cssText: "@font-face { font-family: X }" }), "@font-face { font-family: X }");
	assert.equal(filterCssRule({ conditionText: "print", cssRules: [{ cssText: ".a{}" }], cssText: "@media print{.a{}}" }), null);
	assert.equal(filterCssRule(null), null);
	assert.equal(filterCssRule({ type: 4, media: { mediaText: "print" }, cssRules: [], cssText: "" }), null);
});

test("@supports, @container and @layer pass through intact, print in their condition or not", () => {
	const keep = (cssText: string, conditionText?: string) =>
		assert.equal(filterCssRule({ conditionText, cssRules: [{ cssText: ".a{}" }], cssText }), cssText);
	keep("@supports (display: grid) { .a{display:grid} }", "(display: grid)");
	keep("@supports (print-color-adjust: exact) { .a{color:red} }", "(print-color-adjust: exact)");
	keep("@layer base { .a{color:red} }");
	keep("@container (min-width: 400px) { .a{top:0} }", "(min-width: 400px)");
});

test("body classes keep the theme, force one scheme and drop translucency", () => {
	assert.equal(bodyClassList("theme-light mod-windows is-focused", "obsidian"), "theme-light mod-windows is-focused sk-pdf-export");
	assert.equal(bodyClassList("theme-light mod-windows", "dark"), "mod-windows theme-dark sk-pdf-export");
	assert.equal(bodyClassList("theme-dark", "light"), "theme-light sk-pdf-export");
	assert.equal(bodyClassList("", "obsidian"), "sk-pdf-export");
	assert.equal(bodyClassList("theme-dark is-translucent is-focused", "obsidian"), "theme-dark is-focused sk-pdf-export");
});

test("automatic page breaks cover both DOM shapes and spare the first block", () => {
	assert.equal(pageBreakCss("none"), "");
	assert.equal(pageBreakCss("h1"), ".markdown-preview-sizer > div:not(:first-child) > h1,\n.markdown-preview-sizer > h1:not(:first-child) { break-before: page; }");
	assert.ok(pageBreakCss("h2").includes("> h1") && pageBreakCss("h2").includes("> h2"));
	assert.ok(pageBreakCss("h2").split(",").every((selector) => selector.includes(":not(:first-child)")));
});

test("a white page only on a light scheme", () => {
	assert.equal(isDarkScheme("dark", false), true);
	assert.equal(isDarkScheme("light", true), false);
	assert.equal(isDarkScheme("obsidian", true), true);
	assert.equal(isDarkScheme("obsidian", false), false);
	assert.equal(backgroundCss("white", false), "body { background-color: #ffffff !important; }");
	assert.equal(backgroundCss("white", true), "");
	assert.equal(backgroundCss("theme", false), "");
});

test("the print CSS neutralizes the app layout and the pane decorations", () => {
	assert.ok(PRINT_CSS.includes(".sk-pdf-export-wrap {"));
	assert.ok(PRINT_CSS.includes("contain: none !important"));
	assert.ok(PRINT_CSS.includes("background: transparent !important") && PRINT_CSS.includes("border: 0 !important"));
	assert.ok(PRINT_CSS.includes(".sk-pdf-export-page-break {"));
	assert.equal(safeStyleText(".a{content:'</style>'}"), ".a{content:'<\\/style>'}");
});

test("canvas size prefers the CSS size", () => {
	assert.deepEqual(canvasSize({ clientWidth: 400, clientHeight: 200 }), { width: 400, height: 200 });
	assert.deepEqual(canvasSize({ clientWidth: 0, clientHeight: 0, getAttribute: (n) => ({ width: "800", height: "600" })[n] ?? null }), { width: 800, height: 600 });
	assert.deepEqual(canvasSize({ clientWidth: 400.6, clientHeight: 199.2 }), { width: 401, height: 199 });
	assert.deepEqual(canvasSize({}), { width: 0, height: 0 });
});

test("PDF bytes become an ArrayBuffer of exactly their own bytes", () => {
	const bytes = (ab: ArrayBuffer) => Array.from(new Uint8Array(ab));
	assert.deepEqual(bytes(toArrayBuffer(null)), []);
	assert.deepEqual(bytes(toArrayBuffer(Buffer.from([1, 2, 3]))), [1, 2, 3]);
	assert.deepEqual(bytes(toArrayBuffer(Buffer.from([9, 1, 2, 3, 9]).subarray(1, 4))), [1, 2, 3]);
	assert.deepEqual(bytes(toArrayBuffer(new Uint8Array([4, 5]).buffer)), [4, 5]);
	assert.deepEqual(bytes(toArrayBuffer({ type: "Buffer", data: [7, 8] })), [7, 8]);
});

test("print options: header and footer get room, unknown values fall back", () => {
	const settings = { ...pdfExport.defaults };
	const options = printOptions(settings);
	assert.equal(options.pageSize, "A4");
	assert.equal(options.scale, 1);
	assert.equal(options.displayHeaderFooter, true);
	assert.equal(options.margins.left, 15 / 25.4);
	assert.ok(options.footerTemplate.includes("pageNumber") && options.headerTemplate === "<div></div>");
	assert.equal(options.generateDocumentOutline, true);
	const tight = printOptions({ ...settings, marginMm: 5, pageSize: "B9", scalePercent: 400 });
	assert.equal(tight.margins.top, 12 / 25.4);
	assert.equal(tight.margins.left, 5 / 25.4);
	assert.equal(tight.pageSize, "A4");
	assert.equal(tight.scale, 1.5);
	const bare = printOptions({ ...settings, marginMm: 5, pageNumbers: false, headerTitle: false, outline: false });
	assert.equal(bare.displayHeaderFooter, false);
	assert.equal(bare.margins.top, 5 / 25.4);
	assert.equal(bare.generateDocumentOutline, false);
});

test("output paths: folders normalized, empty means the vault root", () => {
	assert.equal(folderPath(" PDF "), "PDF");
	assert.equal(folderPath("/Exports\\2026/"), "Exports/2026");
	assert.equal(folderPath(""), "");
	assert.equal(folderPath("/"), "");
	assert.equal(vaultPdfPath("Exports", "Meeting notes"), "Exports/Meeting notes.pdf");
	assert.equal(vaultPdfPath("", "Meeting notes"), "Meeting notes.pdf");
	assert.equal(tempHtmlName("Project X: été", 42), "Project_X_t_-42.html");
	assert.equal(tempHtmlName("", 1), "note-1.html");
});

test("waits time out, pass results through, and stop at once on cancel", async () => {
	assert.equal(await withTimeout(Promise.resolve(3), 1000, "x"), 3);
	await assert.rejects(withTimeout(new Promise(() => undefined), 10, "Printing"), /Printing timed out/);
	await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 1000, "x"), /boom/);
	const controller = new AbortController();
	const pending = withTimeout(new Promise(() => undefined), 0, "Save dialog", controller.signal);
	controller.abort();
	await assert.rejects(pending, ExportCancelled);
	await assert.rejects(withTimeout(Promise.resolve(1), 1000, "x", controller.signal), ExportCancelled);
});
