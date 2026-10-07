// Where a note belongs: its parent is the note named by an "up" (or "parent", "moc") property,
// else the first link at the top of the note (a breadcrumb line). Following parents up gives the
// chain to the top note. When one top note holds most of the vault (a home page), the "area" of a
// note is the level just below it; otherwise it is the top note. The area gives the color.
// Moved from the note rail unchanged; two options (PlacesOptions) come from the Home module, and
// their defaults keep the rule exactly as it was.
import { TFile } from "obsidian";
import type { App, CachedMetadata, LinkCache } from "obsidian";
import { DEFAULT_PLACES_OPTIONS, type Place, type PlacesOptions } from "./types";

export type { Place } from "./types";

/** Properties that name the parent, in order of preference. */
export const PARENT_KEYS = ["up", "parent", "parents", "moc", "mocs"];
/** Deepest chain followed (a loop or a very deep tree stops there). */
export const MAX_DEPTH = 8;
/** A first link counts as the parent only within this many lines after the properties. */
const TOP_LINES = 3;
/** A top note holding more than this share of the linked notes is a home page, not an area. */
const HOME_SHARE = 0.5;

/** "[[Note|alias]]" or "Note" from a property value: the link path, or null. */
export function linkpathOf(value: unknown): string | null {
	const first = Array.isArray(value) ? value[0] : value;
	if (typeof first !== "string") return null;
	const text = first.trim();
	const wiki = /^\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]$/.exec(text);
	const path = (wiki ? wiki[1] : text).trim();
	return path && !path.includes("[[") ? path : null;
}

