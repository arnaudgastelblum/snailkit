import assert from "node:assert/strict";
import { test } from "node:test";
import { assignSlots, buildCss, contrastRatio, fnv1a, hexToHue, hueClasses, oklchToSrgb, roleColors, slotHue, splitTag, tagHues, tagKey } from "../src/modules/tag-colors/colors";
import { entries, migrate, registry, type ColorHost, type TagColorsSettings } from "../src/modules/tag-colors/types";
import { classes, setOverride } from "../src/modules/tag-colors/dialogs";
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
	const settings: TagColorsSettings = { uppercase: true, colorPanes: true, slots: Object.entries(assignSlots({}, { "project/website/design": 4 })), overrides: [] };
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
	const defaults: TagColorsSettings = { uppercase: true, colorPanes: true, slots: [], overrides: [] };
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
