import { branchPath, childRows, columnLayout, nodeKey, pathFrom, type MapMode, type MapRow } from "./layout";
import { MapLifetime } from "./motion";
import { MAP_LIMITS as L, type MapOptions, type MapState } from "./types";
import { zoomOf } from "../surface";
import { elementOf } from "../dom";

let sceneId = 0;
interface Entry { row: MapRow; el: HTMLElement; signature: string }

/** Keyed DOM keeps shallow nodes (and their real keyboard focus) in place during unfolding. */
export class MapScene {
	readonly entries = new Map<string, Entry>();
	rows: MapRow[] = [];
	/** The last columns drawing folded the root into a pill. */
	folded = false;
	private groups = new Map<string, HTMLElement>();
	private edges = new Map<string, SVGPathElement>();
	private svg: SVGSVGElement;
	private labels: HTMLElement[] = [];
	private serial = 0;
	private prefix = `sk-map-${++sceneId}-`;
	private mode: MapMode | null = null;
	private root: string | null = null;
	private canvas: CanvasRenderingContext2D | null;
	constructor(readonly box: HTMLElement, private options: MapOptions, private life: MapLifetime) {
		this.svg = box.createSvg("svg");
		this.svg.classList.add("sk-map-branches");
		this.svg.setAttribute("aria-hidden", "true");
		this.canvas = elementOf(box.ownerDocument, "canvas").getContext("2d");
	}

	private measure = (text: string): number => {
		if (!this.canvas) return text.length * 7;
		return this.canvas.measureText(text).width;
	};

