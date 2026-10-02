// Insert table: hover the grid to pick columns × rows, or type a bigger size.
import { Modal, Platform } from "obsidian";
import type { TablesController } from "./controller";

const GRID_COLS = 8;
const GRID_ROWS = 6;

export class InsertTableModal extends Modal {
	private cols = 4;
	private rows = 3;
	private sizeEl!: HTMLElement;
	private cells: Array<{ el: HTMLButtonElement; c: number; r: number }> = [];
	private colInput!: HTMLInputElement;
	private rowInput!: HTMLInputElement;

	constructor(
		private readonly controller: TablesController,
		private readonly onInsert: (cols: number, rows: number) => void,
		private readonly onClosed: () => void,
	) {
		super(controller.app);
	}

	onOpen(): void {
		const t = (key: string) => this.controller.t(key);
		this.modalEl.addClass("sk-tables-insert-modal");
		this.titleEl.setText(t("insert.title"));
		const root = this.contentEl.createDiv("sk-tables-ui sk-tables-insert");
		this.sizeEl = root.createDiv({ cls: "sk-tables-insert-size", attr: { "aria-live": "polite" } });

		const grid = root.createDiv({ cls: "sk-tables-grid", attr: { role: "grid", "aria-label": t("insert.grid") } });
		this.cells = [];
		for (let r = 1; r <= GRID_ROWS; r++) {
			for (let c = 1; c <= GRID_COLS; c++) {
				const cell = grid.createEl("button", {
					cls: "sk-tables-grid-cell",
					attr: { type: "button", "aria-label": `${c} × ${r}`, tabindex: r === 1 && c === 1 ? "0" : "-1" },
				});
				cell.addEventListener("mouseenter", () => this.setSize(c, r));
				cell.addEventListener("focus", () => this.setSize(c, r));
				cell.addEventListener("click", () => this.submit());
				this.cells.push({ el: cell, c, r });
			}
		}
		grid.addEventListener("keydown", (evt) => this.onGridKey(evt));

		const dims = root.createDiv("sk-tables-dims");
		this.colInput = this.numberField(dims, t("insert.columns"), 1, 30, (v) => this.setSize(v, this.rows));
		this.rowInput = this.numberField(dims, t("insert.rows"), 1, 200, (v) => this.setSize(this.cols, v));

		const actions = root.createDiv("sk-tables-modal-actions");
		const insert = actions.createEl("button", { cls: "mod-cta", text: t("insert.button"), attr: { type: "button" } });
		insert.addEventListener("click", () => this.submit());
		this.scope.register([], "Enter", () => {
			this.submit();
			return false;
		});
		this.refresh();
		(Platform.isMobile ? this.colInput : this.cells[0].el).focus();
	}

	private numberField(parent: HTMLElement, label: string, min: number, max: number, onChange: (value: number) => void): HTMLInputElement {
		const field = parent.createEl("label", { cls: "sk-tables-field" });
		field.createSpan({ text: label });
		const input = field.createEl("input", { attr: { type: "number", min, max, inputmode: "numeric" } });
		input.addEventListener("input", () => {
			const v = parseInt(input.value, 10);
			if (v >= min && v <= max) onChange(v);
		});
		return input;
	}

	private setSize(cols: number, rows: number): void {
		this.cols = cols;
		this.rows = rows;
		this.refresh();
	}

	private refresh(): void {
		this.sizeEl.setText(`${this.controller.ctx.tn("insert.cols-count", this.cols)} × ${this.controller.ctx.tn("insert.rows-count", this.rows)}`);
		for (const { el, c, r } of this.cells) el.setAttribute("data-preview", String(c <= this.cols && r <= this.rows));
		const active = this.contentEl.doc.activeElement;
		if (active !== this.colInput) this.colInput.value = String(this.cols);
		if (active !== this.rowInput) this.rowInput.value = String(this.rows);
	}

	private onGridKey(evt: KeyboardEvent): void {
		const moves: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
		const move = moves[evt.key];
		if (!move) return;
		evt.preventDefault();
		const c = Math.max(1, Math.min(GRID_COLS, this.cols + move[0]));
		const r = Math.max(1, Math.min(GRID_ROWS, this.rows + move[1]));
		const cell = this.cells.find((x) => x.c === c && x.r === r);
		if (!cell) return;
		for (const x of this.cells) x.el.setAttribute("tabindex", x === cell ? "0" : "-1");
		cell.el.focus();
	}

	private submit(): void {
		const { cols, rows } = this;
		this.close();
		this.onInsert(cols, rows);
	}

	onClose(): void {
		this.contentEl.empty();
		this.onClosed();
	}
}
