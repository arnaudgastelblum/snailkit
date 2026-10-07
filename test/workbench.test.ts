// The Workbench of the core: the tab registry (order, ids, removal), the module facade, the saved
// state (current and former Tasks format), which tab a Workbench shows, Alt+1 ... Alt+9, and where
// a note opened from a tab goes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TFile, type App, type WorkspaceLeaf } from "obsidian";
import { moduleWorkbench, WorkbenchCore } from "../src/core/workbench";
import { openNoteAt } from "../src/core/workbench/open";
import { altDigit, BUILT_IN_TABS, chooseTab, nthTab, readViewState, reshow, sortTabs, startupPlan } from "../src/core/workbench/state";
import { TAB_ORDER, WORKBENCH_VIEW_TYPE, type WorkbenchTab } from "../src/core/workbench/types";

// The registry schedules a redraw with window.setTimeout.
(globalThis as { window?: unknown }).window ??= globalThis;

const tab = (id: string, order?: number): WorkbenchTab => ({ id, order, icon: "x", label: id, mount() {} });

test("the view type keeps the name saved workspaces know", () => {
	assert.equal(WORKBENCH_VIEW_TYPE, "snailkit-tasks");
	assert.deepEqual(BUILT_IN_TABS, ["home", "tasks", "sessions"]);
});

test("tabs come in their order (Home, Tasks, Brainstorm, then the others in arrival order)", () => {
	const core = new WorkbenchCore();
	core.addTab(tab("example", undefined));
	core.addTab(tab("sessions", TAB_ORDER.sessions));
	core.addTab(tab("another"));
	core.addTab(tab("tasks", TAB_ORDER.tasks));
	core.addTab(tab("home", TAB_ORDER.home));
	assert.deepEqual(core.ids(), ["home", "tasks", "sessions", "example", "another"]);
	assert.deepEqual(sortTabs([{ tab: { order: 30 }, seq: 0 }, { tab: { order: 10 }, seq: 1 }, { tab: {}, seq: 2 }]), [{ order: 10 }, { order: 30 }, {}]);
	core.dispose();
});

test("ids are checked, taken ids refused, and an old remover never removes a new registration", () => {
	const core = new WorkbenchCore();
	for (const id of ["", "Bad", "two words", "tab1", "-dash", "tab/x"]) core.addTab(tab(id))();
	assert.deepEqual(core.ids(), []);
	assert.equal(core.addTab({ id: "nomount", icon: "x", label: "x" } as unknown as WorkbenchTab)(), undefined);
	const first = tab("tasks", 20);
	const remove = core.addTab(first);
	core.addTab(tab("tasks", 20))();
	assert.equal(core.get("tasks"), first, "a second tab with a taken id is refused");
	remove();
	assert.equal(core.get("tasks"), undefined);
	const second = tab("tasks", 20);
	core.addTab(second);
	remove();
	assert.equal(core.get("tasks"), second);
	assert.equal(core.addCompanionTab(tab("home"))(), undefined);
	assert.equal(core.get("home"), undefined, "companion plugins cannot take Snailkit's own ids");
	core.addCompanionTab(tab("example"));
	assert.ok(core.get("example"));
	core.dispose();
	assert.deepEqual(core.ids(), []);
	core.addTab(tab("late"));
	assert.deepEqual(core.ids(), [], "nothing registers after the plugin unloads");
});

test("a module's tabs go away when it stops, and an empty Workbench never opens by itself", () => {
	const core = new WorkbenchCore();
	core.setAutoOpen("startup");
	assert.equal(core.autoOpenMode, "never", "no tab yet");
	const cleanups: Array<() => unknown> = [];
	const bench = moduleWorkbench(core, (cleanup) => cleanups.push(cleanup));
	bench.addTab(tab("tasks", 20));
	assert.equal(core.autoOpenMode, "startup");
	assert.equal(core.autoOpenTab, "tasks", "the first tab without Home");
	bench.addTab(tab("home", 10));
	assert.equal(bench.hasTab("home"), true);
	assert.equal(core.autoOpenTab, "home", "Home when it is on");
	assert.equal(cleanups.length, 1, "one cleanup for the tabs");
	for (const cleanup of cleanups.splice(0)) cleanup();
	assert.equal(bench.hasTab("home"), false);
	assert.equal(core.autoOpenMode, "never");
	assert.deepEqual(bench.instances("home"), []);
	bench.addTab(tab("late"));
	assert.equal(core.get("late"), undefined, "a stopped module adds no tab");
	core.dispose();
});

