// Recently opened notes (opened, not modified: a sync touching a note does not lift it). Kept
// per device in Obsidian's local storage, never in data.json. Pure.
import { dayKey, daysBetween } from "./dates";

export interface Recent {
	path: string;
	/** When it was opened (ms); 0 when unknown (taken from Obsidian's own list at first use). */
	at: number;
}

/** How many notes the Home shows; a few more are kept so that deleted ones leave no gap. */
export const RECENTS_SHOWN = 10;
export const RECENTS_KEPT = 20;

export type RecentGroup = "today" | "yesterday" | "week" | "earlier";
export const RECENT_GROUPS: RecentGroup[] = ["today", "yesterday", "week", "earlier"];

/** What was stored, cleaned: valid entries, each path once, newest first. */
export function cleanRecents(raw: unknown): Recent[] {
	if (!Array.isArray(raw)) return [];
	const out: Recent[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const { path, at } = item as { path?: unknown; at?: unknown };
		if (typeof path !== "string" || !path || out.some((r) => r.path === path)) continue;
		out.push({ path, at: typeof at === "number" && Number.isFinite(at) && at > 0 ? at : 0 });
		if (out.length >= RECENTS_KEPT) break;
	}
	return out;
}

/** Obsidian's own list of last opened files (newest first), when nothing is stored yet. */
export function seedRecents(paths: readonly string[]): Recent[] {
	return cleanRecents(paths.filter((p) => p.endsWith(".md")).map((path) => ({ path, at: 0 })));
}

/** A note was opened now. */
export function pushRecent(list: readonly Recent[], path: string, at: number): Recent[] {
	return [{ path, at }, ...list.filter((r) => r.path !== path)].slice(0, RECENTS_KEPT);
}

export function renameRecent(list: readonly Recent[], from: string, to: string): Recent[] {
	return cleanRecents(list.map((r) => (r.path === from ? { ...r, path: to } : r)));
}

export function dropRecent(list: readonly Recent[], path: string): Recent[] {
	return list.filter((r) => r.path !== path);
}

export function groupOfRecent(at: number, now: number): RecentGroup {
	if (!at) return "earlier";
	const days = daysBetween(dayKey(at), dayKey(now));
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	if (days < 7) return "week";
	return "earlier";
}

/** The notes shown (existing ones, RECENTS_SHOWN at most), grouped Today, Yesterday, This week, Earlier; empty groups left out. */
export function groupRecents(list: readonly Recent[], now: number, exists: (path: string) => boolean = () => true): Array<{ group: RecentGroup; items: Recent[] }> {
	const shown = list.filter((r) => exists(r.path)).slice(0, RECENTS_SHOWN);
	return RECENT_GROUPS.map((group) => ({ group, items: shown.filter((r) => groupOfRecent(r.at, now) === group) })).filter((g) => g.items.length);
}
