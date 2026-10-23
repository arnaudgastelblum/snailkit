// What the shared tag picker offers for a task of a note: the tag tree of the navigator, and the
// tags already used around the note (its task, its tasks, its own tags, then the notes above it,
// up to its area). Read by Tag colors, Brainstorm and the Tasks tab through `tagChoices`.
import { getAllTags, TFile } from "obsidian";
import type { PlacesService } from "../../core/places/types";
import { isTagName, type TagAround, type TagPlace, type TagTreeEntry } from "../../ui/tag-picker/logic";
import { buildTree, type TagNode } from "./group";
import { plainTitle } from "./parse";
import type { TaskIndex } from "./task-index";
import type { Context } from "./types";

export type { TagAround, TagPlace, TagTreeEntry };

export interface TagChoices {
	/** Every group tag of the open tasks, as the Tasks navigator shows them: parents before their sub-tags, siblings in the user's order. */
	tree: TagTreeEntry[];
	/** Up to 3 group tags used around the note, nearest first. Empty without a note. */
	around: TagAround[];
}

/** The tree of the navigator, a tag before its sub-tags. */
export function flatTree(nodes: readonly TagNode[]): TagTreeEntry[] {
	return nodes.flatMap((node) => [
		{ tag: node.tag, depth: node.depth, count: node.count },
		...flatTree(node.children),
	]);
}

/**
 * The rows of the tree a task can take as its group. The tree makes a parent for each nested tag:
 * `high` for `high/project`, `2026` for `2026/plan`; a priority, a flag or a name Tasks cannot read
 * back would leave the task without a group, so it is left out and its sub-tags move up a level.
 */
export function choosableTree(entries: readonly TagTreeEntry[], flags: ReadonlySet<string>): TagTreeEntry[] {
	const kept = new Set<string>();
	const out: TagTreeEntry[] = [];
	for (const entry of entries) {
		const tag = entry.tag.toLowerCase();
		if (!isTagName(tag) || !/^[\p{L}\p{N}_]/u.test(tag) || flags.has(tag)) continue;
		const parts = tag.split("/");
		let depth = 0;
		for (let i = 1; i < parts.length; i++) if (kept.has(parts.slice(0, i).join("/"))) depth++;
		kept.add(tag);
		out.push({ ...entry, depth });
	}
	return out;
}

/**
 * The tags used around a note, nearest first, each once: the tag of the task whose note it is,
 * the tags of its tasks (most used first), its own tags that a task uses, then for each parent
 * (`levels`, nearest first) the tags of the tasks in it and in the notes below it. A tag of the
 * note also used above says where (its count is more telling than "tag of the note").
 */
export function aroundTags(input: {
	path: string;
	tasks: readonly { path: string; primary: string }[];
	owner?: { tag: string; title: string } | null;
	noteTags?: readonly string[];
	levels?: readonly { path: string; name: string }[];
	chainOf?(path: string): readonly string[];
	limit?: number;
}): TagAround[] {
	const result: TagAround[] = [];
	const seen = new Set<string>();
	const limit = input.limit ?? 3;
	const full = () => result.length >= limit;
	const add = (tag: string, where: TagPlace) => {
		tag = tag.toLowerCase();
		if (!tag || seen.has(tag) || full()) return;
		seen.add(tag);
		result.push({ tag, where });
	};
	const grouped = (matches: (path: string) => boolean) => {
		const counts = new Map<string, number>();
		for (const task of input.tasks) {
			if (!matches(task.path)) continue;
			const tag = task.primary.toLowerCase();
			if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
		return [...counts].sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b));
	};
	if (limit <= 0) return result;
	if (input.owner) add(input.owner.tag, { kind: "task", title: input.owner.title });
	if (full()) return result;
	for (const [tag, count] of grouped((path) => path === input.path)) add(tag, { kind: "here", count });
	if (full()) return result;
	// The parents, read only from here: each with the tags of the tasks in it and below it.
	const levels = (input.levels ?? []).map((level) => ({ level, tags: grouped((path) => path === level.path || !!input.chainOf?.(path).includes(level.path)) }));
	const above = (level: { path: string; name: string }, count: number): TagPlace => ({ kind: "above", name: level.name, path: level.path, count });
	const used = new Set(input.tasks.map((task) => task.primary.toLowerCase()));
	for (const tag of input.noteTags ?? []) {
		const key = tag.toLowerCase();
		if (!used.has(key)) continue;
		const at = levels.find((l) => l.tags.some(([t]) => t === key));
		add(key, at ? above(at.level, at.tags.find(([t]) => t === key)![1]) : { kind: "note" });
	}
	for (const { level, tags } of levels) {
		if (full()) break;
		// A tag seldom used there (under a quarter of the most used one) says little about the note.
		const top = tags[0]?.[1] ?? 0;
		for (const [tag, count] of tags) if (count * 4 >= top) add(tag, above(level, count));
	}
	return result;
}

/** The tree and the tags around the note `path` (none without a note); the parents come from the places service. */
export function tagChoices(index: TaskIndex, ctx: Context | undefined, path: string | null): TagChoices {
	const tree = choosableTree(flatTree(buildTree(index.open(), ctx?.settings.tagOrder ?? [])), index.flags());
	const file = path === null ? null : ctx?.app.vault.getAbstractFileByPath(path);
	if (!ctx || !(file instanceof TFile)) return { tree, around: [] };
	const owner = index.ownerOf(file.path);
	const cache = ctx.app.metadataCache.getFileCache(file);
	const input = {
		path: file.path,
		tasks: index.list,
		owner: owner ? { tag: owner.primary, title: plainTitle(owner.title) } : null,
		noteTags: (cache ? getAllTags(cache) ?? [] : []).map((tag) => tag.replace(/^#/, "")),
	};
	try {
		const places = ctx.service<PlacesService>("places");
		if (places?.version === 1) {
			const { chain, area } = places.placeOf(file);
			const end = area ? chain.findIndex((parent) => parent.path === area.path) : -1;
			const levels = chain.slice(0, end + 1).map((parent) => ({ path: parent.path, name: parent.basename }));
			const chains = new Map<string, readonly string[]>([[file.path, chain.map((parent) => parent.path)]]);
			const chainOf = (path: string): readonly string[] => {
				let paths = chains.get(path);
				if (!paths) {
					const note = ctx.app.vault.getAbstractFileByPath(path);
					paths = note instanceof TFile ? places.placeOf(note).chain.map((parent) => parent.path) : [];
					chains.set(path, paths);
				}
				return paths;
			};
			return { tree, around: aroundTags({ ...input, levels, chainOf }) };
		}
	} catch {
		// Local tags remain available when places cannot be read.
	}
	return { tree, around: aroundTags(input) };
}
