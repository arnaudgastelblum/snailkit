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