	draw(state: MapState, mode: MapMode, width: number, open: ReadonlySet<string>, animate = true, keepFolded = false, grown: ReadonlySet<string> = new Set()): void {
		const ancestors = this.root && this.root !== state.root ? new Set([this.root, ...pathFrom(this.options.source, this.root, state.root).slice(0, -1)]) : new Set<string>();
		this.root = state.root;
		const before = new Map([...this.entries].map(([key, entry]) => [key, entry.el.getBoundingClientRect()]));
		const changedMode = this.mode !== mode;
		if (changedMode) this.clear();
		this.mode = mode;
		this.box.classList.toggle("is-tree", mode === "tree");
		this.svg.style.display = mode === "tree" ? "none" : "";
		const font = this.life.win.getComputedStyle(this.box).fontFamily;
		if (this.canvas) this.canvas.font = `500 13.5px ${font}`;
		this.labels.forEach((label) => label.remove()); this.labels = [];
		const used = new Set<string>();
		const usedGroups = new Set<string>();
		this.rows = [];
		const attach = (row: MapRow, container: HTMLElement, expanded: boolean): HTMLElement => {
			used.add(row.key); this.rows.push(row);
			let entry = this.entries.get(row.key);
			const fresh = !entry;
			if (!entry) {
				const el = container.createDiv();
				el.id = this.prefix + ++this.serial;
				el.dataset.mapKey = row.key;
				el.dataset.nav = "";
				el.tabIndex = -1;
				entry = { row, el, signature: "" }; this.entries.set(row.key, entry);
			}
			entry.row = row;
			const el = entry.el;
			this.decorate(entry, expanded);
			if (el.parentElement !== container) container.append(el);
			if (fresh && animate) this.life.animate(el, [{ opacity: 0, transform: mode === "tree" ? "none" : "translateX(-12px)" }, { opacity: 1, transform: "none" }], 420,
				(row.position - 1) * (mode === "tree" ? 16 : 14) + (before.size ? 60 : row.depth * 90), true);
			return el;
		};
		const group = (id: string, parent: HTMLElement): HTMLElement => {
			usedGroups.add(id);
			let el = this.groups.get(id);
			if (!el) {
				el = parent.createDiv();
				el.id = this.prefix + "g" + ++this.serial;
				el.setAttribute("role", "group");
				el.className = "sk-map-group";
				this.groups.set(id, el);
			}
			if (el.parentElement !== parent) parent.append(el);
			this.entries.get(nodeKey(id))?.el.setAttribute("aria-owns", el.id);
			return el;
		};
		if (mode === "columns") {
			const geometry = columnLayout(this.options.source, state, width, this.options.home, this.measure, this.options.strings.more.bind(this.options.strings), keepFolded, grown);
			this.folded = geometry.folded;
			this.box.style.minWidth = `${geometry.width}px`;
			this.box.style.height = `${geometry.height}px`;
			if (geometry.root) {
				const row = geometry.root;
				const el = attach(row, this.box, geometry.columns.length > 0);
				el.classList.toggle("is-folded", geometry.folded);
				Object.assign(el.style, { left: `${row.x}px`, top: `${row.y}px`, width: `${row.width}px`, maxWidth: `${row.width}px` });
			}
			for (const col of geometry.columns) {
				const container = group(col.parent, this.box);
				container.classList.toggle("is-overflow", col.height > col.visible);
				container.classList.toggle("is-grown", col.grown);
				Object.assign(container.style, { left: `${col.x}px`, top: `${col.top}px`, width: `${col.width}px`, height: `${col.visible}px` });
				for (const row of col.rows) {
					const expanded = geometry.columns.some((next) => next.parent === row.node?.id);
					const el = attach(row, container, expanded);
					Object.assign(el.style, { left: "0px", top: `${row.y - col.top}px`, width: "max-content", maxWidth: "100%" });
					el.classList.toggle("is-dim", !!state.chain[row.depth - 1] && row.node?.id !== state.chain[row.depth - 1]);
				}
				for (const label of col.labels) {
					const el = container.createDiv();
					el.className = "sk-map-group-label"; el.textContent = label.text; el.style.top = `${label.y - col.top}px`;
					el.setAttribute("aria-hidden", "true"); container.append(el); this.labels.push(el);
				}
			}
		} else {
			this.folded = false;
			this.box.style.removeProperty("min-width");
			this.box.style.removeProperty("height");
			const root = this.options.source.node(state.root);
			if (root) {
				const rootRow: MapRow = { key: nodeKey(root.id), node: root, parent: null, depth: 0, position: 1, size: 1, more: 0 };
				attach(rootRow, this.box, root.hasChildren);
				const visit = (id: string, depth: number, parent: HTMLElement, ancestors: string[]) => {
					const fresh = !this.groups.has(id);
					const container = group(id, parent);
					container.classList.add("is-open");
					let inner = container.firstElementChild as HTMLElement | null;
					if (!inner) { inner = container.createDiv(); inner.className = "sk-map-tree-inner"; }
					for (const row of childRows(this.options.source, id, depth, ancestors, grown.has(id))) {
						const expanded = !!row.node?.hasChildren && depth < L.depth && open.has(row.node.id);
						const el = attach(row, inner, expanded);
						// Restore preorder after a sibling is expanded, without moving an already focused row.
						if (expanded) visit(row.node!.id, depth + 1, inner, [...ancestors, id]);
						const nextGroup = this.groups.get(row.node?.id ?? "");
						if (nextGroup?.parentElement === inner && el.nextElementSibling !== nextGroup) el.after(nextGroup);
					}
					if (fresh && animate) { container.classList.remove("is-open"); void container.offsetHeight; container.classList.add("is-open"); }
				};
				if (root.hasChildren) visit(root.id, 1, this.box, []);
			}
		}
		for (const [key, entry] of this.entries) {
			if (used.has(key)) continue;
			this.entries.delete(key);
			this.leave(entry.el, animate, !!entry.row.node && ancestors.has(entry.row.node.id));
		}
		for (const [id, container] of this.groups) {
			if (usedGroups.has(id)) continue;
			this.groups.delete(id);
			container.removeAttribute("id"); container.setAttribute("aria-hidden", "true"); container.inert = true;
			if (mode === "tree" && animate) {
				container.classList.remove("is-open");
				this.life.after(`group:${++this.serial}`, 260, () => container.remove());
			} else this.leave(container, animate);
		}
		// Reconcile tree sibling order after source updates (renames, sorting, insertions).
		if (mode === "tree") {
			for (const parent of new Set(this.rows.map((row) => row.parent))) {
				const siblings = this.rows.filter((row) => row.parent === parent);
				let previous: Element | null = null;
				for (const row of siblings) {
					const el = this.entries.get(row.key)!.el;
					if (previous && previous.nextElementSibling !== el) previous.after(el);
					previous = row.node && usedGroups.has(row.node.id) ? this.groups.get(row.node.id)! : el;
				}
			}
		}
		if (animate && !changedMode && mode === "columns") {
			// Moves are measured on screen; the map may be zoomed (Home's zoom): back to its own pixels.
			const z = zoomOf(this.box);
			for (const [key, entry] of this.entries) {
				const from = before.get(key); if (!from) continue;
				const to = entry.el.getBoundingClientRect();
				if (Math.abs(from.left - to.left) > 1 || Math.abs(from.top - to.top) > 1)
					this.life.animate(entry.el, [{ transform: `translate(${(from.left - to.left) / z}px, ${(from.top - to.top) / z}px)` }, { transform: "none" }], 420);
			}
		}
		this.drawEdges(animate);
	}

