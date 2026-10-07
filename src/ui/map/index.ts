import { Surface } from "../surface";
import { inTriangle, mapMode, nodeKey, pathFrom, startingChain, validChain, type MapRow, type Point } from "./layout";
import { dropZone, nextAfter, sameOrder, type Zone } from "./drop";
import { keyMove } from "./keys";
import { MapLifetime } from "./motion";
import { MapScene } from "./scene";
import { MAP_LIMITS as L, type MapEdit, type MapEvents, type MapHandle, type MapOptions, type MapState } from "./types";

export type { MapEdit, MapEvents, MapHandle, MapNode, MapNodeKind, MapOptions, MapSource, MapState, MapStrings } from "./types";
export { MAP_LIMITS } from "./types";

let mapId = 0;

/** The caller owns this handle and registers destroy with its module context. */
export function mountMap(el: HTMLElement, options: MapOptions, events: MapEvents): MapHandle {
	const doc = el.ownerDocument, win = doc.defaultView!;
	const life = new MapLifetime(win), source = options.source;
	const shell = doc.createElement("div"); shell.className = "sk-map";
	const crumbs = doc.createElement("nav"); crumbs.className = "sk-map-crumbs";
	const viewport = doc.createElement("div"); viewport.className = "sk-map-viewport";
	const box = doc.createElement("div"); box.className = "sk-map-stage"; box.setAttribute("role", "tree");
	// Named by hidden text, not by aria-label: Obsidian shows an aria-label as a tooltip on hover.
	const names = doc.createElement("span"); names.className = "sk-map-sr";
	const crumbsName = doc.createElement("span"), treeName = doc.createElement("span");
	crumbsName.id = `sk-map-names-${++mapId}-crumbs`; treeName.id = `sk-map-names-${mapId}-tree`;
	crumbsName.textContent = options.strings.breadcrumbs; treeName.textContent = options.strings.tree; names.append(crumbsName, treeName);
	crumbs.setAttribute("aria-labelledby", crumbsName.id); box.setAttribute("aria-labelledby", treeName.id);
	const tip = doc.createElement("div"); tip.className = "sk-map-tooltip"; tip.setAttribute("role", "tooltip"); tip.hidden = true;
	viewport.append(box); shell.append(names, crumbs, viewport, tip); el.append(shell);
	const coarse = win.matchMedia("(pointer: coarse)");
	const phone = () => doc.body.classList.contains("is-phone") || doc.body.classList.contains("is-mobile") || coarse.matches;
	let width = el.clientWidth;
	let mode = mapMode(width, phone(), options.mode);
	let state: MapState = options.state ? { ...options.state, chain: [...options.state.chain] } : {
		root: options.home, chain: startingChain(source, options.home, options.current, mode === "columns"), focus: null,
	};
	let dead = false, drawing = false, silentFocus = false;
	// The root folded into a pill (fourth level) stays folded while the pointer is on the Map, so
	// the columns do not slide back and forth under it; it unfolds when the pointer leaves, by
	// the pill, the breadcrumbs or the keyboard.
	let folded = false, inside = false;
	let activeKey: string | null = state.focus ? nodeKey(state.focus) : null;
	let hoverKey: string | null = null, overKey: string | null = null;
	let lastPoint: Point | null = null;
	let apex: (Point & { time: number; key: string }) | null = null;
	let hold: { id: string; event: KeyboardEvent } | null = null;
	let touch: { key: string; x: number; y: number; pointer: number } | null = null;
	let suppressClick: string | null = null;
	const last = new Map<string, string>(), open = new Set(state.chain);
	// Parents whose "N more" was opened: all their children show, while their branch stays open.
	const grown = new Set<string>();
	const scene = new MapScene(box, options, life);
	const getState = (): MapState => ({ ...state, chain: [...state.chain] });
	const changed = () => events.change?.(getState());
	const rowOf = (target: EventTarget | null): MapRow | null => {
		const node = target as Element | null;
		const element = node && typeof node.closest === "function" ? node.closest<HTMLElement>("[data-map-key]") : null;
		return element && box.contains(element) ? scene.entries.get(element.dataset.mapKey!)?.row ?? null : null;
	};
	const roving = () => {
		const key = activeKey && scene.entries.has(activeKey) ? activeKey : nodeKey(state.root);
		for (const [id, entry] of scene.entries) entry.el.tabIndex = id === key ? 0 : -1;
		box.tabIndex = scene.entries.size ? -1 : 0;
	};
	const hideTip = () => { life.cancel("tip"); tip.hidden = true; };
	const cancelHold = () => { life.cancel("hold"); hold = null; surface.cursorEl.classList.remove("is-held"); };
	const stopHover = () => { life.cancel("hover"); life.cancel("safety"); hideTip(); hoverKey = null; overKey = null; apex = null; };
	/** "N more" opened (hover, click, Enter, →): every child of that parent shows in its column. */
	const grow = (row: MapRow, focusFirst = false) => {
		if (row.node || !row.parent || grown.has(row.parent)) return;
		const parent = row.parent, first = row.position;
		grown.add(parent); stopHover(); draw();
		if (focusFirst) {
			const next = scene.rows.find((r) => r.parent === parent && r.depth === row.depth && r.position === first);
			if (next) focusKey(next.key);
		}
		changed();
	};
	const activate = (row: MapRow) => {
		if (mode === "tree") return;
		if (row.depth === 0 && folded) return;
		if (!row.node) { grow(row); return; }
		const chain = row.node ? pathFrom(source, state.root, row.node.id) : pathFrom(source, state.root, row.parent);
		if (row.node && row.parent) last.set(row.parent, row.node.id);
		if (chain.length === state.chain.length && chain.every((id, i) => state.chain[i] === id)) return;
		state.chain = chain.slice(0, L.depth); draw(); changed();
	};
	const showTip = (row: MapRow) => {
		hideTip();
		const entry = scene.entries.get(row.key); if (!entry || !row.node) return;
		const label = entry.el.querySelector<HTMLElement>(".sk-map-label")!;
		if (row.node.title && row.node.title !== row.node.label || label.scrollWidth > label.clientWidth + 1) {
			life.after("tip", 500, () => {
				if (hoverKey !== row.key || !entry.el.isConnected) return;
				tip.textContent = row.node!.title || row.node!.label; tip.hidden = false;
				const r = entry.el.getBoundingClientRect();
				const x = Math.max(6, Math.min(r.left, win.innerWidth - tip.offsetWidth - 6));
				const y = Math.max(6, Math.min(r.bottom + 6, win.innerHeight - tip.offsetHeight - 6));
				tip.style.left = `${x}px`; tip.style.top = `${y}px`;
				// A contained ancestor (Obsidian's leaf has contain: strict) anchors "fixed" to itself: take its offset out.
				const t = tip.getBoundingClientRect();
				tip.style.left = `${2 * x - t.left}px`; tip.style.top = `${2 * y - t.top}px`;
			});
		}
	};
	const pointAt = (row: MapRow) => {
		life.cancel("safety");
		if (hoverKey === row.key) {
			life.after("hover", L.hoverIntent, () => { if (overKey === row.key) activate(row); });
			return;
		}
		hoverKey = row.key;
		const item = scene.entries.get(row.key)?.el;
		if (item) surface.set(item, "mouse");
		life.after("hover", L.hoverIntent, () => { if (hoverKey === row.key && overKey === row.key) activate(row); });
		showTip(row);
	};
	// Own map pointer routing before Surface: the safety triangle protects the cursor too.
	life.listen(box, "pointermove", (event) => {
		const e = event as PointerEvent;
		if (e.pointerType === "touch" || mode === "tree") return;
		inside = true;
		// While a node is dragged, no hover unfolding and no gliding cursor: the drop decides alone.
		if (drag?.moving) { e.stopImmediatePropagation(); return; }
		e.stopImmediatePropagation();
		const row = rowOf(e.target), p = { x: e.clientX, y: e.clientY };
		const previous = lastPoint; lastPoint = p; overKey = row?.key ?? null;
		if (!row) { life.cancel("hover"); hideTip(); return; }
		if (hoverKey === row.key && scene.entries.get(row.key)?.el.getAttribute("aria-expanded") === "true") apex = { ...p, time: win.performance.now(), key: row.key };
		if (apex && row.key !== apex.key && (!previous || p.x >= previous.x - 0.5)) {
			const elapsed = win.performance.now() - apex.time, parent = scene.entries.get(apex.key)?.row;
			const rects = (parent?.node ? scene.rows.filter((r) => r.parent === parent.node!.id) : []).map((r) => scene.entries.get(r.key)!.el.getBoundingClientRect());
			if (elapsed < L.safetyTriangle && parent && row.depth <= parent.depth && rects.length) {
				const x = Math.min(...rects.map((r) => r.left));
				if (inTriangle(p, apex, { x, y: Math.min(...rects.map((r) => r.top)) - 6 }, { x, y: Math.max(...rects.map((r) => r.bottom)) + 6 })) {
					life.cancel("hover"); life.after("safety", L.safetyTriangle - elapsed, () => { if (overKey === row.key) pointAt(row); }); return;
				}
			}
		}
		pointAt(row);
	});
	const surface = new Surface(box, {
		itemSelector: "[data-map-key]", scrollEl: viewport, sticky: () => true,
		onSet(item) {
			const row = scene.entries.get(item.dataset.mapKey!)?.row; if (!row) return;
			activeKey = row.key; state.focus = row.node?.id ?? null; scene.highlight(activeKey); roving();
		},
	});
	life.add(() => surface.destroy());
	life.listen(box, "pointerleave", () => {
		stopHover(); inside = false;
		if (folded && !drag) life.after("unfold", 250, () => { if (!inside && !drag && folded) draw(); });
	});
	life.listen(box, "focusin", (event) => {
		if (drawing || silentFocus || (event.target as Element).closest?.(".sk-map-edit")) return;
		// Reaching "N more" by the keyboard does not open it: Enter or → does.
		const row = rowOf(event.target); if (!row?.node) return;
		stopHover(); cancelHold(); activate(row); changed();
	});
	life.listen(box, "focusout", (event) => {
		if (drawing || silentFocus) return;
		const next = (event as FocusEvent).relatedTarget as Node | null;
		if (!next || !box.contains(next)) cancelHold();
	});
	const focusKey = (key: string | null, unfold = false) => {
		const entry = scene.entries.get(key ?? "") ?? scene.entries.get(nodeKey(state.root));
		if (!entry) { box.focus(); return; }
		silentFocus = true; surface.focus(entry.el); silentFocus = false;
		const column = entry.el.closest<HTMLElement>(".sk-map-group.is-overflow");
		if (column) {
			const top = entry.el.offsetTop;
			if (top < column.scrollTop) column.scrollTop = top;
			else if (top + L.nodeHeight > column.scrollTop + column.clientHeight) column.scrollTop = top + L.nodeHeight - column.clientHeight;
		}
		if (unfold && entry.row.node) activate(entry.row);
	};
	const renderCrumbs = () => {
		crumbs.replaceChildren(); if (state.root === options.home && !folded) return;
		const ancestors: string[] = [], seen = new Set<string>();
		let id: string | null = state.root;
		while (id && !seen.has(id)) { seen.add(id); ancestors.unshift(id); if (id === options.home) break; id = source.parent(id); }
		if (mode === "tree" && ancestors.length > 1) {
			const back = doc.createElement("button"); back.type = "button"; back.tabIndex = -1;
			back.className = "sk-btn is-ghost is-s"; back.dataset.mapRoot = ancestors[ancestors.length - 2]; back.textContent = options.strings.back; crumbs.append(back);
		}
		ancestors.forEach((ancestor, i) => {
			if (i) { const separator = doc.createElement("span"); separator.className = "sk-map-crumb-separator"; separator.setAttribute("aria-hidden", "true"); options.icon(separator, "chevron-right"); crumbs.append(separator); }
			// Folded: the root's name moves up here, as a button that unfolds it.
			const last = i === ancestors.length - 1, button = !last || folded;
			const item = doc.createElement(button ? "button" : "span"); item.textContent = source.node(ancestor)?.label ?? "";
			if (button) {
				(item as HTMLButtonElement).type = "button"; item.tabIndex = -1; item.className = "sk-btn is-ghost is-s";
				if (last) item.dataset.mapUnfold = ""; else item.dataset.mapRoot = ancestor;
			} else item.setAttribute("aria-current", "page");
			crumbs.append(item);
		});
	};
	function draw(animate = true): void {
		if (dead || drawing) return;
		drawing = true;
		const focused = doc.activeElement as HTMLElement | null;
		const hadFocus = !!focused && box.contains(focused);
		if (!source.node(state.root)) { state.root = options.home; state.chain = []; }
		// A grown column folds back when its branch closes (another branch, another root).
		const branch = new Set([state.root, ...state.chain]);
		for (const id of grown) if (!source.node(id) || (mode === "tree" ? id !== state.root && !open.has(id) : !branch.has(id))) grown.delete(id);
		state.chain = validChain(source, state.root, state.chain, grown);
		for (const id of grown) if (mode !== "tree" && id !== state.root && !state.chain.includes(id)) grown.delete(id);
		for (const id of open) if (!source.node(id)) open.delete(id);
		scene.draw(state, mode, width, open, animate, folded && (inside || !!drag), grown);
		folded = scene.folded;
		if (!activeKey || !scene.entries.has(activeKey)) activeKey = nodeKey(state.root);
		state.focus = scene.entries.get(activeKey)?.row.node?.id ?? null;
		roving(); scene.highlight(activeKey); renderCrumbs(); placeEdit();
		const target = scene.entries.get(activeKey)?.el;
		if (target && hadFocus && focused !== editing?.input && (!focused?.isConnected || !focused.hasAttribute("data-map-key"))) focusKey(activeKey);
		else if (target && surface.current) surface.set(target, "mouse", true);
		else surface.clear();
		drawing = false;
	}
	const goRoot = (id: string, chain?: string[], focus?: string) => {
		if (dead || !source.node(id)) return;
		life.cancel("click"); cancelHold(); stopHover();
		state.root = id; state.chain = chain ?? startingChain(source, id, options.current, mode === "columns"); folded = false;
		open.clear(); state.chain.forEach((child) => open.add(child));
		activeKey = focus ?? nodeKey(id); state.focus = id; draw(); changed();
	};
	const recenter = (id: string) => goRoot(id);
	const toggle = (row: MapRow) => {
		if (!row.node?.hasChildren) return;
		if (row.depth >= L.depth) { recenter(row.node.id); return; }
		if (row.depth === 0) return;
		if (open.has(row.node.id)) open.delete(row.node.id); else open.add(row.node.id);
		state.chain = pathFrom(source, state.root, open.has(row.node.id) ? row.node.id : row.parent).slice(0, L.depth); draw(); changed();
	};
	const openRow = (row: MapRow, event: MouseEvent | KeyboardEvent, immediate = false) => {
		life.cancel("click");
		if (!row.node) { grow(row, "key" in event); return; }
		const id = row.node.id, tab = event.ctrlKey || event.metaKey || "button" in event && event.button === 1;
		if (tab || immediate) { events.open(id, tab ? "tab" : "same", event); return; }
		const item = scene.entries.get(row.key)?.el;
		item?.classList.add("is-pressed"); life.after(`press:${row.key}`, 140, () => item?.classList.remove("is-pressed"));
		life.after("click", L.doubleClick, () => { if (source.node(id)) events.open(id, "same", event); });
	};
	/** The pill or the root's crumb: back to three columns, the root whole. */
	const unfold = () => {
		life.cancel("click"); stopHover(); folded = false;
		state.chain = state.chain.slice(0, L.columns - 1); draw(); changed();
	};
	life.listen(crumbs, "click", (event) => {
		if ((event.target as Element).closest("[data-map-unfold]")) { unfold(); return; }
		const button = (event.target as Element).closest<HTMLElement>("[data-map-root]");
		if (button) goRoot(button.dataset.mapRoot!, pathFrom(source, button.dataset.mapRoot!, state.root));
	});
	life.listen(box, "click", (event) => {
		const e = event as MouseEvent, row = rowOf(e.target); if (!row) return;
		e.stopPropagation();
		if (suppressClick === row.key) { suppressClick = null; e.preventDefault(); return; }
		if ((e.target as Element).closest(".sk-map-edit")) return;
		cancelHold();
		if (row.depth === 0 && folded && mode === "columns" && !e.ctrlKey && !e.metaKey) { unfold(); return; }
		const action = (e.target as Element).closest<HTMLElement>("[data-map-action]")?.dataset.mapAction;
		if (action === "recenter" && row.node) { recenter(row.node.id); return; }
		if (action === "open" || e.ctrlKey || e.metaKey) { openRow(row, e, true); return; }
		if (mode === "tree" && row.node?.hasChildren && row.depth > 0) { toggle(row); return; }
		if (e.detail > 1) { life.cancel("click"); return; }
		openRow(row, e, mode === "tree");
	});
	life.listen(box, "dblclick", (event) => {
		const e = event as MouseEvent, row = rowOf(e.target); if (!row || e.ctrlKey || e.metaKey || mode === "tree") return;
		e.preventDefault(); e.stopPropagation(); life.cancel("click"); if (row.node) recenter(row.node.id);
	});
	life.listen(box, "auxclick", (event) => {
		const e = event as MouseEvent, row = rowOf(e.target);
		if (row && e.button === 1) { e.preventDefault(); e.stopPropagation(); openRow(row, e, true); }
	});
	life.listen(box, "contextmenu", (event) => {
		const e = event as MouseEvent, row = rowOf(e.target); if (!row?.node) return;
		e.preventDefault(); e.stopPropagation(); life.cancel("click"); life.cancel("longpress"); cancelHold();
		if (suppressClick !== row.key) events.menu(row.node.id, e);
	});
	life.listen(box, "pointerdown", (event) => {
		const e = event as PointerEvent; suppressClick = null;
		const row = rowOf(e.target); if (!row) return;
		activeKey = row.key; state.focus = row.node?.id ?? null; roving();
		if (e.button === 1) e.preventDefault();
		if (e.pointerType !== "touch" || !row.node || (e.target as Element).closest("button")) return;
		touch = { key: row.key, x: e.clientX, y: e.clientY, pointer: e.pointerId };
		life.after("longpress", L.longPress, () => {
			if (!touch || !row.node) return;
			suppressClick = row.key; life.cancel("click"); events.menu(row.node.id, e);
		});
	});
	for (const name of ["pointerup", "pointercancel"]) life.listen(doc, name, () => { life.cancel("longpress"); touch = null; });
	life.listen(doc, "pointermove", (event) => {
		const e = event as PointerEvent;
		if (touch && touch.pointer === e.pointerId && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > 8) { life.cancel("longpress"); touch = null; }
	});

	// Drag and drop (mouse, columns). A node the caller lets move is dragged freely: a copy follows
	// the pointer. Each node of the Map is a band as wide as its column (gaps included, so the target
	// never blinks off between two rows). On a sibling, the top third puts it before, the bottom
	// third after (a line shows where), the middle makes it the parent (that node lights up), with a
	// little hysteresis (drop.ts). On another node: onto it, when the caller accepts (events.canDrop).
	// Holding still a moment over a folded node unfolds it, to drop deeper. Near an edge, the Map
	// and the page scroll. What shows is exactly what the release does. Escape cancels.
	type Drop = { kind: "order"; before: string | null } | { kind: "into"; target: string };
	type Found = { drop: Drop | null; key: string | null; zone: Zone | null; line?: { left: number; width: number; top: number }; target?: HTMLElement; row?: MapRow };
	let drag: { id: string; parent: string | null; depth: number; el: HTMLElement; ghost: HTMLElement | null;
		x: number; y: number; offX: number; offY: number; px: number; py: number; pointer: number; moving: boolean;
		found: Found | null; spring: { key: string; x: number; y: number } | null; scroller: HTMLElement | null } | null = null;
	const line = doc.createElement("div"); line.className = "sk-map-drop"; line.hidden = true; box.append(line);
	let lit: HTMLElement | null = null;
	const light = (el: HTMLElement | null) => {
		if (lit === el) return;
		lit?.classList.remove("is-drop-target"); lit = el; lit?.classList.add("is-drop-target");
	};
	const endDrag = () => {
		if (!drag) return;
		life.cancel("spring"); life.cancel("autoscroll");
		scene.entries.get(nodeKey(drag.id))?.el.classList.remove("is-dragged");
		drag.el.classList.remove("is-dragged"); drag.ghost?.remove();
		line.hidden = true; light(null); box.classList.remove("is-dragging"); drag = null;
		if (folded && !inside) draw();
	};
	const canOrder = (id: string) => !!events.move && !!events.canMove?.(id);
	/** The nearest ancestor that scrolls vertically (the Home page), for scrolling while dragging. */
	const scrollerOf = (): HTMLElement | null => {
		for (let el = shell.parentElement; el; el = el.parentElement) {
			const y = win.getComputedStyle(el).overflowY;
			if ((y === "auto" || y === "scroll") && el.scrollHeight > el.clientHeight + 1) return el;
		}
		return null;
	};
	life.listen(box, "pointerdown", (event) => {
		const e = event as PointerEvent;
		if (e.pointerType !== "mouse" || e.button !== 0 || mode !== "columns" || (!events.move && !events.drop)) return;
		if ((e.target as Element).closest("button, .sk-map-edit")) return;
		const row = rowOf(e.target); if (!row?.node || row.depth === 0) return;
		if (!canOrder(row.node.id) && !events.drop) return;
		const el = scene.entries.get(row.key)?.el; if (!el) return;
		const r = el.getBoundingClientRect();
		drag = { id: row.node.id, parent: row.parent, depth: row.depth, el, ghost: null, x: e.clientX, y: e.clientY,
			offX: e.clientX - r.left, offY: e.clientY - r.top, px: e.clientX, py: e.clientY, pointer: e.pointerId, moving: false,
			found: null, spring: null, scroller: null };
	});
	/** The node whose band holds the point: its column's width (gaps included), half the row gap above and below. */
	const bandAt = (px: number, py: number): { row: MapRow; el: HTMLElement; rect: DOMRect } | null => {
		for (const entry of scene.entries.values()) {
			if (!entry.el.isConnected || entry.el.classList.contains("is-leaving")) continue;
			const rect = entry.el.getBoundingClientRect();
			const group = entry.el.closest<HTMLElement>(".sk-map-group");
			const g = group?.getBoundingClientRect();
			const half = (L.rowStep - L.nodeHeight) / 2 + 0.5;
			const left = g ? g.left - 10 : rect.left - 10, right = g ? g.right + 10 : rect.right + 10;
			if (px < left || px > right || py < rect.top - half || py > rect.bottom + half) continue;
			// A row scrolled out of its column does not count.
			if (g && (py < g.top || py > g.bottom)) continue;
			return { row: entry.row, el: entry.el, rect };
		}
		return null;
	};
	/** Where the pointer would drop the dragged node (with the zone shown just before, for the hysteresis). */
	const dropAt = (px: number, py: number, previous: Found | null): Found => {
		const none: Found = { drop: null, key: null, zone: null };
		if (!drag) return none;
		const id = drag.id, parent = drag.parent, depth = drag.depth, ordering = canOrder(id);
		const all = parent === null ? [] : source.children(parent).map((n) => n.id);
		const columnOf = (el: HTMLElement) => el.closest<HTMLElement>(".sk-map-group")?.getBoundingClientRect() ?? el.getBoundingClientRect();
		const order = (before: string | null, el: HTMLElement, edge: number, key: string, zone: Zone): Found => {
			// Landing where it already is: nothing to show, nothing to do.
			if (sameOrder(all, id, before)) return { ...none, key, zone };
			const c = columnOf(el);
			return { drop: { kind: "order", before }, key, zone, line: { left: c.left + 4, width: c.width - 8, top: edge } };
		};
		const hit = bandAt(px, py);
		if (hit?.row.node) {
			const { row, el, rect } = hit, target = row.node!.id;
			if (target === id) return { ...none, key: row.key };
			const sibling = ordering && row.parent === parent && row.depth === depth;
			const accepts = !!events.drop && !!events.canDrop?.(id, target);
			const zone = dropZone((py - rect.top) / rect.height, sibling, accepts, previous?.key === row.key ? previous.zone : null);
			if (zone === "into") return { drop: { kind: "into", target }, key: row.key, zone, target: el, row };
			if (zone === "before") return order(target, el, rect.top - 1, row.key, zone);
			if (zone === "after") return order(nextAfter(all, id, target), el, rect.bottom + 1, row.key, zone);
			return { ...none, key: row.key };
		}
		// Below the last sibling shown in its own column (or on its "N more"): at the end of what shows.
		if (ordering && hit && !hit.row.node && hit.row.parent === parent && hit.row.depth === depth) {
			const shown = scene.rows.filter((r) => r.node && r.parent === parent && r.depth === depth);
			const lastShown = shown[shown.length - 1];
			const el = lastShown && scene.entries.get(lastShown.key)?.el;
			if (lastShown && el) return order(nextAfter(all, id, lastShown.node!.id), el, el.getBoundingClientRect().bottom + 1, hit.row.key, "after");
		}
		return none;
	};
	/** The ghost under the pointer, where it was grabbed. */
	const placeGhost = () => {
		if (!drag?.ghost) return;
		const b = shell.getBoundingClientRect();
		drag.ghost.style.left = `${drag.px - drag.offX - b.left}px`; drag.ghost.style.top = `${drag.py - drag.offY - b.top}px`;
	};
	/** The drop under the pointer, shown (line or lit node); called again whenever the layout moves. */
	const aim = (): Found => {
		if (!drag) return { drop: null, key: null, zone: null };
		const found = dropAt(drag.px, drag.py, drag.found);
		drag.found = found;
		light(found.target ?? null);
		if (found.line) {
			const b = box.getBoundingClientRect();
			line.style.left = `${found.line.left - b.left}px`; line.style.width = `${found.line.width}px`; line.style.top = `${found.line.top - b.top - 1}px`; line.hidden = false;
		} else line.hidden = true;
		placeGhost();
		// A folded node the pointer rests on (to drop onto it) opens after a moment, to go deeper.
		const row = found.drop?.kind === "into" ? found.row : null;
		const closed = row?.node?.hasChildren && row.node.id !== state.chain[row.depth - 1] ? row : null;
		if (!closed) { drag.spring = null; life.cancel("spring"); }
		else if (drag.spring?.key !== closed.key || Math.hypot(drag.px - drag.spring.x, drag.py - drag.spring.y) > 8) {
			drag.spring = { key: closed.key, x: drag.px, y: drag.py };
			life.after("spring", L.springOpen, () => {
				if (!drag || drag.spring?.key !== closed.key || drag.found?.drop?.kind !== "into" || drag.found.key !== closed.key) return;
				const chain = pathFrom(source, state.root, closed.node!.id);
				if (!chain.length) return;
				state.chain = chain.slice(0, L.depth); draw(); changed();
				// The dragged node may have left the screen with its column: its copy goes on.
				const now = scene.entries.get(nodeKey(drag.id))?.el;
				if (now) { now.classList.add("is-dragged"); drag.el = now; }
				drag.spring = null;
				// The columns moved (and the root may have folded): aim again, without waiting for the pointer.
				aim();
			});
		}
		return found;
	};
	/** Near an edge, the Map (sideways, a long column) and the page scroll, then the drop is aimed again. */
	const autoscroll = () => {
		if (!drag?.moving) return;
		const speed = (distance: number) => Math.ceil(Math.min(16, (36 - distance) / 2.5));
		let moved = false;
		const v = viewport.getBoundingClientRect();
		if (drag.px < v.left + 36 && viewport.scrollLeft > 0) { viewport.scrollLeft -= speed(drag.px - v.left); moved = true; }
		else if (drag.px > v.right - 36 && viewport.scrollLeft < viewport.scrollWidth - viewport.clientWidth) { viewport.scrollLeft += speed(v.right - drag.px); moved = true; }
		for (const group of Array.from(box.querySelectorAll<HTMLElement>(".sk-map-group.is-overflow"))) {
			const g = group.getBoundingClientRect();
			if (drag.px < g.left || drag.px > g.right) continue;
			if (drag.py < g.top + 28 && drag.py > g.top - 8 && group.scrollTop > 0) { group.scrollTop -= speed(Math.max(0, drag.py - g.top)); moved = true; }
			else if (drag.py > g.bottom - 28 && drag.py < g.bottom + 8 && group.scrollTop < group.scrollHeight - group.clientHeight) { group.scrollTop += speed(Math.max(0, g.bottom - drag.py)); moved = true; }
		}
		const page = drag.scroller;
		if (page) {
			const p = page.getBoundingClientRect();
			if (drag.py < p.top + 36 && page.scrollTop > 0) { page.scrollTop -= speed(Math.max(0, drag.py - p.top)); moved = true; }
			else if (drag.py > p.bottom - 36 && page.scrollTop < page.scrollHeight - page.clientHeight) { page.scrollTop += speed(Math.max(0, p.bottom - drag.py)); moved = true; }
		}
		if (moved) { scene.drawEdges(); aim(); }
		life.frame(autoscroll);
	};
	// Capture phase: the box's hover routing above stops the event before it would bubble here.
	life.listen(doc, "pointermove", (event) => {
		const e = event as PointerEvent;
		if (!drag || e.pointerId !== drag.pointer) return;
		drag.px = e.clientX; drag.py = e.clientY;
		if (!drag.moving) {
			// A few pixels of slack: a click with a shaky hand stays a click.
			if (Math.hypot(drag.px - drag.x, drag.py - drag.y) < 6) return;
			drag.moving = true; stopHover(); hideTip(); life.cancel("click"); life.cancel("unfold");
			const ghost = drag.el.cloneNode(true) as HTMLElement;
			ghost.removeAttribute("id"); ghost.removeAttribute("data-map-key"); ghost.removeAttribute("data-nav");
			ghost.classList.add("sk-map-ghost"); ghost.classList.remove("is-hi", "is-pressed", "is-current"); ghost.setAttribute("aria-hidden", "true");
			Object.assign(ghost.style, { width: `${drag.el.getBoundingClientRect().width}px`, maxWidth: "none", transform: "none" });
			shell.append(ghost); drag.ghost = ghost;
			drag.el.classList.add("is-dragged"); box.classList.add("is-dragging");
			drag.scroller = scrollerOf();
			life.frame(autoscroll);
		}
		e.preventDefault();
		aim();
	}, true);
	life.listen(doc, "pointerup", (event) => {
		const e = event as PointerEvent;
		if (!drag || e.pointerId !== drag.pointer) return;
		// Where the button is released, on the layout as it is now (it may have moved since the last move).
		if (drag.moving) { drag.px = e.clientX; drag.py = e.clientY; aim(); }
		const { id, moving } = drag, drop = drag.found?.drop ?? null;
		const key = nodeKey(id);
		endDrag();
		if (!moving) return;
		suppressClick = key; life.cancel("click"); stopHover();
		if (drop?.kind === "order") events.move!(id, drop.before);
		else if (drop?.kind === "into") {
			events.drop!(id, drop.target);
			// Show the new parent unfolded: its new child appears there once the caller's data follows.
			const chain = pathFrom(source, state.root, drop.target);
			if (chain.length && chain.length <= L.depth) { state.chain = chain; draw(); changed(); }
		}
	}, true);
	// No native drag (text or link) while a node is held.
	life.listen(box, "dragstart", (event) => { if (drag) event.preventDefault(); });
	life.listen(doc, "pointercancel", endDrag);
	life.listen(doc, "keydown", (event) => { if (drag?.moving && (event as KeyboardEvent).key === "Escape") { event.preventDefault(); event.stopPropagation(); endDrag(); } }, true);

	// The inline name field (MapHandle.edit): it lives in a node and survives redraws.
	let editing: { id: string; input: HTMLInputElement; options: MapEdit; busy: boolean } | null = null;
	const placeEdit = () => {
		if (!editing) return;
		const entry = scene.entries.get(nodeKey(editing.id));
		if (!entry) return;
		const { input } = editing;
		entry.el.classList.add("is-editing");
		const label = entry.el.querySelector<HTMLElement>(".sk-map-label");
		if (input.parentElement !== entry.el) {
			const [start, end] = [input.selectionStart, input.selectionEnd];
			if (label) label.after(input); else entry.el.append(input);
			// A redraw rebuilt the node: the field comes back with its focus and selection.
			input.focus({ preventScroll: true }); if (start !== null && end !== null) input.setSelectionRange(start, end);
		}
	};
	const stopEdit = () => {
		if (!editing) return;
		const { input, id } = editing; editing = null;
		input.remove(); scene.entries.get(nodeKey(id))?.el.classList.remove("is-editing");
		surface.repaint(true);
	};
	const reveal = (id: string): boolean => {
		if (dead || !source.node(id)) return false;
		if (id === state.root) return true;
		let path = pathFrom(source, state.root, id);
		if (!path.length) {
			if (id === options.home) { goRoot(options.home, []); return true; }
			path = pathFrom(source, options.home, id);
			if (!path.length) return false;
			goRoot(options.home, []);
		}
		if (path.length > L.depth) {
			const root = path[path.length - L.depth - 1];
			goRoot(root, path.slice(path.length - L.depth, -1));
		} else {
			const chain = path.slice(0, -1);
			const closed = chain.some((c) => !open.has(c));
			chain.forEach((c) => open.add(c));
			if (closed || chain.length !== state.chain.length || chain.some((c, i) => state.chain[i] !== c)) { state.chain = chain; draw(); changed(); }
		}
		// Same branch, but the node may be new to the source: draw again to show it.
		if (!scene.entries.has(nodeKey(id))) draw();
		return scene.entries.has(nodeKey(id));
	};
	const edit = (id: string, editOptions: MapEdit): boolean => {
		stopEdit();
		if (!reveal(id)) return false;
		const input = doc.createElement("input");
		input.type = "text"; input.className = "sk-map-edit"; input.value = editOptions.value; input.spellcheck = false;
		input.setAttribute("aria-label", editOptions.label);
		const current = { id, input, options: editOptions, busy: false };
		editing = current;
		activeKey = nodeKey(id); roving();
		placeEdit(); input.focus({ preventScroll: true }); input.select();
		const commit = async () => {
			if (editing !== current || current.busy) return;
			current.busy = true;
			let keep: boolean | void = undefined;
			try { keep = await current.options.commit(input.value); } catch (error) { console.error("[Snailkit] map: rename failed", error); }
			current.busy = false;
			if (editing !== current) return;
			if (keep === false) { input.focus({ preventScroll: true }); input.select(); return; }
			stopEdit(); focusKey(nodeKey(id));
		};
		input.addEventListener("keydown", (event) => {
			event.stopPropagation();
			if (event.isComposing) return;
			if (event.key === "Enter") { event.preventDefault(); void commit(); }
			else if (event.key === "Escape") { event.preventDefault(); if (editing !== current) return; stopEdit(); current.options.cancel(); focusKey(nodeKey(state.root)); }
		});
		for (const name of ["pointerdown", "pointermove", "click", "dblclick", "contextmenu", "keyup"]) input.addEventListener(name, (event) => event.stopPropagation());
		// Leaving the field keeps the name typed (not while the Map redraws and moves it).
		input.addEventListener("blur", () => { win.setTimeout(() => { if (editing === current && doc.activeElement !== input && !current.busy) void commit(); }, 0); });
		return true;
	};
	life.listen(box, "keydown", (event) => {
		const e = event as KeyboardEvent; if (e.isComposing || e.altKey || editing) return;
		const row = rowOf(e.target); if (!row) return;
		if (e.key === "Tab") { cancelHold(); stopHover(); return; }
		if (e.key !== "Enter" && (e.ctrlKey || e.metaKey)) return;
		if (e.key === "Enter") {
			e.preventDefault(); e.stopPropagation(); if (e.repeat || hold) return;
			if (e.ctrlKey || e.metaKey || !row.node) { openRow(row, e, true); return; }
			hold = { id: row.node.id, event: e }; surface.set(scene.entries.get(row.key)!.el, "key"); surface.cursorEl.classList.add("is-held");
			life.after("hold", L.holdToRecenter, () => { if (hold) { const id = hold.id; recenter(id); focusKey(nodeKey(id)); } });
			return;
		}
		if (e.key.toLowerCase() === "p" && !e.shiftKey && row.node) { e.preventDefault(); e.stopPropagation(); events.pin(row.node.id, scene.entries.get(row.key)!.el); return; }
		if ((e.key === "F10" && e.shiftKey || e.key === "ContextMenu") && row.node) { e.preventDefault(); e.stopPropagation(); cancelHold(); events.menu(row.node.id, e); return; }
		if (e.key === "ArrowRight" && !row.node) { e.preventDefault(); e.stopPropagation(); grow(row, true); return; }
		const intent = keyMove(e.key, row, scene.rows, state, source, options.home, mode, open, last); if (!intent) return;
		e.preventDefault(); e.stopPropagation(); cancelHold(); stopHover(); life.cancel("click");
		if (intent.escape) { surface.clear(); events.escape?.(); return; }
		if (intent.root) goRoot(intent.root, intent.chain, intent.key);
		else {
			if (intent.chain) state.chain = intent.chain;
			if (intent.collapse) open.delete(intent.collapse);
			if (intent.expand) open.add(intent.expand);
			if (intent.chain || intent.collapse || intent.expand) draw();
		}
		if (intent.key) focusKey(intent.key, e.key !== "ArrowLeft" && !intent.root);
		changed();
	});
	life.listen(doc, "keyup", (event) => {
		const e = event as KeyboardEvent; if (e.key !== "Enter" || !hold) return;
		e.preventDefault(); const held = hold; cancelHold(); if (source.node(held.id)) events.open(held.id, "same", held.event);
	});
	life.listen(win, "blur", () => { cancelHold(); stopHover(); life.cancel("longpress"); touch = null; });
	life.listen(viewport, "scroll", () => { hideTip(); life.cancel("longpress"); surface.repaint(true); });
	const scroll = () => { scene.drawEdges(); surface.repaint(true); };
	box.addEventListener("scroll", scroll, true); life.add(() => box.removeEventListener("scroll", scroll, true));
	const layout = () => {
		if (dead) return;
		width = el.clientWidth; const nextMode = mapMode(width, phone(), options.mode);
		if (nextMode !== mode) { mode = nextMode; stopHover(); cancelHold(); state.chain.forEach((id) => open.add(id)); }
		draw(false);
	};
	let pendingLayout = false;
	const scheduleLayout = () => { if (!pendingLayout) { pendingLayout = true; life.frame(() => { pendingLayout = false; layout(); }); } };
	const Resize = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
	if (Resize) { const observer = new Resize(scheduleLayout); observer.observe(el); life.add(() => observer.disconnect()); }
	life.listen(win, "resize", scheduleLayout); life.listen(coarse, "change", scheduleLayout);
	draw();
	return {
		update: () => { if (!dead) { cancelHold(); stopHover(); life.cancel("click"); draw(false); changed(); } },
		recenter, focus: () => { if (!dead) focusKey(activeKey); }, layout, getState, reveal, edit,
		destroy: () => { if (!dead) { dead = true; editing = null; drag?.ghost?.remove(); drag = null; life.destroy(); scene.destroy(); shell.remove(); } },
	};
}
