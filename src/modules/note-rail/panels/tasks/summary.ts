// Pure counts of the vault summary at the top of the Open tasks panel (with the Tasks module).
import type { VaultTaskCounts } from "../../types";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Open tasks due before `today` (overdue) and on `today`, both "YYYY-MM-DD". Done tasks and tasks without a date do not count. */
export function countDue(tasks: Iterable<{ due: string | null; done: boolean }>, today: string): VaultTaskCounts {
	const out: VaultTaskCounts = { overdue: 0, today: 0 };
	for (const task of tasks) {
		if (task.done || !task.due || !DAY.test(task.due)) continue;
		if (task.due < today) out.overdue++;
		else if (task.due === today) out.today++;
	}
	return out;
}

/** The parts of the summary, in order: zero counts left out. Empty when there is nothing due. */
export function summaryParts(counts: VaultTaskCounts): Array<{ kind: "overdue" | "today"; count: number }> {
	const parts: Array<{ kind: "overdue" | "today"; count: number }> = [];
	if (counts.overdue > 0) parts.push({ kind: "overdue", count: counts.overdue });
	if (counts.today > 0) parts.push({ kind: "today", count: counts.today });
	return parts;
}

/**
 * The badge of the rail button: the tasks due today. With `withOverdue` (the "Include overdue in
 * the badge" setting), the overdue ones too, orange when there are some.
 */
export function dueBadge(counts: VaultTaskCounts, withOverdue = false): { count: number | null; warn: boolean } {
	const count = counts.today + (withOverdue ? counts.overdue : 0);
	return { count: count || null, warn: withOverdue && counts.overdue > 0 };
}
