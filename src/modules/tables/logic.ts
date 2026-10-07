// Pure table logic: lines in, lines or models out. No Obsidian runtime calls here, so all of it
// is tested in test/tables.test.ts.
//
// A "block" is { start, end, prefix, metaLine } with 0-based line indexes: start is the header
// row, end the last row, metaLine the style comment (always end + 1) or null. The comment sits
// below the table because Live Preview only draws a table whose previous line is empty or a
// heading. A "model" is { rows, aligns }: rows[0] is the header (the delimiter row is not a row
// of the model), aligns[c] is "left" | "center" | "right" | null.

export type Align = "left" | "center" | "right" | null;
export interface Block {
	start: number;
	end: number;
	prefix: string;
	metaLine: number | null;
}
export interface Model {
	rows: string[][];
	aligns: Align[];
}
/** The table after an action, and the cell to put the cursor in. */
export interface Plan {
	model: Model;
	row: number;
	col: number;
}
export type DateOrder = "dmy" | "mdy";
export type ColumnKind = "number" | "date" | "text";

export const ROW_ACTIONS = ["rowAbove", "rowBelow", "rowDuplicate", "rowUp", "rowDown", "rowDelete"] as const;
export const COLUMN_ACTIONS = ["colLeft", "colRight", "colDuplicate", "colMoveLeft", "colMoveRight", "colDelete"] as const;
export const ALIGN_ACTIONS = ["alignLeft", "alignCenter", "alignRight"] as const;
export type Action =
	| (typeof ROW_ACTIONS)[number]
	| (typeof COLUMN_ACTIONS)[number]
	| (typeof ALIGN_ACTIONS)[number]
	| "sortAsc"
	| "sortDesc"
	| "format"
	| "next"
	| "prev"
	| "down";

