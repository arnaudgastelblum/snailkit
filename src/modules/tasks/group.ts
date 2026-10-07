// Pure ordering and grouping: the tag tree, sort modes, filters, Today and Upcoming, due labels.
import type { Priority, Task } from "./types";

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function tagParent(tag: string): string | null {
	const i = tag.lastIndexOf("/");
	return i < 0 ? null : tag.slice(0, i);
}

/** True for the tag itself and its nested tags: `project/website` is in `project`. */
export function inScope(tag: string, scope: string): boolean {
	return tag === scope || tag.startsWith(scope + "/");
}

// ----- dates (YYYY-MM-DD strings, computed in UTC so no time zone can shift a day) -----

export function isIsoDate(value: string): boolean {
	const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!m) return false;
	const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
	return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function toUtc(date: string): number {
	const [y, m, d] = date.split("-").map(Number);
	return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
	return fromUtc(toUtc(date) + days * 86400000);
}

export function daysBetween(from: string, to: string): number {
	return Math.round((toUtc(to) - toUtc(from)) / 86400000);
}

/** Monday of next week. */
export function nextWeek(today: string): string {
	const weekday = new Date(toUtc(today)).getUTCDay();
	return addDays(today, ((8 - weekday) % 7) || 7);
}

export type DueState = "overdue" | "today" | "soon" | "later";

export function dueState(due: string | null, today: string): DueState | null {
	if (!due) return null;
	if (due < today) return "overdue";
	if (due === today) return "today";
	return daysBetween(today, due) <= 6 ? "soon" : "later";
}

/** How to say a due date: relative words close to today, a weekday this week, else a date. */
export type DueLabel =
	| { kind: "today" | "tomorrow" | "yesterday" | "weekday" }
	| { kind: "overdue"; days: number }
	| { kind: "date"; sameYear: boolean };

export function dueLabel(due: string, today: string): DueLabel {
	const days = daysBetween(today, due);
	if (days === 0) return { kind: "today" };
	if (days === 1) return { kind: "tomorrow" };
	if (days === -1) return { kind: "yesterday" };
	if (days < 0) return { kind: "overdue", days: -days };
	if (days <= 6) return { kind: "weekday" };
	return { kind: "date", sameYear: due.slice(0, 4) === today.slice(0, 4) };
}

// ----- sorting -----

export function comparePriority(a: { priority: Priority | null }, b: { priority: Priority | null }): number {
	return (a.priority ? PRIORITY_RANK[a.priority] : 3) - (b.priority ? PRIORITY_RANK[b.priority] : 3);
}

/** Earliest first, no date last. */
export function compareDue(a: { due: string | null }, b: { due: string | null }): number {
	if (a.due === b.due) return 0;
	if (!a.due) return 1;
	if (!b.due) return -1;
	return a.due < b.due ? -1 : 1;
}

/** The order of the notes: note path, then line. */
export function compareNotes(a: { path: string; line: number }, b: { path: string; line: number }): number {
	if (a.path !== b.path) return a.path < b.path ? -1 : 1;
	return a.line - b.line;
}

/** Sorts tasks. "manual": the order the user dragged (`order`, task keys), then note order for the others. */
export function sortTasks(tasks: readonly Task[], mode: string, order: readonly string[] = []): Task[] {
	const rank = new Map(order.map((key, i) => [key, i]));
	const at = (t: Task) => rank.get(t.key) ?? Number.MAX_SAFE_INTEGER;
	const by =
		mode === "manual"
			? (a: Task, b: Task) => at(a) - at(b) || compareNotes(a, b)
			: mode === "priority"
			? (a: Task, b: Task) => comparePriority(a, b) || compareDue(a, b) || compareNotes(a, b)
			: mode === "due"
				? (a: Task, b: Task) => compareDue(a, b) || comparePriority(a, b) || compareNotes(a, b)
				: compareNotes;
	return tasks.slice().sort(by);
}

// ----- filters -----

/** Words of the query must all be in the title or the note path; a word starting with "#" matches tags by prefix. */
export function matchesQuery(task: Pick<Task, "title" | "path" | "tags">, query: string): boolean {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	const haystack = (task.title + " " + task.path).toLowerCase();
	return words.every((w) => (w.startsWith("#") ? task.tags.some((t) => t.startsWith(w.slice(1))) : haystack.includes(w)));
}

/** Priority filter: an empty list shows everything; "none" stands for tasks without priority. */
export function passesPriority(task: Pick<Task, "priority">, filter: readonly string[]): boolean {
	return !filter.length || filter.includes(task.priority ?? "none");
}

