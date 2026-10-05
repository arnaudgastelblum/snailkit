import assert from "node:assert/strict";
import { test } from "node:test";
import { inTag, lineOutsideTasks, subTags } from "../src/modules/tag-colors/card";
import { assignSlots, buildCss, contrastRatio, fnv1a, hexToHue, hueClasses, oklchToSrgb, roleColors, slotHue, splitTag, tagHues, tagKey } from "../src/modules/tag-colors/colors";
import { entries, migrate, registry, type ColorHost, type TagColorsSettings } from "../src/modules/tag-colors/types";
import { classes, setOverride } from "../src/modules/tag-colors/dialogs";
import { asTask, nextPart, rankTags, tagQuery, withoutTyped } from "../src/modules/tag-colors/suggest";
import { mergeSettings } from "../src/core/settings";

test("tag parsing preserves display case and Unicode while keys ignore case", () => {
	assert.equal(tagKey("#PrOjEcT/Écriture/日本語"), "project/écriture/日本語");
	assert.deepEqual(splitTag("#Project/Website/Design"), {
		root: "Project", mids: ["Website"], leaf: "Design", parts: ["Project", "Website", "Design"],
	});
	assert.deepEqual(splitTag("#reading"), { root: "reading", mids: [], leaf: "reading", parts: ["reading"] });
});

test("hash and palette are stable and the first 14 families use distinct slots", () => {
	assert.equal(fnv1a("hello"), 0x4f9f2cab);
	assert.equal(slotHue(0), 18);
	assert.equal(slotHue(7), 198);
	const counts = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`family${i}`, 20 - i]));
	const slots = assignSlots({}, counts);
	assert.equal(new Set(Array.from({ length: 14 }, (_, i) => slots[`family${i}`])).size, 14);
	assert.ok(Object.values(slots).every(slot => slot >= 0 && slot < 14));
	assert.deepEqual(assignSlots({}, Object.fromEntries(Object.entries(counts).reverse())), slots);
});

test("frequency wins collisions, case variants combine, and existing slots never move", () => {
	const first = "reading";
	const second = Array.from({ length: 100 }, (_, i) => `topic${i}`).find(tag => fnv1a(tag) % 14 === fnv1a(first) % 14)!;
	const assigned = assignSlots({}, { [first]: 2, [second]: 10 });
	assert.equal(assigned[second], fnv1a(second) % 14);
	assert.notEqual(assigned[first], assigned[second]);
	assert.equal(assignSlots({}, { "#Reading": 8, reading: 8, [second]: 10 }).reading, fnv1a(first) % 14);
	const copy = { ...assigned };
	const updated = assignSlots(assigned, { reading: 1000, "project/website/design": 500 });
	assert.deepEqual(assigned, copy);
	for (const [key, slot] of Object.entries(copy)) assert.equal(updated[key], slot);
	assert.equal(updated[second], copy[second]);
});

test("implicit ancestors, siblings and cousins receive distinct colors until exhausted", () => {
	const slots = assignSlots({}, { "project/website/design": 30, "project/website/content": 20, "project/docs/edit": 10 });
	assert.ok(Object.hasOwnProperty.call(slots, "project"));
	assert.ok(Object.hasOwnProperty.call(slots, "project/website"));
	assert.equal(new Set(Object.values(slots)).size, Object.keys(slots).length);
	const exhausted = assignSlots({}, Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`project/item${i}`, 30 - i])));
	assert.equal(exhausted["project/item29"], fnv1a("project/item29") % 14);
});

test("overrides distinguish family and body and reset restores the registry", async () => {
	const settings: TagColorsSettings = { uppercase: true, colorPanes: true, tagCard: false, tagSuggest: false, slots: Object.entries(assignSlots({}, { "project/website/design": 4 })), overrides: [] };
	let saves = 0;
	const host = { settings, save: async () => { saves++; } } as ColorHost;
	const before = tagHues("project/website/design", registry(settings, "slots"), {});
	await setOverride(host, "#PROJECT", 0);
	await setOverride(host, "Project/Website/Design", 215);
	assert.deepEqual(tagHues("project/website/design", registry(settings, "slots"), registry(settings, "overrides")), { rootHue: 0, leafHue: 215 });
	assert.equal(classes(host, "project/website/design"), "sk-tag-colors-r-0 sk-tag-colors-l-215");
	await setOverride(host, "project/website/design", null);
	assert.deepEqual(tagHues("project/website/design", registry(settings, "slots"), registry(settings, "overrides")), { rootHue: 0, leafHue: before.leafHue });
	assert.equal(saves, 3);
	assert.equal(tagHues("reading", {}, { reading: 92 }).rootHue, 92);
});

