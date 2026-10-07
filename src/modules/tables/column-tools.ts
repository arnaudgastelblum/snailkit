// Live Preview header tools on desktop: a resize handle on the right edge of header cells
// (widths saved in the style comment) and a round button in the header cell's corner that
// opens the column menu, like the column arrows of a spreadsheet.
import { Menu, setIcon } from "obsidian";
import type { TablesController } from "./controller";
import { firstVisibleRow, widthsOf } from "./dom";
import { TABLE_WIDGET } from "./internals";
import { MAX_WIDTH_COLUMNS, setColumnWidth } from "./logic";

const RESIZE_ZONE = 5;
const MIN_WIDTH = 48;

interface Drag {
	table: HTMLTableElement;
	col: number;
	th: HTMLTableCellElement;
	startX: number;
	startW: number;
	width: number | null;
}

export class ColumnResizer {
	private handle: HTMLElement | null = null;
	private hover: { table: HTMLTableElement; col: number } | null = null;
	private drag: Drag | null = null;
	private doc: Document | null = null;

	constructor(private readonly controller: TablesController) {}

	onMove(evt: MouseEvent): void {
		if (this.drag) return this.dragTo(evt.clientX);
		const target = evt.target as HTMLElement | null;
		if (!target || typeof target.closest !== "function") return;
		if (this.handle && target === this.handle) return;
		if (target.closest(".sk-tables-col-btn")) return;
		const table = target.closest<HTMLTableElement>(`${TABLE_WIDGET} table`);
		const head = table && firstVisibleRow(table);
		if (!table || !head) {
			this.controller.columnButton.hide();
			return this.hideHandle();
		}
		const box = table.getBoundingClientRect();
		const cells = Array.from(head.cells);
		// Header button while the pointer is over a header cell.
		const th = target.closest("th");
		if (th && th.parentElement === table.rows[0]) this.controller.columnButton.show(table, cells.indexOf(th));
		else this.controller.columnButton.hide();
		for (let c = 0; c < cells.length; c++) {
			const r = cells[c].getBoundingClientRect();
			if (Math.abs(evt.clientX - r.right) <= RESIZE_ZONE) return this.showHandle(table, c, r.right, box);
		}
		this.hideHandle();
	}

	private showHandle(table: HTMLTableElement, col: number, x: number, box: DOMRect): void {
		if (this.handle && this.handle.ownerDocument !== table.ownerDocument) this.hideHandle();
		if (!this.handle) {
			this.handle = table.ownerDocument.body.createDiv({ cls: "sk-tables-ui sk-tables-col-resizer", attr: { "aria-hidden": "true" } });
			this.handle.addEventListener("mousedown", (evt) => this.onDown(evt));
			this.handle.addEventListener("dblclick", (evt) => this.onReset(evt));
			this.handle.title = this.controller.t("resize.hint");
		}
		this.hover = { table, col };
		this.handle.style.left = x - 4 + "px";
		this.handle.style.top = box.top + "px";
		this.handle.style.height = box.height + "px";
	}

	private hideHandle(): void {
		if (this.handle && !this.drag) {
			this.handle.remove();
			this.handle = null;
			this.hover = null;
		}
	}

	private onDown(evt: MouseEvent): void {
		if (!this.hover || evt.button !== 0 || !this.handle) return;
		evt.preventDefault();
		evt.stopPropagation();
		// Obsidian may have drawn the table again since the handle appeared.
		const { table, col } = this.hover;
		const row = table.isConnected ? firstVisibleRow(table) : undefined;
		const th = row?.cells[col];
		if (!th || col >= MAX_WIDTH_COLUMNS) return this.hideHandle();
		this.drag = { table, col, th, startX: evt.clientX, startW: th.getBoundingClientRect().width, width: null };
		this.handle.addClass("is-dragging");
		this.doc = table.ownerDocument;
		this.doc.body.addClass("sk-tables-resizing");
	}

	private dragTo(x: number): void {
		const d = this.drag as Drag;
		d.width = Math.max(MIN_WIDTH, Math.round(d.startW + x - d.startX));
		d.table.setCssProps({ ["--sk-tables-w" + (d.col + 1)]: d.width + "px" });
		d.table.setAttribute("data-sk-widths", "");
		if (this.handle) this.handle.style.left = d.th.getBoundingClientRect().right - 4 + "px";
	}

	onUp(): void {
		const d = this.drag;
		if (!d) return;
		this.drag = null;
		this.doc?.body.removeClass("sk-tables-resizing");
		// Saving draws the table again: the next drag must find it again.
		this.hideHandle();
		if (d.width !== null) this.save(d.table, d.col, d.width);
	}

	private onReset(evt: MouseEvent): void {
		if (!this.hover) return;
		evt.preventDefault();
		this.save(this.hover.table, this.hover.col, 0);
	}

	private save(table: HTMLTableElement, col: number, width: number): void {
		this.controller.commitWidths(table, setColumnWidth(widthsOf(table), col, width));
	}

	destroy(): void {
		this.drag = null;
		this.doc?.body.removeClass("sk-tables-resizing");
		this.handle?.remove();
		this.handle = null;
		this.hover = null;
	}
}

export class ColumnButton {
	private el: HTMLButtonElement | null = null;
	private target: { table: HTMLTableElement; col: number; th: HTMLTableCellElement } | null = null;
	private menu: Menu | null = null;

	constructor(private readonly controller: TablesController) {}

	show(table: HTMLTableElement, col: number): void {
		const th = table.rows[0]?.cells[col];
		if (!th) return this.hide();
		if (this.el && this.el.ownerDocument !== table.ownerDocument) this.hide();
		if (!this.el) {
			const label = this.controller.t("column-button");
			this.el = table.ownerDocument.body.createEl("button", { cls: "sk-tables-ui sk-tables-col-btn", attr: { type: "button", "aria-label": label } });
			setIcon(this.el, "chevron-down");
			this.el.addEventListener("mousedown", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
			});
			this.el.addEventListener("click", (evt) => this.open(evt));
		}
		this.target = { table, col, th };
		// Top-right corner, half over the cell border: never on the header text.
		const r = th.getBoundingClientRect();
		this.el.style.top = r.top - 10 + "px";
		this.el.style.left = r.right - 24 + "px";
	}

	hide(): void {
		if (this.menu || !this.el) return;
		this.el.remove();
		this.el = null;
		this.target = null;
	}

	private open(evt: MouseEvent): void {
		evt.preventDefault();
		const t = this.target;
		if (!t || !t.table.isConnected || !this.el) return this.hide();
		const ctx = this.controller.contextForTable(t.table, t.col);
		if (!ctx) return;
		const menu = new Menu();
		this.controller.fillColumnMenu(menu, ctx);
		const r = this.el.getBoundingClientRect();
		this.menu = menu;
		menu.onHide(() => {
			this.menu = null;
			this.hide();
		});
		menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
	}

	destroy(): void {
		const menu = this.menu;
		this.menu = null;
		menu?.hide();
		this.hide();
	}
}