	private decorate(entry: Entry, expanded: boolean): void {
		const { row, el } = entry;
		const node = row.node;
		const signature = JSON.stringify([node, row.more, this.mode]);
		if (signature !== entry.signature) {
			entry.signature = signature; el.replaceChildren();
			el.className = `sk-map-node sk-surface-item${node ? ` is-${node.kind === "root" ? "home" : node.kind}` : " is-more"}`;
			const head = el.createSpan(); head.className = "sk-map-head"; head.setAttribute("aria-hidden", "true");
			if (!node) this.options.icon(head, "arrow-right");
			else if (node.kind === "domain") head.textContent = Array.from(node.label)[0] ?? "";
			else if (node.kind === "root" || node.kind === "sub" || node.kind === "brainstorm")
				this.options.icon(head, node.kind === "root" ? "house" : node.kind === "sub" ? "git-fork" : "zap");
			const label = el.createSpan(); label.className = "sk-map-label";
			// Give clipped inline text enough vertical room for descenders in every theme.
			label.textContent = node?.label ?? this.options.strings.more(row.more);
			if (node?.hasChildren) {
				const chevron = el.createSpan(); chevron.className = "sk-map-chevron"; chevron.setAttribute("aria-hidden", "true");
				this.options.icon(chevron, "chevron-right");
				const button = el.createEl("button"); button.type = "button"; button.tabIndex = -1;
				button.className = "sk-btn is-ghost is-icon is-s sk-map-action";
				button.dataset.mapAction = this.mode === "tree" ? "open" : "recenter";
				// One tooltip only: Obsidian's, from the aria-label (a title would add the system's on top).
				button.setAttribute("aria-label", this.mode === "tree" ? this.options.strings.open : this.options.strings.recenterTip);
				this.options.icon(button, this.mode === "tree" ? "arrow-up-right" : "focus");
			}
		}
		const hue = node ? node.hue : row.parent ? this.options.source.node(row.parent)?.hue : null;
		el.classList.toggle("is-gray", hue == null);
		if (hue == null) el.style.removeProperty("--sk-hue"); else el.setCssProps({ "--sk-hue": String(hue) });
		el.classList.toggle("is-current", !!node && node.id === this.options.current);
		el.classList.toggle("is-expanded", expanded);
		el.classList.toggle("is-root", row.depth === 0);
		el.setCssProps({ "--sk-map-level": String(row.depth) });
		el.setAttribute("role", "treeitem");
		// Named by hidden text, not by aria-label: Obsidian shows an aria-label as a tooltip on hover.
		const name = node?.title || node?.label || this.options.strings.moreLabel(row.more, this.options.source.node(row.parent!)?.label ?? "");
		let sr = el.querySelector<HTMLElement>(":scope > .sk-map-sr");
		if (!sr) { sr = el.createSpan(); sr.className = "sk-map-sr"; }
		sr.id = el.id + "-name";
		if (sr.textContent !== name) sr.textContent = name;
		el.setAttribute("aria-labelledby", sr.id);
		el.setAttribute("aria-level", String(row.depth + 1));
		el.setAttribute("aria-posinset", String(row.position));
		el.setAttribute("aria-setsize", String(row.size));
		if (node?.hasChildren) el.setAttribute("aria-expanded", String(expanded)); else el.removeAttribute("aria-expanded");
		el.removeAttribute("aria-owns");
	}