/** The link path naming the parent in this metadata: a parent property first, else the first link. */
export function parentLinkpath(cache: CachedMetadata | null): string | null {
	if (!cache) return null;
	const fm = cache.frontmatter;
	if (fm) {
		for (const key of PARENT_KEYS) {
			const found = Object.keys(fm).find((k) => k.toLowerCase() === key);
			const path = found ? linkpathOf(fm[found]) : null;
			if (path) return path;
		}
	}
	const links: LinkCache[] = cache.links ?? [];
	let first: LinkCache | null = null;
	for (const link of links) if (!first || link.position.start.offset < first.position.start.offset) first = link;
	if (!first) return null;
	const start = cache.frontmatterPosition ? cache.frontmatterPosition.end.line + 1 : 0;
	if (first.position.start.line - start >= TOP_LINES) return null;
	return first.link.split(/[#^]/)[0].trim() || null;
}

/** Folders as typed in a setting ("Archive, /Templates/ ") to clean vault paths, without duplicates. Pure. */
export function cleanFolders(folders: readonly string[]): string[] {
	const out: string[] = [];
	for (const raw of folders) {
		if (typeof raw !== "string") continue;
		const folder = raw.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
		if (folder && !out.includes(folder)) out.push(folder);
	}
	return out;
}

/** True when `path` lies in one of the (clean) folders. Pure. */
export function inFolders(path: string, folders: readonly string[]): boolean {
	return folders.some((folder) => path.startsWith(folder + "/"));
}

export function parentOf(app: App, file: TFile, options: PlacesOptions = DEFAULT_PLACES_OPTIONS): TFile | null {
	const ignored = options.ignoredFolders;
	if (ignored.length && inFolders(file.path, ignored)) return null;
	const path = parentLinkpath(app.metadataCache.getFileCache(file));
	if (!path) return null;
	const target = app.metadataCache.getFirstLinkpathDest(path, file.path);
	if (!(target instanceof TFile) || target.extension !== "md" || target.path === file.path) return null;
	return ignored.length && inFolders(target.path, ignored) ? null : target;
}

/** Parents from the nearest to the top one (empty when the note has no parent). Stops on a loop. */
export function chainOf(app: App, file: TFile, options: PlacesOptions = DEFAULT_PLACES_OPTIONS): TFile[] {
	const chain: TFile[] = [];
	const seen = new Set([file.path]);
	let current = parentOf(app, file, options);
	while (current && !seen.has(current.path) && chain.length < MAX_DEPTH) {
		chain.push(current);
		seen.add(current.path);
		current = parentOf(app, current, options);
	}
	return chain;
}

/** A stable hue (0-359) for a note path: the same top note always gets the same color. */
export function hueOf(path: string): number {
	let h = 2166136261;
	for (let i = 0; i < path.length; i++) {
		h ^= path.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return Math.abs(h) % 360;
}

/**
 * The area of a note from its chain (nearest parent first). Below the home page, it is the level
 * just under it (the note itself for an area note); elsewhere, the top note. A chosen home page
 * may sit anywhere in a chain; a detected one is always a top note. Pure.
 */
export function areaOf<T extends { path: string }>(file: T, chain: readonly T[], home: string | null, chosen: boolean): T | null {
	if (!chain.length) return null;
	const last = chain.length - 1;
	const at = home === null ? -1 : chosen ? chain.findIndex((note) => note.path === home) : chain[last].path === home ? last : -1;
	if (at < 0) return chain[last];
	return at >= 1 ? chain[at - 1] : file;
}

/**
 * Finds the home page (a top note holding most of the vault) once in a while, and the place of any
 * note. One per app (see placeFinder), so that the rail, the core and every module share the same
 * options.
 */
export class PlaceFinder {
	private home: string | null | undefined = undefined;
	private at = 0;
	private opts: PlacesOptions = { ...DEFAULT_PLACES_OPTIONS };

	constructor(private app: App) {}

	get options(): PlacesOptions {
		return this.opts;
	}

	/** New options (missing keys keep their value). The home page is looked for again. */
	configure(next: Partial<PlacesOptions>): void {
		this.opts = {
			home: typeof next.home === "string" ? next.home.trim().replace(/^\/+/, "") : this.opts.home,
			ignoredFolders: Array.isArray(next.ignoredFolders) ? cleanFolders(next.ignoredFolders) : this.opts.ignoredFolders,
		};
		this.home = undefined;
	}

	/** True when the path is in an ignored folder. */
	isIgnored(path: string): boolean {
		return inFolders(path, this.opts.ignoredFolders);
	}

	parentOf(file: TFile): TFile | null {
		return parentOf(this.app, file, this.opts);
	}

	chainOf(file: TFile): TFile[] {
		return chainOf(this.app, file, this.opts);
	}

	/** The home page chosen in the options when that note exists, else the detected one. */
	private chosenHome(): string | null {
		const path = this.opts.home;
		if (!path) return null;
		const file = this.app.vault.getAbstractFileByPath(path) ?? this.app.vault.getAbstractFileByPath(path + ".md");
		return file instanceof TFile && file.extension === "md" && !this.isIgnored(file.path) ? file.path : null;
	}

	/** The home page, found again at most once a minute (links change while you write). */
	homePath(): string | null {
		const chosen = this.chosenHome();
		if (chosen) return chosen;
		if (this.home !== undefined && Date.now() - this.at < 60_000) return this.home;
		this.at = Date.now();
		const tops = new Map<string, number>();
		let linked = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			const chain = this.chainOf(file);
			if (!chain.length) continue;
			linked++;
			const top = chain[chain.length - 1].path;
			tops.set(top, (tops.get(top) ?? 0) + 1);
		}
		let best: string | null = null;
		let count = 0;
		for (const [path, n] of tops) if (n > count) [best, count] = [path, n];
		this.home = best && linked >= 4 && count > linked * HOME_SHARE ? best : null;
		return this.home;
	}

	/** True when homePath() is the note chosen in the options (it may sit anywhere in a chain). */
	homeIsChosen(): boolean {
		return this.chosenHome() !== null;
	}

	placeOf(file: TFile): Place {
		const chain = this.chainOf(file);
		if (!chain.length) return { chain, area: null };
		return { chain, area: areaOf(file, chain, this.homePath(), this.homeIsChosen()) };
	}
}

const finders = new WeakMap<App, PlaceFinder>();

export function placeFinder(app: App): PlaceFinder {
	let finder = finders.get(app);
	if (!finder) finders.set(app, (finder = new PlaceFinder(app)));
	return finder;
}
