// The rounded cursor that glides from item to item (mouse and arrow keys) and takes the pastel
// hue of the item it rests on. Shared by the Home tab, the Map, Search and later the rail.
// Plain DOM only (no Obsidian helpers), so that it works in popout windows and in tests.
// Geometry works in lists, grids and columns. The optional is-held class on cursorEl fills
// the cursor during a held action. Every listener belongs to this instance.
//
// Markup it expects:
// - the box gets the class "sk-surface" (position: relative) and receives the cursor element;
// - an item is any element matching `itemSelector` (default "[data-nav]") inside the box, with
//   the class "sk-surface-item" (it stacks above the cursor);
// - an item's color: the CSS variable --sk-hue on it (0-359); without it, or with the class
//   "is-gray", the cursor is neutral.

export type SurfaceVia = "mouse" | "key";
export type SurfaceDirection = "up" | "down" | "left" | "right";

export interface SurfaceOptions {
	/** Selector of the items inside the box. Default "[data-nav]". */
	itemSelector?: string;
	/** The element that scrolls to keep the item in view. Default: the box. */
	scrollEl?: HTMLElement;
	/** Called each time the cursor lands on an item. */
	onSet?(el: HTMLElement, via: SurfaceVia): void;
	/** While it returns true, the mouse leaving the box keeps the cursor where it is. */
	sticky?(): boolean;
}

export class Surface {
	readonly cursorEl: HTMLElement;
	private hi: HTMLElement | null = null;
	private via: SurfaceVia = "key";
	private readonly selector: string;
	private readonly cleanups: Array<() => void> = [];
	private touch = false;
	private dead = false;
	private readonly hadClass: boolean;

	constructor(
		readonly box: HTMLElement,
		private readonly options: SurfaceOptions = {},
	) {
		this.selector = options.itemSelector ?? "[data-nav]";
		this.hadClass = box.classList.contains("sk-surface");
		box.classList.add("sk-surface");
		this.cursorEl = box.ownerDocument.createElement("div");
		this.cursorEl.className = "sk-surface-cursor";
		this.cursorEl.setAttribute("aria-hidden", "true");
		box.prepend(this.cursorEl);
		this.listen(box, "pointerdown", (event) => {
			this.touch = (event as PointerEvent).pointerType === "touch";
			if (this.touch) this.clear();
		});
		this.listen(box, "keydown", () => { this.touch = false; });
		this.listen(box, "pointermove", (event) => {
			const e = event as PointerEvent;
			if (e.pointerType === "touch") return;
			this.touch = false;
			const item = this.itemOf(e.target);
			if (item && item !== this.hi) this.set(item, "mouse");
		});
		this.listen(box, "pointerleave", () => {
			if (this.via === "mouse" && !this.options.sticky?.()) {
				const focused = this.itemOf(this.box.ownerDocument.activeElement);
				if (focused) this.set(focused, "key"); else this.clear();
			}
		});
		this.listen(box, "focusin", (event) => {
			const item = this.itemOf(event.target);
			if (!this.touch && item && item !== this.hi) this.set(item, "key");
		});
		const repaint = () => this.repaint(true);
		box.addEventListener("scroll", repaint, true);
		this.cleanups.push(() => box.removeEventListener("scroll", repaint, true));
		const win = box.ownerDocument.defaultView;
		if (win) this.listen(win, "resize", repaint);
	}

	/** The item under the cursor, or null. */
	get current(): HTMLElement | null {
		return !this.dead && this.hi && this.box.contains(this.hi) && this.hi.isConnected ? this.hi : null;
	}

	/** Visible items, in document order. */
	items(): HTMLElement[] {
		return Array.from(this.box.querySelectorAll<HTMLElement>(this.selector)).filter((el) => el.getClientRects().length > 0);
	}

	/** Puts the cursor on an item (null clears it). `snap` jumps without gliding. */
	set(el: HTMLElement | null, via: SurfaceVia = "key", snap = false): void {
		if (via === "mouse") this.touch = false;
		if (this.dead) return;
		if (!el) return this.clear();
		if (!this.box.contains(el)) return;
		this.hi?.classList.remove("is-hi");
		this.hi = el;
		this.via = via;
		el.classList.add("is-hi");
		this.repaint(snap);
		this.options.onSet?.(el, via);
	}

	clear(): void {
		this.hi?.classList.remove("is-hi");
		this.hi = null;
		this.cursorEl.classList.remove("is-shown", "is-held");
	}

