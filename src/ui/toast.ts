// One shared toast: a small pill at the bottom of the window, with an optional action (Undo).
// A new toast replaces the previous one, so they never pile up.

export interface ToastOptions {
	action?: { label: string; run: () => void };
	/** Milliseconds before it leaves. Default 5000 with an action, 3000 without. */
	duration?: number;
}

let current: { el: HTMLElement; timer: number } | null = null;

function dismiss(el: HTMLElement): void {
	if (current?.el === el) {
		window.clearTimeout(current.timer);
		current = null;
	}
	el.addClass("is-leaving");
	window.setTimeout(() => el.remove(), 220);
}

export function showToast(message: string, options: ToastOptions = {}): void {
	if (current) dismiss(current.el);
	const doc = activeDocument;
	const el = doc.body.createDiv({ cls: "sk-toast", attr: { role: "status", "aria-live": "polite" } });
	el.createSpan({ cls: "sk-toast-text", text: message });
	if (options.action) {
		el.addClass("has-action");
		const { label, run } = options.action;
		const button = el.createEl("button", { cls: "sk-toast-action", text: label });
		button.addEventListener("click", () => {
			dismiss(el);
			run();
		});
	}
	const duration = options.duration ?? (options.action ? 5000 : 3000);
	const timer = window.setTimeout(() => dismiss(el), duration);
	el.addEventListener("mouseenter", () => {
		if (current?.el === el) window.clearTimeout(current.timer);
	});
	el.addEventListener("mouseleave", () => {
		if (current?.el !== el) return;
		current.timer = window.setTimeout(() => dismiss(el), 1500);
	});
	current = { el, timer };
}

/** Removes the toast, if any (on plugin unload). */
export function clearToast(): void {
	if (current) {
		window.clearTimeout(current.timer);
		current.el.remove();
		current = null;
	}
}
