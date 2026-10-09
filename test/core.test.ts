import assert from "node:assert/strict";
import { test } from "node:test";
import { HINT_WORKBENCH_TABS, STARTER_TOOLS, mergeSettings, normalizeData, starterData } from "../src/core/settings";
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
	assert.equal(fr.tn("home.count", 1, { total: 9 }), "1 outil sur 9 dans votre coquille");
	assert.equal(fr.tn("home.count", 0, { total: 9 }), "0 outil sur 9 dans votre coquille");
	assert.equal(fr.tn("home.count", 3, { total: 9 }), "3 outils sur 9 dans votre coquille");
	const en = new Translator("en", [CORE_STRINGS]);
	assert.equal(en.t("missing.key"), "missing.key");
});

test("stored data is normalized", () => {
	assert.deepEqual(normalizeData(null), { version: 1, language: "auto", welcomed: false, hints: [], workbench: { autoOpen: "startup-and-new-tabs", startTab: "auto", startTabPhone: "tasks" }, modules: {} });
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

test("when the Workbench opens by itself is its own setting, taken over from the Home module once", () => {
	assert.equal(normalizeData({ workbench: { autoOpen: "startup" } }).workbench.autoOpen, "startup");
	assert.equal(normalizeData({ workbench: { autoOpen: "sometimes" } }).workbench.autoOpen, "startup-and-new-tabs", "a bad value falls back to the default");
	const former = normalizeData({ modules: { home: { enabled: true, settings: { openWorkbench: "never" } } } });
	assert.equal(former.workbench.autoOpen, "never", "the Home module's former setting comes over");
	assert.equal(normalizeData({ workbench: { autoOpen: "startup" }, modules: { home: { settings: { openWorkbench: "never" } } } }).workbench.autoOpen, "startup", "once saved, the Workbench's own value wins");
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

// Every stylesheet ends up in one styles.css: two @keyframes with the same name, even in two
// modules, and the last one silently replaces the other everywhere (a placed task once played the
// stamp's tilted animation).
test("animation names are unique across every stylesheet", async () => {
	const fs = await import("node:fs");
	const path = await import("node:path");
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".css")) files.push(full);
		}
	};
	walk("src");
	const seen = new Map<string, string>();
	for (const file of files) {
		for (const match of fs.readFileSync(file, "utf8").matchAll(/@keyframes\s+([\w-]+)/g)) {
			const name = match[1];
			assert.ok(!seen.has(name), `@keyframes ${name} is defined in ${seen.get(name)} and again in ${file}`);
			seen.set(name, file);
		}
	}
});

test("Workbench start tabs normalize independently", () => {
	for (const workbench of [undefined, null, {}, { startTab: "unknown", startTabPhone: 42 }]) {
		const settings = normalizeData({ workbench }).workbench;
		assert.equal(settings.startTab, "auto");
		assert.equal(settings.startTabPhone, "tasks");
	}
	for (const tab of ["auto", "home", "tasks", "sessions"]) {
		const settings = normalizeData({ workbench: { startTab: tab, startTabPhone: tab } }).workbench;
		assert.equal(settings.startTab, tab);
		assert.equal(settings.startTabPhone, tab);
	}
	const mixed = normalizeData({ workbench: { startTab: "sessions", startTabPhone: "missing" } }).workbench;
	assert.equal(mixed.startTab, "sessions");
	assert.equal(mixed.startTabPhone, "tasks");
});

test("a first install starts with the starter tools on, and only they", () => {
	const data = starterData();
	assert.deepEqual(Object.keys(data.modules).sort(), [...STARTER_TOOLS].sort());
	for (const id of STARTER_TOOLS) assert.deepEqual(data.modules[id], { enabled: true, settings: {} });
	assert.equal(data.welcomed, false);
	// Stored settings never get them back: a tool turned off stays off.
	assert.equal(normalizeData({ modules: { tasks: { enabled: false, settings: {} } } }).modules.tasks.enabled, false);
	assert.deepEqual(normalizeData({}).modules, {});
});
