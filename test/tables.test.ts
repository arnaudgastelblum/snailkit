// Pure logic of the Tables module: finding and parsing tables, rewriting them aligned, row and
// column actions, sorting, the style comment (with styles of earlier versions) and widths.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	cellIndexAt,
	cellSpan,
	columnKind,
	createTable,
	defaultMeta,
	displayWidth,
	findAllTables,
	findTableAt,
	formatTable,
	insideFence,
	isDelimiterRow,
	lineOfRow,
	lookExtras,
	lookMeta,
	metaFromLine,
	parseDate,
	parseMetaTokens,
	parseNumber,
	parseTable,
	parseWidths,
	planAction,
	plainText,
	rowOfLine,
	serializeMeta,
	setColumnWidth,
	shownStyle,
	sortRows,
	splitCells,
	toCsv,
	widthsToken,
	withMeta,
	accentCss,
	type Model,
} from "../src/modules/tables/logic";

const L = (s: string) => s.split("\n");
const firstCells = (m: Model) => m.rows.map((r) => r[0]);

// ----- Parsing -----

test("cells: outer pipes optional, escaped pipes stay in the cell", () => {
	assert.deepEqual(splitCells("| a | b \\| c |  d |"), ["a", "b \\| c", "d"]);
	assert.deepEqual(splitCells("a | b"), ["a", "b"]);
	assert.deepEqual(splitCells("|  |x|"), ["", "x"]);
	// "\\|" is a backslash followed by a separator.
	assert.deepEqual(splitCells("| a\\\\| b | c |"), ["a\\\\", "b", "c"]);
});

test("delimiter rows, in and out of callouts", () => {
	assert.ok(isDelimiterRow("| --- | :-: | --: |"));
	assert.ok(isDelimiterRow("> |:--|---|"));
	assert.ok(!isDelimiterRow("| a | b |"));
	assert.ok(!isDelimiterRow("| | |"));
});

const DOC = L(`# Project X

| Name | Qty |
|------|----:|
| a    | 2   |
| b    | 10  |
<!-- table: style=ledger accent=blue banding=rows first-col -->

Text | with pipe

\`\`\`
| x | y |
|---|---|
| 1 | 2 |
\`\`\`

> [!note]
> | K | V |
> |---|---|
> | k | v |`);

test("a table is found from any of its rows, with its style comment below", () => {
	for (const i of [2, 3, 4, 5]) assert.deepEqual(findTableAt(DOC, i), { start: 2, end: 5, prefix: "", metaLine: 6 });
	assert.equal(findTableAt(DOC, 6), null, "the comment line is not a row");
	assert.equal(findTableAt(DOC, 8), null, "a line with a pipe is not a table");
	assert.equal(findTableAt(DOC, 0), null);
});

test("tables in code blocks are ignored, tables in callouts are found", () => {
	assert.equal(findTableAt(DOC, 11), null);
	const callout = findTableAt(DOC, 19);
	assert.deepEqual(callout, { start: 17, end: 19, prefix: "> ", metaLine: null });
	assert.deepEqual(findAllTables(DOC).map((b) => [b.start, b.end]), [[2, 5], [17, 19]]);
	assert.deepEqual(findAllTables(DOC, 10, 14), []);
});

test("a fence closes only on a bare marker of the same kind", () => {
	const lines = L("````\n```` not-a-closing-fence\n| x | y |\n|---|---|\n| 1 | 2 |\n````\n\n| a | b |\n|---|---|");
	assert.equal(findTableAt(lines, 3), null);
	assert.deepEqual(findAllTables(lines).map((b) => b.start), [7]);
	assert.ok(insideFence(L("```js\n| a |"), 1));
	assert.ok(!insideFence(L("```js\ncode\n```  \n| a |"), 3));
});

test("the style comment must share the table's quote prefix", () => {
	assert.equal(findTableAt(L("| a | b |\n|---|---|\n> <!-- table: style=grid -->"), 1)?.metaLine, null);
	assert.equal(findTableAt(L("> | a | b |\n> |---|---|\n> <!-- table: style=grid -->"), 1)?.metaLine, 2);
});

test("ragged rows are padded, alignments read from the delimiter row", () => {
	const m = parseTable(L("| a | b | c |\n|:--|:-:|--:|\n| 1 |\n| 1 | 2 | 3 | 4 |"), { start: 0, end: 3 });
	assert.deepEqual(m.aligns, ["left", "center", "right", null]);
	assert.deepEqual(m.rows[1], ["1", "", "", ""]);
	assert.equal(m.rows.length, 3);
});

// ----- Rewriting -----

