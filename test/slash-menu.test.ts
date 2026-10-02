import assert from "node:assert/strict";
import { test } from "node:test";
import type { TFile } from "obsidian";
import { Translator } from "../src/i18n";
import { slashMenu } from "../src/modules/slash-menu";
import { defaultSettings, localizedSettings } from "../src/modules/slash-menu/settings/defaults";
import { migrateSettings, sanitizeAction } from "../src/modules/slash-menu/settings/migrations";
import { SearchIndex, normalize, matchScore, highlightIndices } from "../src/modules/slash-menu/search/SearchIndex";
import { buildCallout, calloutHeader } from "../src/modules/slash-menu/actions/callout";
import { convertLine } from "../src/modules/slash-menu/actions/block";
import { renderVariables, extractCursor, variableNames } from "../src/modules/slash-menu/utils/variables";
import { buildMenuModel } from "../src/modules/slash-menu/menu/model";
import { coreSlashEnabled } from "../src/modules/slash-menu/settings/page";
import { EditorState } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import { MenuController, type MenuControllerHost } from "../src/modules/slash-menu/menu/MenuController";

test("search normalizes accents, case and whitespace and ranks match strengths", () => {
	assert.equal(normalize("  DÉTAILS  Été  "), "details ete");
	const texts = ["table", "tables", "new table", "stable", "t a b l e"];
	const scores = texts.map((text) => matchScore("table", text));
	for (let i = 1; i < scores.length; i++) assert.ok(scores[i - 1] > scores[i]);
	assert.deepEqual(highlightIndices("ete", "Été"), [0, 1, 2]);
	assert.deepEqual(highlightIndices("xx", "Été"), []);
});

test("search finds aliases, keywords, categories and loose multiword matches", () => {
	const settings = defaultSettings();
	const index = new SearchIndex();
	index.build(settings.items, settings.categories);
	const ids = (query: string) => index.search(query, () => true, 50).map((result) => result.item.id);
	assert.equal(ids("h2")[0], "builtin:h2");
	assert.ok(ids("hdg2").includes("builtin:h2"));
	assert.equal(ids("callout warn")[0], "builtin:callout-warning");
	assert.equal(ids("grid")[0], "builtin:table");
	assert.ok(ids("insert").includes("builtin:table"));
	assert.equal(index.search("", () => true, 3).length, 3);
	assert.equal(index.search("", () => false, 10).length, 0);
});

test("variables expand supported fields without clipboard or selection access", async () => {
	const settings = defaultSettings();
	settings.dateFormat = "[DATE]";
	settings.timeFormat = "[TIME]";
	settings.datetimeFormat = "[DATETIME]";
	const value = await renderVariables("{{date}} {{time}} {{datetime}} {{title}} {{cursor}} {{unknown}}", {
		settings, file: { basename: "Meeting notes" } as TFile,
	});
	assert.equal(value, "DATE TIME DATETIME Meeting notes {{cursor}} {{unknown}}");
	assert.equal(await renderVariables("{{date:[custom]}} {{title}}", { settings, file: null }), "custom ");
	assert.deepEqual(variableNames(), ["date", "time", "datetime", "title", "cursor"]);
	assert.deepEqual(extractCursor("a{{cursor}}b{{cursor}}"), { text: "ab", cursor: 1 });
	assert.deepEqual(extractCursor("abc"), { text: "abc", cursor: null });
});

test("callouts build fold markers, blank lines and a cursor without header injection", () => {
	assert.equal(calloutHeader({ calloutType: "faq", title: "Meeting notes", fold: "closed" }), "> [!faq]- Meeting notes");
	assert.equal(calloutHeader({ calloutType: "tip", title: "", fold: "open" }), "> [!tip]+");
	assert.equal(calloutHeader({ calloutType: "note]\n", title: "A\nB", fold: "none" }), "> [!note] A B");
	const config = { type: "callout", calloutType: "note", title: "", fold: "none", content: "" } as const;
	assert.equal(buildCallout(config, ""), "> [!note]\n> {{cursor}}");
	assert.equal(buildCallout(config, "First\n\nLast"), "> [!note]\n> First\n>\n> Last{{cursor}}");
	assert.equal(convertLine("- [x] Meeting notes", "h2").line, "## Meeting notes");
});

test("migration drops cut actions and variables, sanitizes ids and preserves empty lists", () => {
	let nested: unknown = { type: "markdown", template: "text" };
	for (let i = 0; i < 5000; i++) nested = { type: "workflow", steps: [nested] };
	const settings = migrateSettings({
		triggerChar: " ", maxResults: Infinity, triggerAfterSpaceOnly: false,
		categories: [{ id: "a", name: "Project X" }, { id: "a", name: "Duplicate" }],
		items: [
			{ id: "ok", name: "Meeting notes", categoryId: "missing", action: { type: "markdown", template: "{{title}}" } },
			{ id: "ok", action: { type: "command", commandId: "editor:toggle-bold" } },
			{ id: "workflow", action: nested },
			{ id: "drawing", action: { type: "excalidraw" } },
			{ id: "clipboard", action: { type: "markdown", template: "{{clipboard}}" } },
			{ id: "selection", action: { type: "callout", content: "{{ selection }}" } },
			null,
		],
		recent: ["ok", "drawing"], junk: true,
	});
	assert.deepEqual(settings.items.map((item) => item.id), ["ok"]);
	assert.equal(settings.items[0].categoryId, "a");
	assert.equal(settings.categories.length, 1);
	assert.deepEqual(settings.recent, ["ok"]);
	assert.equal(settings.triggerChar, "/");
	assert.equal(settings.triggerAfterSpaceOnly, true);
	assert.equal(settings.maxResults, 50);
	assert.ok(!("junk" in settings));
	assert.deepEqual(migrateSettings({ items: [] }).items, []);
	assert.equal(sanitizeAction({ type: "unknown" }), null);
});

