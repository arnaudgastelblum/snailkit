// A list of rows for the small panels (Snailkit menu, area, actions): icon, label, a quiet meta on
// the right or a chevron for a sub-panel; Up and Down move, Enter or Space runs, a click runs.
// Ctrl or Cmd (and a middle click) are passed to the action for "open in a new tab".
import { setIcon } from "obsidian";
import { asElement } from "../rail/motion";

export type RowRun = (e: MouseEvent | KeyboardEvent) => void;

export interface RowOptions {
	/** Lucide icon, or null for none (the caller may fill `iconEl` itself). */
	icon?: string | null;
	/** Short grey text at the right end. */
	meta?: string;
	/** A chevron: the row leads to a sub-panel. */
	chevron?: boolean;
	/** Extra classes on the row. */
	cls?: string;
	/** Indent level (the area panel's tree). */
	depth?: number;
	/** The current note or day: lit, not clickable. */
	current?: boolean;
	/** Title attribute (a path). */
	title?: string;
}

export class RowList {
	private actions = new Map<HTMLElement, RowRun>();
	private cleanups: (() => void)[] = [];
	private destroyed = false;

	constructor(private body: HTMLElement) {
		this.listen("click", (e) => this.activate(e as MouseEvent));
		this.listen("auxclick", (e) => {
			if ((e as MouseEvent).button === 1) this.activate(e as MouseEvent);
		});
		this.listen("keydown", (e) => this.onKey(e as KeyboardEvent));
	}

	/** Forget every row (the body is being rebuilt). */
	clear(): void {
		this.actions.clear();
	}

	destroy(): void {
		this.destroyed = true;
		for (const c of this.cleanups) c();
		this.cleanups = [];
		this.actions.clear();
	}

	section(parent: HTMLElement, label: string, count?: number): HTMLElement {
		const head = parent.createDiv("sk-note-rail-section");
		head.createSpan({ text: label });
		if (count) head.createSpan({ cls: "sk-note-rail-count", text: String(count) });
		return head;
	}

	/** A focusable row. Returns the row; `iconEl` is its icon slot (empty without an icon). */
	row(parent: HTMLElement, label: string, key: string, run: RowRun | null, options: RowOptions = {}): HTMLElement & { iconEl: HTMLElement } {
		const el = parent.createDiv({
			cls: `sk-note-rail-row sk-note-rail-mrow ${options.cls ?? ""}`.trim(),
			attr: { tabindex: "0", role: options.current ? "listitem" : "button", "data-key": key, "data-nav": "" },
		}) as unknown as HTMLElement & { iconEl: HTMLElement };
		if (options.depth) el.setCssProps({ "--depth": String(options.depth) });
		if (options.current) el.addClass("is-current");
		if (options.title) el.setAttr("title", options.title);
		const iconEl = el.createSpan("sk-note-rail-mrow-icon");
		if (options.icon) setIcon(iconEl, options.icon);
		el.iconEl = iconEl;
		el.createSpan({ cls: "sk-note-rail-row-title", text: label });
		if (options.meta) el.createSpan({ cls: "sk-note-rail-row-meta", text: options.meta });
		if (options.chevron) setIcon(el.createSpan("sk-note-rail-mrow-chevron"), "chevron-right");
		if (run) this.actions.set(el, run);
		return el;
	}

	/** Focus the row with that key, if it is there. */
	focus(key: string | undefined): void {
		if (!key) return;
		this.body.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
	}

	/** The key of the row that has the focus (to give it back after a rebuild). */
	focusedKey(): string | undefined {
		return asElement(this.body.doc.activeElement)?.closest<HTMLElement>("[data-key]")?.dataset.key;
	}

	private listen(type: string, fn: (e: Event) => void): void {
		this.body.addEventListener(type, fn);
		this.cleanups.push(() => this.body.removeEventListener(type, fn));
	}

	private activate(e: MouseEvent): void {
		if (this.destroyed) return;
		const el = asElement(e.target)?.closest<HTMLElement>("[data-key]");
		const run = el ? this.actions.get(el) : undefined;
		if (!run) return;
		e.preventDefault();
		run(e);
	}

	/** Up and Down move, Home and End jump, Enter or Space runs (Ctrl or Cmd Enter: a new tab). */
	private onKey(e: KeyboardEvent): void {
		if (this.destroyed) return;
		const items = Array.from(this.body.querySelectorAll<HTMLElement>("[data-nav]"));
		const current = asElement(e.target)?.closest<HTMLElement>("[data-nav]");
		const i = current ? items.indexOf(current) : -1;
		let next: HTMLElement | undefined;
		if (e.key === "ArrowDown") next = items[Math.min(items.length - 1, i + 1)];
		else if (e.key === "ArrowUp") next = items[Math.max(0, i - 1)];
		else if (e.key === "Home") next = items[0];
		else if (e.key === "End") next = items[items.length - 1];
		else if ((e.key === "Enter" || e.key === " ") && current) {
			const run = this.actions.get(current);
			if (!run) return;
			e.preventDefault();
			if (!e.repeat) run(e);
			return;
		} else return;
		e.preventDefault();
		next?.focus({ preventScroll: false });
	}
}

/** True for Ctrl or Cmd (or a middle click): the caller opens in a new tab. */
export function wantsNewTab(e: MouseEvent | KeyboardEvent): boolean {
	return e.ctrlKey || e.metaKey || ("button" in e && e.button === 1);
}
