import { Surface } from "../surface";
import { inTriangle, mapMode, nodeKey, pathFrom, startingChain, validChain, type MapRow, type Point } from "./layout";
import { keyMove } from "./keys";
import { MapLifetime } from "./motion";
import { MapScene } from "./scene";
import { MAP_LIMITS as L, type MapEvents, type MapHandle, type MapOptions, type MapState } from "./types";

export type { MapEvents, MapHandle, MapNode, MapNodeKind, MapOptions, MapSource, MapState, MapStrings } from "./types";
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
	let activeKey: string | null = state.focus ? nodeKey(state.focus) : null;
	let hoverKey: string | null = null, overKey: string | null = null;
	let lastPoint: Point | null = null;
	let apex: (Point & { time: number; key: string }) | null = null;
	let hold: { id: string; event: KeyboardEvent } | null = null;
	let touch: { key: string; x: number; y: number; pointer: number } | null = null;
	let suppressClick: string | null = null;
	const last = new Map<string, string>(), open = new Set(state.chain);
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
	const activate = (row: MapRow) => {
		if (mode === "tree") return;
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
	life.listen(box, "pointerleave", stopHover);
	life.listen(box, "focusin", (event) => {
		if (drawing || silentFocus) return;
		const row = rowOf(event.target); if (!row) return;
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
		if (unfold) activate(entry.row);
	};
	const renderCrumbs = () => {
		crumbs.replaceChildren(); if (state.root === options.home) return;
		const ancestors: string[] = [], seen = new Set<string>();
		let id: string | null = state.root;
		while (id && !seen.has(id)) { seen.add(id); ancestors.unshift(id); if (id === options.home) break; id = source.parent(id); }
		if (mode === "tree" && ancestors.length > 1) {
			const back = doc.createElement("button"); back.type = "button"; back.tabIndex = -1;
			back.className = "sk-btn is-ghost is-s"; back.dataset.mapRoot = ancestors[ancestors.length - 2]; back.textContent = options.strings.back; crumbs.append(back);
		}
		ancestors.forEach((ancestor, i) => {
			if (i) { const separator = doc.createElement("span"); separator.className = "sk-map-crumb-separator"; separator.setAttribute("aria-hidden", "true"); options.icon(separator, "chevron-right"); crumbs.append(separator); }
			const item = doc.createElement(i === ancestors.length - 1 ? "span" : "button"); item.textContent = source.node(ancestor)?.label ?? "";
			if (item.tagName === "BUTTON") { (item as HTMLButtonElement).type = "button"; item.tabIndex = -1; item.className = "sk-btn is-ghost is-s"; item.dataset.mapRoot = ancestor; }
			else item.setAttribute("aria-current", "page");
			crumbs.append(item);
		});
	};
	function draw(animate = true): void {
		if (dead || drawing) return;
		drawing = true;
		const focused = doc.activeElement as HTMLElement | null;
		const hadFocus = !!focused && box.contains(focused);
		if (!source.node(state.root)) { state.root = options.home; state.chain = []; }
		state.chain = validChain(source, state.root, state.chain);
		for (const id of open) if (!source.node(id)) open.delete(id);
		scene.draw(state, mode, width, open, animate);
		if (!activeKey || !scene.entries.has(activeKey)) activeKey = nodeKey(state.root);
		state.focus = scene.entries.get(activeKey)?.row.node?.id ?? null;
		roving(); scene.highlight(activeKey); renderCrumbs();
		const target = scene.entries.get(activeKey)?.el;
		if (target && hadFocus && (!focused?.isConnected || !focused.hasAttribute("data-map-key"))) focusKey(activeKey);
		else if (target && surface.current) surface.set(target, "mouse", true);
		else surface.clear();
		drawing = false;
	}
	const goRoot = (id: string, chain?: string[], focus?: string) => {
		if (dead || !source.node(id)) return;
		life.cancel("click"); cancelHold(); stopHover();
		state.root = id; state.chain = chain ?? startingChain(source, id, options.current, mode === "columns");
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
		if (!row.node) { if (row.parent) events.openPage(row.parent); return; }
		const id = row.node.id, tab = event.ctrlKey || event.metaKey || "button" in event && event.button === 1;
		if (tab || immediate) { events.open(id, tab ? "tab" : "same", event); return; }
		const item = scene.entries.get(row.key)?.el;
		item?.classList.add("is-pressed"); life.after(`press:${row.key}`, 140, () => item?.classList.remove("is-pressed"));
		life.after("click", L.doubleClick, () => { if (source.node(id)) events.open(id, "same", event); });
	};
	life.listen(crumbs, "click", (event) => {
		const button = (event.target as Element).closest<HTMLElement>("[data-map-root]");
		if (button) goRoot(button.dataset.mapRoot!, pathFrom(source, button.dataset.mapRoot!, state.root));
	});
	life.listen(box, "click", (event) => {
		const e = event as MouseEvent, row = rowOf(e.target); if (!row) return;
		e.stopPropagation();
		if (suppressClick === row.key) { suppressClick = null; e.preventDefault(); return; }
		cancelHold();
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
	life.listen(box, "keydown", (event) => {
		const e = event as KeyboardEvent; if (e.isComposing || e.altKey) return;
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
		recenter, focus: () => { if (!dead) focusKey(activeKey); }, layout, getState,
		destroy: () => { if (!dead) { dead = true; life.destroy(); scene.destroy(); shell.remove(); } },
	};
}
