import type { Text } from "@codemirror/state";

export interface Box {
	anchorLine: number;
	anchorCol: number;
	headLine: number;
	headCol: number;
}
export type Direction = "up" | "down" | "left" | "right";
export interface SelectionRow { line: number; anchorCol: number; headCol: number }
export interface InsertRow {
	from: number;
	to: number;
	lineTo: number;
	endCol: number;
	prevIsTab?: boolean;
	startCol?: number;
	prevCol?: number;
}
export interface Edit { from: number; to: number; insert?: string }
const LINE_BREAK_RE = /\r?\n/;

// Columns count Unicode code points and tab stops, including virtual space.
export function isLowSurrogate(text: string, i: number) {
	const c = text.charCodeAt(i);
	const p = text.charCodeAt(i - 1);
	return i > 0 && c >= 0xdc00 && c <= 0xdfff && p >= 0xd800 && p <= 0xdbff;
}

// Width, in columns, of the character at index i.
export function charWidth(text: string, i: number, col: number, tabSize: number) {
	if (text.charCodeAt(i) === 9) return tabSize - (col % tabSize);
	return isLowSurrogate(text, i) ? 0 : 1;
}

// Length of the character that ends at index i (2 for a surrogate pair).
export function charBefore(text: string, i: number) {
	return isLowSurrogate(text, i - 1) ? 2 : 1;
}

export function charAfter(text: string, i: number) {
	return isLowSurrogate(text, i + 1) ? 2 : 1;
}

// Visual column reached at string index `index`.
export function columnOf(text: string, index: number, tabSize: number) {
	let col = 0;
	for (let i = 0; i < index && i < text.length; i++) col += charWidth(text, i, col, tabSize);
	return col;
}

export function lineWidth(text: string, tabSize: number) {
	return columnOf(text, text.length, tabSize);
}

// First string index whose column is >= col, or the line length when the
// column lies past the end of the line. Never inside a surrogate pair.
export function indexOfColumn(text: string, col: number, tabSize: number) {
	let c = 0;
	for (let i = 0; i < text.length; i++) {
		if (c >= col && !isLowSurrogate(text, i)) return i;
		c += charWidth(text, i, c, tabSize);
	}
	return text.length;
}

export function boxBounds(box: Box) {
	return {
		top: Math.min(box.anchorLine, box.headLine),
		bottom: Math.max(box.anchorLine, box.headLine),
		left: Math.min(box.anchorCol, box.headCol),
		right: Math.max(box.anchorCol, box.headCol),
	};
}

// One row per line of the box: offsets of the selected part (clipped to the
// line) and the line's own width, to spot rows that end before the box.
export function boxRows(doc: Text, box: Box, tabSize: number) {
	const { top, bottom, left, right } = boxBounds(box);
	const rows = [];
	for (let n = top; n <= bottom; n++) {
		const line = doc.line(n);
		const from = line.from + indexOfColumn(line.text, left, tabSize);
		const to = line.from + indexOfColumn(line.text, right, tabSize);
		const forward = box.anchorCol <= box.headCol;
		const index = from - line.from;
		const before = index > 0 ? charBefore(line.text, index) : 0;
		rows.push({
			line: n,
			lineFrom: line.from,
			lineTo: line.to,
			from,
			to,
			anchor: forward ? from : to,
			head: forward ? to : from,
			endCol: lineWidth(line.text, tabSize),
			// Column where the row's selection really starts (past `left` when
			// `left` falls inside a tab), and the character just before it.
			startCol: columnOf(line.text, index, tabSize),
			prevCol: columnOf(line.text, index - before, tabSize),
			prevLength: before,
			prevIsTab: before === 1 && line.text.charCodeAt(index - 1) === 9,
			nextLength: index < line.text.length ? charAfter(line.text, index) : 0,
			nextIsTab: line.text.charCodeAt(index) === 9,
		});
	}
	return rows;
}

// Selection ranges for a box, main range on the head line.
export function boxSelection(doc: Text, box: Box, tabSize: number) {
	const rows = boxRows(doc, box, tabSize);
	const top = Math.min(box.anchorLine, box.headLine);
	return {
		ranges: rows.map((r) => ({ anchor: r.anchor, head: r.head })),
		mainIndex: box.headLine - top,
	};
}

// True when plain editing would miss the column on some row: the line ends
// left of the box, or (zero-width box) the column falls inside a tab.
export function needsVirtualSpace(doc: Text, box: Box, tabSize: number) {
	const { left, right } = boxBounds(box);
	return boxRows(doc, box, tabSize).some((r) => r.endCol < left || (left === right && (r.startCol ?? 0) > left));
}

// A zero-width row whose column falls inside a tab: the tab is split into
// spaces around the column so the edit lands exactly on it.
export function insideTab(r: InsertRow, left: number) {
	return r.from === r.to && r.prevIsTab && (r.startCol ?? 0) > left;
}

