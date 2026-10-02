import { setIcon } from "obsidian";
import type { MenuRow, MenuSection } from "./model";

export interface MenuAnchor {
	left: number;
	top: number;
	bottom: number;
}

export interface MenuDisplayOptions {
	showIcons: boolean;
	showDescriptions: boolean;
	animations: boolean;
	triggerChar: string;
}

const MENU_GAP = 6;
const MAX_HEIGHT = 420;
const VIEWPORT_MARGIN = 8;
const CLOSE_MS = 230;
/** How many rows get the staggered entrance animation. */
const STAGGER_ROWS = 12;

/**
 * The floating menu (pure DOM, no editor knowledge). The controller feeds it
 * sections and forwards keys; it reports the chosen row through onChoose.
 */
export class SlashMenu {
	private root: HTMLElement;
	private queryEl: HTMLElement;
	private listEl: HTMLElement;
	private highlightEl: HTMLElement;
	private rows: MenuRow[] = [];
	private rowEls: HTMLElement[] = [];
	private selected = 0;
	private anchor: MenuAnchor | null = null;
	private lastPointer = { x: -1, y: -1 };
	private closing = false;
	private opts: MenuDisplayOptions;
	private timers = new Set<number>();
	private later(callback: () => void, delay: number): void {
		const win = this.doc.defaultView ?? window;
		const id = win.setTimeout(() => { this.timers.delete(id); callback(); }, delay);
		this.timers.add(id);
	}
	destroy(): void {
		for (const id of this.timers) (this.doc.defaultView ?? window).clearTimeout(id);
		this.timers.clear(); this.root.remove(); this.onDestroy();
	}

	constructor(
		private doc: Document,
		private t: (key: string) => string,
		private onDestroy: () => void,
		opts: MenuDisplayOptions,
		private onChoose: (row: MenuRow) => void,
	) {
		this.opts = opts;
		this.root = doc.body.createDiv({ cls: "sk-slash-menu-menu" });
		this.root.setAttr("role", "listbox");
		this.root.toggleClass("sk-slash-menu-no-anim", !opts.animations);
		this.root.toggleClass("sk-slash-menu-no-icons", !opts.showIcons);
		// Keep the focus in the editor whatever is clicked in the menu.
		this.root.addEventListener("mousedown", (e) => e.preventDefault());

		const search = this.root.createDiv({ cls: "sk-slash-menu-menu-search" });
		setIcon(search.createSpan({ cls: "sk-slash-menu-menu-search-icon" }), "search");
		search.createSpan({ cls: "sk-slash-menu-menu-search-trigger", text: opts.triggerChar });
		this.queryEl = search.createSpan({ cls: "sk-slash-menu-menu-search-query" });

		this.listEl = this.root.createDiv({ cls: "sk-slash-menu-menu-list" });
		this.highlightEl = this.listEl.createDiv({ cls: "sk-slash-menu-menu-highlight" });

		const footer = this.root.createDiv({ cls: "sk-slash-menu-menu-footer" });
		const hint = (keys: string, label: string) => {
			const h = footer.createSpan({ cls: "sk-slash-menu-menu-hint" });
			h.createEl("kbd", { text: keys });
			h.createSpan({ text: label });
		};
		hint("↑↓", this.t("menu.hint.navigate"));
		hint("↵", this.t("menu.hint.select"));
		hint("⇥", this.t("menu.hint.complete"));
		hint("esc", this.t("menu.hint.close"));
	}

	get isClosing(): boolean {
		return this.closing;
	}

	/** Shows the menu for the first time at `anchor` with an entrance animation. */
	open(anchor: MenuAnchor, query: string, sections: MenuSection[]): void {
		this.anchor = anchor;
		this.root.addClass("sk-slash-menu-entering");
		this.render(query, sections, true);
		this.position();
		this.later(() => this.root.removeClass("sk-slash-menu-entering"), 400);
	}

	update(query: string, sections: MenuSection[]): void {
		// Not placed yet: open() will render the latest query.
		if (this.closing || !this.anchor) return;
		this.render(query, sections, false);
		this.position();
	}

	reanchor(anchor: MenuAnchor): void {
		this.anchor = anchor;
		this.position();
	}