const PREFIX_RE = /^[ \t]*(?:>[ \t]?)*/;
const META_RE = /^<!--\s*table:([^>]*?)\s*-->\s*$/;
const DELIM_CELL_RE = /^\s*(:?)-+(:?)\s*$/;
const FENCE_RE = /^[ \t]*(?:>[ \t]?)*(`{3,}|~{3,})(.*)$/;
const HEX_RE = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
const ISO_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?$/;
const NUM_DATE_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/;
const NUMBER_RE = /^\d[\d.,]*$/;
const CURRENCY_RE = /^(?:[€$£¥₹]|EUR|USD|GBP|CHF)|(?:[€$£¥₹%]|EUR|USD|GBP|CHF)$/i;
const WIDE_RE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

// ---------------------------------------------------------------------------
// Finding tables
// ---------------------------------------------------------------------------

export function prefixOf(line: string): string {
	return (PREFIX_RE.exec(line) as RegExpExecArray)[0];
}

function samePrefix(a: string, b: string): boolean {
	return a.replace(/\s+$/, "") === b.replace(/\s+$/, "");
}

/**
 * Positions of the separator pipes of a row, after its prefix. A backslash escapes the next
 * character, so "\|" is text and "\\|" is a separator. Every function that splits cells goes
 * through this one.
 */
export function pipePositions(line: string): number[] {
	const out: number[] = [];
	for (let i = prefixOf(line).length; i < line.length; i++) {
		if (line[i] === "\\") i++;
		else if (line[i] === "|") out.push(i);
	}
	return out;
}

export function isTableLine(line: string): boolean {
	return pipePositions(line).length > 0;
}

/** Cells of one row, trimmed, without the outer pipes. Escaped pipes stay escaped. */
export function splitCells(text: string): string[] {
	const s = text.trim();
	const pipes = pipePositions(s);
	const bounds = [pipes[0] === 0 ? 0 : -1].concat(pipes.filter((p) => p > 0));
	if (bounds[bounds.length - 1] !== s.length - 1 || bounds.length === 1) bounds.push(s.length);
	const cells: string[] = [];
	for (let i = 0; i + 1 < bounds.length; i++) cells.push(s.slice(bounds[i] + 1, bounds[i + 1]).trim());
	return cells;
}

export function isDelimiterRow(line: string): boolean {
	const body = line.slice(prefixOf(line).length);
	if (!body.includes("-")) return false;
	return splitCells(body).every((cell) => DELIM_CELL_RE.test(cell));
}

/**
 * Fence state after `line`: the open fence marker, or null outside code. A closing fence is the
 * same character, at least as long, and nothing else on the line (CommonMark).
 */
function fenceStep(open: string | null, line: string): string | null {
	const m = FENCE_RE.exec(line);
	if (!m) return open;
	if (!open) return m[1][0] === "`" && m[2].includes("`") ? null : m[1];
	return m[1][0] === open[0] && m[1].length >= open.length && !m[2].trim() ? null : open;
}

/** True when line `index` sits inside a fenced code block. */
export function insideFence(lines: string[], index: number): boolean {
	let open: string | null = null;
	for (let i = 0; i < index; i++) open = fenceStep(open, lines[i]);
	return open !== null;
}

/** Style read from a comment line, or null when the line is not a style comment. */
export function metaFromLine(line: string | undefined): Meta | null {
	if (line === undefined) return null;
	const m = META_RE.exec(line.slice(prefixOf(line).length).trim());
	return m ? parseMetaTokens(m[1]) : null;
}

/** Style read from `line`, just below a table whose rows look like `row`, in the same container. */
export function metaBelow(line: string | undefined, row: string): Meta | null {
	if (line === undefined || !samePrefix(prefixOf(line), prefixOf(row))) return null;
	return metaFromLine(line);
}

/** Identity of a table for staleness checks: its header cells. */
export function headerKey(lines: string[], block: Pick<Block, "start">): string {
	const line = lines[block.start];
	return splitCells(line.slice(prefixOf(line).length)).join("|");
}

/** The table around line `index`, or null. */
export function findTableAt(lines: string[], index: number, checkFence = true): Block | null {
	if (index < 0 || index >= lines.length || !isTableLine(lines[index])) return null;
	const prefix = prefixOf(lines[index]);
	const inBlock = (i: number) => i >= 0 && i < lines.length && isTableLine(lines[i]) && samePrefix(prefixOf(lines[i]), prefix);
	let first = index;
	let last = index;
	while (inBlock(first - 1)) first--;
	while (inBlock(last + 1)) last++;
	let start = -1;
	for (let i = first + 1; i <= last; i++) {
		if (isDelimiterRow(lines[i])) {
			start = i - 1;
			break;
		}
	}
	if (start < 0 || index < start) return null;
	if (checkFence && insideFence(lines, start)) return null;
	const metaLine = metaBelow(lines[last + 1], lines[start]) ? last + 1 : null;
	return { start, end: last, prefix, metaLine };
}

/** Every table between lines `from` and `to` (inclusive), skipping code. */
export function findAllTables(lines: string[], from = 0, to = lines.length - 1): Block[] {
	const blocks: Block[] = [];
	let open: string | null = null;
	for (let i = 0; i < from; i++) open = fenceStep(open, lines[i]);
	for (let i = from; i <= to && i < lines.length; i++) {
		const before = open;
		open = fenceStep(open, lines[i]);
		if (before || open || i === 0 || !isDelimiterRow(lines[i]) || !isTableLine(lines[i - 1])) continue;
		const block = findTableAt(lines, i - 1, false);
		if (block && block.start === i - 1) {
			blocks.push(block);
			i = block.end;
		}
	}
	return blocks;
}

// ---------------------------------------------------------------------------
// Model and Markdown
// ---------------------------------------------------------------------------

function alignOf(cell: string | undefined): Align {
	const m = DELIM_CELL_RE.exec(cell || "");
	if (!m) return null;
	if (m[1] && m[2]) return "center";
	if (m[2]) return "right";
	if (m[1]) return "left";
	return null;
}

/** Ragged rows are padded with empty cells: no cell is ever dropped. */
export function parseTable(lines: string[], block: Pick<Block, "start" | "end">): Model {
	const body: string[] = [];
	for (let i = block.start; i <= block.end; i++) body.push(lines[i].slice(prefixOf(lines[i]).length));
	const delim = splitCells(body[1]);
	const rows = [splitCells(body[0])].concat(body.slice(2).map(splitCells));
	const width = Math.max(delim.length, ...rows.map((r) => r.length));
	for (const r of rows) while (r.length < width) r.push("");
	const aligns: Align[] = [];
	for (let c = 0; c < width; c++) aligns.push(alignOf(delim[c]));
	return { rows, aligns };
}

/** Columns a text takes in a monospace font: CJK and emoji count as two. */
export function displayWidth(text: string): number {
	let w = 0;
	for (const ch of text) w += WIDE_RE.test(ch) ? 2 : 1;
	return w;
}

function padCell(text: string, width: number, align: Align): string {
	const gap = width - displayWidth(text);
	if (gap <= 0) return text;
	if (align === "right") return " ".repeat(gap) + text;
	if (align === "center") {
		const left = Math.floor(gap / 2);
		return " ".repeat(left) + text + " ".repeat(gap - left);
	}
	return text + " ".repeat(gap);
}

function delimiterCell(width: number, align: Align): string {
	if (align === "center") return ":" + "-".repeat(width - 2) + ":";
	if (align === "left") return ":" + "-".repeat(width - 1);
	if (align === "right") return "-".repeat(width - 1) + ":";
	return "-".repeat(width);
}

/** Model to aligned Markdown lines, each starting with `prefix` (indentation, `>`). */
export function formatTable(model: Model, prefix = ""): string[] {
	const widths = model.aligns.map((_, c) => Math.max(3, ...model.rows.map((r) => displayWidth(r[c] || ""))));
	const row = (cells: string[]) => prefix + "| " + widths.map((w, c) => padCell(cells[c] || "", w, model.aligns[c])).join(" | ") + " |";
	const delim = prefix + "| " + widths.map((w, c) => delimiterCell(w, model.aligns[c])).join(" | ") + " |";
	return [row(model.rows[0]), delim].concat(model.rows.slice(1).map(row));
}

/** { from, to } of the trimmed text of cell `col` in a row line. */
export function cellSpan(line: string, col: number): { from: number; to: number } {
	const pipes = pipePositions(line);
	const body = prefixOf(line).length;
	const leading = line.slice(body).trimStart().startsWith("|");
	const bounds = leading ? pipes : [body - 1].concat(pipes);
	const start = bounds[col] + 1;
	const end = col + 1 < bounds.length ? bounds[col + 1] : line.length;
	let from = start;
	let to = end;
	while (from < to && line[from] === " ") from++;
	while (to > from && line[to - 1] === " ") to--;
	// Empty cell: just after "| ".
	if (from >= to) from = to = Math.min(start + 1, end);
	return { from, to };
}

/** Cell index under character `ch` of a row line. */
export function cellIndexAt(line: string, ch: number): number {
	const body = prefixOf(line).length;
	const leading = line.slice(body).trimStart().startsWith("|");
	const before = pipePositions(line).filter((p) => p < ch).length;
	return Math.max(0, leading ? before - 1 : before);
}

/** Model row of a line of the block (the delimiter row counts as the header). */
export function rowOfLine(block: Pick<Block, "start">, index: number): number {
	const offset = index - block.start;
	return offset <= 1 ? 0 : offset - 1;
}

/** Line of a model row, counted from the header line. */
export function lineOfRow(row: number): number {
	return row === 0 ? 0 : row + 1;
}

function cloneModel(model: Model): Model {
	return { rows: model.rows.map((r) => r.slice()), aligns: model.aligns.slice() };
}

function moveItem<T>(list: T[], from: number, to: number): void {
	const [item] = list.splice(from, 1);
	list.splice(to, 0, item);
}

export function insertRow(model: Model, at: number): Model {
	const m = cloneModel(model);
	m.rows.splice(at, 0, m.aligns.map(() => ""));
	return m;
}

export function duplicateRow(model: Model, row: number): Model {
	const m = cloneModel(model);
	m.rows.splice(row + 1, 0, m.rows[row].slice());
	return m;
}

export function deleteRow(model: Model, row: number): Model {
	const m = cloneModel(model);
	m.rows.splice(row, 1);
	return m;
}

export function moveRow(model: Model, row: number, to: number): Model {
	const m = cloneModel(model);
	moveItem(m.rows, row, to);
	return m;
}

export function insertColumn(model: Model, at: number, align: Align = null): Model {
	const m = cloneModel(model);
	m.aligns.splice(at, 0, align);
	for (const r of m.rows) r.splice(at, 0, "");
	return m;
}

export function duplicateColumn(model: Model, col: number): Model {
	const m = cloneModel(model);
	m.aligns.splice(col + 1, 0, m.aligns[col]);
	for (const r of m.rows) r.splice(col + 1, 0, r[col]);
	return m;
}

export function deleteColumn(model: Model, col: number): Model {
	const m = cloneModel(model);
	m.aligns.splice(col, 1);
	for (const r of m.rows) r.splice(col, 1);
	return m;
}

export function moveColumn(model: Model, col: number, to: number): Model {
	const m = cloneModel(model);
	moveItem(m.aligns, col, to);
	for (const r of m.rows) moveItem(r, col, to);
	return m;
}

export function setAlignment(model: Model, col: number, align: Align): Model {
	const m = cloneModel(model);
	m.aligns[col] = align;
	return m;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/** Cell text without Markdown decoration, for sorting and CSV. */
export function plainText(md: string | undefined): string {
	return String(md || "")
		.replace(/\\\|/g, "|")
		.replace(/!?\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_, target: string, alias: string) => alias || target)
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, "")
		.replace(/(\*\*|__|~~|==|`)/g, "")
		.replace(/(^|\s)[*_](\S)/g, "$1$2")
		.replace(/(\S)[*_](\s|$)/g, "$1$2")
		.trim();
}

