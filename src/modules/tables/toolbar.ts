// The floating toolbar above the table that has the cursor: Rows, Columns, Sort, Style, More.
// Collapses to one button when the table's top is scrolled away; docks at the bottom on phones.
import { Menu, Platform, setIcon } from "obsidian";
import type { TablesController } from "./controller";
import { mobileToolbar } from "./internals";
import type { TableContext } from "./types";

type Kind = "rows" | "columns" | "sort" | "style" | "more";

export class TableToolbar {
	el: HTMLElement | null = null;
	private ctx: TableContext | null = null;
	private buttons: HTMLButtonElement[] = [];
	private live: HTMLElement | null = null;
	private busy = false;
	private menu: Menu | null = null;
	/** The table where Escape closed the toolbar: it stays hidden until the cursor leaves it. */
	private dismissedKey: string | null = null;
	private expanded = false;
	private frame = 0;
	private timer = 0;

	constructor(private readonly controller: TablesController) {}

	refreshSoon(): void {
		if (this.frame) return;
		this.frame = window.requestAnimationFrame(() => {
			this.frame = 0;
			this.refresh();
		});
	}

	/** True while the toolbar, one of its menus or the style panel is in use. */
	private isActive(): boolean {
		const active = activeDocument.activeElement;
		return this.busy || !!this.controller.stylePanel || !!(this.el && active && this.el.contains(active));
	}

	refresh(): void {
		const ctx = this.controller.ctx.settings.toolbar ? this.controller.focusedContext() : null;
		if (!ctx) {
			if (this.isActive()) return this.position();
			this.dismissedKey = null;
			return this.scheduleHide();
		}
		if (ctx.key === this.dismissedKey) return this.hide();
		window.clearTimeout(this.timer);
		this.timer = 0;
		const sameTable = this.ctx?.key === ctx.key;
		this.ctx = ctx;
		if (this.el && sameTable) return this.position();
		if (!sameTable) this.expanded = false;
		this.timer = window.setTimeout(() => this.show(), this.el ? 0 : 150);
	}

	private scheduleHide(): void {
		if (!this.el || this.timer) return;
		this.timer = window.setTimeout(() => {
			this.timer = 0;
			if (!this.isActive()) this.hide();
		}, 150);
	}

	private show(): void {
		this.timer = 0;
		if (!this.el) this.build();
		this.position();
	}

	private build(): void {
		const t = (key: string) => this.controller.t(key);
		const el = (this.el = activeDocument.body.createDiv({
			cls: "sk-tables-ui sk-tables-toolbar is-entering",
			attr: { role: "toolbar", "aria-label": t("toolbar.label") },
		}));
		if (Platform.isMobile) el.addClass("is-docked");
		this.controller.later(() => el.removeClass("is-entering"), 200);
		this.buttons = [
			this.action("rows", "rows-3", t("toolbar.rows"), true),
			this.action("columns", "columns-3", t("toolbar.columns"), true),
			this.action("sort", "arrow-up-down", t("toolbar.sort"), true),
			this.action("style", "palette", t("toolbar.style"), false),
		];
		el.createDiv("sk-tables-sep");
		this.buttons.push(this.action("more", "more-horizontal", t("toolbar.more"), true));
		this.buttons.forEach((b, i) => b.setAttribute("tabindex", i === 0 ? "0" : "-1"));
		this.live = el.createSpan({ cls: "sk-tables-sr-only", attr: { "aria-live": "polite" } });
		el.addEventListener("keydown", (evt) => this.onKey(evt));
	}

	private action(kind: Kind, icon: string, label: string, menu: boolean): HTMLButtonElement {
		const el = this.el as HTMLElement;
		const button = el.createEl("button", { cls: "sk-tables-action", attr: { type: "button", "data-action": kind, "aria-label": label } });
		setIcon(button.createSpan("sk-tables-action-icon"), icon);
		button.createSpan({ cls: "sk-tables-action-label", text: label });
		if (menu) {
			button.setAttribute("aria-haspopup", "menu");
			button.setAttribute("aria-expanded", "false");
			setIcon(button.createSpan("sk-tables-action-chevron"), "chevron-down");
		}
		// Keeps the focus (and the cell being edited) in the editor.
		button.addEventListener("mousedown", (evt) => evt.preventDefault());
		button.addEventListener("click", () => this.activate(kind, button));
		return button;
	}

