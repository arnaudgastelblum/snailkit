// Pure part of the idea sessions panel: which sessions wait to be sorted. Tested in test/note-rail.test.ts.
import type { SessionEntry } from "../../types";

/** How many sessions to sort the panel lists at most. */
export const TO_SORT_MAX = 5;

/** Sessions to sort, newest first, `max` at most. Entries that are not well formed are skipped. */
export function sessionsToSort(list: readonly SessionEntry[] | null | undefined, max = TO_SORT_MAX): SessionEntry[] {
	if (!Array.isArray(list)) return [];
	return (list as readonly SessionEntry[])
		.filter((s) => !!s && s.state === "to-sort" && typeof s.path === "string" && typeof s.title === "string")
		.slice()
		.sort((a, b) => (Number(b.created) || 0) - (Number(a.created) || 0) || a.title.localeCompare(b.title))
		.slice(0, Math.max(0, max));
}

/** How many sessions wait to be sorted in all. */
export function toSortCount(list: readonly SessionEntry[] | null | undefined): number {
	return Array.isArray(list) ? (list as readonly SessionEntry[]).filter((s) => !!s && s.state === "to-sort").length : 0;
}
