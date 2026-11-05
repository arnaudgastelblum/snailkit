import { setIcon } from "obsidian";
import { zoomOf } from "../../ui/surface";
import type { TagMapNode } from "./tag-map";

/**
 * New task on a phone: a tap on the round "+" unfolds, above a light veil, the tags most used for
 * tasks, joined to the button by curves as on the Map of Home (the button of the page, mirrored:
 * the tags rise to its left). A tag with sub-tags opens them in its place, the tag itself kept at
 * the foot to take the whole family. A tap on a tag starts the new task with it; the veil, the
 * "x" or the system back close it.
 */
export interface TagFanOptions {
	/** Hidden name of the fan (never an aria-label: Obsidian shows those as tooltips). */
	name: string;
	back: string;
	roots: () => TagMapNode[];
	draw: (parent: HTMLElement, tag: string) => void;
	onPick: (tag: string, from: DOMRect | null) => void;
	onClose: () => void;
	reduced: () => boolean;
}

export interface TagFanHandle {
	close(): void;
}

const ROW = 48;
const GAP = 40;
const SVG_NS = "http://www.w3.org/2000/svg";

export function openTagFan(host: HTMLElement, fab: HTMLElement, o: TagFanOptions): TagFanHandle {
	const doc = host.ownerDocument;
	const fan = host.createDiv({ cls: "sk-tasks-fan" });
	const veil = fan.createDiv({ cls: "sk-tasks-fan-veil" });
	const name = fan.createSpan({ cls: "sk-tasks-nb-sr", text: o.name });
	name.id = "sk-tasks-fan-" + Date.now().toString(36);
	const stage = fan.createDiv({ cls: "sk-tasks-fan-stage", attr: { role: "group", "aria-labelledby": name.id } });
	fab.addClass("is-fan");
	fab.setAttr("aria-expanded", "true");
	let root: TagMapNode | null = null;
	let closed = false;

	const draw = (animate: boolean) => {
		const focused = fan.contains(doc.activeElement);
		stage.empty();
		// Screen rects over the zoom of the Workbench (its text size): lengths inside the fan.
		const z = zoomOf(host) || 1;
		const box = host.getBoundingClientRect();
		const f = fab.getBoundingClientRect();
		const hr = { width: box.width / z, height: box.height / z };
		const fr = { left: (f.left - box.left) / z, top: (f.top - box.top) / z, height: f.height / z };
		// Where the curves leave the button, in the coordinates of the fan.
		const ax = fr.left - 4;
		const ay = fr.top + fr.height / 2;
		// As many choices as the height above the button holds (the most used first).
		const room = Math.max(1, Math.floor((ay - 24) / ROW));
		const right = ax - GAP;
		const items: Array<{ el: HTMLElement; sub: boolean }> = [];
		const node = (n: TagMapNode, sub: boolean, whole = false) => {
			const b = stage.createEl("button", { cls: "sk-tasks-fan-node" + (sub ? " is-sub" : "") + (whole ? " is-whole" : ""), attr: { type: "button", "data-tag": n.tag } });
			o.draw(b, n.tag);
			b.createSpan({ cls: "sk-tasks-fan-n", text: String(n.count) });
			if (!sub && !whole && n.children.length) setIcon(b.createSpan({ cls: "sk-tasks-fan-chev" }), "chevron-left");
			b.addEventListener("click", (e) => {
				e.stopPropagation();
				if (!sub && !whole && n.children.length) {
					root = n;
					draw(true);
					return;
				}
				const mark = b.querySelector(".sk-tasks-cap");
				const from = mark ? mark.getBoundingClientRect() : null;
				close(false);
				o.onPick(n.tag, from);
			});
			items.push({ el: b, sub });
			return b;
		};
		// From the foot up: the tag chosen (whole family) then its sub-tags, or the roots.
		if (root) {
			node(root, false, true);
			for (const c of root.children.slice(0, Math.max(1, room - 2))) node(c, true);
		} else for (const n of o.roots().slice(0, room)) node(n, false);
		const svg = doc.createElementNS(SVG_NS, "svg");
		svg.classList.add("sk-tasks-fan-lines");
		stage.prepend(svg);
		svg.setAttribute("width", String(hr.width));
		svg.setAttribute("height", String(hr.height));
		const paths: SVGPathElement[] = [];
		items.forEach(({ el }, i) => {
			const cy = ay - i * ROW;
			el.setCssProps({ "--sk-fan-r": hr.width - right + "px", "--sk-fan-y": cy + "px" });
			const p = doc.createElementNS(SVG_NS, "path");
			const m = (ax + right) / 2;
			p.setAttribute("d", `M${ax},${ay} C${m},${ay} ${m},${cy} ${right + 2},${cy}`);
			if (root && i === 0) p.classList.add("is-on");
			svg.appendChild(p);
			paths.push(p);
		});
		if (root) {
			// The way back to the roots, on top of the column (its foot sits on Obsidian's toolbar).
			const back = stage.createEl("button", { cls: "sk-tasks-fan-back", attr: { type: "button" } });
			setIcon(back, "chevron-right");
			back.createSpan({ text: o.back });
			back.setCssProps({ "--sk-fan-r": hr.width - right + "px", "--sk-fan-y": ay - items.length * ROW + 4 + "px" });
			back.addEventListener("click", (e) => {
				e.stopPropagation();
				root = null;
				draw(true);
			});
		}
		if (focused) items[0]?.el.focus({ preventScroll: true });
		if (!animate || o.reduced()) return;
		paths.forEach((p, i) => {
			const len = p.getTotalLength();
			p.setAttribute("stroke-dasharray", String(len));
			p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 260, delay: i * 35, easing: "cubic-bezier(0.3, 0, 0.2, 1)", fill: "backwards" });
		});
		items.forEach(({ el }, i) =>
			el.animate([{ opacity: 0, transform: "translate(14px, -50%) scale(0.92)" }, { opacity: 1, transform: "translate(0, -50%)" }], { duration: 280, delay: 80 + i * 35, easing: "cubic-bezier(0.2, 1.3, 0.35, 1)", fill: "backwards" }),
		);
	};

	const close = (tell = true) => {
		if (closed) return;
		closed = true;
		fab.removeClass("is-fan");
		fab.setAttr("aria-expanded", "false");
		host.win.removeEventListener("resize", onResize);
		if (o.reduced()) fan.remove();
		else void fan.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140 }).finished.catch(() => undefined).then(() => fan.remove());
		if (tell) o.onClose();
	};
	const onResize = () => draw(false);
	host.win.addEventListener("resize", onResize);
	veil.addEventListener("click", () => close());
	// A keyboard (on a tablet or a phone with one): the focus goes into the fan, arrows move up and
	// down the column, Escape closes and gives the focus back to the button, Tab closes and goes on.
	fan.addEventListener("keydown", (e) => {
		const list = Array.from(stage.querySelectorAll<HTMLElement>(".sk-tasks-fan-node, .sk-tasks-fan-back"));
		const i = list.indexOf(doc.activeElement as HTMLElement);
		if (e.key === "Escape") {
			close();
			fab.focus();
		} else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
			const n = list.length ? (i + (e.key === "ArrowUp" ? 1 : -1) + list.length) % list.length : 0;
			list[n]?.focus({ preventScroll: true });
		} else if (e.key === "Tab") {
			close();
			fab.focus();
			return;
		} else return;
		e.preventDefault();
		e.stopPropagation();
	});
	if (!o.reduced()) veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
	draw(true);
	fan.querySelector<HTMLElement>(".sk-tasks-fan-node")?.focus({ preventScroll: true });
	return { close: () => close() };
}
