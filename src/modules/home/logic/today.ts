// The "Today" row of the Home: today's note, tasks overdue and due today, brainstorms to sort,
// tasks left in older daily notes. A chip with nothing to say is not shown. Pure.

export interface DueCounts {
	overdue: number;
	today: number;
}

/** Open tasks due before `today` (overdue) and on `today` ("YYYY-MM-DD"). Undated and done tasks do not count. */
export function dueCounts(tasks: Iterable<{ due: string | null; done: boolean }>, today: string): DueCounts {
	const out: DueCounts = { overdue: 0, today: 0 };
	for (const task of tasks) {
		if (task.done || !task.due || !/^\d{4}-\d{2}-\d{2}$/.test(task.due)) continue;
		if (task.due < today) out.overdue++;
		else if (task.due === today) out.today++;
	}
	return out;
}

export type TodayChip =
	| { kind: "daily"; exists: boolean }
	| { kind: "due"; overdue: number; today: number }
	| { kind: "brainstorms"; count: number }
	| { kind: "old"; count: number };

export interface TodayInput {
	/** Whether today's note exists (the chip is there either way: it creates the note). */
	daily: boolean;
	/** Null without the Tasks module. */
	due: DueCounts | null;
	/** Brainstorms to sort; null without the Brainstorm module. */
	toSort: number | null;
	/** Open tasks in daily notes before today; null without the Tasks module. */
	old: number | null;
}

/** The chips of the Today row, in their order, empty ones left out. */
export function todayChips(input: TodayInput): TodayChip[] {
	const out: TodayChip[] = [{ kind: "daily", exists: input.daily }];
	if (input.due && (input.due.overdue || input.due.today)) out.push({ kind: "due", overdue: input.due.overdue, today: input.due.today });
	if (input.toSort) out.push({ kind: "brainstorms", count: input.toSort });
	if (input.old) out.push({ kind: "old", count: input.old });
	return out;
}

export interface OldDailyGroup<T> {
	path: string;
	/** "YYYY-MM-DD" of the daily note. */
	day: string;
	tasks: T[];
}

/**
 * Open tasks in daily notes older than today, grouped by note, the newest note first, tasks in
 * note order. `dayOf` gives the day of a daily note ("YYYY-MM-DD"), null for other notes.
 */
export function oldDailyTasks<T extends { path: string; line: number; done: boolean }>(tasks: Iterable<T>, dayOf: (path: string) => string | null, today: string, keep?: (task: T) => boolean): OldDailyGroup<T>[] {
	const groups = new Map<string, OldDailyGroup<T>>();
	for (const task of tasks) {
		if (task.done && !keep?.(task)) continue;
		const day = dayOf(task.path);
		if (!day || day >= today) continue;
		let group = groups.get(task.path);
		if (!group) groups.set(task.path, (group = { path: task.path, day, tasks: [] }));
		group.tasks.push(task);
	}
	const out = [...groups.values()].sort((a, b) => b.day.localeCompare(a.day) || a.path.localeCompare(b.path));
	for (const group of out) group.tasks.sort((a, b) => a.line - b.line);
	return out;
}

/** Brainstorms waiting to be sorted. */
export function toSortCount(list: Iterable<{ state: string }>): number {
	let n = 0;
	for (const entry of list) if (entry.state === "to-sort") n++;
	return n;
}
