// Where a note belongs: its parent is the note named by an "up" (or "parent", "moc") property,
// else the first link at the top of the note (a breadcrumb line). Following parents up gives the
// chain to the top note. When one top note holds most of the vault (a home page), the "area" of a
// note is the level just below it; otherwise it is the top note. The area gives the color.
import { TFile } from "obsidian";
import type { App, CachedMetadata, LinkCache } from "obsidian";

/** Properties that name the parent, in order of preference. */
export const PARENT_KEYS = ["up", "parent", "parents", "moc", "mocs"];
/** Deepest chain followed (a loop or a very deep tree stops there). */
const MAX_DEPTH = 8;
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

export function parentOf(app: App, file: TFile): TFile | null {
	const path = parentLinkpath(app.metadataCache.getFileCache(file));
	if (!path) return null;
	const target = app.metadataCache.getFirstLinkpathDest(path, file.path);
	return target instanceof TFile && target.extension === "md" && target.path !== file.path ? target : null;
}

/** Parents from the nearest to the top one (empty when the note has no parent). Stops on a loop. */
export function chainOf(app: App, file: TFile): TFile[] {
	const chain: TFile[] = [];
	const seen = new Set([file.path]);
	let current = parentOf(app, file);
	while (current && !seen.has(current.path) && chain.length < MAX_DEPTH) {
		chain.push(current);
		seen.add(current.path);
		current = parentOf(app, current);
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

/** Where a note belongs: its parents (nearest first) and its area (null when it has no parent). */
export interface Place {
	chain: TFile[];
	area: TFile | null;
}

/**
 * Finds the home page (a top note holding most of the vault) once in a while, and the place of any
 * note. One per app (see placeFinder).
 */
export class PlaceFinder {
	private home: string | null | undefined = undefined;
	private at = 0;

	constructor(private app: App) {}

	/** The home page, found again at most once a minute (links change while you write). */
	homePath(): string | null {
		if (this.home !== undefined && Date.now() - this.at < 60_000) return this.home;
		this.at = Date.now();
		const tops = new Map<string, number>();
		let linked = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			const chain = chainOf(this.app, file);
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

	placeOf(file: TFile): Place {
		const chain = chainOf(this.app, file);
		if (!chain.length) return { chain, area: null };
		const home = this.homePath();
		const top = chain[chain.length - 1];
		if (top.path !== home) return { chain, area: top };
		// Below the home page: the area is the next level down (the note itself for an area note).
		return { chain, area: chain.length >= 2 ? chain[chain.length - 2] : file };
	}
}

const finders = new WeakMap<App, PlaceFinder>();

export function placeFinder(app: App): PlaceFinder {
	let finder = finders.get(app);
	if (!finder) finders.set(app, (finder = new PlaceFinder(app)));
	return finder;
}

/** Shared with other modules as the "places" service while Note rail is on. */
export interface PlacesService {
	version: 1;
	placeOf(file: TFile): Place;
	hueOf(path: string): number;
}
