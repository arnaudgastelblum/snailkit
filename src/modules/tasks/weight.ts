import { hasFlag } from "./group";
import type { Task } from "./types";

export type Weight = 0 | 1 | 2 | 3;

export function weightOf(task: Pick<Task, "priority">): Weight {
	return task.priority === "high" ? 0 : task.priority === "medium" ? 1 : task.priority === "low" ? 3 : 2;
}

export interface GroupFold {
	shown: Task[];
	lighter: Task[];
	waiting: Task[];
	someday: Task[];
}

export function foldGroup(tasks: readonly Task[], opts: { room: boolean; waitingFlag: string | null; somedayFlag: string | null; minShown?: number }): GroupFold {
	const result: GroupFold = { shown: [], lighter: [], waiting: [], someday: [] };
	const active: Task[] = [];
	for (const task of tasks) {
		if (opts.waitingFlag !== null && hasFlag(task, opts.waitingFlag)) result.waiting.push(task);
		else if (opts.somedayFlag !== null && hasFlag(task, opts.somedayFlag)) result.someday.push(task);
		else active.push(task);
	}
	let fill = (opts.minShown ?? 3) - active.filter((task) => weightOf(task) < 2).length;
	for (const task of active) {
		if (opts.room || weightOf(task) < 2) result.shown.push(task);
		else if (fill > 0) {
			result.shown.push(task);
			fill--;
		} else result.lighter.push(task);
	}
	return result;
}

/** Sort a copy; equal weights and tie breaks retain their input order. */
export function sortByWeight(tasks: readonly Task[], tieBreak: (a: Task, b: Task) => number): Task[] {
	return [...tasks].sort((a, b) => weightOf(a) - weightOf(b) || tieBreak(a, b));
}