	move(delta: number): void {
		if (this.rows.length === 0) return;
		const n = this.rows.length;
		this.select((((this.selected + delta) % n) + n) % n);
	}

	/** Jumps by a page of rows without wrapping. */
	page(direction: 1 | -1): void {
		if (this.rows.length === 0) return;
		this.select(Math.max(0, Math.min(this.rows.length - 1, this.selected + direction * 6)));
	}

	selectedRow(): MenuRow | null {
		return this.rows[this.selected] ?? null;
	}

	get rowCount(): number {
		return this.rows.length;
	}

	/** Confirmation animation on the chosen row, then fade out and remove. */
	playChosenAndClose(): void {
		const el = this.rowEls[this.selected];
		el?.addClass("is-chosen");
		this.close(true, 90);
	}

	/** Little "no" shake on the selected row (unavailable entry). */
	shake(): void {
		const el = this.rowEls[this.selected];
		if (!el || !this.opts.animations) return;
		el.removeClass("is-shaking");
		void el.offsetWidth; // restart the animation
		el.addClass("is-shaking");
	}

	close(animated: boolean, delay = 0): void {
		if (this.closing) return;
		this.closing = true;
		if (!animated || !this.opts.animations) {
			this.destroy();
			return;
		}
		this.later(() => this.root.addClass("sk-slash-menu-closing"), delay);
		this.later(() => this.destroy(), delay + CLOSE_MS);
	}

	private render(query: string, sections: MenuSection[], entering: boolean): void {
		const previous = this.selectedRow()?.item.id;
		this.queryEl.setText(query);
		this.queryEl.toggleClass("is-empty", query === "");
		this.queryEl.setAttr("data-placeholder", this.t("menu.placeholder"));

		this.listEl.empty();
		this.listEl.appendChild(this.highlightEl);
		this.rows = [];
		this.rowEls = [];

		if (sections.length === 0) {
			const empty = this.listEl.createDiv({ cls: "sk-slash-menu-menu-empty" });
			setIcon(empty.createDiv({ cls: "sk-slash-menu-menu-empty-icon" }), "search-x");
			empty.createDiv({ text: this.t("menu.empty") });
			this.highlightEl.hide();
			return;
		}
		this.highlightEl.show();

		for (const section of sections) {
			const sectionEl = this.listEl.createDiv({ cls: `sk-slash-menu-menu-section sk-slash-menu-menu-section-${section.kind}` });
			if (section.title) {
				const title = sectionEl.createDiv({ cls: "sk-slash-menu-menu-section-title" });
				if (section.kind === "pinned") setIcon(title.createSpan({ cls: "sk-slash-menu-menu-section-icon" }), "pin");
				if (section.kind === "recent") setIcon(title.createSpan({ cls: "sk-slash-menu-menu-section-icon" }), "history");
				title.createSpan({ text: section.title });
			}
			for (const row of section.rows) this.renderRow(sectionEl, row, entering);
		}

		// Keep the same entry selected while filtering when it is still there.
		const keep = previous !== undefined && !entering && query === "" ? this.rows.findIndex((r) => r.item.id === previous) : -1;
		this.select(keep >= 0 ? keep : 0, true);
		this.listEl.scrollTop = keep >= 0 ? this.listEl.scrollTop : 0;
	}

