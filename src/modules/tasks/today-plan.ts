import { addDays, compareDue, compareNotes, comparePriority, daysBetween } from "./group";
import type { Task } from "./types";

/** Dates and windows used by the morning triage. */
export interface LookOptions {
	today: string;
	firstSeen: ReadonlyMap<string, string>;
	later: ReadonlyMap<string, string>;
	soonDays?: number;
	newDays?: number;
}

/** Tasks worth reviewing, grouped by their first matching reason. */
export interface Look { soon: Task[]; high: Task[]; fresh: Task[] }

/** Selects and sorts open, unparked tasks for Worth a look. */
export function worthALook(tasks: readonly Task[], o: LookOptions): Look {
	const result: Look = { soon: [], high: [], fresh: [] };
	const soonUntil = addDays(o.today, o.soonDays ?? 7);
	for (const task of tasks) {
		if ((o.later.get(task.key) ?? "") > o.today) continue;
		if (task.due !== null && task.due <= o.today) continue;
		if (task.due !== null && task.due <= soonUntil) {
			result.soon.push(task);
			continue;
		}
		if (task.priority === "high" && task.due === null) {
			result.high.push(task);
			continue;
		}
		const seen = o.firstSeen.get(task.key);
		if (seen && Math.max(0, daysBetween(seen, o.today)) < (o.newDays ?? 3)
			&& task.priority === null && task.due === null) {
			result.fresh.push(task);
		}
	}
	result.soon.sort((a, b) => compareDue(a, b) || comparePriority(a, b) || compareNotes(a, b));
	result.high.sort(compareNotes);
	result.fresh.sort((a, b) => {
		const aSeen = o.firstSeen.get(a.key)!;
		const bSeen = o.firstSeen.get(b.key)!;
		return (aSeen === bSeen ? 0 : aSeen > bSeen ? -1 : 1) || compareNotes(a, b);
	});
	return result;
}

function pairsChanged(prev: ReadonlyArray<readonly [string, string]>, next: Array<[string, string]>): boolean {
	return prev.length !== next.length || next.some(([key, date], i) => prev[i][0] !== key || prev[i][1] !== date);
}

/** Retains known dates and records each current key once, in current key order. */
export function updateFirstSeen(prev: ReadonlyArray<readonly [string, string]>, keys: readonly string[], today: string, seeding: boolean): { next: Array<[string, string]>; changed: boolean } {
	const known = new Map(prev);
	const next: Array<[string, string]> = [...new Set(keys)].map((key) => [key, known.get(key) ?? (seeding ? "" : today)]);
	return { next, changed: pairsChanged(prev, next) };
}

/** Default number of days to hide a task from Worth a look. */
export const LATER_DAYS = 3;

/** Returns the day on which a deferred task comes back. */
export function laterUntil(today: string, days = LATER_DAYS): string {
	return addDays(today, days);
}

/** Keeps current tasks with an unexpired deferral, preserving pair order. */
export function pruneLater(prev: ReadonlyArray<readonly [string, string]>, keys: readonly string[], today: string): { next: Array<[string, string]>; changed: boolean } {
	const current = new Set(keys);
	const next: Array<[string, string]> = prev
		.filter(([key, until]) => current.has(key) && until > today)
		.map(([key, until]) => [key, until]);
	return { next, changed: pairsChanged(prev, next) };
}