// ----- groups -----

export interface TagNode {
	tag: string;
	/** Last part of the tag: "website" for "project/website". */
	name: string;
	depth: number;
	/** Tasks whose group is exactly this tag. */
	own: Task[];
	children: TagNode[];
	/** Tasks of this tag and of its nested tags. */
	count: number;
}

/** Tag tree of the given tasks, nested tags inside their parent, alphabetical at each level. */
/**
 * The tag tree of these tasks. Siblings follow `order` (tags the user placed, dragged in the
 * navigator), then the others by name.
 */
export function buildTree(tasks: readonly Task[], order: readonly string[] = []): TagNode[] {
	const nodes = new Map<string, TagNode>();
	const node = (tag: string): TagNode => {
		let found = nodes.get(tag);
		if (!found) {
			const parts = tag.split("/");
			found = { tag, name: parts[parts.length - 1], depth: parts.length - 1, own: [], children: [], count: 0 };
			nodes.set(tag, found);
			const parent = tagParent(tag);
			if (parent) node(parent).children.push(found);
		}
		return found;
	};
	for (const t of tasks) {
		node(t.primary).own.push(t);
		for (let tag: string | null = t.primary; tag; tag = tagParent(tag)) node(tag).count++;
	}
	const rank = new Map(order.map((tag, i) => [tag, i]));
	const at = (n: TagNode) => rank.get(n.tag) ?? Number.MAX_SAFE_INTEGER;
	const byTag = (a: TagNode, b: TagNode) => at(a) - at(b) || a.tag.localeCompare(b.tag);
	for (const n of nodes.values()) n.children.sort(byTag);
	return [...nodes.values()].filter((n) => !tagParent(n.tag)).sort(byTag);
}

/**
 * The order after moving `item` before or after `target`, two siblings shown as `siblings` (in
 * their current order): tags of one level of the navigator, or tasks of one group. The siblings
 * are written in their new order; other entries keep theirs.
 */
export function moveInOrder(order: readonly string[], siblings: readonly string[], item: string, target: string, after: boolean): string[] {
	const next = siblings.filter((s) => s !== item);
	const i = next.indexOf(target);
	if (i < 0 || item === target) return [...order];
	next.splice(after ? i + 1 : i, 0, item);
	return [...order.filter((s) => !siblings.includes(s)), ...next];
}

export function findNode(nodes: readonly TagNode[], tag: string): TagNode | null {
	for (const n of nodes) {
		if (n.tag === tag) return n;
		const found = findNode(n.children, tag);
		if (found) return found;
	}
	return null;
}

/** Today view: overdue tasks (oldest first), then tasks due today (highest priority first). */
export function todayGroups(tasks: readonly Task[], today: string): { overdue: Task[]; today: Task[] } {
	return {
		overdue: tasks.filter((t) => t.due && t.due < today).sort((a, b) => compareDue(a, b) || comparePriority(a, b) || compareNotes(a, b)),
		today: tasks.filter((t) => t.due === today).sort((a, b) => comparePriority(a, b) || compareNotes(a, b)),
	};
}

/** Upcoming view: tasks due after today, one group per day, in date order. */
export function upcomingGroups(tasks: readonly Task[], today: string): Array<{ date: string; tasks: Task[] }> {
	const days = new Map<string, Task[]>();
	const later = tasks.filter((t) => t.due && t.due > today).sort((a, b) => compareDue(a, b) || comparePriority(a, b) || compareNotes(a, b));
	for (const t of later) {
		const list = days.get(t.due!) ?? [];
		list.push(t);
		days.set(t.due!, list);
	}
	return [...days].map(([date, list]) => ({ date, tasks: list }));
}

export interface Counts {
	all: number;
	overdue: number;
	/** Overdue or due today: what the Today view shows. */
	today: number;
	upcoming: number;
}

export function countTasks(tasks: readonly Task[], today: string): Counts {
	let overdue = 0;
	let dueToday = 0;
	let upcoming = 0;
	for (const t of tasks) {
		if (!t.due) continue;
		if (t.due < today) overdue++;
		else if (t.due === today) dueToday++;
		else upcoming++;
	}
	return { all: tasks.length, overdue, today: overdue + dueToday, upcoming };
}

/** A stable hue for a tag (FNV-1a hash), used when no other module colors tags. */
export function fallbackHue(tag: string): number {
	let h = 0x811c9dc5;
	for (const c of tag) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193) >>> 0;
	return ((h % 14) * 360) / 14 + 18;
}