test("CSS classes encode fractional hues and expose all four service variables", () => {
	const hue = slotHue(1);
	const names = hueClasses({ rootHue: hue, leafHue: 0 });
	assert.match(names, /^sk-tag-colors-r-[\d_]+ sk-tag-colors-l-0$/);
	const css = buildCss([hue, hue, 0]);
	assert.equal(css.split("\n").length, 8);
	for (const theme of ["light", "dark"]) assert.ok(css.includes(`body.theme-${theme} .${names.split(" ")[0]}`));
	for (const role of ["r", "l"]) for (const part of ["bg", "fg"]) assert.ok(css.includes(`--sk-tag-${role}-${part}: oklch(`));
	assert.ok(!css.includes("--tc-"));
});

test("palette and custom hues meet 4.5:1 contrast in both themes", () => {
	for (const hue of [...Array.from({ length: 14 }, (_, i) => slotHue(i)), ...Array.from({ length: 360 }, (_, i) => i)]) {
		for (const theme of ["light", "dark"]) for (const role of ["root", "leaf"]) {
			const { bg, fg } = roleColors(hue, theme, role);
			const background = oklchToSrgb(bg[0], bg[1], bg[2]);
			const foreground = oklchToSrgb(fg[0], fg[1], fg[2]);
			assert.ok(contrastRatio(background, foreground) >= 4.5, `${hue} ${theme} ${role}`);
			assert.ok([...background, ...foreground].every(v => v >= 0 && v <= 1));
		}
	}
	assert.equal(hexToHue("#ff0000"), 29);
	assert.equal(hexToHue("#FF0000"), 29);
	assert.throws(() => hexToHue("red"));
});

test("registry migration validates entries and survives core merging and JSON reload", () => {
	const defaults: TagColorsSettings = { uppercase: true, colorPanes: true, tagCard: false, tagSuggest: false, slots: [], overrides: [] };
	const old = { slots: { "#Reading": 3, invalid: 14, fractional: 1.2 }, overrides: { "#Project": 0, invalid: 360 } };
	const saved = mergeSettings(defaults, migrate(old));
	assert.deepEqual(saved.slots, [["reading", 3]]);
	assert.deepEqual(saved.overrides, [["project", 0]]);
	assert.deepEqual(mergeSettings(defaults, migrate(JSON.parse(JSON.stringify(saved)))), saved);
	assert.deepEqual(entries([null, ["", 1], ["reading", NaN], ["reading", 1], ["#Reading", 2]], true), [["reading", 2]]);
	const special = assignSlots({}, JSON.parse('{"__proto__": 2, "constructor": 1}'));
	assert.equal(typeof special.__proto__, "number");
	assert.equal(typeof special.constructor, "number");
});

// ----- tag card -----

test("tag card: sub-tags counted under their direct parent, tags found outside tasks", () => {
	assert.ok(inTag("#Project/Website", "project"));
	assert.ok(!inTag("#projects", "project"));
	assert.deepEqual(subTags({ "#project": 2, "#project/web": 3, "#project/web/seo": 1, "#Project/Design": 4, "#home": 9 }, "project"), [["project/design", 4], ["project/web", 4]]);
	const pos = (line: number) => ({ start: { line, col: 0, offset: line * 10 }, end: { line, col: 5, offset: line * 10 + 5 } });
	const cache = {
		tags: [{ tag: "#project", position: pos(2) }, { tag: "#project/web", position: pos(5) }],
		listItems: [{ task: " ", position: pos(2), parent: -1 }],
	};
	// Line 2 is a task: the first place outside a task is line 5.
	assert.equal(lineOutsideTasks(cache as never, "project"), 5);
	assert.equal(lineOutsideTasks({ tags: [{ tag: "#project", position: pos(2) }], listItems: cache.listItems } as never, "project"), null);
	assert.equal(lineOutsideTasks({ frontmatter: { tags: ["project/web"] } } as never, "project"), -1);
});