	private activate(kind: Kind, button: HTMLButtonElement): void {
		if (!this.el) return;
		if (this.el.hasClass("is-collapsed")) {
			this.expanded = true;
			return this.position();
		}
		const ctx = this.ctx && this.controller.revalidate(this.ctx);
		if (!ctx) return;
		if (kind === "style") {
			if (this.controller.stylePanel) return this.controller.stylePanel.close(true);
			return this.controller.openStylePanel(ctx, button.getBoundingClientRect(), button.matches(":focus-visible"));
		}
		const menu = new Menu();
		if (kind === "rows") this.controller.fillRowMenu(menu, ctx);
		else if (kind === "columns") this.controller.fillColumnMenu(menu, ctx);
		else if (kind === "sort") this.controller.fillSortMenu(menu, ctx);
		else this.controller.fillMoreMenu(menu, ctx);
		const rect = button.getBoundingClientRect();
		this.busy = true;
		this.menu = menu;
		button.setAttribute("aria-expanded", "true");
		menu.onHide(() => {
			if (this.menu === menu) this.menu = null;
			this.busy = false;
			button.setAttribute("aria-expanded", "false");
			this.refreshSoon();
		});
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private onKey(evt: KeyboardEvent): void {
		const index = this.buttons.indexOf(activeDocument.activeElement as HTMLButtonElement);
		if (evt.key === "ArrowRight" || evt.key === "ArrowLeft") {
			evt.preventDefault();
			const next = this.buttons[(index + (evt.key === "ArrowRight" ? 1 : -1) + this.buttons.length) % this.buttons.length];
			this.buttons.forEach((b) => b.setAttribute("tabindex", b === next ? "0" : "-1"));
			next.focus();
		} else if (evt.key === "Escape") {
			evt.preventDefault();
			this.dismiss();
		}
	}

	/** Moves the keyboard focus to the toolbar (command "Focus table tools"). */
	focus(): boolean {
		this.dismissedKey = null;
		if (!this.el) {
			const ctx = this.controller.focusedContext() ?? this.controller.activeContext();
			if (!ctx) return false;
			this.ctx = ctx;
			this.build();
		}
		this.expanded = true;
		this.position();
		(this.buttons.find((b) => b.getAttribute("tabindex") === "0") || this.buttons[0]).focus();
		return true;
	}

	private dismiss(): void {
		const ctx = this.ctx;
		this.dismissedKey = ctx ? ctx.key : null;
		this.hide();
		if (ctx) this.controller.restoreFocus(ctx, ctx.row, ctx.col);
	}

	/** Tells screen readers what an action did. */
	announce(text: string): void {
		if (!this.live) return;
		const live = this.live;
		live.setText("");
		this.controller.later(() => live.setText(text), 50);
	}

	position(): void {
		const ctx = this.ctx;
		const el = this.el;
		if (!el || !ctx) return;
		if (el.hasClass("is-docked")) return this.dock(el);
		const pane = ctx.cm.scrollDOM.getBoundingClientRect();
		const anchor = this.controller.anchorRect(ctx);
		if (!anchor || anchor.bottom < pane.top + 24 || anchor.top > pane.bottom - 24) {
			el.addClass("is-hidden");
			return;
		}
		el.removeClass("is-hidden");
		const h = el.offsetHeight || 40;
		let top = anchor.top - h - 8;
		// The table's top is scrolled away: one button at the top right of the pane.
		const pinned = top < pane.top + 8;
		el.toggleClass("is-collapsed", pinned && !this.expanded);
		const w = el.offsetWidth;
		let left = Math.max(pane.left + 8, Math.min(anchor.left, pane.right - w - 8));
		if (pinned) {
			top = pane.top + 8;
			left = pane.right - w - 16;
		}
		el.style.top = top + "px";
		el.style.left = left + "px";
	}

	/** Phones: at the bottom, above the keyboard and Obsidian's mobile toolbar. */
	private dock(el: HTMLElement): void {
		const win = el.win || window;
		const vv = win.visualViewport;
		let offset = vv ? Math.max(0, win.innerHeight - vv.height - vv.offsetTop) : 0;
		const bar = mobileToolbar(el.doc || document);
		if (bar) offset = Math.max(offset, win.innerHeight - bar.getBoundingClientRect().top);
		el.setCssProps({ "--sk-tables-dock-offset": offset + "px" });
	}

	hide(): void {
		window.clearTimeout(this.timer);
		this.timer = 0;
		this.el?.remove();
		this.el = null;
		this.ctx = null;
		this.live = null;
		this.buttons = [];
		this.expanded = false;
	}

	destroy(): void {
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.menu?.hide();
		this.hide();
	}
}
