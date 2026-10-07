// Small motion helpers shared by the rail and the panels.

/** Same curves as the --sk-spring and --sk-ease tokens, for animations started from code. */
export const SPRING = "cubic-bezier(0.2, 1.3, 0.35, 1)";
export const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** True when the OS asks for reduced motion (checked live, the user can flip it at any time). */
export function reducedMotion(win: Window = window): boolean {
	try {
		return win.matchMedia("(prefers-reduced-motion: reduce)").matches;
	} catch {
		return false;
	}
}

/** Duration helper: 0 under reduced motion. */
export function dur(ms: number, win: Window = window): number {
	return reducedMotion(win) ? 0 : ms;
}

/** Restart a CSS animation class on an element (remove, reflow, add). */
export function replayClass(el: HTMLElement, cls: string): void {
	el.classList.remove(cls);
	void el.offsetWidth;
	el.classList.add(cls);
}

/**
 * Staggered entrance for list items: each element gets --i (capped) and the entrance animation,
 * removed once played so later hovers and transitions are not affected.
 */
export function stagger(items: HTMLElement[], win: Window = window): void {
	if (reducedMotion(win)) return;
	items.forEach((el, i) => {
		el.setCssProps({ "--i": String(Math.min(i, 24)) });
		el.classList.add("sk-note-rail-in");
		el.addEventListener("animationend", () => el.classList.remove("sk-note-rail-in"), { once: true });
	});
}

/** Pop an element in (rail button appearing). No-op under reduced motion. */
export function popIn(el: HTMLElement, win: Window = window): void {
	if (reducedMotion(win) || typeof el.animate !== "function") return;
	el.animate([{ opacity: 0, transform: "scale(0.5)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: SPRING });
}

/** Cross-window element test (`instanceof Element` fails for nodes of a popout window). */
export function asElement(target: EventTarget | null | undefined): Element | null {
	return target && (target as Node).nodeType === 1 ? (target as Element) : null;
}

/** Cross-window node test. */
export function asNode(target: EventTarget | null | undefined): Node | null {
	return target && typeof (target as Node).nodeType === "number" ? (target as Node) : null;
}