	private renderRow(parent: HTMLElement, row: MenuRow, entering: boolean): void {
		const index = this.rows.length;
		const el = parent.createDiv({ cls: "sk-slash-menu-menu-item" });
		el.setAttr("role", "option");
		if (!row.availability.available) {
			el.addClass("is-unavailable");
			if (row.availability.reason) el.setAttr("aria-label", row.availability.reason);
		}
		if (entering && index < STAGGER_ROWS) el.style.setProperty("--sk-slash-menu-i", String(index));

		if (this.opts.showIcons) {
			const icon = el.createDiv({ cls: "sk-slash-menu-menu-item-icon" });
			setIcon(icon, row.item.icon || "circle-dot");
		}
		const text = el.createDiv({ cls: "sk-slash-menu-menu-item-text" });
		const title = text.createDiv({ cls: "sk-slash-menu-menu-item-title" });
		renderHighlighted(title, row.item.name, row.matches);
		const desc = !row.availability.available && row.availability.reason ? row.availability.reason : row.item.description;
		if (this.opts.showDescriptions && desc) text.createDiv({ cls: "sk-slash-menu-menu-item-desc", text: desc });

		if (!row.availability.available) el.createDiv({ cls: "sk-slash-menu-menu-item-badge", text: this.t("menu.unavailable") });
		else if (row.categoryLabel) el.createDiv({ cls: "sk-slash-menu-menu-item-meta", text: row.categoryLabel });

		el.addEventListener("mousemove", (e) => {
			// Ignore the synthetic "move" fired when the list scrolls under a still pointer.
			if (e.clientX === this.lastPointer.x && e.clientY === this.lastPointer.y) return;
			this.lastPointer = { x: e.clientX, y: e.clientY };
			if (this.selected !== index) this.select(index);
		});
		el.addEventListener("click", () => {
			this.select(index);
			this.onChoose(row);
		});

		this.rows.push(row);
		this.rowEls.push(el);
	}

	private select(index: number, instant = false): void {
		this.rowEls[this.selected]?.removeClass("is-selected");
		this.rowEls[this.selected]?.setAttr("aria-selected", "false");
		this.selected = index;
		const el = this.rowEls[index];
		if (!el) return;
		el.addClass("is-selected");
		el.setAttr("aria-selected", "true");

		// The accent pill glides to the selected row.
		this.highlightEl.toggleClass("is-instant", instant);
		this.highlightEl.style.transform = `translateY(${el.offsetTop}px)`;
		this.highlightEl.style.height = `${el.offsetHeight}px`;
		this.highlightEl.toggleClass("is-unavailable", el.hasClass("is-unavailable"));
		this.scrollIntoView(el);
	}

	private scrollIntoView(el: HTMLElement): void {
		const list = this.listEl;
		// Show the section title too when selecting the first row of a section.
		const section = el.parentElement;
		const isFirst = section?.querySelector(".sk-slash-menu-menu-item") === el;
		const top = isFirst && section ? section.offsetTop : el.offsetTop;
		const bottom = el.offsetTop + el.offsetHeight;
		if (top < list.scrollTop) list.scrollTop = top;
		else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
	}

	/** Below the cursor, or above it when there is not enough room. */
	private position(): void {
		if (!this.anchor) return;
		const win = this.doc.defaultView ?? window;
		const vw = win.innerWidth;
		const vh = win.innerHeight;
		const width = this.root.offsetWidth;
		const height = this.root.offsetHeight;
		const left = Math.max(VIEWPORT_MARGIN, Math.min(this.anchor.left - 14, vw - width - VIEWPORT_MARGIN));
		const spaceBelow = vh - this.anchor.bottom - MENU_GAP - VIEWPORT_MARGIN;
		const spaceAbove = this.anchor.top - MENU_GAP - VIEWPORT_MARGIN;
		const above = height > spaceBelow && spaceAbove > spaceBelow;
		this.root.toggleClass("is-above", above);
		this.root.style.left = `${left}px`;
		if (above) {
			this.root.style.top = "";
			this.root.style.bottom = `${vh - this.anchor.top + MENU_GAP}px`;
			this.root.style.maxHeight = `${Math.min(MAX_HEIGHT, spaceAbove)}px`;
		} else {
			this.root.style.bottom = "";
			this.root.style.top = `${this.anchor.bottom + MENU_GAP}px`;
			this.root.style.maxHeight = `${Math.min(MAX_HEIGHT, Math.max(160, spaceBelow))}px`;
		}
	}
}

function renderHighlighted(el: HTMLElement, text: string, matches: number[]): void {
	if (matches.length === 0) {
		el.setText(text);
		return;
	}
	const set = new Set(matches);
	let run = "";
	let inMatch = false;
	const flush = () => {
		if (!run) return;
		if (inMatch) el.createSpan({ cls: "sk-slash-menu-match", text: run });
		else el.appendText(run);
		run = "";
	};
	for (let i = 0; i < text.length; i++) {
		const m = set.has(i);
		if (m !== inMatch) {
			flush();
			inMatch = m;
		}
		run += text[i];
	}
	flush();
}
