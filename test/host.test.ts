// Module lifecycle: fast toggles, failing activations and failing cleanups never leave a module
// half running, and never affect the other modules.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ModuleHost } from "../src/core/host";
import { defineModule, type AnyModule } from "../src/core/module";
import { defaultData } from "../src/core/settings";
import type SnailkitPlugin from "../src/main";

const en = { "module.name": "Demo", "module.description": "A demo module." };
const strings = { en, fr: en, nl: en, es: en };

function fakePlugin() {
	const commands = new Map<string, unknown>();
	const plugin = {
		app: { commands: { addCommand: (c: { id: string }) => commands.set(c.id, c), removeCommand: (id: string) => commands.delete(id) }, workspace: { updateOptions() {}, trigger() {} } },
		data: defaultData(),
		workbench: { setAutoOpen() {} },
		saveData: async () => undefined,
		lang: "en",
		manifest: { id: "snailkit", name: "Snailkit" },
		editorExtensions: [],
	};
	return { plugin: plugin as unknown as SnailkitPlugin, commands };
}

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

test("turning a module off while it is starting leaves nothing running", async () => {
	const { plugin, commands } = fakePlugin();
	const slow = defineModule({
		id: "slow",
		icon: "x",
		category: "write",
		strings,
		defaults: {},
		async activate(ctx) {
			ctx.addCommand({ id: "run", name: "Run", callback() {} });
			await tick(20);
		},
	});
	const host = new ModuleHost(plugin, [slow]);
	const on = host.setEnabled("slow", true);
	const off = host.setEnabled("slow", false);
	const again = host.setEnabled("slow", true);
	const final = host.setEnabled("slow", false);
	await Promise.all([on, off, again, final]);
	assert.equal(host.get("slow")!.context, null);
	assert.equal(commands.size, 0, "no command left behind");
});

test("on, off, on in a row ends with exactly one running context", async () => {
	const { plugin, commands } = fakePlugin();
	let starts = 0;
	const mod = defineModule({
		id: "mod",
		icon: "x",
		category: "write",
		strings,
		defaults: {},
		async activate(ctx) {
			starts++;
			ctx.addCommand({ id: "run", name: "Run", callback() {} });
			await tick();
		},
	});
	const host = new ModuleHost(plugin, [mod]);
	await Promise.all([host.setEnabled("mod", true), host.setEnabled("mod", false), host.setEnabled("mod", true)]);
	assert.ok(host.get("mod")!.context);
	assert.equal(commands.size, 1);
	assert.equal(host.get("mod")!.state, "on");
	assert.ok(starts >= 1);
});

test("a module that throws while starting is marked, cleaned, and does not stop the others", async () => {
	const { plugin, commands } = fakePlugin();
	plugin.data.modules = { broken: { enabled: true, settings: {} }, fine: { enabled: true, settings: {} } };
	const broken = defineModule({
		id: "broken",
		icon: "x",
		category: "write",
		strings,
		defaults: {},
		activate(ctx) {
			ctx.addCommand({ id: "a", name: "A", callback() {} });
			ctx.register(() => {
				throw new Error("cleanup boom");
			});
			throw new Error("start boom");
		},
	});
	const fine = defineModule({ id: "fine", icon: "x", category: "write", strings, defaults: {}, activate() {} });
	const host = new ModuleHost(plugin, [broken, fine] as AnyModule[]);
	await host.startEnabled();
	assert.equal(host.get("broken")!.state, "error");
	assert.equal(host.get("broken")!.error, "start boom");
	assert.equal(host.get("fine")!.state, "on");
	assert.equal(commands.size, 0, "the broken module's command was removed despite the failing cleanup");
});

test("a failing cleanup does not keep the other cleanups from running", async () => {
	const { plugin } = fakePlugin();
	const ran: string[] = [];
	const mod = defineModule({
		id: "mod",
		icon: "x",
		category: "write",
		strings,
		defaults: {},
		activate(ctx) {
			ctx.register(() => ran.push("first"));
			ctx.register(() => {
				throw new Error("boom");
			});
			ctx.register(() => ran.push("last"));
		},
	});
	const host = new ModuleHost(plugin, [mod]);
	await host.setEnabled("mod", true);
	await host.setEnabled("mod", false);
	assert.deepEqual(ran.sort(), ["first", "last"]);
});

test("saving keeps the settings keys this version does not know", async () => {
	const { plugin } = fakePlugin();
	const mod = defineModule({ id: "mod", icon: "x", category: "write", strings, defaults: { a: 1 }, activate() {} });
	plugin.data.modules.mod = { enabled: false, settings: { a: 2, newer: true } };
	const host = new ModuleHost(plugin, [mod]);
	const handle = host.get("mod")!;
	(handle.settings as { a: number }).a = 3;
	await handle.save();
	assert.deepEqual(plugin.data.modules.mod.settings, { a: 3, newer: true });
});

test("settings changed on another device reach the modules instead of being overwritten", async () => {
	const { plugin } = fakePlugin();
	const seen: number[] = [];
	const mod = defineModule({
		id: "mod",
		icon: "x",
		category: "write",
		strings,
		defaults: { a: 1 },
		activate(ctx) {
			ctx.onSettingsChange((s) => seen.push(s.a));
		},
	});
	const other = defineModule({ id: "other", icon: "x", category: "write", strings, defaults: {}, activate() {} });
	plugin.data.modules.mod = { enabled: true, settings: { a: 1 } };
	const host = new ModuleHost(plugin, [mod, other] as AnyModule[]);
	await host.startEnabled();
	const fresh = defaultData();
	fresh.modules.mod = { enabled: true, settings: { a: 5 } };
	fresh.modules.other = { enabled: true, settings: {} };
	host.get("mod")!.localAt = 0;
	await host.applyExternal(async () => fresh);
	assert.deepEqual(seen, [5]);
	assert.equal(host.get("other")!.state, "on", "turned on elsewhere, so on here too");
	const off = defaultData();
	off.modules.mod = { enabled: false, settings: { a: 5 } };
	for (const handle of host.handles) handle.localAt = 0;
	await host.applyExternal(async () => off);
	assert.equal(host.get("mod")!.state, "off");
	assert.equal(host.get("other")!.state, "off");
});

