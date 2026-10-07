// The "places" of the core: one per app, shared by every module and published as the "places"
// service. placeOf() and parentOf() read the metadata cache fresh, as the rail always did (a link
// just edited shows at once). Questions about the tree (children, domains) go through an index of
// parents, built at the first question, updated note by note when a note changes, and built again
// (at the next question, at most every 500 ms) after a note is created, renamed or deleted.
import type { App, EventRef, TFile } from "obsidian";
import { hueOf, MAX_DEPTH, placeFinder } from "./rule";
import { DEFAULT_PLACES_OPTIONS, type PlacesOptions, type PlacesService } from "./types";

export type { Place, PlacesOptions, PlacesService } from "./types";

/** The index is built again at most this often. */
const REBUILD_MS = 500;
/** onChange callbacks run once per burst of changes. */
const NOTIFY_MS = 300;

/** The places of an app, plus what only the core and the Home module may call. */
export interface PlacesCore extends PlacesService {
	/** Options of the rule (the Home module's settings); missing keys keep their value. */
	configure(options: Partial<PlacesOptions>): void;
	readonly options: PlacesOptions;
	/** The published "places" service: the PlacesService part only. */
	readonly service: PlacesService;
	/** The plugin unloads. */
	dispose(): void;
}

/**
 * Parents and children of every note, by path. Pure: it is given each note's parent path and keeps
 * both directions. Tested in test/places.test.ts.
 */
export class ParentIndex {
	private readonly parents = new Map<string, string | null>();
	private readonly kids = new Map<string, Set<string>>();

	clear(): void {
		this.parents.clear();
		this.kids.clear();
	}

	/** Sets the parent of a note (null: none). Returns true when it changed. */
	set(path: string, parent: string | null): boolean {
		const had = this.parents.has(path);
		const before = this.parents.get(path) ?? null;
		if (had && before === parent) return false;
		if (before !== null) {
			const set = this.kids.get(before);
			set?.delete(path);
			if (set && !set.size) this.kids.delete(before);
		}
		this.parents.set(path, parent);
		if (parent !== null) {
			let set = this.kids.get(parent);
			if (!set) this.kids.set(parent, (set = new Set()));
			set.add(path);
		}
		return true;
	}

	remove(path: string): void {
		this.set(path, null);
		this.parents.delete(path);
	}

	parent(path: string): string | null {
		return this.parents.get(path) ?? null;
	}

	children(path: string): string[] {
		return [...(this.kids.get(path) ?? [])].sort((a, b) => a.localeCompare(b));
	}

	hasChildren(path: string): boolean {
		return (this.kids.get(path)?.size ?? 0) > 0;
	}

	/** Paths of every note known to the index. */
	paths(): IterableIterator<string> {
		return this.parents.keys();
	}

	/** Parents from the nearest to the top one, as chainOf() does (stops on a loop or at MAX_DEPTH). */
	chain(path: string): string[] {
		const chain: string[] = [];
		const seen = new Set([path]);
		let current = this.parent(path);
		while (current !== null && !seen.has(current) && chain.length < MAX_DEPTH) {
			chain.push(current);
			seen.add(current);
			current = this.parent(current);
		}
		return chain;
	}

	/**
	 * The domains. Below a home page (detected or chosen): its children that have children. Without
	 * one: the top notes (no parent) that have children. A tree that does not hang from the home
	 * page holds no domain: the rail's area pill still names its top note (placeOf is unchanged),
	 * the Home and the Map show the home page's tree only.
	 */
	domains(home: string | null): string[] {
		if (home !== null) return this.children(home).filter((path) => this.hasChildren(path));
		const out: string[] = [];
		for (const [path, parent] of this.parents) if (parent === null && this.hasChildren(path)) out.push(path);
		return out;
	}
}