// ----- tag suggestions -----

test("tag suggestions: trigger, ranking by note, area then vault, Tab parts and lines as tasks", () => {
	assert.equal(tagQuery("Call the plumber #ho"), "ho");
	assert.equal(tagQuery("Call #"), "");
	assert.equal(tagQuery("(see #pro/we"), "pro/we");
	assert.equal(tagQuery("#"), "", "a lone # at the line start opens the menu (a heading needs a space)");
	assert.equal(tagQuery("# Title"), null);
	assert.equal(tagQuery("issue#12"), null, "a # inside a word is not a tag");

	const all = new Map([
		["home", { tag: "home", count: 9 }],
		["project", { tag: "project", count: 2 }],
		["project/website", { tag: "Project/Website", count: 5 }],
		["project/website/seo", { tag: "project/website/seo", count: 1 }],
		["reading", { tag: "reading", count: 20 }],
	]);
	const stats = { all, note: new Map([["home", 1]]), area: new Map([["project/website", 3]]) };
	// Nothing typed: this note, then the area, then the vault by use.
	assert.deepEqual(rankTags("", stats).map((i) => i.tag), ["home", "Project/Website", "reading", "project", "project/website/seo"]);
	assert.deepEqual(rankTags("", stats).map((i) => i.origin), ["note", "area", "vault", "vault", "vault"]);
	// Typed: starts-with first, then a part starting with it, then containing it; a new tag offered last.
	const web = rankTags("web", stats);
	assert.deepEqual(web.map((i) => i.tag), ["Project/Website", "project/website/seo", "web"]);
	assert.equal(web[2].origin, "new");
	assert.ok(rankTags("pro", stats).find((i) => i.tag === "project")!.parent);
	assert.ok(!rankTags("home", stats).some((i) => i.origin === "new"), "no new tag when it exists");
	// The tag being typed is already in the note's cache: one use less.
	const typing = { all: new Map([...all, ["pro", { tag: "pro", count: 1 }]]), note: new Map([["pro", 1]]), area: new Map() };
	assert.ok(!rankTags("pro", withoutTyped(typing, "pro")).some((i) => i.tag === "pro" && i.origin !== "new"));

	const item = (tag: string) => ({ tag, count: 1, origin: "vault" as const, parent: false });
	assert.equal(nextPart("pro", item("project/website/seo")), "project/");
	assert.equal(nextPart("project/we", item("project/website/seo")), "project/website/");
	assert.equal(nextPart("project/website/s", item("project/website/seo")), "project/website/seo");

	assert.deepEqual(asTask("Call the plumber #home "), { text: "- [ ] Call the plumber #home ", shift: 6 });
	assert.deepEqual(asTask("\t- Call #home"), { text: "\t- [ ] Call #home", shift: 4 });
	assert.deepEqual(asTask("1. Call #home"), { text: "1. [ ] Call #home", shift: 4 });
	assert.deepEqual(asTask("- [ ] Call #home"), { text: "- [ ] Call #home", shift: 0 });
});

test("tag suggestions: never in code or links, Tab goes into a parent's sub-tags", () => {
	assert.equal(tagQuery("Run `npm #pro"), null, "inline code");
	assert.equal(tagQuery("Run `npm` then #pro"), "pro", "after inline code");
	assert.equal(tagQuery("See [[Note#hea"), null, "heading link");
	assert.equal(tagQuery("See [label](#anc"), null, "Markdown link target");
	assert.equal(tagQuery("See [label](https://x.org) #pro"), "pro");
	const parent = { tag: "project", count: 2, origin: "vault" as const, parent: true };
	assert.equal(nextPart("pro", parent), "project/", "a parent tag opens its sub-tags");
	assert.equal(nextPart("pro", { ...parent, parent: false }), "project");
});