test("an unreadable file from another device changes nothing", async () => {
	const { plugin } = fakePlugin();
	const mod = defineModule({ id: "mod", icon: "x", category: "write", strings, defaults: { a: 1 }, activate() {} });
	plugin.data.modules.mod = { enabled: true, settings: { a: 2 } };
	const host = new ModuleHost(plugin, [mod]);
	await host.startEnabled();
	await host.applyExternal(async () => null);
	assert.equal(host.get("mod")!.state, "on");
	assert.equal((host.get("mod")!.settings as { a: number }).a, 2);
});

test("a module just changed on this device keeps its local values over an older file", async () => {
	const { plugin } = fakePlugin();
	const mod = defineModule({ id: "mod", icon: "x", category: "write", strings, defaults: { a: 1 }, activate() {} });
	const host = new ModuleHost(plugin, [mod]);
	const older = defaultData();
	older.modules.mod = { enabled: false, settings: { a: 1 } };
	// The user turns the module on while the older file is waiting in the queue.
	const applied = host.applyExternal(async () => older);
	const on = host.setEnabled("mod", true);
	await Promise.all([applied, on]);
	assert.equal(host.get("mod")!.state, "on");
	assert.equal(plugin.data.modules.mod.enabled, true);
});

test("when the Workbench opens, just chosen on this device, wins over an older file", async () => {
	const { plugin } = fakePlugin();
	const host = new ModuleHost(plugin, []);
	const older = defaultData();
	const applied = host.applyExternal(async () => older);
	const chosen = host.setWorkbenchAutoOpen("never");
	await Promise.all([applied, chosen]);
	assert.equal(plugin.data.workbench.autoOpen, "never");
	const newer = defaultData();
	newer.workbench.autoOpen = "startup";
	(host as unknown as { workbenchLocalAt: number }).workbenchLocalAt = 0;
	await host.applyExternal(async () => newer);
	assert.equal(plugin.data.workbench.autoOpen, "startup", "a change from another device comes in");
});

test("a language change from another device restarts the running modules", async () => {
	const { plugin } = fakePlugin();
	let starts = 0;
	let resets = 0;
	(plugin as unknown as { resetTranslator(): void }).resetTranslator = () => void resets++;
	const mod = defineModule({ id: "mod", icon: "x", category: "write", strings, defaults: {}, activate() { starts++; } });
	plugin.data.modules.mod = { enabled: true, settings: {} };
	const host = new ModuleHost(plugin, [mod]);
	await host.startEnabled();
	const fresh = defaultData();
	fresh.language = "fr";
	fresh.modules.mod = { enabled: true, settings: {} };
	await host.applyExternal(async () => fresh);
	assert.equal(resets, 1);
	assert.equal(starts, 2);
	assert.equal(plugin.data.language, "fr");
});

test("the plugin unloading while a file from another device is read starts nothing again", async () => {
	const { plugin, commands } = fakePlugin();
	const mod = defineModule({
		id: "mod",
		icon: "x",
		category: "write",
		strings,
		defaults: {},
		activate(ctx) {
			ctx.addCommand({ id: "run", name: "Run", callback() {} });
		},
	});
	plugin.data.modules.mod = { enabled: true, settings: {} };
	const host = new ModuleHost(plugin, [mod]);
	await host.startEnabled();
	assert.equal(commands.size, 1);
	const fresh = defaultData();
	fresh.modules.mod = { enabled: true, settings: {} };
	fresh.language = "fr";
	host.get("mod")!.localAt = 0;
	(plugin as unknown as { resetTranslator(): void }).resetTranslator = () => undefined;
	const applied = host.applyExternal(async () => {
		host.stopAll();
		await tick();
		return fresh;
	});
	await applied;
	assert.equal(host.get("mod")!.context, null);
	assert.equal(commands.size, 0, "nothing left registered after the unload");
	assert.equal(await host.setEnabled("mod", true), "off", "a later toggle starts nothing either");
	await host.relocalize();
	assert.equal(host.get("mod")!.context, null);
});

test("the plugin unloading during the first start leaves the next modules off", async () => {
	const { plugin, commands } = fakePlugin();
	let hostRef: ModuleHost | null = null;
	const first = defineModule({
		id: "first",
		icon: "x",
		category: "write",
		strings,
		defaults: {},
		async activate(ctx) {
			ctx.addCommand({ id: "a", name: "A", callback() {} });
			hostRef!.stopAll();
			await tick();
		},
	});
	const second = defineModule({
		id: "second",
		icon: "x",
		category: "write",
		strings,
		defaults: {},
		activate(ctx) {
			ctx.addCommand({ id: "b", name: "B", callback() {} });
		},
	});
	plugin.data.modules = { first: { enabled: true, settings: {} }, second: { enabled: true, settings: {} } };
	const host = new ModuleHost(plugin, [first, second] as AnyModule[]);
	hostRef = host;
	await host.startEnabled();
	assert.equal(host.get("first")!.context, null);
	assert.equal(host.get("second")!.context, null);
	assert.equal(commands.size, 0);
});
