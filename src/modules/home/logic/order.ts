// The order of the notes under a parent on the Map, once the user has dragged one: kept per parent
// in the Home settings (`noteOrder`, a list of [parent path, child paths]), never in the notes.
// Children the user never placed (new notes, notes moved in) come first, in the Map's own order;
// the placed ones follow in the order made. Paths follow renames and are forgotten on delete. Pure.

export type NoteOrder = Array<[string, string[]]>;

/** Children in display order: the unplaced ones first (in `natural` order), then the saved order. */
export function applyOrder(natural: readonly string[], saved: readonly string[] | undefined): string[] {
	if (!saved?.length) return [...natural];
	const present = new Set(natural);
	const placed = saved.filter((path, i) => present.has(path) && saved.indexOf(path) === i);
	const known = new Set(placed);
	return [...natural.filter((path) => !known.has(path)), ...placed];
}

/** `list` with `id` moved before `before` (null: to the end). Unchanged when `id` is not in it. */
export function moveBefore(list: readonly string[], id: string, before: string | null): string[] {
	if (!list.includes(id) || id === before) return [...list];
	const rest = list.filter((path) => path !== id);
	const at = before === null ? -1 : rest.indexOf(before);
	if (at < 0) rest.push(id);
	else rest.splice(at, 0, id);
	return rest;
}

/** The saved order of one parent, or undefined. */
export function orderOf(order: NoteOrder, parent: string): string[] | undefined {
	return order.find(([p]) => p === parent)?.[1];
}

/** The settings' order with the children of `parent` saved as `children`. */
export function withOrder(order: NoteOrder, parent: string, children: readonly string[]): NoteOrder {
	const rest = order.filter(([p]) => p !== parent);
	return children.length ? [...rest, [parent, [...children]]] : rest;
}

/** Only well formed entries, each parent once, each child once. */
export function cleanOrder(value: unknown): NoteOrder {
	if (!Array.isArray(value)) return [];
	const out: NoteOrder = [];
	const parents = new Set<string>();
	for (const entry of value) {
		if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Array.isArray(entry[1]) || parents.has(entry[0])) continue;
		const kids = [...new Set((entry[1] as unknown[]).filter((p): p is string => typeof p === "string" && p !== ""))];
		if (!kids.length) continue;
		parents.add(entry[0]);
		out.push([entry[0], kids]);
	}
	return out;
}

/** True when a path appears in the order (as a parent or a child). */
export function orderMentions(order: NoteOrder, path: string): boolean {
	return order.some(([parent, kids]) => parent === path || kids.includes(path));
}

/** A renamed note keeps its place (and its children's order). */
export function renameInOrder(order: NoteOrder, from: string, to: string): NoteOrder {
	return order.map(([parent, kids]) => [parent === from ? to : parent, kids.map((p) => (p === from ? to : p))]);
}

/** A deleted note is forgotten (as a parent and as a child). */
export function dropFromOrder(order: NoteOrder, path: string): NoteOrder {
	return order
		.filter(([parent]) => parent !== path)
		.map(([parent, kids]): [string, string[]] => [parent, kids.filter((p) => p !== path)])
		.filter(([, kids]) => kids.length > 0);
}
