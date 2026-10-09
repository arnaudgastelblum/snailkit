// Playful motion shared by the tools: a few particles with weight, a thin wave, an element flying
// on an arc, an odometer, a "+1" that rises, and the small scene of a day with nothing left. No
// Obsidian here, only the page; every effect stays quiet (neutral colors, short) and none runs
// when the system asks for reduced motion (callers check `reducedMotion` first).
export { dayProgress, nextRun, PENTATONIC, RUN_GAP, stepFrequency, type Run } from "./rhythm";

export function reducedMotion(win: Window): boolean {
	return win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** A color of the page (a CSS variable), read once for the canvas. */
export function cssColor(el: HTMLElement, name: string, fallback: string): string {
	const value = el.ownerDocument.defaultView?.getComputedStyle(el).getPropertyValue(name).trim();
	return value || fallback;
}

// ----- particles: one canvas per window, there only while something moves -----

interface Particle {
	kind: "line" | "dot";
	x: number;
	y: number;
	vx: number;
	vy: number;
	g: number;
	drag: number;
	size: number;
	life: number;
	alpha: number;
	color: string;
}

class Particles {
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private parts: Particle[] = [];
	private frame = 0;

	constructor(private readonly doc: Document) {}

	add(parts: Particle[]): void {
		const win = this.doc.defaultView;
		if (!win) return;
		if (!this.canvas) {
			this.canvas = this.doc.body.createEl("canvas", { cls: "sk-fx-canvas", attr: { "aria-hidden": "true" } });
			this.ctx = this.canvas.getContext("2d");
			this.fit();
		}
		this.parts.push(...parts);
		if (!this.frame) this.frame = win.requestAnimationFrame(() => this.tick());
	}

	private fit(): void {
		const win = this.doc.defaultView;
		if (!win || !this.canvas || !this.ctx) return;
		const ratio = Math.min(win.devicePixelRatio || 1, 2);
		this.canvas.width = win.innerWidth * ratio;
		this.canvas.height = win.innerHeight * ratio;
		this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	}

	private tick(): void {
		const win = this.doc.defaultView;
		const ctx = this.ctx;
		if (!win || !ctx || !this.canvas) return;
		if (this.canvas.width !== Math.round(win.innerWidth * Math.min(win.devicePixelRatio || 1, 2))) this.fit();
		ctx.clearRect(0, 0, win.innerWidth, win.innerHeight);
		this.parts = this.parts.filter((p) => p.life > 0);
		for (const p of this.parts) {
			p.vx *= p.drag;
			p.vy = p.vy * p.drag + p.g;
			p.x += p.vx;
			p.y += p.vy;
			p.life--;
			ctx.globalAlpha = Math.min(1, p.life / 14) * p.alpha;
			ctx.fillStyle = p.color;
			if (p.kind === "line") {
				ctx.save();
				ctx.translate(p.x, p.y);
				ctx.rotate(Math.atan2(p.vy, p.vx));
				ctx.fillRect(-p.size, -0.8, p.size * 2, 1.6);
				ctx.restore();
			} else {
				ctx.beginPath();
				ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		ctx.globalAlpha = 1;
		if (this.parts.length) {
			this.frame = win.requestAnimationFrame(() => this.tick());
			return;
		}
		// Nothing moves any more: the canvas leaves the page.
		this.frame = 0;
		this.canvas.remove();
		this.canvas = null;
		this.ctx = null;
	}
}

const particles = new WeakMap<Document, Particles>();
const fx = (doc: Document): Particles => {
	let p = particles.get(doc);
	if (!p) particles.set(doc, (p = new Particles(doc)));
	return p;
};

/** Short strokes thrown out of a point, like a spring released. */
export function spark(doc: Document, x: number, y: number, count: number, color: string): void {
	const parts: Particle[] = [];
	for (let i = 0; i < count; i++) {
		const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
		const speed = 2.4 + Math.random() * 2.2;
		parts.push({ kind: "line", x: x + Math.cos(a) * 10, y: y + Math.sin(a) * 10, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, g: 0.05, drag: 0.86, size: 3 + Math.random() * 2, life: 22 + Math.random() * 6, alpha: 0.9, color });
	}
	fx(doc).add(parts);
}

/** Fine dust drifting away from a box (a row that leaves). */
export function dust(doc: Document, rect: DOMRect, color: string): void {
	const parts: Particle[] = [];
	for (let i = 0; i < 26; i++) {
		parts.push({ kind: "dot", x: rect.left + Math.random() * rect.width, y: rect.top + 6 + Math.random() * Math.max(1, rect.height - 12), vx: 0.6 + Math.random() * 1.6, vy: -0.3 - Math.random() * 0.8, g: -0.01, drag: 0.97, size: 0.8 + Math.random() * 1.6, life: 26 + Math.random() * 22, alpha: 0.6, color });
	}
	fx(doc).add(parts);
}

/** Motes rising slowly over the whole window (the end of the day). */
export function motes(doc: Document, color: string): void {
	const win = doc.defaultView;
	if (!win) return;
	const parts: Particle[] = [];
	for (let i = 0; i < 70; i++) {
		parts.push({ kind: "dot", x: Math.random() * win.innerWidth, y: win.innerHeight * (0.35 + Math.random() * 0.7), vx: (Math.random() - 0.5) * 0.6, vy: -0.6 - Math.random() * 1.4, g: -0.004, drag: 0.995, size: 1 + Math.random() * 2, life: 110 + Math.random() * 90, alpha: 0.55, color });
	}
	fx(doc).add(parts);
}

// ----- small elements that live for one gesture -----

/** A thin ring spreading from a point. */
export function wave(doc: Document, x: number, y: number): void {
	const w = doc.body.createDiv({ cls: "sk-fx-wave" });
	w.setCssStyles({ left: `${x}px`, top: `${y}px` });
	void w.animate([{ transform: "scale(1)", opacity: 0.9 }, { transform: "scale(3.2)", opacity: 0 }], { duration: 520, easing: "cubic-bezier(0.1, 0.6, 0.3, 1)" }).finished.then(() => w.remove(), () => w.remove());
}

/** A "+1" rising from a point; a little higher and larger with `strength` (0 to 6). */
export function plusOne(doc: Document, x: number, y: number, strength = 0): void {
	const s = Math.max(0, Math.min(6, strength));
	const el = doc.body.createDiv({ cls: "sk-fx-plus", text: "+1" });
	el.setCssStyles({ left: `${x}px`, top: `${y}px` });
	const lift = 26 + s * 4;
	void el.animate([
		{ transform: "translateY(0) scale(0.6)", opacity: 0 },
		{ transform: `translateY(${-lift * 0.6}px) scale(${1 + s * 0.06})`, opacity: 1, offset: 0.35 },
		{ transform: `translateY(${-lift}px) scale(1)`, opacity: 0 },
	], { duration: 900, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" }).finished.then(() => el.remove(), () => el.remove());
}

/** A capsule of `text` flying on an arc from one box to another; resolves when it lands. */
export async function fly(doc: Document, text: string, from: DOMRect, to: DOMRect): Promise<void> {
	const el = doc.body.createDiv({ cls: "sk-fx-flyer", text });
	const fx0 = from.left;
	const fy0 = from.top - 4;
	const tx = to.left + 4;
	const ty = to.top + 2;
	// A low arc, kept inside the window (it never crosses the title bar above the target).
	const mx = (fx0 + tx) / 2 + 40;
	const my = Math.max(8, Math.min(fy0 - 50, ty + 30));
	try {
		await el.animate([
			{ transform: `translate(${fx0}px, ${fy0}px) scale(1)`, opacity: 1 },
			{ transform: `translate(${(fx0 + mx) / 2}px, ${(fy0 + my) / 2}px) scale(0.86) rotate(-3deg)`, opacity: 1, offset: 0.35 },
			{ transform: `translate(${mx}px, ${my}px) scale(0.6) rotate(-1deg)`, opacity: 1, offset: 0.65 },
			{ transform: `translate(${tx}px, ${ty}px) scale(0.12)`, opacity: 0.2 },
		], { duration: 640, easing: "cubic-bezier(0.45, 0, 0.25, 1)", fill: "forwards" }).finished;
	} catch {
		// Cancelled (the window closed): nothing to wait for.
	} finally {
		el.remove();
	}
}

/**
 * A copy of a typed line gliding from where it was typed (`from`, text starting `inset` px in) to the row
 * it became (`to`): it lifts a little, travels, and settles; resolves when it is in place.
 */
export async function glide(doc: Document, text: string, from: DOMRect, inset: number, to: DOMRect): Promise<void> {
	const el = doc.body.createDiv({ cls: "sk-fx-glide", text });
	el.style.paddingLeft = inset + "px";
	const at = (r: DOMRect, dy = 0) => ({ transform: `translate(${r.left}px, ${r.top + dy}px)`, width: r.width + "px", height: r.height + "px" });
	try {
		await el.animate([
			{ ...at(from), opacity: 1 },
			{ ...at(from, -3), opacity: 1, offset: 0.18 },
			{ ...at(to), opacity: 1, offset: 0.85 },
			{ ...at(to), opacity: 0 },
		], { duration: 560, easing: "cubic-bezier(0.5, 0, 0.2, 1)", fill: "forwards" }).finished;
	} catch {
		// Cancelled (the window closed): nothing to wait for.
	} finally {
		el.remove();
	}
}

/** A quick squash and rebound (a box that received something, a pill that counts one more). */
export function pop(el: HTMLElement, amount = 1): void {
	const up = 1 + 0.1 * amount;
	el.animate([{ transform: "scale(1)" }, { transform: `scale(${up})`, offset: 0.35 }, { transform: "scale(0.97)", offset: 0.7 }, { transform: "scale(1)" }], { duration: 420, easing: "ease-out" });
}

// ----- the odometer: each digit rolls to its value -----

/** Shows `value` in `el` as rolling digits (built on first use). `animate` false: set at once. */
export function odometer(el: HTMLElement, value: number, animate = true): void {
	if (!el.hasClass("sk-odo")) {
		el.addClass("sk-odo");
		el.setAttr("aria-hidden", "true");
	}
	const digits = String(Math.max(0, Math.floor(value)));
	while (el.children.length < digits.length) {
		const col = createSpan();
		const strip = col.createEl("i");
		for (let d = 0; d <= 9; d++) strip.createEl("b", { text: String(d) });
		el.prepend(col);
	}
	while (el.children.length > digits.length) el.firstElementChild?.remove();
	[...digits].forEach((ch, i) => {
		const strip = el.children[i].firstElementChild as HTMLElement | null;
		if (!strip) return;
		strip.toggleClass("is-still", !animate);
		strip.setCssStyles({ transform: `translateY(${-Number(ch) * 1.35}em)` });
	});
}

// ----- the end of the day -----

/**
 * The day is clear: a light sweeps across the window, motes rise, the snail crosses the bottom and
 * one quiet sentence shows for a few seconds. Resolves when the scene is over.
 */
export async function dayClear(doc: Document, words: { title: string; sub: string }, color: string): Promise<void> {
	const win = doc.defaultView;
	if (!win) return;
	const sweep = doc.body.createDiv({ cls: "sk-fx-sweep" });
	void sweep.animate([{ backgroundPosition: "120% 0" }, { backgroundPosition: "-20% 0" }], { duration: 1100, easing: "ease-in-out" }).finished.then(() => sweep.remove(), () => sweep.remove());
	motes(doc, color);
	const note = doc.body.createDiv({ cls: "sk-fx-closing" });
	note.createEl("b", { text: words.title });
	note.createSpan({ text: words.sub });
	note.animate([{ opacity: 0, transform: "translate(-50%, -40%)" }, { opacity: 1, transform: "translate(-50%, -50%)" }], { duration: 600, delay: 300, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.2)", fill: "both" });
	const snail = doc.body.createSvg("svg", { cls: "sk-fx-snail", attr: { viewBox: "0 0 84 46", "aria-hidden": "true" } });
	const g = snail.createSvg("g", { attr: { fill: "none", stroke: "currentColor", "stroke-width": "2.2", "stroke-linecap": "round", "stroke-linejoin": "round" } });
	for (const d of ["M6 40h52c9 0 14-5 14-12", "M34 24m-7 0a7 7 0 1 0 7-7 4 4 0 1 0 4 4 2 2 0 1 0-2 2", "M66 30l-2-14M72 28l2-13"]) g.createSvg("path", { attr: { d } });
	g.createSvg("circle", { attr: { cx: "34", cy: "24", r: "14" } });
	snail.createSvg("circle", { attr: { cx: "64", cy: "15", r: "2.4", fill: "currentColor" } });
	snail.createSvg("circle", { attr: { cx: "74", cy: "14", r: "2.4", fill: "currentColor" } });
	const crawl = snail.animate([{ transform: "translateX(-100px)" }, { transform: `translateX(${win.innerWidth + 40}px)` }], { duration: 9000, easing: "linear", fill: "forwards" });
	await new Promise<void>((resolve) => win.setTimeout(resolve, 3200));
	await note.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, fill: "forwards" }).finished.catch(() => undefined);
	note.remove();
	await crawl.finished.catch(() => undefined);
	snail.remove();
}