	/** Places the cursor again over its item (after a layout change). */
	repaint(snap = false): void {
		const el = this.current;
		if (!el) return;
		const box = this.box.getBoundingClientRect();
		const rect = el.getBoundingClientRect();
		if (!rect.width) return;
		const x = rect.left - box.left - this.box.clientLeft + this.box.scrollLeft;
		const y = rect.top - box.top - this.box.clientTop + this.box.scrollTop;
		const cursor = this.cursorEl;
		cursor.classList.toggle("is-snap", snap || !cursor.classList.contains("is-shown"));
		cursor.classList.toggle("is-mouse", this.via === "mouse");
		cursor.style.transform = `translate(${x}px, ${y}px)`;
		cursor.style.width = `${rect.width}px`;
		cursor.style.height = `${rect.height}px`;
		const hue = el.ownerDocument.defaultView?.getComputedStyle(el).getPropertyValue("--sk-hue").trim() ?? "";
		cursor.classList.toggle("is-gray", !hue || el.classList.contains("is-gray"));
		if (hue) cursor.style.setProperty("--sk-hue", hue);
		cursor.classList.add("is-shown");
		if (cursor.classList.contains("is-snap")) {
			void cursor.offsetWidth;
			cursor.classList.remove("is-snap");
		}
	}

	/** Moves to the nearest item in a direction (the first item when none is under the cursor). Returns it, or null. */
	move(direction: SurfaceDirection): HTMLElement | null {
		const items = this.items();
		if (!items.length) return null;
		const current = this.current;
		if (!current || !items.includes(current)) {
			this.focus(items[0]);
			return items[0];
		}
		const candidates = items.filter((item) => item !== current);
		const index = nearestItem(current.getBoundingClientRect(), candidates.map((item) => item.getBoundingClientRect()), direction);
		const next = index < 0 ? null : candidates[index];
		if (next) this.focus(next);
		return next;
	}

	/** Gives the focus to an item, puts the cursor on it and scrolls it into view. */
	focus(el: HTMLElement): void {
		if (this.dead) return;
		this.touch = false;
		el.focus({ preventScroll: true });
		if (this.hi !== el) this.set(el, "key");
		this.reveal(el);
	}

	/** Scrolls the item into view, with a margin. */
	reveal(el: HTMLElement): void {
		const scroller = this.options.scrollEl ?? this.box;
		const rect = el.getBoundingClientRect();
		const view = scroller.getBoundingClientRect();
		const margin = Math.max(0, Math.min(48, (view.height - rect.height) / 2));
		let delta = 0;
		if (rect.top < view.top + margin) delta = rect.top - view.top - margin;
		else if (rect.bottom > view.bottom - margin) delta = rect.bottom - view.bottom + margin;
		let horizontal = 0;
		if (rect.left < view.left + 8) horizontal = rect.left - view.left - 8;
		else if (rect.right > view.right - 8) horizontal = rect.right - view.right + 8;
		if (delta || horizontal) scroller.scrollBy({ top: delta, left: horizontal });
	}

	destroy(): void {
		if (this.dead) return;
		this.dead = true;
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.clear();
		this.cursorEl.remove();
		if (!this.hadClass) this.box.classList.remove("sk-surface");
	}

	private itemOf(target: EventTarget | null): HTMLElement | null {
		// No instanceof: in a popout window, elements come from another realm.
		const node = target as Element | null;
		const el = node && typeof node.closest === "function" ? node.closest<HTMLElement>(this.selector) : null;
		return el && this.box.contains(el) ? el : null;
	}

	private listen(target: EventTarget, type: string, handler: (event: Event) => void): void {
		target.addEventListener(type, handler);
		this.cleanups.push(() => target.removeEventListener(type, handler));
	}
}

type ItemRect = Pick<DOMRect, "left" | "right" | "top" | "bottom">;
/** Spatial navigation, including unequal widths and ragged grids. No DOM reads here. */
export function nearestItem(a: ItemRect, candidates: readonly ItemRect[], direction: SurfaceDirection): number {
	const acx = (a.left + a.right) / 2, acy = (a.top + a.bottom) / 2;
	let best = -1, score = Infinity;
	candidates.forEach((r, index) => {
		const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
		const gx = Math.max(0, Math.max(a.left, r.left) - Math.min(a.right, r.right));
		const gy = Math.max(0, Math.max(a.top, r.top) - Math.min(a.bottom, r.bottom));
		let value: number;
		if (direction === "down") {
			if (r.top < a.bottom - 4) return;
			value = r.top - a.bottom + gx * 4 + Math.abs(r.left - a.left) * 0.02;
		} else if (direction === "up") {
			if (r.bottom > a.top + 4) return;
			value = a.top - r.bottom + gx * 4 + Math.abs(r.left - a.left) * 0.02;
		} else if (direction === "right") {
			if (cx <= acx + 2 || r.left < a.left + 4) return;
			value = Math.max(0, r.left - a.right) + gy * 4 + Math.abs(cy - acy) * 0.3;
		} else {
			if (cx >= acx - 2 || r.right > a.right - 4) return;
			value = Math.max(0, a.left - r.right) + gy * 4 + Math.abs(cy - acy) * 0.3;
		}
		if (value < score) { score = value; best = index; }
	});
	return best;
}