test("tabs added and removed many times leave no cleanup behind", () => {
	const core = new WorkbenchCore();
	const cleanups: Array<() => unknown> = [];
	const bench = moduleWorkbench(core, (cleanup) => cleanups.push(cleanup));
	for (let i = 0; i < 50; i++) bench.addTab(tab("example"))();
	bench.addTab(tab("Bad id"))();
	assert.equal(cleanups.length, 1, "one cleanup, registered once");
	assert.equal(core.get("example"), undefined);
	const kept = tab("kept");
	const remove = bench.addTab(kept);
	const other = bench.addTab(tab("other"));
	other();
	other();
	assert.equal(core.get("kept"), kept);
	for (const cleanup of cleanups.splice(0)) cleanup();
	assert.equal(core.get("kept"), undefined, "what is left goes when the module stops");
	remove();
	core.addTab(tab("kept"));
	remove();
	assert.ok(core.get("kept"), "an old remover never removes a new registration");
	core.dispose();
});

test("the saved state: current format, the Tasks module's former format, and junk", () => {
	assert.deepEqual(readViewState({ activeTab: "home", tabs: { home: { page: null }, tasks: { scope: "today" } }, transient: true }), {
		activeTab: "home",
		tabs: { home: { page: null }, tasks: { scope: "today" } },
		transient: true,
	});
	// What Obsidian saved for the task list before it became the core's Workbench.
	assert.deepEqual(readViewState({ scope: "today", activeTab: "tasks" }), { activeTab: "tasks", tabs: { tasks: { scope: "today" } }, transient: null });
	assert.deepEqual(readViewState({ scope: "tag:project", activeTab: "sessions" }), { activeTab: "sessions", tabs: { tasks: { scope: "tag:project" } }, transient: null });
	assert.deepEqual(readViewState({ scope: "all", tabs: { tasks: { scope: "upcoming" } } }).tabs, { tasks: { scope: "upcoming" } }, "the current format wins");
	assert.deepEqual(readViewState(null), { activeTab: null, tabs: {}, transient: null });
	assert.deepEqual(readViewState({ activeTab: "Bad id", tabs: { ok: 1, "Bad id": {}, list: [] } }), { activeTab: null, tabs: {}, transient: null });
});

test("which tab shows: the wanted one as soon as it exists, else the shown one, else the first", () => {
	// Restored on Home before the Home module started: Tasks shows meanwhile.
	assert.equal(chooseTab("home", null, ["tasks", "sessions"]), "tasks");
	assert.equal(chooseTab("home", "tasks", ["home", "tasks", "sessions"]), "home");
	// The shown tab's module stops: the next one; it comes back: the wanted one again.
	assert.equal(chooseTab("sessions", "sessions", ["home", "tasks"]), "home");
	assert.equal(chooseTab("sessions", "home", ["home", "tasks", "sessions"]), "sessions");
	assert.equal(chooseTab(null, "tasks", ["home", "tasks"]), "tasks");
	assert.equal(chooseTab(null, null, []), null);
});

