// Defaults and pure helpers that read the settings safely (stored values may be hand-edited).
import { BUTTON_IDS, type ButtonId, type NoteRailSettings } from "./types";

export const DEFAULT_SETTINGS: NoteRailSettings = {
	showToc: true,
	showBookmarks: true,
	showTasks: true,
	showCalendar: true,
	buttonOrder: [...BUTTON_IDS],
	position: "left",
	mobilePosition: "right",
	restOpacity: 0.5,
	openOnHover: true,
	tocHoverPreview: true,
	tocHoverDelay: 100,
	tocMaxLevel: 6,
	pinsKey: "pins",
	vaultPins: [],
	vaultPinFolders: [],
	bookmarksTips: 0,
	showPlace: true,
	tasksIncludePinned: true,
	tasksIncludeVaultPins: false,
	tasksBadge: true,
	badgeOverdue: false,
	calendarWeekStart: "monday",
	calendarWeekNumbers: true,
	calendarTaskDots: true,
	calendarConfirmCreate: false,
	calendarFolder: "",
	calendarFormat: "",
	calendarTemplate: "",
};

/** The setting that shows or hides each panel the user can turn off. */
export const SHOW_KEY: Record<ButtonId | "calendar", "showToc" | "showBookmarks" | "showTasks" | "showCalendar"> = {
	toc: "showToc",
	bookmarks: "showBookmarks",
	tasks: "showTasks",
	calendar: "showCalendar",
};

/**
 * Valid button ids in the stored order, each once, missing ones appended in default order.
 * "calendar" (a rail button until 0.2.8, a row of the Snailkit menu since) is dropped.
 */
export function railOrder(stored: unknown): ButtonId[] {
	const out: ButtonId[] = [];
	if (Array.isArray(stored)) {
		for (const id of stored) if (BUTTON_IDS.includes(id as ButtonId) && !out.includes(id as ButtonId)) out.push(id as ButtonId);
	}
	for (const id of BUTTON_IDS) if (!out.includes(id)) out.push(id);
	return out;
}

/** `order` with `id` moved one step up (-1) or down (+1). Unchanged at the ends. */
export function moveInOrder(order: ButtonId[], id: ButtonId, step: -1 | 1): ButtonId[] {
	const next = order.slice();
	const from = next.indexOf(id);
	const to = from + step;
	if (from < 0 || to < 0 || to >= next.length) return next;
	[next[from], next[to]] = [next[to], next[from]];
	return next;
}

export const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
	typeof value === "number" && isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Property name of the note pins: the setting trimmed, `pins` when empty. */
export function pinsKey(settings: NoteRailSettings): string {
	return (typeof settings.pinsKey === "string" && settings.pinsKey.trim()) || "pins";
}

/** Vault pins as stored: strings only, no blanks, no duplicates, order kept. */
export function cleanVaultPins(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return Array.from(new Set(value.filter((p): p is string => typeof p === "string" && p.trim() !== "")));
}

/**
 * Vault pins after a rename (`to` = new path) or a delete (`to` = null) of a file or a folder at
 * `from`. Returns null when nothing changes.
 */
export function remapVaultPins(pins: string[], from: string, to: string | null, isFile: boolean): string[] | null {
	const next: string[] = [];
	for (const p of pins) {
		const hit = isFile ? p === from : p.startsWith(from + "/");
		if (!hit) next.push(p);
		else if (to !== null) next.push(isFile ? to : to + p.slice(from.length));
	}
	const unique = Array.from(new Set(next));
	return unique.length === pins.length && unique.every((p, i) => p === pins[i]) ? null : unique;
}