/** "1 234,50 €", "$1,234.50", "12%", "-$20" to a number, or null. */
export function parseNumber(text: string): number | null {
	let t = text.replace(/[\s\u00a0\u202f']/g, "").replace(/−/g, "-");
	// The sign may sit before or after a leading currency: -$20, $-20.
	let sign = 1;
	const takeSign = () => {
		if (t[0] === "-" || t[0] === "+") {
			if (t[0] === "-") sign = -sign;
			t = t.slice(1);
		}
	};
	takeSign();
	const raw = t;
	t = t.replace(CURRENCY_RE, "").replace(CURRENCY_RE, "");
	if (t !== raw && sign === 1) takeSign();
	if (!NUMBER_RE.test(t)) return null;
	const comma = t.lastIndexOf(",");
	const dot = t.lastIndexOf(".");
	let decimal: string | null = null;
	if (comma >= 0 && dot >= 0) decimal = comma > dot ? "," : ".";
	else if (comma >= 0) decimal = /^\d{1,3}(,\d{3})+$/.test(t) ? null : ",";
	else if (dot >= 0) decimal = /^\d{1,3}(\.\d{3}){2,}$/.test(t) ? null : ".";
	const thousands = decimal === "," ? "." : decimal === "." ? "," : comma >= 0 ? "," : ".";
	t = t.split(thousands).join("");
	if (decimal) t = t.replace(decimal, ".");
	const n = Number(t);
	return Number.isFinite(n) ? sign * n : null;
}

/** "2026-10-15", "15/10/2026" (dmy) or "10/15/2026" (mdy) to a timestamp, or null. */
export function parseDate(text: string, order: DateOrder = "dmy"): number | null {
	let y: number;
	let mo: number;
	let d: number;
	let h = 0;
	let mi = 0;
	let m = ISO_DATE_RE.exec(text);
	if (m) {
		[y, mo, d] = [+m[1], +m[2], +m[3]];
		if (m[4]) [h, mi] = [+m[4], +m[5]];
	} else if ((m = NUM_DATE_RE.exec(text))) {
		[d, mo] = order === "mdy" ? [+m[2], +m[1]] : [+m[1], +m[2]];
		y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
	} else {
		return null;
	}
	if (h > 23 || mi > 59) return null;
	const time = Date.UTC(y, mo - 1, d, h, mi);
	const back = new Date(time);
	// Rejects 31/02 and the like instead of rolling over to March.
	return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? time : null;
}

/** Kind of a column, decided from its non-empty cells. */
export function columnKind(values: string[], order: DateOrder = "dmy"): ColumnKind {
	const vals = values.map(plainText).filter(Boolean);
	if (!vals.length) return "text";
	if (vals.every((v) => parseNumber(v) !== null)) return "number";
	if (vals.every((v) => parseDate(v, order) !== null)) return "date";
	return "text";
}

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export interface SortOptions {
	/** Keeps the last row (a total row) in place. */
	keepLast?: boolean;
	dateOrder?: DateOrder;
}

/** Body rows sorted by column `col`: header fixed, empty cells last in both directions, stable. */
export function sortRows(model: Model, col: number, dir: "asc" | "desc", opts: SortOptions = {}): Model {
	const body = model.rows.slice(1);
	const fixed = opts.keepLast && body.length > 1 ? [body.pop() as string[]] : [];
	const kind = columnKind(body.map((r) => r[col]), opts.dateOrder);
	const key = (text: string): number | string =>
		kind === "number" ? (parseNumber(text) as number) : kind === "date" ? (parseDate(text, opts.dateOrder) as number) : text;
	const sign = dir === "desc" ? -1 : 1;
	const items = body.map((r, i) => ({ r, i, text: plainText(r[col]) }));
	items.sort((a, b) => {
		if (!a.text || !b.text) return a.text === b.text ? a.i - b.i : a.text ? -1 : 1;
		const ka = key(a.text);
		const kb = key(b.text);
		const cmp = kind === "text" ? COLLATOR.compare(ka as string, kb as string) : (ka as number) - (kb as number);
		return cmp ? cmp * sign : a.i - b.i;
	});
	return { rows: [model.rows[0].slice()].concat(items.map((x) => x.r.slice()), fixed), aligns: model.aligns.slice() };
}

/**
 * One table action on a model. Returns the new model and the cell to focus afterwards, or null
 * when the action does not apply (the header row and the last column are protected).
 */
export function planAction(action: Action, model: Model, row: number, col: number, opts: SortOptions = {}): Plan | null {
	const rows = model.rows.length;
	const cols = model.aligns.length;
	const same = () => cloneModel(model);
	switch (action) {
		case "rowAbove":
			return row < 1 ? null : { model: insertRow(model, row), row, col };
		case "rowBelow":
			return { model: insertRow(model, row + 1), row: row + 1, col };
		case "rowDuplicate":
			return row < 1 ? null : { model: duplicateRow(model, row), row: row + 1, col };
		case "rowUp":
			return row < 2 ? null : { model: moveRow(model, row, row - 1), row: row - 1, col };
		case "rowDown":
			return row < 1 || row >= rows - 1 ? null : { model: moveRow(model, row, row + 1), row: row + 1, col };
		case "rowDelete":
			return row < 1 ? null : { model: deleteRow(model, row), row: Math.min(row, rows - 2), col };
		case "colLeft":
			return { model: insertColumn(model, col, model.aligns[col]), row, col };
		case "colRight":
			return { model: insertColumn(model, col + 1, model.aligns[col]), row, col: col + 1 };
		case "colDuplicate":
			return { model: duplicateColumn(model, col), row, col: col + 1 };
		case "colMoveLeft":
			return col < 1 ? null : { model: moveColumn(model, col, col - 1), row, col: col - 1 };
		case "colMoveRight":
			return col >= cols - 1 ? null : { model: moveColumn(model, col, col + 1), row, col: col + 1 };
		case "colDelete":
			return cols < 2 ? null : { model: deleteColumn(model, col), row, col: Math.min(col, cols - 2) };
		case "alignLeft":
			return { model: setAlignment(model, col, "left"), row, col };
		case "alignCenter":
			return { model: setAlignment(model, col, "center"), row, col };
		case "alignRight":
			return { model: setAlignment(model, col, "right"), row, col };
		case "sortAsc":
		case "sortDesc":
			return rows < 3 ? null : { model: sortRows(model, col, action === "sortAsc" ? "asc" : "desc", opts), row, col };
		case "format":
			return { model: same(), row, col };
		case "next":
			if (col + 1 < cols) return { model: same(), row, col: col + 1 };
			if (row + 1 < rows) return { model: same(), row: row + 1, col: 0 };
			return { model: insertRow(model, rows), row: rows, col: 0 };
		case "prev":
			if (col > 0) return { model: same(), row, col: col - 1 };
			return { model: same(), row: Math.max(0, row - 1), col: row > 0 ? cols - 1 : 0 };
		case "down":
			if (row + 1 < rows) return { model: same(), row: row + 1, col };
			return { model: insertRow(model, rows), row: rows, col };
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// The style comment: <!-- table: style=plain banding=rows widths=120,0 -->
// ---------------------------------------------------------------------------

/** The styles offered. */
export const STYLES = ["plain", "ledger", "grid", "report"] as const;
export type StyleId = (typeof STYLES)[number];
/**
 * Styles of earlier versions, still read and drawn as the closest style offered. The comment
 * keeps its original word until the user picks another style.
 */
export const LEGACY_STYLES: Record<string, StyleId> = { tide: "report", index: "plain", marker: "plain" };
export const ACCENTS = ["theme", "blue", "cyan", "green", "yellow", "orange", "red", "purple", "pink", "gray"] as const;
export const BANDINGS = ["off", "rows", "columns"] as const;
export const HEADER_MODES = ["on", "off", "hide"] as const;
export const TEXT_SIZES = ["theme", "small", "note", "large"] as const;
export type Banding = (typeof BANDINGS)[number];
export type HeaderMode = (typeof HEADER_MODES)[number];
export type TextSize = (typeof TEXT_SIZES)[number];
/** Widths are written for at most this many columns. */
export const MAX_WIDTH_COLUMNS = 30;

export interface Meta {
	/** As written: one of STYLES, a legacy style, or "none" (the theme's look, used to keep widths only). */
	style: string;
	/** "theme", a named accent or a hex color. */
	accent: string;
	banding: Banding;
	header: HeaderMode;
	firstCol: boolean;
	total: boolean;
	size: TextSize;
	/** Column widths in px, 0 = automatic. */
	widths: number[];
	/** Unknown tokens, kept as they are. */
	extra: string[];
}

const includes = <T extends string>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value);

export function defaultMeta(): Meta {
	return { style: "plain", accent: "theme", banding: "off", header: "on", firstCol: false, total: false, size: "theme", widths: [], extra: [] };
}

/** The style a table is drawn with: legacy styles map to the closest one offered. */
export function shownStyle(style: string): StyleId | "none" {
	if (style === "none") return "none";
	if (includes(STYLES, style)) return style;
	return LEGACY_STYLES[style] ?? "plain";
}

export function parseMetaTokens(text: string): Meta {
	const meta = defaultMeta();
	for (const token of String(text).trim().split(/\s+/)) {
		if (!token) continue;
		const eq = token.indexOf("=");
		const key = eq < 0 ? token : token.slice(0, eq);
		const value = eq < 0 ? undefined : token.slice(eq + 1);
		const on = value === undefined || value === "on" || value === "true";
		if (key === "style" && (value === "none" || includes(STYLES, value) || (value !== undefined && value in LEGACY_STYLES))) meta.style = value;
		else if (key === "widths" && value !== undefined && parseWidths(value)) meta.widths = parseWidths(value) as number[];
		else if (key === "accent" && (includes(ACCENTS, value) || HEX_RE.test(value || ""))) meta.accent = value as string;
		else if (key === "banding" && includes(BANDINGS, value)) meta.banding = value;
		else if (key === "size" && includes(TEXT_SIZES, value)) meta.size = value;
		else if (key === "header") meta.header = value === "hide" ? "hide" : on ? "on" : "off";
		else if (key === "first-col") meta.firstCol = on;
		else if (key === "total") meta.total = on;
		else meta.extra.push(token);
	}
	return meta;
}

/** "120,0,80" to [120, 0, 80], or null when it is not a list of whole pixel widths. */
export function parseWidths(value: string): number[] | null {
	return /^\d{1,4}(,\d{1,4})*$/.test(value) ? value.split(",").map(Number) : null;
}

/** "widths=120,0,80" or "" when every column is automatic. Trailing automatic columns are dropped. */
export function widthsToken(widths: number[]): string {
	const list = widths.slice(0, MAX_WIDTH_COLUMNS).map((w) => Math.max(0, Math.min(9999, Math.round(w) || 0)));
	while (list.length && !list[list.length - 1]) list.pop();
	return list.length ? "widths=" + list.join(",") : "";
}

/** Widths with column `col` set to `width` (0 = automatic). */
export function setColumnWidth(widths: number[], col: number, width: number): number[] {
	const out = widths.slice();
	while (out.length <= col) out.push(0);
	out[col] = Math.max(0, Math.round(width));
	return out;
}

/** Tokens in a fixed order, defaults omitted (except style and banding), unknown tokens last. */
export function serializeMeta(meta: Meta): string {
	const tokens = ["style=" + meta.style];
	if (meta.accent && meta.accent !== "theme") tokens.push("accent=" + meta.accent);
	tokens.push("banding=" + meta.banding);
	if (meta.header !== "on") tokens.push("header=" + meta.header);
	if (meta.firstCol) tokens.push("first-col");
	if (meta.total) tokens.push("total");
	if (meta.size && meta.size !== "theme") tokens.push("size=" + meta.size);
	const widths = widthsToken(meta.widths || []);
	if (widths) tokens.push(widths);
	return "<!-- table: " + tokens.concat(meta.extra || []).join(" ") + " -->";
}

/** CSS color of an accent, or null for the theme's accent. Never raw text from the note. */
export function accentCss(accent: string): string | null {
	if (accent === "theme") return null;
	if (accent === "gray") return "var(--color-base-50)";
	if (includes(ACCENTS, accent)) return `var(--color-${accent})`;
	return HEX_RE.test(accent || "") ? accent : null;
}

/**
 * Writes `meta` (or removes it when null) below the table of `block`. Returns the new lines and
 * the new block (the table itself never moves).
 */
export function withMeta(lines: string[], block: Block, meta: Meta | null): { lines: string[]; block: Block } {
	const out = lines.slice();
	let metaLine = block.metaLine;
	const text = meta ? block.prefix + serializeMeta(meta) : null;
	if (metaLine !== null && text) out[metaLine] = text;
	else if (metaLine !== null) {
		out.splice(metaLine, 1);
		metaLine = null;
	} else if (text) {
		out.splice(block.end + 1, 0, text);
		metaLine = block.end + 1;
	}
	return { lines: out, block: { start: block.start, end: block.end, prefix: block.prefix, metaLine } };
}

/** The parts of a look that are not style, banding or size (kept by "Use as default for new tables"). */
export function lookExtras(meta: Meta): string {
	const tokens: string[] = [];
	if (meta.accent && meta.accent !== "theme") tokens.push("accent=" + meta.accent);
	if (meta.header !== "on") tokens.push("header=" + meta.header);
	if (meta.firstCol) tokens.push("first-col");
	if (meta.total) tokens.push("total");
	return tokens.join(" ");
}

/** Look of new tables built from the settings. Invalid values fall back to the defaults. */
export function lookMeta(style: string, banding: string, size: string, extras: string): Meta {
	const meta = parseMetaTokens(`style=${style} banding=${banding} size=${size} ${extras}`);
	if (meta.style === "none") meta.style = "plain";
	meta.style = shownStyle(meta.style);
	meta.widths = [];
	meta.extra = [];
	return meta;
}

/**
 * Lines of a new table: header, delimiter, body, style comment. `rows` counts the header row.
 * `headerName(n)` names column n (1-based).
 */
export function createTable(cols: number, rows: number, look: Meta, headerName: (n: number) => string): string[] {
	cols = Math.max(1, Math.min(30, cols | 0));
	rows = Math.max(1, Math.min(200, rows | 0));
	const header: string[] = [];
	for (let c = 0; c < cols; c++) header.push(headerName(c + 1));
	const model: Model = { rows: [header], aligns: header.map(() => null) };
	for (let r = 1; r < rows; r++) model.rows.push(header.map(() => ""));
	const meta = { ...defaultMeta(), ...look, widths: [], extra: [] };
	return formatTable(model).concat(serializeMeta(meta));
}

/** CSV for the clipboard (RFC 4180 quoting, plain cell text). */
export function toCsv(model: Model): string {
	const quote = (v: string) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
	return model.rows.map((r) => r.map((c) => quote(plainText(c))).join(",")).join("\n");
}