test("at startup: one Workbench kept (pinned first), transient ones of the last session closed", () => {
	const b = (pinned: boolean, transient: boolean) => ({ pinned, transient });
	// The phone's saved layout, notes left out: the pinned Workbench (second tab), then a transient one.
	assert.deepEqual(startupPlan([b(true, false), b(false, true)], true), { keep: 0, close: [1], empty: [] });
	assert.deepEqual(startupPlan([b(false, true), b(false, false), b(true, false)], true), { keep: 2, close: [0], empty: [] }, "the pinned one, wherever it is");
	assert.deepEqual(startupPlan([b(false, true), b(false, false)], true), { keep: 1, close: [0], empty: [] }, "else one that is not transient");
	assert.deepEqual(startupPlan([b(false, true), b(false, true)], true), { keep: 0, close: [1], empty: [] }, "else a transient one, which stops being transient");
	assert.deepEqual(startupPlan([b(true, false), b(false, false)], true), { keep: 0, close: [], empty: [] }, "a second Workbench the user opened stays");
	assert.deepEqual(startupPlan([], true), { keep: -1, close: [], empty: [] });
	// "Never": nothing opens by itself, and transient Workbenches are empty tabs again.
	assert.deepEqual(startupPlan([b(true, false), b(false, true)], false), { keep: -1, close: [], empty: [1] });
});

test("at startup: a new tab's Workbench the user pinned is kept, like any lasting one", () => {
	const b = (pinned: boolean, transient: boolean) => ({ pinned, transient });
	// Ctrl/Cmd+T, then the tab pinned: its saved state still says transient.
	assert.deepEqual(startupPlan([b(true, false), b(true, true), b(false, true)], true), { keep: 0, close: [2], empty: [] }, "the startup Workbench first, the pinned new tab stays");
	assert.deepEqual(startupPlan([b(false, true), b(true, true)], true), { keep: 1, close: [0], empty: [] }, "pinned before unpinned");
	assert.deepEqual(startupPlan([b(false, false), b(true, true)], true), { keep: 1, close: [], empty: [] });
	assert.deepEqual(startupPlan([b(true, true), b(false, true)], false), { keep: -1, close: [], empty: [1] }, "\"Never\": a pinned one is not emptied");
});

test("Alt+1 ... Alt+9 pick the n-th tab, whatever the keyboard layout", () => {
	const ids = ["home", "tasks", "sessions"];
	const key = (code: string, extra: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; key: string }> = {}) =>
		altDigit({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code, ...extra });
	assert.equal(key("Digit2"), 2);
	assert.equal(key("Numpad3"), 3);
	assert.equal(key("", { key: "1" }), 1);
	assert.equal(key("Digit1", { key: "&" }), 1, "AZERTY: the physical key decides");
	assert.equal(key("Digit0"), null);
	assert.equal(key("Digit1", { ctrlKey: true }), null);
	assert.equal(key("Digit1", { shiftKey: true }), null);
	assert.equal(key("Digit1", { altKey: false }), null);
	const event = { altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code: "Digit2" };
	assert.equal(altDigit(event, { mac: false, typing: true }), 2, "in a field too (Tasks' quick add keeps its other keys)");
	assert.equal(altDigit(event, { mac: true, typing: false }), 2);
	assert.equal(altDigit(event, { mac: true, typing: true }), null, "macOS: Option and a digit type a character in a field");
	assert.equal(nthTab(ids, 2), "tasks");
	assert.equal(nthTab(ids, 4), null);
	assert.equal(nthTab(ids, 0), null);
});

test("a state for the tab already shown wins over its live state", () => {
	assert.deepEqual(reshow(undefined, true), { action: "keep", state: null }, "nothing asked for it: it stays as it is");
	assert.deepEqual(reshow(undefined, false), { action: "keep", state: null });
	assert.deepEqual(reshow({ page: "b" }, true), { action: "set", state: { page: "b" } });
	const asked = { page: "a" };
	const step = reshow(asked, false);
	assert.deepEqual(step, { action: "remount", state: { page: "a" } }, "a tab without setState is mounted again with the asked state");
	assert.notEqual(step.state, asked, "a copy: the tab cannot change the request");
});

// ----- opening a note -----

interface FakeLeaf {
	type: string;
	pinned?: boolean;
	opened: string[];
	view: { getViewType(): string };
	openFile(file: { path: string }): Promise<void>;
	getViewState(): { type: string; pinned?: boolean };
}

