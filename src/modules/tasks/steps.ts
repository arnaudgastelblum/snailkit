// Steps: the checkboxes written in a task note (the note a task links with 📝) are the steps of
// that task. Read from the link alone (no metadata cache), so the index can tell it at once.
import type { Task } from "./types";

/** "Tasks/Task - Fix.md" -> "tasks/task - fix": how a link target and a note path are compared. */
function linkKey(target: string): string {
	return target.replace(/\.md$/i, "").replace(/^\/+/, "").toLowerCase();
}

/** The open tasks of `tasks` that link a task note, by link target (the first one wins). */
export function noteOwners(tasks: readonly Task[]): Map<string, Task> {
	const owners = new Map<string, Task>();
	for (const t of tasks) {
		if (t.done || !t.primary || !t.noteLink) continue;
		const key = linkKey(t.noteLink);
		if (!owners.has(key)) owners.set(key, t);
	}
	return owners;
}

/** The open task whose 📝 note is `path`: linked by its full path, or by its bare name. */
export function ownerOf(owners: ReadonlyMap<string, Task>, path: string): Task | null {
	const full = linkKey(path);
	return owners.get(full) ?? owners.get(full.replace(/^.*\//, "")) ?? null;
}

/**
 * The task `t` is a step of: the owner of its note, when `t` has no tag or the owner's tag (or one
 * below it). A checkbox given another tag on purpose stands on its own.
 */
export function stepParent(owner: Task | null, t: Task): Task | null {
	if (!owner || owner.key === t.key || owner.path === t.path) return null;
	if (t.primary && t.primary !== owner.primary && !t.primary.startsWith(owner.primary + "/")) return null;
	return owner;
}

