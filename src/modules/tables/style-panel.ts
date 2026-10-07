// The style panel: style, accent, banding, header row, text size, first column, total row.
// Hovering a style previews it on the table; every change is one undo step in the note.
import { Platform, setIcon, ToggleComponent } from "obsidian";
import type { TablesController } from "./controller";
import { applyMeta, iconButton, miniTable, placeBeside, placeBelow } from "./dom";
import {
	accentCss,
	ACCENTS,
	BANDINGS,
	defaultMeta,
	HEADER_MODES,
	shownStyle,
	STYLES,
	TEXT_SIZES,
	type Meta,
} from "./logic";
import type { StyleTarget } from "./types";

const HEX_RE = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;

export class StylePanel {
	private el: HTMLElement | null = null;
	private doc: Document = document;
	/** The table's own comment, or null while it has none. */
	private meta: Meta | null;
	private readonly onPointer = (evt: PointerEvent) => {
		const target = evt.target as HTMLElement | null;
		if (this.el && target && !this.el.contains(target) && !target.closest?.(".sk-tables-toolbar, .menu")) this.close(false);
	};

	constructor(
		private readonly controller: TablesController,
		private readonly target: StyleTarget,
	) {
		this.meta = target.meta ? { ...defaultMeta(), ...target.meta } : null;
	}

	private t(key: string): string {
		return this.controller.t(key);
	}

	private current(): Meta {
		return this.meta || this.controller.newTableMeta();
	}

	open(anchor: { top: number; bottom: number; left: number }, focus: boolean): void {
		const doc = (this.doc = activeDocument);
		const el = (this.el = doc.body.createDiv({
			cls: "sk-tables-ui sk-tables-popover sk-tables-style-panel is-entering",
			attr: { role: "dialog", "aria-label": this.t("style.title") },
		}));
		if (Platform.isMobile) el.addClass("is-sheet");
		this.render();
		const table = this.target.tables()[0];
		if (!Platform.isMobile) {
			if (table) placeBeside(el, table.getBoundingClientRect());
			else placeBelow(el, anchor);
		}
		this.controller.later(() => el.removeClass("is-entering"), 200);
		doc.addEventListener("pointerdown", this.onPointer, true);
		el.addEventListener("keydown", (evt) => {
			if (evt.key === "Escape") {
				evt.preventDefault();
				evt.stopPropagation();
				this.close(true);
			}
		});
		if (focus) (el.querySelector<HTMLElement>(".sk-tables-preset[aria-pressed=true]") || el.querySelector<HTMLElement>(".sk-tables-preset"))?.focus();
	}