test("rewrite pads per alignment, delimiter cells at least three wide", () => {
	assert.deepEqual(formatTable({ rows: [["Name", "Qty", "C"], ["abcdef", "7", "x"]], aligns: [null, "right", "center"] }), [
		"| Name   | Qty |  C  |",
		"| ------ | --: | :-: |",
		"| abcdef |   7 |  x  |",
	]);
	assert.deepEqual(formatTable({ rows: [["a"], ["b"]], aligns: ["left"] }), ["| a   |", "| :-- |", "| b   |"]);
});

test("wide characters count double and the callout prefix is kept", () => {
	assert.equal(displayWidth("中文a"), 5);
	assert.deepEqual(formatTable({ rows: [["中文", "a"], ["x", "b"]], aligns: [null, null] }, "> "), ["> | 中文 | a   |", "> | ---- | --- |", "> | x    | b   |"]);
});

test("format then parse is stable", () => {
	const block = findTableAt(DOC, 3);
	assert.ok(block);
	const m = parseTable(DOC, block);
	const out = formatTable(m);
	assert.deepEqual(parseTable(out, { start: 0, end: out.length - 1 }), m);
	assert.deepEqual(formatTable(parseTable(out, { start: 0, end: out.length - 1 })), out);
});

test("cell positions for the cursor", () => {
	const line = "| Name   |  7 |     |";
	assert.deepEqual(cellSpan(line, 0), { from: 2, to: 6 });
	assert.deepEqual(cellSpan(line, 1), { from: 12, to: 13 });
	assert.deepEqual(cellSpan(line, 2), { from: 16, to: 16 });
	assert.equal(cellIndexAt(line, 0), 0);
	assert.equal(cellIndexAt(line, 12), 1);
	assert.equal(cellIndexAt(line, 17), 2);
	assert.deepEqual(cellSpan("a | b", 1), { from: 4, to: 5 });
	assert.deepEqual(cellSpan("> | k | v |", 1), { from: 8, to: 9 });
	const escaped = "| a\\\\| b | KEEP |";
	const span = cellSpan(escaped, 2);
	assert.equal(escaped.slice(span.from, span.to), "KEEP");
	assert.equal(rowOfLine({ start: 4 }, 5), 0, "the delimiter row counts as the header");
	assert.equal(rowOfLine({ start: 4 }, 7), 2);
	assert.equal(lineOfRow(0), 0);
	assert.equal(lineOfRow(2), 3);
});

// ----- Row and column actions -----

const M: Model = { rows: [["H1", "H2"], ["a", "1"], ["b", "2"]], aligns: [null, "right"] };

test("row actions, with the header protected", () => {
	for (const action of ["rowDelete", "rowAbove", "rowDuplicate", "rowUp"] as const) assert.equal(planAction(action, M, 0, 0), null, action);
	let p = planAction("rowAbove", M, 1, 1);
	assert.deepEqual([p?.model.rows.length, p?.model.rows[1], p?.row, p?.col], [4, ["", ""], 1, 1]);
	p = planAction("rowBelow", M, 0, 0);
	assert.deepEqual([p?.model.rows[1], p?.row], [["", ""], 1]);
	p = planAction("rowDuplicate", M, 2, 0);
	assert.deepEqual(p?.model.rows.slice(2), [["b", "2"], ["b", "2"]]);
	assert.equal(planAction("rowUp", M, 1, 0), null, "the first row never goes above the header");
	p = planAction("rowUp", M, 2, 0);
	assert.deepEqual([p?.model.rows[1][0], p?.row], ["b", 1]);
	assert.equal(planAction("rowDown", M, 2, 0), null);
	p = planAction("rowDelete", M, 2, 0);
	assert.deepEqual([p?.model.rows.length, p?.row], [2, 1]);
	assert.equal(M.rows.length, 3, "the input model is never changed");
});

test("column actions and alignment, the last column protected", () => {
	let p = planAction("colRight", M, 1, 1);
	assert.deepEqual([p?.model.rows[0], p?.model.aligns, p?.col], [["H1", "H2", ""], [null, "right", "right"], 2]);
	p = planAction("colLeft", M, 1, 0);
	assert.deepEqual([p?.model.rows[1], p?.col], [["", "a", "1"], 0]);
	p = planAction("colDuplicate", M, 1, 0);
	assert.deepEqual(p?.model.rows[1], ["a", "a", "1"]);
	p = planAction("colMoveRight", M, 0, 0);
	assert.deepEqual([p?.model.rows[0], p?.model.aligns, p?.col], [["H2", "H1"], ["right", null], 1]);
	assert.equal(planAction("colMoveRight", M, 0, 1), null);
	assert.equal(planAction("colMoveLeft", M, 0, 0), null);
	p = planAction("colDelete", M, 0, 1);
	assert.deepEqual([p?.model.rows[2], p?.col], [["b"], 0]);
	assert.equal(planAction("colDelete", { rows: [["a"], ["1"]], aligns: [null] }, 1, 0), null);
	assert.deepEqual(planAction("alignCenter", M, 1, 0)?.model.aligns, ["center", "right"]);
	assert.deepEqual(planAction("alignLeft", M, 1, 1)?.model.aligns, [null, "left"]);
});

