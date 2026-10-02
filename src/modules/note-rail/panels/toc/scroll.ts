// Retargetable eased scroll. One animation per scroll element: a new call replaces the running one
// (a fast sweep over the contents never queues jumps). The target is a function re-read every frame,
// because CodeMirror and the reading view only know estimated heights for lines not rendered yet:
// the estimate sharpens while we travel, and the animation follows it.
import { reducedMotion } from "../../rail/motion";

export type ScrollTarget = () => number | null;

export interface ScrollHandle {
	stop(): void;
	readonly done: boolean;
}

interface ScrollOptions {
	duration?: number;
	/** Jump (still corrected for a few frames unless `sync`). */
	instant?: boolean;
	/** Jump synchronously, schedule nothing (module turned off). */
	sync?: boolean;
	/** Checked every frame: false stops the animation (note changed, view gone). */
	guard?: () => boolean;
	/** Called once when the animation ends or is stopped. */
	onEnd?: () => void;
	/** When the module is turned off, jump to the target instead of freezing midway (glide back to origin). */
	finishOnUnload?: boolean;
}

const running = new WeakMap<HTMLElement, ScrollHandle>();
/** Every live animation, so they can all be stopped when the module is turned off. */
const all = new Map<ScrollHandle, () => void>();
const ease = (t: number) => 1 - Math.pow(1 - t, 4);
/** Extra frames after the end to absorb late height corrections. */
const SETTLE_FRAMES = 4;

const FINISHED: ScrollHandle = { stop() {}, done: true };

export function cancelScroll(el: HTMLElement): void {
	running.get(el)?.stop();
}

/** Stop every running scroll animation (module turned off). */
export function cancelAllScrolls(): void {
	for (const [h, finish] of Array.from(all)) {
		finish();
		h.stop();
	}
}

export function animateScroll(el: HTMLElement, target: ScrollTarget, opts: ScrollOptions = {}): ScrollHandle {
	cancelScroll(el);
	const win = el.ownerDocument.defaultView ?? window;
	const clamp = (y: number) => Math.max(0, Math.min(el.scrollHeight - el.clientHeight, y));
	const read = () => {
		const t = target();
		return t === null || !isFinite(t) ? null : clamp(t);
	};

	const first = read();
	if (first === null) {
		opts.onEnd?.();
		return FINISHED;
	}
	if (opts.sync) {
		el.scrollTop = first;
		opts.onEnd?.();
		return FINISHED;
	}

	let raf = 0;
	let done = false;
	const interrupt = () => handle.stop();
	const handle: ScrollHandle = {
		get done() {
			return done;
		},
		stop() {
			if (done) return;
			done = true;
			win.cancelAnimationFrame(raf);
			el.removeEventListener("wheel", interrupt);
			el.removeEventListener("touchstart", interrupt);
			el.removeEventListener("keydown", interrupt);
			if (running.get(el) === handle) running.delete(el);
			all.delete(handle);
			opts.onEnd?.();
		},
	};
	running.set(el, handle);
	all.set(handle, () => {
		if (!opts.finishOnUnload || done) return;
		const y = read();
		if (y !== null) el.scrollTop = y;
	});
	// The user takes over: stop following.
	el.addEventListener("wheel", interrupt, { passive: true });
	el.addEventListener("touchstart", interrupt, { passive: true });
	el.addEventListener("keydown", interrupt);

	const alive = () => !done && el.isConnected && (!opts.guard || opts.guard());

	let settle = SETTLE_FRAMES;
	const settleStep = () => {
		if (!alive()) return handle.stop();
		const y = read();
		if (y !== null && Math.abs(y - el.scrollTop) > 0.5) el.scrollTop = y;
		if (--settle > 0) raf = win.requestAnimationFrame(settleStep);
		else handle.stop();
	};

	const from = el.scrollTop;
	const dist = first - from;
	if (opts.instant || reducedMotion(win) || Math.abs(dist) < 1) {
		el.scrollTop = first;
		raf = win.requestAnimationFrame(settleStep);
		return handle;
	}

	const base = opts.duration ?? 460;
	const d = Math.min(620, Math.max(260, base * Math.min(1, 0.45 + Math.abs(dist) / 2400)));
	const t0 = win.performance.now();
	const step = (now: number) => {
		if (!alive()) return handle.stop();
		const t = Math.min(1, (now - t0) / d);
		const to = read() ?? first;
		el.scrollTop = from + (to - from) * ease(t);
		raf = win.requestAnimationFrame(t < 1 ? step : settleStep);
	};
	raf = win.requestAnimationFrame(step);
	return handle;
}
