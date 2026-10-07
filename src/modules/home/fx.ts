// Motion of the Home tab: what moves glides (FLIP), a pinned note flies to the Pins row, and the
// formatters of dates in the module's language. Plain DOM in the element's own window (popouts).
import type { DateWords } from "./logic/dates";

export function winOf(el: Element): Window {
	return el.ownerDocument.defaultView ?? window;
}

export function reduced(el: Element): boolean {
	try {
		return winOf(el).matchMedia("(prefers-reduced-motion: reduce)").matches;
	} catch {
		return false;
	}
}

const EASE = "cubic-bezier(.16,1,.3,1)";

function rectIn(el: HTMLElement): { left: number; top: number } {
	const r = el.getBoundingClientRect();
	const parent = el.parentElement?.closest<HTMLElement>("[data-flip]");
	if (!parent) return { left: r.left, top: r.top };
	const p = parent.getBoundingClientRect();
	return { left: r.left - p.left, top: r.top - p.top };
}

/** Runs `mutate` (a redraw), then slides the elements marked [data-flip] from where they were. */
export function flip(root: HTMLElement, mutate: () => void): void {
	const before = new Map<string, { left: number; top: number }>();
	root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => before.set(el.dataset.flip!, rectIn(el)));
	mutate();
	if (reduced(root) || !before.size) return;
	root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
		const was = before.get(el.dataset.flip!);
		if (!was) {
			if (!el.classList.contains("is-landing")) el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: EASE });
			return;
		}
		const now = rectIn(el);
		const dx = was.left - now.left;
		const dy = was.top - now.top;
		if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
		el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 420, easing: EASE });
	});
}

/**
 * A copy of the chip flies from `from` (a rectangle in the window) to `to` (the new chip, kept
 * invisible by the caller until it lands): sideways and down on two curves, a slight swell.
 */
export function fly(from: DOMRect, to: HTMLElement, label: HTMLElement, done: () => void): void {
	const doc = to.ownerDocument;
	const target = to.getBoundingClientRect();
	const wx = doc.body.createDiv({ cls: "sk-home-fly-x" });
	const wy = wx.createDiv({ cls: "sk-home-fly-y" });
	wy.appendChild(label);
	const sx = from.left + Math.min(26, from.width / 3);
	const sy = from.top + (from.height - target.height) / 2;
	wx.style.transform = `translateX(${sx}px)`;
	wy.style.transform = `translateY(${sy}px)`;
	const duration = 600;
	wx.animate([{ transform: `translateX(${sx}px)` }, { transform: `translateX(${target.left}px)` }], { duration, easing: "cubic-bezier(.55,0,.35,1)", fill: "forwards" });
	wy.animate([{ transform: `translateY(${sy}px)` }, { transform: `translateY(${target.top}px)` }], { duration, easing: "cubic-bezier(.2,.85,.3,1)", fill: "forwards" });
	const anim = label.animate([{ transform: "scale(.94)", opacity: 0.6 }, { transform: "scale(1.08)", opacity: 1, offset: 0.4 }, { transform: "scale(1)", opacity: 1 }], { duration, easing: "ease-out", fill: "forwards" });
	let ended = false;
	const end = () => {
		if (ended) return;
		ended = true;
		wx.remove();
		done();
	};
	anim.onfinish = end;
	winOf(to).setTimeout(end, duration + 200);
}

/** Dates in the module's language (Intl), for relative labels and due dates. */
export function dateWords(lang: string, t: (key: string) => string): DateWords {
	const weekday = new Intl.DateTimeFormat(lang, { weekday: "short" });
	const day = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" });
	const dayYear = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" });
	const time = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });
	return {
		today: t("date.today"),
		yesterday: t("date.yesterday"),
		tomorrow: t("date.tomorrow"),
		weekday: (ms) => weekday.format(ms),
		date: (ms, year) => (year ? dayYear : day).format(ms),
		time: (ms) => time.format(ms),
	};
}

/** "Tue 6 Oct": the label of today's note. */
export function todayLabel(lang: string, now: number): string {
	return new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", month: "short" }).format(now);
}

/** The first letter of a name, for a domain's pill. */
export function initialOf(name: string): string {
	const first = Array.from(name.trim())[0] ?? "?";
	return first.toLocaleUpperCase();
}