test("built-ins follow all four languages and user-created or edited text stays literal", () => {
	const expected = { en: "Heading 1", fr: "Titre 1", nl: "Kop 1", es: "Encabezado 1" };
	for (const lang of ["en", "fr", "nl", "es"] as const) {
		const translator = new Translator(lang, [slashMenu.strings]);
		const settings = defaultSettings();
		const custom = { ...structuredClone(settings.items[0]), id: "custom", name: "Project X", description: "Meeting notes" };
		settings.items.push(custom);
		const local = localizedSettings(settings, translator.t.bind(translator));
		assert.equal(local.items.find((item) => item.id === "builtin:h1")!.name, expected[lang]);
		assert.equal(local.items.length, 32);
		assert.deepEqual(local.items.at(-1), custom);
		for (const item of local.items) {
			assert.ok(item.name && item.description);
			assert.ok(!item.name.startsWith("entry."));
			assert.ok(!item.description.startsWith("entry."));
		}
		settings.items[1].name = "Heading 1";
		settings.items[1].customized = true;
		assert.equal(localizedSettings(settings, translator.t.bind(translator)).items[1].name, "Heading 1");
		assert.deepEqual(settings.items[0], defaultSettings().items[0]);
	}
});

test("menu model respects hidden categories, pinned, recent and unavailable modes", () => {
	const settings = defaultSettings();
	settings.items[0].pinned = true;
	settings.items[1].enabled = false;
	settings.recent = [settings.items[0].id, settings.items[2].id];
	settings.categories.find((category) => category.id === "callouts")!.hidden = true;
	const index = new SearchIndex(); index.build(settings.items, settings.categories);
	const input = { settings, index, query: "", labels: { pinned: "Pinned", recent: "Recent" }, availability: (item: { id: string }) => ({ available: item.id !== "builtin:table" }) };
	const model = buildMenuModel(input);
	assert.deepEqual(model.slice(0, 2).map((section) => section.kind), ["pinned", "recent"]);
	assert.deepEqual(model[1].rows.map((row) => row.item.id), [settings.items[2].id]);
	assert.ok(!model.flatMap((section) => section.rows).some((row) => row.item.categoryId === "callouts" || row.item.id === settings.items[1].id));
	assert.equal(buildMenuModel({ ...input, query: "table" })[0].rows[0].availability.available, false);
	settings.unavailableDisplay = "hide";
	assert.deepEqual(buildMenuModel({ ...input, query: "table" }), []);
});

test("core slash conflict detection handles enabled, disabled and missing registries", () => {
	const app = (value: unknown) => value as Parameters<typeof coreSlashEnabled>[0];
	assert.equal(coreSlashEnabled(app({})), false);
	assert.equal(coreSlashEnabled(app({ internalPlugins: { plugins: { "slash-command": { enabled: true } } } })), true);
	assert.equal(coreSlashEnabled(app({ internalPlugins: { getPluginById: () => ({ enabled: false }) } })), false);
});

test("typed triggers require whitespace or line start, never paste or composition", () => {
	const settings = defaultSettings();
	const controller = new MenuController({ store: { settings } } as MenuControllerHost);
	const trigger = (before: string, inserted: string, userEvent = "input.type", composing = false) => {
		const state = EditorState.create({ doc: before, selection: { anchor: before.length } });
		const transaction = state.update({ changes: { from: before.length, insert: inserted }, selection: { anchor: before.length + inserted.length }, userEvent });
		const update = { docChanged: true, transactions: [transaction], changes: transaction.changes, state: transaction.state,
			view: { composing, state: transaction.state } } as unknown as ViewUpdate;
		return (controller as unknown as { shouldOpen(update: ViewUpdate): boolean }).shouldOpen(update);
	};
	assert.equal(trigger("", "/"), true);
	assert.equal(trigger("Meeting notes ", "/"), true);
	assert.equal(trigger("Meeting notes\n", "/"), true);
	assert.equal(trigger("https:", "/"), false);
	assert.equal(trigger("word", "/"), false);
	assert.equal(trigger("", "/", "input.paste"), false);
	assert.equal(trigger("", "/", "input.type", true), false);
	settings.triggerChar = "::";
	assert.equal(trigger("Meeting notes :", ":"), true);
	assert.equal(trigger("word:", ":"), false);
});

test("activation owns its extension and command across repeated on/off cycles", async () => {
	for (let i = 0; i < 3; i++) {
		const cleanups: Array<() => void> = [];
		const commands: unknown[] = [];
		const extensions: unknown[] = [];
		const listeners: Array<() => void> = [];
		const translator = new Translator("en", [slashMenu.strings]);
		const context = {
			app: { workspace: { getActiveFile: () => null } }, settings: defaultSettings(),
			t: translator.t.bind(translator),
			register: (cleanup: () => void) => cleanups.push(cleanup),
			registerEditorExtension: (extension: unknown) => { extensions.push(extension); cleanups.push(() => { extensions.pop(); }); },
			addCommand: (command: unknown) => { commands.push(command); cleanups.push(() => { commands.pop(); }); },
			onSettingsChange: (listener: () => void) => listeners.push(listener),
		} as unknown as Parameters<typeof slashMenu.activate>[0];
		await slashMenu.activate(context);
		assert.equal(commands.length, 1);
		assert.equal(extensions.length, 1);
		context.settings.triggerChar = ":";
		listeners.forEach((listener) => listener());
		cleanups.reverse().forEach((cleanup) => cleanup());
		assert.equal(commands.length, 0);
		assert.equal(extensions.length, 0);
	}
});
