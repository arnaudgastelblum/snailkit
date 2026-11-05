import { setIcon } from "obsidian";

/**
 * "New task" (page): a button that unfolds, on hover or with N, a small map of the tags most used for
 * tasks, drawn like the Map of Home (curves from the button, one level at a time). Hovering a tag with
 * sub-tags unfolds them; a click (or Enter) picks the tag for the new task.
 */
export interface TagMapNode {
	tag: string;
	count: number;
	children: TagMapNode[];
}

export interface TagMapOptions {
	label: string;
	/** Hidden name of the map (never an aria-label: Obsidian shows those as tooltips). */
	name: string;
	roots: () => TagMapNode[];
	/** The tag's look in the map: a capsule for a root, a dot and its name for a sub-tag. */
	drawRoot: (parent: HTMLElement, tag: string) => void;
	drawSub: (parent: HTMLElement, tag: string) => void;
	onPick: (tag: string, from: DOMRect | null) => void;
	reduced: () => boolean;
}

export interface TagMapHandle {
	el: HTMLElement;
	open(keyboard: boolean): void;
}

const ROW = 34;
const GAP = 44;
const SVG_NS = "http://www.w3.org/2000/svg";

let ids = 0;

export function mountTagMap(parent: HTMLElement, o: TagMapOptions): TagMapHandle {
	const win = parent.win;
	const wrap = parent.createDiv({ cls: "sk-tasks-nb" });
	const btn = wrap.createEl("button", { cls: "sk-tasks-nb-btn", attr: { type: "button", "aria-haspopup": "true", "aria-expanded": "false" } });
	setIcon(btn.createSpan({ cls: "sk-tasks-nb-ic" }), "plus");
	btn.createSpan({ text: o.label });
	btn.createEl("kbd", { cls: "sk-tasks-kbd", text: "N" });
	const name = wrap.createSpan({ cls: "sk-tasks-nb-sr", text: o.name });
	name.id = `sk-tasks-nb-${++ids}`;
	const map = wrap.createDiv({ cls: "sk-tasks-nb-map", attr: { role: "group", "aria-labelledby": name.id } });
	map.hidden = true;

	let isOpen = false;
	let root: string | null = null;
	let col = 0;
	let timer = 0;
	const subsOf = (tag: string | null) => (tag ? (o.roots().find((n) => n.tag === tag)?.children ?? []) : []);

	const node = (n: TagMapNode, sub: boolean): HTMLButtonElement => {
		const b = map.createEl("button", { cls: "sk-tasks-nb-node" + (sub ? " is-sub" : " is-root"), attr: { type: "button", "data-tag": n.tag } });
		(sub ? o.drawSub : o.drawRoot)(b, n.tag);
		b.createSpan({ cls: "sk-tasks-nb-n", text: String(n.count) });
		if (!sub && n.children.length) setIcon(b.createSpan({ cls: "sk-tasks-nb-chev" }), "chevron-right");
		setIcon(b.createSpan({ cls: "sk-tasks-nb-plus" }), "plus");
		return b;
	};

	const draw = (animate: "all" | "subs" | "") => {
		map.empty();
		map.hidden = false;
		const roots = o.roots();
		const svg = map.ownerDocument.createElementNS(SVG_NS, "svg");
		svg.classList.add("sk-tasks-nb-lines");
		map.appendChild(svg);
		const rootEls = roots.map((n) => node(n, false));
		const subs = subsOf(root);
		const subEls = subs.map((n) => node(n, true));
		const bw = btn.offsetWidth, ay = btn.offsetHeight / 2;
		const x0 = bw + GAP;
		let rootW = 0;
		rootEls.forEach((el, i) => {
			el.setCssProps({ "--sk-nb-x": x0 + "px", "--sk-nb-y": i * ROW + "px" });
			rootW = Math.max(rootW, el.offsetWidth);
		});
		rootEls.forEach((el) => el.setCssProps({ "--sk-nb-w": rootW + "px" }));
		const ri = roots.findIndex((n) => n.tag === root);
		const x1 = x0 + rootW + GAP;
		const sy0 = Math.max(0, ri * ROW - ((subs.length - 1) * ROW) / 2);
		let subW = 0;
		subEls.forEach((el, j) => {
			el.setCssProps({ "--sk-nb-x": x1 + "px", "--sk-nb-y": sy0 + j * ROW + "px" });
			subW = Math.max(subW, el.offsetWidth);
		});
		subEls.forEach((el) => el.setCssProps({ "--sk-nb-w": subW + "px" }));
		const h = Math.max(roots.length, subs.length ? sy0 / ROW + subs.length : 0) * ROW;
		const w = (subs.length ? x1 + subW : x0 + rootW) + 8;
		map.setCssProps({ "--sk-nb-mw": w + "px", "--sk-nb-mh": h + "px" });
		svg.setAttribute("width", String(w));
		svg.setAttribute("height", String(h));
		svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
		const curve = (ax: number, ay2: number, bx: number, by: number, cls: string) => {
			const m = (ax + bx) / 2;
			const p = map.ownerDocument.createElementNS(SVG_NS, "path");
			p.setAttribute("d", `M${ax},${ay2} C${m},${ay2} ${m},${by} ${bx},${by}`);
			if (cls) p.classList.add(cls);
			svg.appendChild(p);
			return p;
		};
		const rootPaths = roots.map((n, i) => curve(bw + 6, ay, x0, i * ROW + ROW / 2, n.tag === root ? "is-on" : ""));
		const subPaths = subs.map((_, j) => curve(x0 + rootW + 4, ri * ROW + ROW / 2, x1, sy0 + j * ROW + ROW / 2, "is-sub"));
		rootEls.forEach((el) => el.toggleClass("is-open", el.dataset.tag === root));
		if (o.reduced() || !animate) return;
		const line = (p: SVGPathElement, delay: number) => {
			const len = p.getTotalLength();
			p.setAttribute("stroke-dasharray", String(len));
			p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 260, delay, easing: "cubic-bezier(0.3, 0, 0.2, 1)", fill: "backwards" });
		};
		const rise = (el: HTMLElement, delay: number) =>
			el.animate([{ opacity: 0, transform: "translateX(-8px)" }, { opacity: 1, transform: "none" }], { duration: 240, delay, easing: "cubic-bezier(0.2, 1.3, 0.35, 1)", fill: "backwards" });
		if (animate === "all") {
			rootPaths.forEach((p, i) => line(p, i * 30));
			rootEls.forEach((el, i) => rise(el, 90 + i * 30));
		}
		const base = animate === "all" ? 200 : 0;
		subPaths.forEach((p, j) => line(p, base + j * 30));
		subEls.forEach((el, j) => rise(el, base + 90 + j * 30));
	};

	const hoverRoot = (tag: string) => {
		const next = subsOf(tag).length ? tag : null;
		if (next === root) {
			map.querySelectorAll<HTMLElement>(".sk-tasks-nb-node.is-root").forEach((el) => el.toggleClass("is-open", el.dataset.tag === root));
			return;
		}
		root = next;
		draw(root ? "subs" : "");
	};
	const focusAt = (i: number) => {
		const list = map.querySelectorAll<HTMLElement>(col === 0 ? ".sk-tasks-nb-node.is-root" : ".sk-tasks-nb-node.is-sub");
		list[Math.max(0, Math.min(list.length - 1, i))]?.focus();
	};
	const open = (keyboard: boolean) => {
		if (!o.roots().length) return;
		win.clearTimeout(timer);
		if (!isOpen) {
			isOpen = true;
			root = null;
			col = 0;
			wrap.addClass("is-open");
			btn.setAttr("aria-expanded", "true");
			draw("all");
		}
		if (keyboard) {
			col = 0;
			hoverRoot(o.roots()[0].tag);
			focusAt(0);
		}
	};
	const close = (focusButton = false, now = false) => {
		win.clearTimeout(timer);
		if (!isOpen) return;
		isOpen = false;
		root = null;
		wrap.removeClass("is-open");
		btn.setAttr("aria-expanded", "false");
		if (o.reduced() || now) map.hidden = true;
		else
			void map.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120 }).finished.then(() => {
				if (!isOpen) map.hidden = true;
			});
		if (focusButton) btn.focus();
	};
	const pick = (el: HTMLElement) => {
		const mark = el.querySelector(".sk-tasks-cap, .sk-tasks-dot");
		const from = mark ? mark.getBoundingClientRect() : null;
		const tag = el.dataset.tag;
		isOpen = false;
		if (tag) o.onPick(tag, from);
	};

	wrap.addEventListener("pointerover", (e) => {
		if (e.pointerType === "touch") return;
		win.clearTimeout(timer);
		if (!isOpen) timer = win.setTimeout(() => open(false), 110);
		const n = (e.target as HTMLElement).closest<HTMLElement>(".sk-tasks-nb-node.is-root");
		if (n?.dataset.tag) hoverRoot(n.dataset.tag);
	});
	wrap.addEventListener("pointerout", (e) => {
		if (e.relatedTarget instanceof Node && wrap.contains(e.relatedTarget)) return;
		win.clearTimeout(timer);
		if (map.contains(map.ownerDocument.activeElement)) return;
		timer = win.setTimeout(() => close(), 260);
	});
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		if (isOpen) close();
		else open(true);
	});
	map.addEventListener("click", (e) => {
		const n = (e.target as HTMLElement).closest<HTMLElement>(".sk-tasks-nb-node");
		if (!n) return;
		e.stopPropagation();
		pick(n);
	});
	wrap.addEventListener("keydown", (e) => {
		if (!isOpen) return;
		const roots = o.roots();
		const at = (e.target as HTMLElement).closest<HTMLElement>(".sk-tasks-nb-node");
		const list = Array.from(map.querySelectorAll<HTMLElement>(col === 0 ? ".sk-tasks-nb-node.is-root" : ".sk-tasks-nb-node.is-sub"));
		const i = at ? list.indexOf(at) : -1;
		if (e.key === "Escape") close(true);
		else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			const n = list.length ? (i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length : 0;
			if (col === 0 && roots[n]) hoverRoot(roots[n].tag);
			focusAt(n);
		} else if (e.key === "ArrowRight" && col === 0 && subsOf(root).length) {
			col = 1;
			focusAt(0);
		} else if (e.key === "ArrowLeft" && col === 1) {
			col = 0;
			focusAt(Math.max(0, roots.findIndex((n) => n.tag === root)));
		} else if ((e.key === "Enter" || e.key === " ") && at) pick(at);
		else if (e.key === "Tab") {
			// Closed at once and focus back on the button: Tab then goes on from there, as usual.
			close(true, true);
			return;
		} else return;
		e.preventDefault();
		e.stopPropagation();
	});
	return { el: wrap, open };
}

