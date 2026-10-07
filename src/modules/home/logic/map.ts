// The Map's nodes, read from the vault through World (the Map component knows nothing of files).
// Under the root: the domains in the order of the Domains view, hidden ones left out, with the
// group names. Elsewhere: notes that have children first, then the other notes from the most
// recent to the oldest, then the brainstorms, unless the user dragged them into an order of their
// own (logic/order.ts). Dated titles show without their date. Answers are
// kept until invalidate() (the Map asks often). Pure over World.
import type { MapNode, MapNodeKind, MapSource, MapState } from "../../../ui/map/types";
import { splitDated } from "./dates";
import { applyOrder } from "./order";
import { type World } from "./world";

/** The Map's root when the vault has no home page: the domains hang under it. */
export const VAULT_ROOT = "/";

export interface RootEntry {
	path: string;
	/** Group name shown above the first domain of each group (first column), or null. */
	group: string | null;
}

export class HomeMapSource implements MapSource {
	private readonly kids = new Map<string, MapNode[]>();
	private readonly nodes = new Map<string, MapNode | null>();
	private readonly domainOf = new Map<string, string | null>();
	private domainSet: Set<string> | null = null;
	private rootList: RootEntry[] | null = null;

	constructor(
		private readonly world: World,
		/** The domains as the Domains view orders them (hidden ones left out). */
		private readonly rootEntries: () => RootEntry[],
		/** Name of the vault (the root's label without a home page). */
		private readonly vaultName: string,
		/** The order the user made under a parent (dragged on the Map), if any. */
		private readonly savedOrder: (parent: string) => readonly string[] | undefined = () => undefined,
	) {}

	/** The data changed: answers are read again. */
	invalidate(): void {
		this.kids.clear();
		this.nodes.clear();
		this.domainOf.clear();
		this.domainSet = null;
		this.rootList = null;
	}

	/** The Map's home: the home page, else the vault root. */
	home(): string {
		return this.world.home() ?? VAULT_ROOT;
	}

	private domains(): Set<string> {
		return (this.domainSet ??= new Set(this.world.domains()));
	}

	private roots(): RootEntry[] {
		return (this.rootList ??= this.rootEntries().filter((e) => this.world.exists(e.path)));
	}

	private isRoot(id: string): boolean {
		return id === VAULT_ROOT || id === this.world.home();
	}

	/** The domain of a node (itself for a domain), for its color. */
	private domainFor(id: string): string | null {
		if (this.domainOf.has(id)) return this.domainOf.get(id)!;
		const domains = this.domains();
		let found: string | null = null;
		const seen = new Set<string>();
		let current: string | null = id;
		while (current !== null && !seen.has(current) && seen.size < 12) {
			if (domains.has(current)) {
				found = current;
				break;
			}
			seen.add(current);
			current = this.world.parent(current);
		}
		this.domainOf.set(id, found);
		return found;
	}

	kindOf(id: string): MapNodeKind {
		if (this.isRoot(id)) return "root";
		const domains = this.domains();
		if (domains.has(id)) return "domain";
		if (this.world.isBrainstorm(id)) return "brainstorm";
		if (this.world.isDrawing(id)) return "drawing";
		const parent = this.world.parent(id);
		if (parent !== null && domains.has(parent) && this.world.hasChildren(id)) return "sub";
		return "note";
	}

	node(id: string): MapNode | null {
		if (this.nodes.has(id)) return this.nodes.get(id)!;
		let node: MapNode | null = null;
		if (id === VAULT_ROOT) {
			node = { id, label: this.vaultName, kind: "root", hue: null, hasChildren: this.roots().length > 0 };
		} else if (this.world.exists(id)) {
			const name = this.world.name(id);
			const kind = this.kindOf(id);
			const label = kind === "drawing" ? name.replace(/\.excalidraw$/i, "") : splitDated(name).label;
			const domain = kind === "root" ? null : this.domainFor(id);
			node = {
				id,
				label,
				kind,
				hue: domain ? this.world.hue(domain) : null,
				// Cheap on purpose: building the children here would walk the whole tree.
				hasChildren: kind === "root" ? this.roots().length > 0 : this.world.hasChildren(id),
			};
			if (label !== name) node.title = name;
		}
		this.nodes.set(id, node);
		return node;
	}

	children(id: string): MapNode[] {
		const known = this.kids.get(id);
		if (known) return known;
		let list: MapNode[];
		if (this.isRoot(id)) {
			let last: string | null = null;
			list = [];
			for (const entry of this.roots()) {
				const node = this.node(entry.path);
				if (!node) continue;
				list.push({ ...node, group: entry.group !== last ? entry.group : null });
				last = entry.group;
			}
		} else {
			const world = this.world;
			const paths = world.children(id);
			const recent = (a: string, b: string) => world.mtime(b) - world.mtime(a) || world.name(a).localeCompare(world.name(b));
			const brain = paths.filter((p) => world.isBrainstorm(p)).sort(recent);
			const rest = paths.filter((p) => !world.isBrainstorm(p));
			const parents = rest.filter((p) => world.hasChildren(p)).sort(recent);
			const notes = rest.filter((p) => !world.hasChildren(p)).sort(recent);
			list = applyOrder([...parents, ...notes, ...brain], this.savedOrder(id)).map((p) => this.node(p)).filter((n): n is MapNode => !!n);
		}
		this.kids.set(id, list);
		return list;
	}

	parent(id: string): string | null {
		if (id === VAULT_ROOT) return null;
		const home = this.world.home();
		if (id === home) return null;
		// The domains are the home page's children (places.domains), so a domain listed under the
		// root already has it as its parent. Without a home page they are top notes: the vault holds them.
		const parent = this.world.parent(id);
		if (parent !== null) return parent;
		return home === null && this.domains().has(id) ? VAULT_ROOT : null;
	}
}

/** Depth of the branch the Map unfolds under its root toward a note (the fourth level folds the root). */
const DEPTH = 4;
/** Depth of the branch unfolded when no note leads the way (the root stays whole). */
const FIRST_DEPTH = 2;
const SHOWN = 8;

/**
 * The branch unfolded under `root` at first: the way to `here` when it leads somewhere below the
 * root, else down the first node that has children, three levels at most (four toward a note). Never empty when the
 * root has a child with children: the Map never arrives flat.
 */
export function autoChain(source: MapSource, root: string, here: string | null): string[] {
	if (here && here !== root) {
		const up: string[] = [];
		const seen = new Set<string>();
		let current: string | null = here;
		while (current !== null && current !== root && !seen.has(current) && seen.size < 16) {
			up.unshift(current);
			seen.add(current);
			current = source.parent(current);
		}
		if (current === root && up.length) {
			const chain = up.slice(0, DEPTH);
			const first = source.node(chain[0]);
			if (chain.length > 1 || first?.hasChildren) return chain;
		}
	}
	const chain: string[] = [];
	let at = root;
	while (chain.length < FIRST_DEPTH) {
		const next = source.children(at).slice(0, SHOWN).find((n) => n.hasChildren);
		if (!next) break;
		chain.push(next.id);
		at = next.id;
	}
	return chain;
}

/** A state for the Map recentered on `root` (the branch toward `here` unfolded). */
export function mapStateAt(source: MapSource, root: string, here: string | null): MapState {
	return { root, chain: autoChain(source, root, here), focus: null };
}

/** True when a saved state can still be shown (its root exists). */
export function usableState(source: MapSource, state: unknown): state is MapState {
	if (!state || typeof state !== "object") return false;
	const s = state as Partial<MapState>;
	return typeof s.root === "string" && Array.isArray(s.chain) && !!source.node(s.root);
}