// Rebuild a box from a selection made of one range per consecutive line, all
// starting and ending at the same columns. `rows` are { line, anchorCol,
// headCol } in document order, `mainIndex` the main range. Null otherwise.
export function deriveBox(rows: SelectionRow[], mainIndex: number) {
	if (rows.length < 2) return null;
	for (let i = 1; i < rows.length; i++) {
		const r = rows[i];
		if (r.line !== rows[0].line + i) return null;
		if (r.anchorCol !== rows[0].anchorCol || r.headCol !== rows[0].headCol) return null;
	}
	const main = rows[mainIndex];
	const first = rows[0].line;
	const last = rows[rows.length - 1].line;
	// A box's main cursor is on one of its edges; an inner one means plain cursors.
	if (main.line !== first && main.line !== last) return null;
	return {
		anchorLine: main.line === first ? last : first,
		anchorCol: main.anchorCol,
		headLine: main.line,
		headCol: main.headCol,
	};
}

// Column one character to the right of `col` on this line, or one virtual
// column further once past its end.
export function stepRight(text: string, col: number, tabSize: number) {
	if (col >= lineWidth(text, tabSize)) return col + 1;
	for (let i = 1; i <= text.length; i++) {
		const c = columnOf(text, i, tabSize);
		if (c > col) return c;
	}
	return col + 1;
}

export function stepLeft(text: string, col: number, tabSize: number) {
	if (col <= 0) return 0;
	if (col > lineWidth(text, tabSize)) return col - 1;
	let best = 0;
	for (let i = 0; i <= text.length; i++) {
		const c = columnOf(text, i, tabSize);
		if (c >= col) break;
		best = c;
	}
	return best;
}

export function moveBox(doc: Text, box: Box, dir: Direction, tabSize: number) {
	const next = Object.assign({}, box);
	if (dir === "up") next.headLine = Math.max(1, box.headLine - 1);
	else if (dir === "down") next.headLine = Math.min(doc.lines, box.headLine + 1);
	else {
		const text = doc.line(box.headLine).text;
		next.headCol = dir === "left" ? stepLeft(text, box.headCol, tabSize) : stepRight(text, box.headCol, tabSize);
	}
	return next;
}

// Clipboard text to lines: CRLF or LF, one trailing line break ignored.
export function splitClipboard(text: string) {
	const lines = text.split(LINE_BREAK_RE);
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

// Which clipboard line goes to which row. One line: every row. As many lines
// as rows: one each. Fewer lines: they repeat in order. More: the extra lines
// are dropped and counted.
export function pickPasteLines(lines: string[], rowCount: number) {
	const picked = [];
	for (let i = 0; i < rowCount; i++) picked.push(lines.length ? lines[i % lines.length] : "");
	return { picked, dropped: Math.max(0, lines.length - rowCount) };
}

// Change specs to put one text per row. `rows` come from boxRows or from plain
// ranges ({ from, to, lineTo, endCol }); when `left` is given, a row whose line
// ends before that column is padded with spaces up to it first, and a tab the
// column falls into is split into spaces.
export function planRowInsert(rows: InsertRow[], texts: string[], left: number | null) {
	return rows.map((r, i) => {
		if (left != null && r.from === r.to && r.to === r.lineTo && r.endCol < left) {
			return { from: r.lineTo, to: r.lineTo, insert: " ".repeat(left - r.endCol) + texts[i] };
		}
		if (left != null && insideTab(r, left)) {
			return { from: r.from - 1, to: r.from, insert: " ".repeat(left - (r.prevCol ?? 0)) + texts[i] + " ".repeat((r.startCol ?? 0) - left) };
		}
		return { from: r.from, to: r.to, insert: texts[i] };
	});
}

// Backspace or Delete on a box. A box with width deletes its content on every
// row and becomes a zero-width box at its left edge. A zero-width box deletes
// one character before (or after) the column on the rows that reach it; rows
// that end earlier are left alone, like SSMS in virtual space. A tab loses one
// column (it becomes spaces) so every row moves by exactly one column.
// Backspace at column 0 does nothing, so it never joins lines.
export function planBoxDelete(doc: Text, box: Box, forward: boolean, tabSize: number) {
	const { left, right } = boxBounds(box);
	const rows = boxRows(doc, box, tabSize);
	const changes: Edit[] = [];
	if (right > left) {
		for (const r of rows) if (r.to > r.from) changes.push({ from: r.from, to: r.to });
		return { changes, box: Object.assign({}, box, { anchorCol: left, headCol: left }) };
	}
	if (forward) {
		for (const r of rows) {
			if (insideTab(r, left)) changes.push({ from: r.from - 1, to: r.from, insert: " ".repeat(r.startCol - r.prevCol - 1) });
			else if (r.endCol > left && r.from < r.lineTo) {
				changes.push({ from: r.from, to: r.from + r.nextLength, insert: r.nextIsTab ? " ".repeat(tabSize - (left % tabSize) - 1) : "" });
			}
		}
		return { changes, box };
	}
	if (left === 0) return { changes, box };
	for (const r of rows) {
		if (r.endCol < left || r.from <= r.lineFrom) continue;
		if (r.prevIsTab) changes.push({ from: r.from - 1, to: r.from, insert: " ".repeat(r.startCol - r.prevCol - 1) });
		else changes.push({ from: r.from - r.prevLength, to: r.from });
	}
	return { changes, box: Object.assign({}, box, { anchorCol: left - 1, headCol: left - 1 }) };
}

// Text a multi-range copy should put on the clipboard: one line per range,
// empty ones included (CodeMirror skips them, which breaks the row order).
export function copyText(doc: Text, ranges: readonly { from: number; to: number }[]) {
	return ranges.map((r) => doc.sliceString(r.from, r.to)).join("\n");
}