test("Tab, Shift+Tab and Enter move through cells and add a row at the end", () => {
	const pick = (action: "next" | "prev" | "down", row: number, col: number) => {
		const p = planAction(action, M, row, col);
		return p && [p.model.rows.length, p.row, p.col];
	};
	assert.deepEqual(pick("next", 0, 0), [3, 0, 1]);
	assert.deepEqual(pick("next", 1, 1), [3, 2, 0]);
	assert.deepEqual(pick("next", 2, 1), [4, 3, 0]);
	assert.deepEqual(pick("prev", 2, 0), [3, 1, 1]);
	assert.deepEqual(pick("prev", 0, 0), [3, 0, 0]);
	assert.deepEqual(pick("down", 1, 1), [3, 2, 1]);
	assert.deepEqual(pick("down", 2, 1), [4, 3, 1]);
});

// ----- Sorting -----

test("numbers in European and US formats, currencies, percents", () => {
	const cases: Record<string, number> = {
		"1 234,50 €": 1234.5,
		"$1,234.50": 1234.5,
		"12%": 12,
		"1,5": 1.5,
		"-3.25": -3.25,
		"1.234.567": 1234567,
		"1,234": 1234,
		"1.234,5": 1234.5,
		"EUR 20": 20,
		"20 CHF": 20,
		"£7": 7,
		"− 4": -4,
		"1 000": 1000,
		"-$20": -20,
		"$-20": -20,
		"-USD20": -20,
	};
	for (const [text, value] of Object.entries(cases)) assert.equal(parseNumber(text), value, text);
	for (const text of ["abc", "2026-10-15", "12 apples", "", "--5"]) assert.equal(parseNumber(text), null, text);
});

test("dates: ISO, day first, month first, impossible dates refused", () => {
	assert.equal(parseDate("2026-10-15"), Date.UTC(2026, 9, 15));
	assert.equal(parseDate("2026-10-15 14:30"), Date.UTC(2026, 9, 15, 14, 30));
	assert.equal(parseDate("03/04/2026"), Date.UTC(2026, 3, 3));
	assert.equal(parseDate("03/04/2026", "mdy"), Date.UTC(2026, 2, 4));
	assert.equal(parseDate("15.10.26"), Date.UTC(2026, 9, 15));
	assert.equal(parseDate("29/02/2028"), Date.UTC(2028, 1, 29));
	for (const text of ["31/13/2026", "29/02/2026", "2026-02-31", "2026-01-01 25:00", "soon"]) assert.equal(parseDate(text), null, text);
	assert.equal(parseDate("15/10/2026", "mdy"), null, "month 15 does not exist");
});

test("column kind and plain cell text", () => {
	assert.equal(columnKind(["1,5", "", "**20**"]), "number");
	assert.equal(columnKind(["2026-01-02", "03/02/2026"]), "date");
	assert.equal(columnKind(["a", "1"]), "text");
	assert.equal(columnKind(["", ""]), "text");
	assert.equal(columnKind(["13/01/2026"], "mdy"), "text");
	assert.equal(plainText("[[Page|Alias]] and [link](https://example.com) `code` **b**"), "Alias and link code b");
	assert.equal(plainText("snake_case_name"), "snake_case_name");
});

const S: Model = {
	rows: [["Item", "Amount", "Due"], ["b", "1 000,5", "15/10/2026"], ["a", "", "2026-01-02"], ["C", "20", ""], ["d", "3", "01/01/2026"]],
	aligns: [null, null, null],
};

test("sort numbers: header fixed, empty cells last in both directions", () => {
	assert.deepEqual(firstCells(sortRows(S, 1, "asc")), ["Item", "d", "C", "b", "a"]);
	assert.deepEqual(firstCells(sortRows(S, 1, "desc")), ["Item", "b", "C", "d", "a"]);
	const money: Model = { rows: [["x"], ["€ 12,50"], ["€ 3"], ["€ 1.200,00"], ["-€ 5"]], aligns: [null] };
	assert.deepEqual(firstCells(sortRows(money, 0, "asc")), ["x", "-€ 5", "€ 3", "€ 12,50", "€ 1.200,00"]);
	const percent: Model = { rows: [["x"], ["50%"], ["7%"], ["100%"]], aligns: [null] };
	assert.deepEqual(firstCells(sortRows(percent, 0, "desc")), ["x", "100%", "50%", "7%"]);
});

