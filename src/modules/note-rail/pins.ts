// Pins shared by the Bookmarks and Tasks panels.
// - Note pins live in the note frontmatter, under the `pins` property (or the one set in the
//   settings), as a list of "[[link]]" strings. Obsidian keeps frontmatter links up to date on rename.
// - Vault pins live in the settings as vault paths (the controller follows renames and deletes).
import { TFile, type App } from "obsidian";
import { pinsKey } from "./settings";
import { flattenPinGroups, readPinGroups } from "./vault-pins";
import type { NoteRailSettings } from "./types";

/** Link path of one frontmatter value ("[[A|x]]", "[[A#h]]", "A"), or null. Pure. */
export function pinLinkpath(value: unknown): string | null {
	if (typeof value !== "string") return null;
	let v = value.trim();
	const wiki = /^\[\[([^\[\]\r\n]+)\]\]$/.exec(v);
	if (wiki) v = wiki[1];
	else if (v.startsWith("[[")) return null;
	v = v.split(/[|#^]/, 1)[0].trim();
	return v || null;
}

/** All link paths of a frontmatter pins value (a string or a list). Pure. */
export function pinLinkpaths(value: unknown): string[] {
	const list = Array.isArray(value) ? value : value == null ? [] : [value];
	const out: string[] = [];
	for (const item of list) {
		const p = pinLinkpath(item);
		if (p) out.push(p);
	}
	return out;
}

/** Notes pinned to `file`, in frontmatter order, resolved, without duplicates or self. Unresolved links are dropped. */
export function getNotePins(app: App, file: TFile, settings: NoteRailSettings): TFile[] {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	if (!fm) return [];
	const seen = new Set<string>([file.path]);
	const out: TFile[] = [];
	for (const linkpath of pinLinkpaths(fm[pinsKey(settings)])) {
		const target = app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
		if (target && !seen.has(target.path)) {
			seen.add(target.path);
			out.push(target);
		}
	}
	return out;
}

/** Vault-wide pins that still exist, in order. */
export function getVaultPins(app: App, settings: NoteRailSettings): TFile[] {
	const out: TFile[] = [];
	for (const path of flattenPinGroups(readPinGroups(settings.vaultPins, settings.vaultPinFolders))) {
		const f = app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) out.push(f);
	}
	return out;
}

/** "[[linktext]]" for `target` as seen from `source` (shortest unambiguous form). */
export function pinLink(app: App, target: TFile, source: TFile): string {
	return `[[${app.metadataCache.fileToLinktext(target, source.path, true)}]]`;
}

// ---- Writes -----------------------------------------------------------------------
// Every write is an edit applied INSIDE processFrontMatter, to the entries actually in the file,
// never a replacement computed from the metadata cache (which can lag behind a previous write).
// Writes to the same note run one after another. Entries that do not resolve are always kept.

/** Resolves one raw frontmatter entry to a vault path, or null. */
export type PinResolver = (entry: unknown) => string | null;

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value.slice() : value == null ? [] : [value]);

/** Entries with `link` appended, unless an entry already resolves to `targetPath`. Pure. */
export function pinsAdd(entries: unknown[], resolve: PinResolver, link: string, targetPath: string): unknown[] {
	return entries.some((e) => resolve(e) === targetPath) ? entries : [...entries, link];
}

/** Entries without those resolving to `targetPath`. Unresolved entries are kept. Pure. */
export function pinsRemove(entries: unknown[], resolve: PinResolver, targetPath: string): unknown[] {
	return entries.filter((e) => resolve(e) !== targetPath);
}

/**
 * Resolved entries sorted by their position in `order` (vault paths); resolved entries missing from
 * `order` (added meanwhile) follow in their current order; unresolved entries stay at the end. Pure.
 */
export function pinsReorder(entries: unknown[], resolve: PinResolver, order: string[]): unknown[] {
	const rank = new Map(order.map((p, i) => [p, i]));
	const resolved: { e: unknown; r: number; i: number }[] = [];
	const unresolved: unknown[] = [];
	entries.forEach((e, i) => {
		const path = resolve(e);
		if (path === null) unresolved.push(e);
		else resolved.push({ e, r: rank.get(path) ?? order.length, i });
	});
	resolved.sort((a, b) => a.r - b.r || a.i - b.i);
	return [...resolved.map((x) => x.e), ...unresolved];
}

/** Writes in flight, per note path. Each entry removes itself once its write settles. */
const queues = new Map<string, Promise<void>>();

/** Runs `edit` on the pins list of `file` inside processFrontMatter, queued per note. */
function editNotePins(app: App, file: TFile, settings: NoteRailSettings, edit: (entries: unknown[], resolve: PinResolver) => unknown[]): Promise<void> {
	const key = pinsKey(settings);
	const resolve: PinResolver = (entry) => {
		const linkpath = pinLinkpath(entry);
		return linkpath ? app.metadataCache.getFirstLinkpathDest(linkpath, file.path)?.path ?? null : null;
	};
	const run = () =>
		app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const before = asList(fm[key]);
			const next = edit(before, resolve);
			if (next === before) return;
			if (next.length) fm[key] = next;
			else delete fm[key];
		});
	const previous = queues.get(file.path) ?? Promise.resolve();
	const done = previous.then(run, run);
	const tail = done.catch(() => undefined);
	queues.set(file.path, tail);
	void tail.then(() => {
		if (queues.get(file.path) === tail) queues.delete(file.path);
	});
	return done;
}

/** Resolves once every pin write queued so far for `file` has finished. */
export function pinWritesSettled(file: TFile): Promise<void> {
	return queues.get(file.path) ?? Promise.resolve();
}

export function addNotePin(app: App, file: TFile, target: TFile, settings: NoteRailSettings): Promise<void> {
	if (target.path === file.path) return Promise.resolve();
	return editNotePins(app, file, settings, (entries, resolve) => pinsAdd(entries, resolve, pinLink(app, target, file), target.path));
}

export function removeNotePin(app: App, file: TFile, target: TFile, settings: NoteRailSettings): Promise<void> {
	return editNotePins(app, file, settings, (entries, resolve) => pinsRemove(entries, resolve, target.path));
}

/** Reorders the pins of `file` following `order` (vault paths). Pins missing from `order` are never removed. */
export function reorderNotePins(app: App, file: TFile, order: string[], settings: NoteRailSettings): Promise<void> {
	return editNotePins(app, file, settings, (entries, resolve) => pinsReorder(entries, resolve, order));
}