export function createPlaces(app: App): PlacesCore {
	const finder = placeFinder(app);
	finder.configure(DEFAULT_PLACES_OPTIONS);
	const index = new ParentIndex();
	const listeners = new Set<() => void>();
	let built = false;
	let dirty = true;
	let builtAt = 0;
	let resolvedSeen = false;
	let disposed = false;
	let notifyTimer = 0;
	let domainCache: { key: string; files: TFile[] } | null = null;
	let version = 0;

	const notifySoon = (delay = NOTIFY_MS) => {
		if (disposed) return;
		window.clearTimeout(notifyTimer);
		notifyTimer = window.setTimeout(() => {
			for (const callback of [...listeners]) {
				try {
					callback();
				} catch (error) {
					console.error("[Snailkit] places: a change listener failed", error);
				}
			}
		}, delay);
	};

	const parentPath = (file: TFile): string | null => finder.parentOf(file)?.path ?? null;

	/** The index, built again when it is stale (at most every REBUILD_MS; callers are told when it catches up). */
	const fresh = (): ParentIndex => {
		if (!dirty) return index;
		const now = Date.now();
		if (built && now - builtAt < REBUILD_MS) {
			notifySoon(REBUILD_MS - (now - builtAt) + 20);
			return index;
		}
		index.clear();
		for (const file of app.vault.getMarkdownFiles()) index.set(file.path, parentPath(file));
		built = true;
		dirty = false;
		builtAt = Date.now();
		version++;
		return index;
	};

	const markDirty = () => {
		dirty = true;
		version++;
		notifySoon();
	};

	const fileOf = (path: string): TFile | null => {
		const file = app.vault.getFileByPath?.(path) ?? (app.vault.getAbstractFileByPath(path) as TFile | null);
		return file && (file as TFile).extension === "md" ? file : null;
	};
	const filesOf = (paths: Iterable<string>): TFile[] => {
		const out: TFile[] = [];
		for (const path of paths) {
			const file = fileOf(path);
			if (file) out.push(file);
		}
		return out;
	};

	const refs: Array<{ off(): void }> = [];
	const listen = (source: { on(name: string, cb: (...args: never[]) => unknown): EventRef; offref(ref: EventRef): void }, name: string, cb: (...args: never[]) => unknown) => {
		const ref = source.on(name, cb);
		refs.push({ off: () => source.offref(ref) });
	};
	const vault = app.vault as unknown as Parameters<typeof listen>[0];
	const cache = app.metadataCache as unknown as Parameters<typeof listen>[0];
	listen(cache, "changed", ((file: TFile) => {
		if (!built || dirty || file.extension !== "md") return;
		if (index.set(file.path, parentPath(file))) {
			version++;
			notifySoon();
		}
	}) as never);
	for (const name of ["create", "rename", "delete"]) {
		listen(vault, name, (() => {
			if (built) markDirty();
			else notifySoon();
		}) as never);
	}
	// The first full resolution of the vault (startup): links may now point to notes they did not find yet.
	listen(cache, "resolved", (() => {
		if (resolvedSeen) return;
		resolvedSeen = true;
		// A home page looked for before then is kept a minute and may be wrong (links not read yet):
		// configuring with nothing keeps the options and makes the finder look again.
		finder.configure({});
		domainCache = null;
		if (built) markDirty();
		else notifySoon();
	}) as never);

	const service: PlacesService = {
		version: 1,
		placeOf: (file) => finder.placeOf(file),
		hueOf,
		parentOf: (file) => finder.parentOf(file),
		homePath: () => finder.homePath(),
		childrenOf: (path) => filesOf(fresh().children(path)),
		hasChildren: (path) => fresh().hasChildren(path),
		domains: () => {
			const idx = fresh();
			const home = finder.homePath();
			const key = `${version}|${home ?? ""}`;
			if (domainCache?.key === key) return [...domainCache.files];
			const files = filesOf(idx.domains(home)).sort((a, b) => a.basename.localeCompare(b.basename) || a.path.localeCompare(b.path));
			domainCache = { key, files };
			return [...files];
		},
		isIgnored: (path) => finder.isIgnored(path),
		onChange: (callback) => {
			if (typeof callback !== "function" || disposed) return () => undefined;
			listeners.add(callback);
			return () => {
				listeners.delete(callback);
			};
		},
	};

	return {
		...service,
		service,
		configure: (next) => {
			const before = JSON.stringify(finder.options);
			finder.configure(next);
			if (JSON.stringify(finder.options) === before) return;
			dirty = true;
			version++;
			notifySoon(0);
		},
		get options() {
			return { ...finder.options, ignoredFolders: [...finder.options.ignoredFolders] };
		},
		dispose: () => {
			disposed = true;
			window.clearTimeout(notifyTimer);
			for (const ref of refs.splice(0)) ref.off();
			listeners.clear();
			index.clear();
			finder.configure(DEFAULT_PLACES_OPTIONS);
		},
	};
}