test("sort dates in both orders", () => {
	assert.deepEqual(firstCells(sortRows(S, 2, "asc")), ["Item", "d", "a", "b", "C"]);
	const dates: Model = { rows: [["d"], ["03/04/2026"], ["04/03/2026"]], aligns: [null] };
	assert.deepEqual(firstCells(sortRows(dates, 0, "asc", { dateOrder: "dmy" })), ["d", "04/03/2026", "03/04/2026"]);
	assert.deepEqual(firstCells(sortRows(dates, 0, "asc", { dateOrder: "mdy" })), ["d", "03/04/2026", "04/03/2026"]);
});

test("sort text: case and accent insensitive, numbers inside text in natural order", () => {
	assert.deepEqual(firstCells(sortRows(S, 0, "asc")), ["Item", "a", "b", "C", "d"]);
	const natural: Model = { rows: [["x"], ["item 10"], ["item 9"], ["Éclair"], ["eagle"]], aligns: [null] };
	assert.deepEqual(firstCells(sortRows(natural, 0, "asc")), ["x", "eagle", "Éclair", "item 9", "item 10"]);
});

test("sort keeps a total row last and equal values in their order", () => {
	const m: Model = { rows: [["k", "v"], ["x", "2"], ["y", "1"], ["z", "1"], ["Total", "4"]], aligns: [null, null] };
	assert.deepEqual(firstCells(sortRows(m, 1, "asc", { keepLast: true })), ["k", "y", "z", "x", "Total"]);
	assert.deepEqual(firstCells(sortRows(m, 1, "desc", { keepLast: true })), ["k", "x", "y", "z", "Total"]);
	assert.deepEqual(firstCells(sortRows(m, 1, "desc")), ["k", "Total", "x", "y", "z"]);
	assert.equal(planAction("sortAsc", { rows: [["h"], ["only"]], aligns: [null] }, 1, 0), null, "nothing to sort with one row");
	const plan = planAction("sortDesc", m, 2, 1, { keepLast: true });
	assert.deepEqual(plan && firstCells(plan.model), ["k", "x", "y", "z", "Total"]);
});

// ----- Style comment -----

test("style comment: parse, defaults, round trip, unknown tokens kept", () => {
	const meta = metaFromLine("<!-- table: style=ledger accent=blue banding=rows first-col col3=currency -->");
	assert.deepEqual(meta, {
		style: "ledger",
		accent: "blue",
		banding: "rows",
		header: "on",
		firstCol: true,
		total: false,
		size: "theme",
		widths: [],
		extra: ["col3=currency"],
	});
	assert.equal(serializeMeta(meta as NonNullable<typeof meta>), "<!-- table: style=ledger accent=blue banding=rows first-col col3=currency -->");
	assert.deepEqual(metaFromLine("> <!--table: header=off total -->"), { ...defaultMeta(), header: "off", total: true });
	assert.equal(metaFromLine("<!-- other comment -->"), null);
	assert.equal(parseMetaTokens("size=note").size, "note");
	assert.equal(parseMetaTokens("size=huge").size, "theme");
	assert.equal(parseMetaTokens("header=hide").header, "hide");
	assert.equal(parseMetaTokens("header").header, "on");
});

test("styles of earlier versions are drawn as the closest style and never rewritten", () => {
	assert.equal(shownStyle("tide"), "report");
	assert.equal(shownStyle("index"), "plain");
	assert.equal(shownStyle("marker"), "plain");
	assert.equal(shownStyle("grid"), "grid");
	assert.equal(shownStyle("none"), "none");
	// Changing the widths of a table written by an earlier version keeps its style word.
	const meta = metaFromLine("<!-- table: style=tide banding=rows -->");
	assert.ok(meta);
	assert.equal(meta.style, "tide");
	assert.equal(serializeMeta({ ...meta, widths: [120] }), "<!-- table: style=tide banding=rows widths=120 -->");
	// Unknown style words are kept as unknown tokens, the table is drawn Plain.
	const bogus = parseMetaTokens("style=bogus");
	assert.deepEqual([bogus.style, bogus.extra], ["plain", ["style=bogus"]]);
});