	private render(): void {
		const el = this.el;
		if (!el) return;
		const meta = this.current();
		const shown = shownStyle(meta.style);
		el.empty();
		const header = el.createDiv("sk-tables-popover-header");
		header.createSpan({ cls: "sk-tables-popover-title", text: this.t("style.title") });
		iconButton(header, "sk-tables-icon-btn", "x", this.t("common.close")).addEventListener("click", () => this.close(true));

		let section = el.createDiv("sk-tables-section");
		section.createDiv({ cls: "sk-tables-section-label", text: this.t("style.styles") });
		const grid = section.createDiv("sk-tables-preset-grid");
		const sample = this.sample();
		for (const style of STYLES) {
			const pressed = !!this.meta && style === shown;
			const button = grid.createEl("button", {
				cls: "sk-tables-preset",
				attr: { type: "button", "data-preset": style, "aria-pressed": String(pressed) },
			});
			miniTable(button.createDiv("sk-tables-preset-preview"), { ...meta, style, widths: [] }, sample);
			button.createSpan({ cls: "sk-tables-preset-name", text: this.t("style." + style) });
			setIcon(button.createSpan("sk-tables-preset-check"), "check");
			button.addEventListener("mouseenter", () => this.preview({ style }));
			button.addEventListener("focus", () => this.preview({ style }));
			button.addEventListener("click", () => this.commit({ style }));
		}
		grid.addEventListener("mouseleave", () => this.endPreview());
		grid.addEventListener("focusout", (evt) => {
			if (!grid.contains(evt.relatedTarget as Node | null)) this.endPreview();
		});

		section = el.createDiv("sk-tables-section");
		section.createDiv({ cls: "sk-tables-section-label", text: this.t("style.accent") });
		const swatches = section.createDiv("sk-tables-swatches");
		for (const accent of ACCENTS) {
			const button = swatches.createEl("button", {
				cls: "sk-tables-swatch",
				attr: { type: "button", "data-accent": accent, "aria-pressed": String(meta.accent === accent), "aria-label": this.t("accent." + accent) },
			});
			button.setCssProps({ "--sk-tables-swatch": accentCss(accent) ?? "var(--interactive-accent)" });
			button.addEventListener("click", () => this.commit({ accent }));
		}
		const custom = HEX_RE.test(meta.accent);
		const customButton = swatches.createEl("button", {
			cls: "sk-tables-swatch sk-tables-swatch-custom",
			attr: { type: "button", "aria-pressed": String(custom), "aria-label": this.t("style.custom") },
		});
		if (custom) customButton.setCssProps({ "--sk-tables-swatch": meta.accent });
		setIcon(customButton, "pipette");
		const picker = customButton.createEl("input", { attr: { type: "color", tabindex: "-1", "aria-hidden": "true" } });
		picker.value = custom && meta.accent.length === 7 ? meta.accent : "#3b82f6";
		customButton.addEventListener("click", () => picker.click());
		picker.addEventListener("input", () => this.preview({ accent: picker.value }));
		picker.addEventListener("change", () => this.commit({ accent: picker.value }));

		section = el.createDiv("sk-tables-section");
		section.createDiv({ cls: "sk-tables-section-label", text: this.t("style.options") });
		this.segmented(section, this.t("style.banding"), BANDINGS, "banding.", meta.banding, (banding) => this.commit({ banding }));
		this.segmented(section, this.t("style.header"), HEADER_MODES, "header.", meta.header, (header) => this.commit({ header }));
		this.segmented(section, this.t("style.size"), TEXT_SIZES, "size.", meta.size, (size) => this.commit({ size }));
		for (const key of ["firstCol", "total"] as const) {
			const row = section.createDiv("sk-tables-option-row");
			row.createSpan({ cls: "sk-tables-option-label", text: this.t(key === "firstCol" ? "style.first-col" : "style.total") });
			new ToggleComponent(row).setValue(meta[key]).onChange((value) => this.commit({ [key]: value }));
		}

		const footer = el.createDiv("sk-tables-popover-footer");
		const reset = footer.createEl("button", { cls: "sk-tables-link-btn", text: this.t("style.reset"), attr: { type: "button" } });
		reset.disabled = !this.meta;
		reset.addEventListener("click", () => {
			// Widths are not part of the look: they stay (style=none keeps the theme's look).
			const widths = this.meta && this.meta.widths.some((w) => w > 0) ? this.meta.widths : null;
			this.meta = widths ? { ...defaultMeta(), style: "none", widths } : null;
			this.target.commit(this.meta);
			this.restyle();
			this.render();
		});
		const asDefault = footer.createEl("button", { cls: "sk-tables-link-btn", text: this.t("style.as-default"), attr: { type: "button" } });
		asDefault.disabled = !this.meta || this.meta.style === "none";
		asDefault.addEventListener("click", () => { void (async () => {
			await this.controller.setNewTableLook(this.current());
			this.controller.ctx.toast(this.t("style.default-done"));
		})(); });
	}

	private sample(): string[][] {
		const t = (key: string) => this.t("sample." + key);
		return [
			[t("item"), t("qty"), t("price")],
			[t("apples"), "4", "2.40"],
			[t("pears"), "2", "1.10"],
			[t("total"), "6", "3.50"],
		];
	}

	private segmented<T extends string>(section: HTMLElement, label: string, options: readonly T[], prefix: string, current: T, onPick: (id: T) => void): void {
		const row = section.createDiv("sk-tables-option-row");
		row.createSpan({ cls: "sk-tables-option-label", text: label });
		const group = row.createDiv({ cls: "sk-tables-segmented", attr: { role: "radiogroup", "aria-label": label } });
		for (const option of options) {
			const on = current === option;
			const button = group.createEl("button", {
				cls: "sk-tables-segment",
				text: this.t(prefix + option),
				attr: { type: "button", role: "radio", "aria-checked": String(on) },
			});
			button.addEventListener("click", () => onPick(option));
		}
	}

	private preview(change: Partial<Meta>): void {
		const meta = { ...this.current(), ...change };
		for (const table of this.target.tables()) {
			table.setAttribute("data-sk-preview", "");
			applyMeta(table, meta);
		}
	}

	private endPreview(): void {
		for (const table of this.target.tables()) table.removeAttribute("data-sk-preview");
		this.restyle();
	}

	private restyle(): void {
		const meta = this.meta || this.controller.defaultMeta();
		for (const table of this.target.tables()) if (!table.hasAttribute("data-sk-preview")) applyMeta(table, meta);
	}

	private commit(change: Partial<Meta>): void {
		if (!this.el) return;
		this.meta = { ...this.current(), ...change };
		for (const table of this.target.tables()) table.removeAttribute("data-sk-preview");
		this.target.commit(this.meta);
		if (!this.el) return;
		this.restyle();
		const focused = this.el.querySelector(":focus");
		const preset = focused?.getAttribute("data-preset");
		this.render();
		if (preset) this.el.querySelector<HTMLElement>(`[data-preset="${preset}"]`)?.focus();
	}

	close(restoreFocus: boolean): void {
		if (!this.el) return;
		this.endPreview();
		this.doc.removeEventListener("pointerdown", this.onPointer, true);
		this.el.remove();
		this.el = null;
		if (this.controller.stylePanel === this) this.controller.stylePanel = null;
		if (restoreFocus) this.target.restoreFocus();
		this.controller.toolbar.refreshSoon();
	}
}