/** The tag's capsule glides from where it was picked into the add row, which then glows once. */
export function flyTag(doc: Document, mark: HTMLElement, from: DOMRect, to: HTMLElement, row: HTMLElement | null): void {
	const target = to.getBoundingClientRect();
	const fly = doc.body.createDiv({ cls: "sk-tasks-nb-fly" });
	fly.appendChild(mark);
	to.addClass("is-landing");
	const mid = { x: (from.left + target.left) / 2, y: Math.min(from.top, target.top) - 24 };
	void fly
		.animate(
			[
				{ transform: `translate(${from.left}px, ${from.top}px) scale(1.1)` },
				{ transform: `translate(${mid.x}px, ${mid.y}px) scale(1.15)`, offset: 0.45 },
				{ transform: `translate(${target.left}px, ${target.top}px) scale(1)` },
			],
			{ duration: 420, easing: "cubic-bezier(0.5, 0, 0.2, 1)", fill: "forwards" },
		)
		.finished.catch(() => undefined)
		.then(() => {
			fly.remove();
			to.removeClass("is-landing");
			to.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)", offset: 0.4 }, { transform: "scale(1)" }], { duration: 320, easing: "cubic-bezier(0.2, 1.3, 0.35, 1)" });
			row?.addClass("is-landed");
		});
}
