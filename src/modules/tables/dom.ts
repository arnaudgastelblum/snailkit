// Styling a rendered table (Live Preview widget, Reading view, previews) from its style comment.
// Every style is a class plus data attributes on the <table>; styles.css does the drawing.
import { setIcon } from "obsidian";
import { accentCss, MAX_WIDTH_COLUMNS, shownStyle, type Meta } from "./logic";

const STYLED = "sk-tables-styled";
const ATTRIBUTES = ["data-sk-style", "data-sk-header", "data-sk-banding", "data-sk-first-col", "data-sk-total"];

/**
 * Column widths (px, 0 = automatic) as --sk-tables-w1, --sk-tables-w2... on the <table>;
 * styles.css applies them to every cell of the column. Not on the cells themselves: Obsidian
 * wipes a cell's style attribute when it is clicked.
 */
export function applyWidths(tableEl: HTMLElement, widths: number[]): void {
	for (let c = 0; c < MAX_WIDTH_COLUMNS; c++) {
		const w = widths[c];
		const name = "--sk-tables-w" + (c + 1);
		if (w > 0) tableEl.setCssProps({ [name]: w + "px" });
		else if (tableEl.style.getPropertyValue(name)) tableEl.style.removeProperty(name);
	}
	tableEl.toggleAttribute("data-sk-widths", widths.some((w) => w > 0));
}

/** Widths currently shown on a table (during a drag they are ahead of the note). */
export function widthsOf(tableEl: HTMLTableElement): number[] {
	const head = tableEl.rows[0];
	const count = head ? head.cells.length : 0;
	const out: number[] = [];
	for (let c = 0; c < count; c++) out.push(parseInt(tableEl.style.getPropertyValue("--sk-tables-w" + (c + 1)), 10) || 0);
	return out;
}

/** First row that takes space (the header row may be hidden). */
export function firstVisibleRow(tableEl: HTMLTableElement): HTMLTableRowElement | undefined {
	return Array.from(tableEl.rows).find((tr) => tr.offsetHeight > 0) || tableEl.rows[0];
}

/** Draws a table with `meta`, or as the theme draws it when null. Widths, size and a hidden header apply to every style. */
export function applyMeta(tableEl: HTMLElement, meta: Meta | null): void {
	applyWidths(tableEl, meta ? meta.widths : []);
	tableEl.toggleAttribute("data-sk-hide-header", !!meta && meta.header === "hide");
	if (meta && meta.size !== "theme") tableEl.setAttribute("data-sk-size", meta.size);
	else tableEl.removeAttribute("data-sk-size");
	const style = meta ? shownStyle(meta.style) : "none";
	if (!meta || style === "none") {
		if (!tableEl.classList.contains(STYLED)) return;
		tableEl.classList.remove(STYLED);
		for (const name of ATTRIBUTES) tableEl.removeAttribute(name);
		tableEl.style.removeProperty("--sk-tables-accent");
		return;
	}
	tableEl.classList.add(STYLED);
	const values = [style, meta.header, meta.banding, meta.firstCol ? "on" : "off", meta.total ? "on" : "off"];
	ATTRIBUTES.forEach((name, i) => {
		if (tableEl.getAttribute(name) !== values[i]) tableEl.setAttribute(name, values[i]);
	});
	const accent = accentCss(meta.accent);
	if (accent) tableEl.setCssProps({ "--sk-tables-accent": accent });
	else tableEl.style.removeProperty("--sk-tables-accent");
}

/** A tiny sample table drawn with `meta`, for the style choices. */
export function miniTable(parent: HTMLElement, meta: Meta, sample: string[][]): HTMLTableElement {
	const table = parent.createEl("table", { cls: "sk-tables-mini" });
	applyMeta(table, meta);
	const head = table.createEl("thead").createEl("tr");
	for (const cell of sample[0]) head.createEl("th", { text: cell });
	const body = table.createEl("tbody");
	for (const row of sample.slice(1)) {
		const tr = body.createEl("tr");
		for (const cell of row) tr.createEl("td", { text: cell });
	}
	return table;
}

export function iconButton(parent: HTMLElement, cls: string, icon: string, label: string): HTMLButtonElement {
	const button = parent.createEl("button", { cls, attr: { type: "button", "aria-label": label } });
	setIcon(button, icon);
	return button;
}

/** Keeps a popover inside the window, below (or above) an anchor rectangle. */
export function placeBelow(el: HTMLElement, rect: { top: number; bottom: number; left: number }, gap = 6): void {
	const win = el.win || window;
	const w = el.offsetWidth;
	const h = el.offsetHeight;
	let top = rect.bottom + gap;
	if (top + h > win.innerHeight - 8 && rect.top - gap - h > 8) top = rect.top - gap - h;
	const left = Math.max(8, Math.min(rect.left, win.innerWidth - w - 8));
	el.style.top = Math.max(8, top) + "px";
	el.style.left = left + "px";
}

/** Right of `box` (a table) when there is room, else below it: the table stays in view while previewed. */
export function placeBeside(el: HTMLElement, box: DOMRect): void {
	const win = el.win || window;
	const w = el.offsetWidth;
	const h = el.offsetHeight;
	let left = box.right + 12;
	let top = box.top;
	if (left + w > win.innerWidth - 8) {
		left = Math.max(8, Math.min(box.left, win.innerWidth - w - 8));
		top = box.bottom + 8;
	}
	el.style.left = left + "px";
	el.style.top = Math.max(8, Math.min(top, win.innerHeight - h - 8)) + "px";
}