	drawEdges(animate = false): void {
		if (this.mode !== "columns") return;
		const position = (el: HTMLElement): { x: number; y: number } => {
			let x = 0, y = 0;
			for (let current: HTMLElement | null = el; current && current !== this.box; current = current.offsetParent as HTMLElement | null) {
				x += current.offsetLeft; y += current.offsetTop;
				const parent = current.offsetParent as HTMLElement | null;
				if (parent && parent !== this.box) { x -= parent.scrollLeft; y -= parent.scrollTop; }
			}
			return { x, y };
		};
		const used = new Set<string>();
		for (const [key, entry] of this.entries) {
			const parent = entry.row.parent && this.entries.get(nodeKey(entry.row.parent));
			if (!parent) continue;
			// The folded root hides its name: the branch leaves from the pill itself.
			const label = parent.el.classList.contains("is-folded") ? parent.el : parent.el.querySelector<HTMLElement>(".sk-map-label")!;
			const p = position(label), r = position(entry.el);
			let edge = this.edges.get(key); const fresh = !edge;
			if (!edge) {
				edge = this.svg.createSvg("path");
				edge.setAttribute("pathLength", "1"); this.svg.append(edge); this.edges.set(key, edge);
			}
			// The right edge of the parent's column (or of the root): the branch runs straight to it.
			const column = parent.el.parentElement !== this.box ? parent.el.parentElement : null;
			const run = column ? column.offsetLeft + column.offsetWidth + 2 : parent.el.offsetLeft + parent.el.offsetWidth + 2;
			const d = branchPath(p.x + label.offsetWidth + 4, p.y + label.offsetHeight / 2, r.x - 2, r.y + entry.el.offsetHeight / 2, run);
			edge.setAttribute("d", d);
			edge.style.setProperty("d", `path("${d}")`);
			const clip = entry.el.closest<HTMLElement>(".is-overflow");
			edge.style.visibility = clip && (entry.el.offsetTop < clip.scrollTop || entry.el.offsetTop + L.nodeHeight > clip.scrollTop + clip.clientHeight) ? "hidden" : "";
			const hue = entry.el.style.getPropertyValue("--sk-hue");
			if (hue) edge.setCssProps({ "--sk-hue": hue }); else edge.style.removeProperty("--sk-hue");
			used.add(key);
			if (fresh && animate && !this.life.reduced) this.life.animate(edge, [{ strokeDasharray: "1", strokeDashoffset: "1" }, { strokeDasharray: "1", strokeDashoffset: "0" }], 260, (entry.row.position - 1) * 14 + 60);
		}
		for (const [key, edge] of this.edges) if (!used.has(key)) { this.edges.delete(key); this.leave(edge, animate); }
	}

	highlight(key: string | null): void {
		const path = new Set<string>();
		let row = key ? this.entries.get(key)?.row : undefined;
		while (row && !path.has(row.key)) {
			path.add(row.key);
			row = row.parent ? this.entries.get(nodeKey(row.parent))?.row : undefined;
		}
		for (const [id, entry] of this.entries) entry.el.classList.toggle("is-path", path.has(id));
		for (const [id, edge] of this.edges) edge.classList.toggle("is-active", path.has(id) && !this.entries.get(id)?.el.classList.contains("is-gray"));
		for (const [id, group] of this.groups) {
			const entry = this.entries.get(nodeKey(id));
			const hue = entry?.el.style.getPropertyValue("--sk-hue");
			group.classList.toggle("is-active", path.has(nodeKey(id)) && !!hue);
			if (hue) group.setCssProps({ "--sk-hue": hue }); else group.style.removeProperty("--sk-hue");
		}
	}

	private leave(el: Element, animate: boolean, ancestor = false): void {
		el.removeAttribute("id"); el.removeAttribute("data-nav"); el.removeAttribute("data-map-key");
		el.removeAttribute("tabindex");
		el.setAttribute("aria-hidden", "true"); el.classList.add("is-leaving");
		if ("inert" in el) (el as HTMLElement).inert = true;
		if (animate) this.life.animate(el, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: ancestor ? "translateX(-24px)" : "none" }], ancestor ? 200 : 120, 0, false, () => el.remove());
		else el.remove();
	}
	private clear(): void {
		for (const entry of this.entries.values()) entry.el.remove();
		for (const group of this.groups.values()) group.remove();
		this.entries.clear(); this.groups.clear(); this.edges.clear(); this.svg.replaceChildren();
	}
	destroy(): void {
		this.clear(); this.labels = []; this.rows = []; this.canvas = null; this.box.replaceChildren();
	}
}
