// Moving a note under another one: the only place where Snailkit writes a note's parent. It sets
// the parent property in the note's properties (frontmatter) through Obsidian, never its body,
// and returns how to put the old value back. The pure parts (which key, which value, loops) are
// tested in test/places.test.ts.
import type { App, TFile } from "obsidian";
import { linkpathOf, PARENT_KEYS } from "./rule";

/**
 * The property to write in these properties: the parent key the rule reads now (with its exact
 * spelling), else a parent key present but empty, else "up". So a note that has `parent` or
 * `moc` keeps that key instead of getting a second one.
 */
export function parentKeyIn(frontmatter: Record<string, unknown> | null | undefined): string {
	if (!frontmatter) return "up";
	const keys = Object.keys(frontmatter);
	const find = (key: string) => keys.find((k) => k.toLowerCase() === key);
	for (const key of PARENT_KEYS) {
		const found = find(key);
		if (found && linkpathOf(frontmatter[found])) return found;
	}
	for (const key of PARENT_KEYS) {
		const found = find(key);
		if (found) return found;
	}
	return "up";
}

/** The new value of the parent property: the link, or a list whose first item becomes the link. */
export function parentValue(old: unknown, link: string): unknown {
	if (Array.isArray(old) && old.length > 1) return [link, ...(old as unknown[]).slice(1)];
	return link;
}

/**
 * True when hanging `moved` under `target` would make a loop: `target` is `moved` itself or one
 * of the notes below it (its parents lead back to `moved`).
 */
export function wouldLoop(moved: string, target: string, parentOf: (path: string) => string | null): boolean {
	// The whole chain, however deep: `seen` ends the walk on a loop that does not pass through `moved`.
	const seen = new Set<string>();
	let current: string | null = target;
	while (current !== null && !seen.has(current)) {
		if (current === moved) return true;
		seen.add(current);
		current = parentOf(current);
	}
	return false;
}

/** "[[Name]]" for the target as seen from the note: the shortest link that finds it (the name alone when unique). */
export function parentLink(app: App, sourcePath: string, target: TFile): string {
	try {
		const link = app.fileManager.generateMarkdownLink(target, sourcePath);
		if (/^\[\[[^\]]+\]\]$/.test(link)) return link.replace(/\|[^\]]*\]\]$/, "]]");
	} catch {
		/* a plain wiki link below */
	}
	const text = app.metadataCache.fileToLinktext(target, sourcePath, true);
	return `[[${text}]]`;
}

/** Same property value (lists and objects compared by content). */
export function sameValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Undo of a move, decided on the properties as they are now: put back the old value (or remove
 * the key when it was not there) only while the key still holds what the move wrote. Returns
 * false, changing nothing, when the user or a sync changed it since. Pure; mutates `fm`.
 */
export function undoParent(fm: Record<string, unknown>, change: { key: string; had: boolean; before: unknown; written: unknown }): boolean {
	const has = Object.prototype.hasOwnProperty.call(fm, change.key);
	if (!has || !sameValue(fm[change.key], change.written)) return false;
	if (change.had) fm[change.key] = structuredClone(change.before);
	else delete fm[change.key];
	return true;
}

/** What moveUnder changed, to put it back. */
export interface ParentChange {
	key: string;
	/** Whether the key was there before, and its value. */
	had: boolean;
	before: unknown;
	/** The value the move wrote. */
	written: unknown;
	/** Puts the old value back; false when the property changed since (nothing is undone). */
	undo(): Promise<boolean>;
}

/**
 * Writes `target` as the parent of `file` (properties only). Returns the change, or null when the
 * note could not be written.
 */
export async function moveUnder(app: App, file: TFile, target: TFile): Promise<ParentChange | null> {
	const link = parentLink(app, file.path, target);
	let key = "up";
	let had = false;
	let before: unknown = undefined;
	let written: unknown = undefined;
	try {
		await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			key = parentKeyIn(fm);
			had = Object.prototype.hasOwnProperty.call(fm, key);
			before = had ? structuredClone(fm[key]) : undefined;
			fm[key] = parentValue(fm[key], link);
			written = structuredClone(fm[key]);
		});
	} catch (error) {
		console.error("[Snailkit] places: could not write the parent", error);
		return null;
	}
	const change = { key, had, before, written };
	return {
		...change,
		undo: async () => {
			let done = false;
			await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				done = undoParent(fm, change);
			});
			return done;
		},
	};
}