function fakeLeaf(type: string, pinned?: boolean): FakeLeaf {
	const leaf: FakeLeaf = {
		type,
		pinned,
		opened: [],
		view: { getViewType: () => leaf.type },
		async openFile(file) {
			leaf.opened.push(file.path);
			leaf.type = "markdown";
		},
		getViewState: () => ({ type: leaf.type, pinned: leaf.pinned }),
	};
	return leaf;
}

/** A workspace with these leaves (the first one the most recent); getLeaf() records what it was asked. */
function fakeApp(leaves: FakeLeaf[]) {
	const asked: Array<string | boolean | undefined> = [];
	const created: FakeLeaf[] = [];
	const file = Object.assign(new TFile(), { path: "Notes/Plan.md" });
	const app = {
		vault: { getAbstractFileByPath: (path: string) => (path === file.path ? file : null) },
		workspace: {
			iterateAllLeaves: (cb: (leaf: FakeLeaf) => void) => leaves.forEach(cb),
			getMostRecentLeaf: () => leaves[0] ?? null,
			getLeaf: (how?: string | boolean) => {
				asked.push(how);
				const leaf = fakeLeaf("empty");
				created.push(leaf);
				return leaf;
			},
			setActiveLeaf: () => undefined,
		},
	};
	return { app: app as unknown as App, asked, created };
}

const asLeaf = (leaf: FakeLeaf) => leaf as unknown as WorkspaceLeaf;

test("a note opened from a Workbench in a new tab takes its place", async () => {
	const wb = fakeLeaf(WORKBENCH_VIEW_TYPE);
	const { app, asked } = fakeApp([wb]);
	await openNoteAt(app, "Notes/Plan.md", 0, { replace: asLeaf(wb) });
	assert.deepEqual(wb.opened, ["Notes/Plan.md"]);
	assert.deepEqual(asked, []);
});

test("a pinned Workbench stays, even when it stood in a new tab: the note gets a new tab", async () => {
	const wb = fakeLeaf(WORKBENCH_VIEW_TYPE, true);
	const { app, asked, created } = fakeApp([wb]);
	await openNoteAt(app, "Notes/Plan.md", 0, { replace: asLeaf(wb) });
	assert.deepEqual(wb.opened, []);
	assert.deepEqual(asked, ["tab"]);
	assert.deepEqual(created[0].opened, ["Notes/Plan.md"]);
	// Without Obsidian's internal flag, the public view state tells.
	const quiet = fakeLeaf(WORKBENCH_VIEW_TYPE);
	Object.defineProperty(quiet, "pinned", { value: undefined });
	quiet.getViewState = () => ({ type: quiet.type, pinned: true });
	const second = fakeApp([quiet]);
	await openNoteAt(second.app, "Notes/Plan.md", 0, { replace: asLeaf(quiet) });
	assert.deepEqual(quiet.opened, []);
	// Unpinned again, it is a start page again.
	wb.pinned = false;
	await openNoteAt(app, "Notes/Plan.md", 0, { replace: asLeaf(wb) });
	assert.deepEqual(wb.opened, ["Notes/Plan.md"]);
});

test("Ctrl/Cmd always opens a new tab, and a leaf that is no longer a Workbench is never replaced", async () => {
	const wb = fakeLeaf(WORKBENCH_VIEW_TYPE);
	const { app, asked } = fakeApp([wb]);
	await openNoteAt(app, "Notes/Plan.md", 0, { replace: asLeaf(wb), event: { ctrlKey: true } as MouseEvent });
	assert.deepEqual(wb.opened, []);
	assert.deepEqual(asked, ["tab"]);
	const note = fakeLeaf("markdown");
	const other = fakeApp([note]);
	await openNoteAt(other.app, "Notes/Plan.md", 0, { replace: asLeaf(note) });
	assert.deepEqual(note.opened, []);
	assert.deepEqual(other.asked, [false]);
});
