/** All async work belongs to the mounting document and has one teardown path. */
export class MapLifetime {
	private timers = new Map<string, number>();
	private frames = new Set<number>();
	private animations = new Set<Animation>();
	private cleanups: Array<() => void> = [];
	private dead = false;
	constructor(readonly win: Window) {}
	get reduced(): boolean { return this.win.matchMedia("(prefers-reduced-motion: reduce)").matches; }
	after(name: string, delay: number, callback: () => void): void {
		this.cancel(name);
		if (this.dead) return;
		this.timers.set(name, this.win.setTimeout(() => { this.timers.delete(name); if (!this.dead) callback(); }, delay));
	}
	cancel(name: string): void {
		const timer = this.timers.get(name);
		if (timer !== undefined) this.win.clearTimeout(timer);
		this.timers.delete(name);
	}
	frame(callback: () => void): void {
		if (this.dead) return;
		const id = this.win.requestAnimationFrame(() => { this.frames.delete(id); if (!this.dead) callback(); });
		this.frames.add(id);
	}
	listen(target: EventTarget, type: string, callback: (event: Event) => void, capture = false): void {
		target.addEventListener(type, callback, capture);
		this.cleanups.push(() => target.removeEventListener(type, callback, capture));
	}
	add(cleanup: () => void): void { this.cleanups.push(cleanup); }
	animate(el: Element, frames: Keyframe[], duration: number, delay = 0, spring = false, done?: () => void): void {
		if (this.dead) return;
		if (!el.animate) { done?.(); return; }
		const reduced = this.reduced;
		const style = this.win.getComputedStyle(el);
		const easing = style.getPropertyValue(spring ? "--sk-spring" : "--sk-ease").trim() || "ease-out";
		const animation = el.animate(reduced ? frames.map(({ opacity }) => ({ opacity: opacity ?? 1 })) : frames,
			{ duration: reduced ? 120 : duration, delay: reduced ? 0 : delay, easing, fill: "backwards" });
		this.animations.add(animation);
		animation.onfinish = () => { this.animations.delete(animation); done?.(); };
		animation.oncancel = () => this.animations.delete(animation);
	}
	destroy(): void {
		this.dead = true;
		for (const id of this.timers.values()) this.win.clearTimeout(id);
		for (const id of this.frames) this.win.cancelAnimationFrame(id);
		for (const animation of this.animations) { animation.onfinish = null; animation.cancel(); }
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.timers.clear(); this.frames.clear(); this.animations.clear();
	}
}
