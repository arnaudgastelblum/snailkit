// Pure rules of the Workbench: tab ids and order, the state a Workbench keeps in the saved
// workspace (and the format the Tasks module used before), and which tab a Workbench shows.
// Tested in test/workbench.test.ts.
import type { App, WorkspaceLeaf } from "obsidian";
import { TAB_ORDER, type TabState } from "./types";

/** Tab ids: a-z and "-", starting with a letter. */
export const TAB_ID_RE = /^[a-z][a-z-]*$/;

/** Ids that belong to Snailkit's own modules: companion plugins cannot take them. */
export const BUILT_IN_TABS: readonly string[] = ["home", "tasks", "sessions"];

/** What a Workbench keeps in the saved workspace. */
export interface WorkbenchViewState {
	/** The tab shown (or wanted: a tab whose module has not started yet). "" for none. */
	activeTab: string;
	/** The last state of each tab of this Workbench. */
	tabs: Record<string, TabState>;
	/** A Workbench standing in a new tab: opening a note replaces it. */
	transient?: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a saved state, in the current format or in the Tasks module's former one
 * (`{ scope, activeTab }`, where `scope` was the scope of the task list). Unknown values are dropped.
 */
export function readViewState(raw: unknown): { activeTab: string | null; tabs: Record<string, TabState>; transient: boolean | null } {
	const out: { activeTab: string | null; tabs: Record<string, TabState>; transient: boolean | null } = { activeTab: null, tabs: {}, transient: null };
	if (!isObject(raw)) return out;
	if (typeof raw.activeTab === "string" && TAB_ID_RE.test(raw.activeTab)) out.activeTab = raw.activeTab;
	if (isObject(raw.tabs)) {
		for (const [id, state] of Object.entries(raw.tabs)) if (TAB_ID_RE.test(id) && isObject(state)) out.tabs[id] = { ...state };
	}
	if (typeof raw.scope === "string" && !out.tabs.tasks) out.tabs.tasks = { scope: raw.scope };
	if (typeof raw.transient === "boolean") out.transient = raw.transient;
	return out;
}

/** Order of registered tabs: by `order` (TAB_ORDER.other when missing), then by arrival. */
export function sortTabs<T extends { order?: number }>(entries: Array<{ tab: T; seq: number }>): T[] {
	return [...entries]
		.sort((a, b) => (a.tab.order ?? TAB_ORDER.other) - (b.tab.order ?? TAB_ORDER.other) || a.seq - b.seq)
		.map((entry) => entry.tab);
}

/**
 * The tab a Workbench shows: the wanted one when registered, else the one it shows now when still
 * registered, else the first. Null when no tab exists.
 */
export function chooseTab(wanted: string | null, shown: string | null, available: readonly string[]): string | null {
	if (wanted && available.includes(wanted)) return wanted;
	if (shown && available.includes(shown)) return shown;
	return available[0] ?? null;
}

/**
 * A view state reaches the tab already shown (back or forward arrows, open() with a state).
 * Nothing asked for that tab: it stays as it is ("keep"). Else the asked state wins over the tab's
 * live one: the tab goes there by itself when it can ("set"), or is mounted again with it
 * ("remount"; its live state must not be saved over the asked one on the way).
 */
export function reshow(asked: TabState | undefined, canSet: boolean): { action: "keep" | "set" | "remount"; state: TabState | null } {
	if (!asked) return { action: "keep", state: null };
	return { action: canSet ? "set" : "remount", state: { ...asked } };
}

/** The tab of Alt+1 ... Alt+9 (`digit` 1-9), or null. */
export function nthTab(available: readonly string[], digit: number): string | null {
	return Number.isInteger(digit) && digit >= 1 && digit <= 9 ? available[digit - 1] ?? null : null;
}

/**
 * The digit of Alt+1 ... Alt+9 (keyboard layouts differ: the physical key decides), or null.
 * `where.mac` and `where.typing`: on macOS, Option and a digit type a character in a field
 * (for example "¡" or "£"), so there the field keeps the key.
 */
export function altDigit(
	event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code?: string; key?: string },
	where: { mac?: boolean; typing?: boolean } = {},
): number | null {
	if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
	if (where.mac && where.typing) return null;
	const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code ?? "") ?? /^([1-9])$/.exec(event.key ?? "");
	return match ? Number(match[1]) : null;
}

/**
 * At Obsidian's startup, what becomes of the Workbenches restored in the main area (given in tab
 * order). A transient Workbench the user pinned counts as a lasting one: pinning says "keep this
 * tab" (and opening a note from it already leaves it in place).
 * `keep`: the one that becomes the startup Workbench (a pinned one first, the startup Workbench
 * of the last session before a pinned new tab; else any lasting one; else a transient one), or -1
 * when none was restored. `close`: the transient ones left (new tabs of the last session showing
 * Home): the kept Workbench stands for them, and nothing of them is worth keeping. With
 * `autoOpen` false (the setting is "Never"), nothing is kept as a startup Workbench and every
 * transient one goes back to being an empty tab (`empty`).
 */
export function startupPlan(benches: ReadonlyArray<{ pinned: boolean; transient: boolean }>, autoOpen: boolean): { keep: number; close: number[]; empty: number[] } {
	const transient = benches.map((b, i) => (b.transient && !b.pinned ? i : -1)).filter((i) => i >= 0);
	if (!autoOpen) return { keep: -1, close: [], empty: transient };
	let keep = benches.findIndex((b) => b.pinned && !b.transient);
	if (keep < 0) keep = benches.findIndex((b) => b.pinned);
	if (keep < 0) keep = benches.findIndex((b) => !b.transient);
	if (keep < 0) keep = transient[0] ?? -1;
	return { keep, close: transient.filter((i) => i !== keep), empty: [] };
}

/** True when the leaf is in the left or right side panel (not the main area or a popout window). */
export function isSideLeaf(app: App, leaf: WorkspaceLeaf): boolean {
	const root = leaf.getRoot();
	return root === app.workspace.leftSplit || root === app.workspace.rightSplit;
}
