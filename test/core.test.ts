import assert from "node:assert/strict";
import { test } from "node:test";
import { HINT_WORKBENCH_TABS, mergeSettings, normalizeData } from "../src/core/settings";
import { Translator, format, resolveLanguage } from "../src/i18n";
import { CORE_STRINGS } from "../src/i18n/core";
import { MODULES } from "../src/modules/registry";
import { checkTable } from "./i18n-check";

test("core strings are complete in every language", () => checkTable("core", CORE_STRINGS));

test("module strings are complete, and every module has a name and a description", () => {
	for (const module of MODULES) {
		checkTable(module.id, module.strings);
		assert.ok(module.strings.en["module.name"]);
		assert.ok(module.strings.en["module.description"]);
	}
});

test("module ids are unique and safe", () => {
	const ids = MODULES.map((m) => m.id);
	assert.equal(new Set(ids).size, ids.length);
	for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/);
});

test("language resolution", () => {
	assert.equal(resolveLanguage("auto", "fr"), "fr");
	assert.equal(resolveLanguage("auto", "nl-BE"), "nl");
	assert.equal(resolveLanguage("auto", "es"), "es");
	assert.equal(resolveLanguage("auto", "de"), "en");
	assert.equal(resolveLanguage("auto", undefined), "en");
	assert.equal(resolveLanguage("nl", "fr"), "nl");
});

test("format and plurals", () => {
	assert.equal(format("{a} and {b}", { a: 1 }), "1 and {b}");
	const fr = new Translator("fr", [CORE_STRINGS]);
	assert.equal(fr.tn("home.count", 1, { total: 9 }), "1 outil activé sur 9");
	assert.equal(fr.tn("home.count", 0, { total: 9 }), "0 outil activé sur 9");
	assert.equal(fr.tn("home.count", 3, { total: 9 }), "3 outils activés sur 9");
	const en = new Translator("en", [CORE_STRINGS]);
	assert.equal(en.t("missing.key"), "missing.key");
});

test("stored data is normalized", () => {
	assert.deepEqual(normalizeData(null), { version: 1, language: "auto", welcomed: false, hints: [], modules: {} });
	const data = normalizeData({ language: "xx", welcomed: true, modules: { a: { enabled: true, settings: { x: 1 } }, b: "junk" } });
	assert.equal(data.language, "auto");
	assert.equal(data.welcomed, true);
	assert.deepEqual(data.modules, { a: { enabled: true, settings: { x: 1 } } });
});

test("one-time hints are normalized, and the Workbench hint comes over from the Tasks module", () => {
	assert.deepEqual(normalizeData({ hints: ["a", 3, "", "a", "b"] }).hints, ["a", "b"]);
	assert.deepEqual(normalizeData({ hints: "a" }).hints, []);
	const old = normalizeData({ modules: { tasks: { enabled: true, settings: { workbenchTabsHintSeen: true } } } });
	assert.deepEqual(old.hints, [HINT_WORKBENCH_TABS]);
	assert.equal(old.modules.tasks.settings.workbenchTabsHintSeen, true, "the old key stays where it was");
	assert.deepEqual(normalizeData({ hints: [HINT_WORKBENCH_TABS], modules: { tasks: { settings: { workbenchTabsHintSeen: true } } } }).hints, [HINT_WORKBENCH_TABS]);
	assert.deepEqual(normalizeData({ modules: { tasks: { settings: { workbenchTabsHintSeen: false } } } }).hints, []);
});

test("settings merge keeps types and defaults", () => {
	const defaults = { name: "a", count: 2, on: true, list: [1], nested: { x: 1, y: 2 } };
	const merged = mergeSettings(defaults, { name: 5, count: 7, on: false, list: [3, 4], nested: { y: 9 }, unknown: 1 });
	assert.deepEqual(merged, { name: "a", count: 7, on: false, list: [3, 4], nested: { x: 1, y: 9 } });
	const deep = mergeSettings({ nested: { count: 2, inner: { on: true } } }, { nested: { count: "bad", unknown: 1, inner: { on: false } } });
	assert.deepEqual(deep, { nested: { count: 2, inner: { on: false } } }, "nested values are checked too");
	merged.list.push(9);
	assert.deepEqual(defaults.list, [1], "defaults are never mutated");
});