test("accents are names or hex colors only, never raw CSS", () => {
	const meta = parseMetaTokens("accent=red;background:url(x) style=plain");
	assert.equal(meta.accent, "theme");
	assert.equal(accentCss("green"), "var(--color-green)");
	assert.equal(accentCss("gray"), "var(--color-base-50)");
	assert.equal(accentCss("#12aBef"), "#12aBef");
	assert.equal(accentCss("theme"), null);
	assert.equal(accentCss("#12345"), null);
});

test("writing the comment: replace, insert, remove, inside a callout", () => {
	const block = findTableAt(DOC, 4);
	assert.ok(block);
	let res = withMeta(DOC, block, { ...defaultMeta(), style: "grid" });
	assert.equal(res.lines[6], "<!-- table: style=grid banding=off -->");
	assert.equal(res.lines.length, DOC.length);
	res = withMeta(DOC, block, null);
	assert.equal(res.lines[6], "");
	assert.equal(res.lines.length, DOC.length - 1);
	assert.deepEqual(res.block, { start: 2, end: 5, prefix: "", metaLine: null });
	const callout = findTableAt(DOC, 18);
	assert.ok(callout);
	res = withMeta(DOC, callout, defaultMeta());
	assert.equal(res.lines[20], "> <!-- table: style=plain banding=off -->");
	assert.deepEqual(res.block, { start: 17, end: 19, prefix: "> ", metaLine: 20 });
	assert.deepEqual(findTableAt(res.lines, 18), res.block);
});

test("column widths: encoding, invalid values kept as unknown tokens", () => {
	const meta = metaFromLine("<!-- table: style=none banding=off widths=120,0,80 -->");
	assert.ok(meta);
	assert.equal(meta.style, "none");
	assert.deepEqual(meta.widths, [120, 0, 80]);
	assert.equal(serializeMeta(meta), "<!-- table: style=none banding=off widths=120,0,80 -->");
	assert.equal(serializeMeta({ ...defaultMeta(), widths: [0, 0] }), "<!-- table: style=plain banding=off -->");
	assert.deepEqual(parseMetaTokens("widths=12px,abc").widths, []);
	assert.deepEqual(parseMetaTokens("widths=12px,abc").extra, ["widths=12px,abc"]);
	assert.deepEqual(parseWidths("90,0"), [90, 0]);
	assert.equal(parseWidths("90,"), null);
	assert.equal(widthsToken([0, 80, 0, 0]), "widths=0,80");
	assert.equal(widthsToken([]), "");
	assert.equal(widthsToken([12.6, -5]), "widths=13");
	assert.deepEqual(setColumnWidth([], 2, 160), [0, 0, 160]);
	assert.deepEqual(setColumnWidth([100, 50], 0, 0), [0, 50]);
});

// ----- New tables -----

test("look of new tables from the settings, extras kept by Use as default", () => {
	assert.equal(serializeMeta(lookMeta("plain", "rows", "theme", "")), "<!-- table: style=plain banding=rows -->");
	// Invalid or legacy values fall back, widths and unknown tokens are never copied.
	assert.equal(
		serializeMeta(lookMeta("tide", "nonsense", "note", "accent=green total widths=9 x=1")),
		"<!-- table: style=report accent=green banding=off total size=note -->",
	);
	const meta = { ...defaultMeta(), style: "grid", size: "large" as const, header: "off" as const, firstCol: true, accent: "#336699", widths: [120, 0], extra: ["x=1"] };
	assert.equal(lookExtras(meta), "accent=#336699 header=off first-col");
	assert.equal(lookExtras(defaultMeta()), "");
});

test("a new table: header, delimiter, empty rows and its style comment", () => {
	const lines = createTable(3, 2, lookMeta("plain", "rows", "theme", ""), (n) => `Column ${n}`);
	assert.deepEqual(lines, [
		"| Column 1 | Column 2 | Column 3 |",
		"| -------- | -------- | -------- |",
		"|          |          |          |",
		"<!-- table: style=plain banding=rows -->",
	]);
	const block = findTableAt(lines, 0);
	assert.deepEqual([block?.start, block?.end, block?.metaLine], [0, 2, 3]);
	assert.equal(createTable(0, 0, defaultMeta(), () => "H").length, 3, "at least one column and the header row");
	assert.equal(createTable(50, 1, defaultMeta(), () => "H")[0].split("|").length - 2, 30, "at most 30 columns");
});

test("CSV export: plain text and quoting", () => {
	assert.equal(toCsv({ rows: [["a", "b,c"], ["**x**", 'say "hi"']], aligns: [null, null] }), 'a,"b,c"\nx,"say ""hi"""');
});
