[Snailkit](../README.md) · **Tables**

# Tables

Insert, sort, resize and style Markdown tables with a small toolbar, like in a word processor. The table stays plain Markdown.

## What it does

Markdown tables are quick to read and slow to edit. Tables gives you what a word processor has:

- **Insert table**: hover a grid to pick the size (or type a bigger one), the table appears with the cursor in its first cell.
- **A floating toolbar** above the table that has the cursor: **Rows** (insert, duplicate, move, delete), **Columns** (sort, insert, duplicate, move, align, delete), **Sort**, **Style** and **More** (realign the source, copy as CSV, delete the table).
- **Smart sorting**: numbers (`1 234,50 €`, `$1,234.50`, `12%`), dates (`2026-10-15`, `15/10/2026`) and text in natural order (`item 9` before `item 10`). The header stays on top, a total row stays at the bottom.
- **Styles**: Plain, Ledger, Grid or Report, an accent color, banded rows or columns, a plain or hidden header row, the first column or a total row emphasized, a text size.
- **Column widths**: drag the right edge of a header cell.
- **Keyboard navigation** in Source mode: Tab, Shift+Tab and Enter move between cells and realign the table.

The look of a table is saved in one line just below it, which Obsidian does not show in Reading view:

```markdown
| Task      | Team   | Due        |
| --------- | ------ | ---------- |
| Kick-off  | All    | 2026-10-05 |
| Mock-ups  | Design | 2026-10-12 |
<!-- table: style=ledger accent=blue banding=rows widths=160 -->
```

Every change (a sort, a new row, a style) is one step in Ctrl+Z (Cmd+Z on Mac).

## How to use it

1. Turn on **Tables** in **Settings → Snailkit**.
2. In a note, right-click an empty line and choose **Insert table...**, or run **Insert table** from the command palette. Hover the grid and click.
3. Click in a cell: the toolbar appears above the table. In Live Preview, hover a header cell for its round **column button** (sort and other column actions), and drag a header cell's right edge to change its width.
4. Below a styled table, Live Preview shows a small chip such as `Ledger · Rows`. Click it, or **Style** in the toolbar, to change the look. Hovering a style previews it on the table.

Every action is also a command (search "Snailkit" in the command palette), so you can give them hotkeys in **Settings → Hotkeys**.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Style (new tables) | Plain | The style written below every table you insert. |
| Banding (new tables) | Rows | Rows: every other row is shaded. Columns: every other column. Off: none. |
| Text size (new tables) | Theme | Theme keeps your theme's table size (often a bit smaller than the text). Note matches the text around the table. Small and Large are 0.875 and 1.125 times the note's text size. |
| Also kept from a table | (none) | Shown only after **Use as default for new tables**: the accent, header row, first column and total row taken from that table. **Clear** removes them. |
| Style for other tables | Theme | Tables with no style line below them. Theme: left as your theme draws them. Any style: drawn that way on screen, with the banding and text size of new tables. Nothing is written in your notes. |
| Floating toolbar | On | The toolbar above the table that has the cursor. Off: use the commands and the right-click menu. |
| Style chip | On | In Live Preview, the style line below a table shows as a chip that opens the Style panel. Off: the raw `<!-- table: ... -->` line stays visible. |
| Keyboard navigation | On | Tab, Shift+Tab and Enter inside tables in Source mode. Off: these keys keep their normal behavior. Turn it off if another plugin (such as Advanced Tables) already does this. |
| Date order | Day first | How `03/04/2026` is read when sorting: 3 April (day first) or March 4 (month first). ISO dates (`2026-04-03`) are read the same either way. |

The quickest way to set the look of new tables: style one table as you like, open its Style panel and click **Use as default for new tables**.

## Exact behavior

### What counts as a table

A run of consecutive lines containing an unescaped `|`, whose second line is a delimiter row (`| --- | :-: | --: |`). Leading and trailing pipes are optional. Tables inside callouts and quotes (lines starting with `>`) work; tables inside code blocks are ignored. `\|` is a pipe inside a cell, `\\|` is a backslash followed by a separator.

### The style line

The line directly below the last row, when it reads `<!-- table: ... -->` with the same `>` prefix as the table. Tokens are separated by spaces and never translated:

| Token | Values | When absent |
| --- | --- | --- |
| `style=` | `plain`, `ledger`, `grid`, `report`, or `none` (the theme's look, used when only widths are set) | `plain` |
| `accent=` | `theme`, `blue`, `cyan`, `green`, `yellow`, `orange`, `red`, `purple`, `pink`, `gray`, or a hex color `#rgb` / `#rrggbb` | `theme` |
| `banding=` | `off`, `rows`, `columns` | `off` |
| `header=` | `off` (drawn like any other row), `hide` (not shown, with every style) | emphasized |
| `first-col` | first column in bold | off |
| `total` | last row drawn as a total and kept last when sorting | off |
| `size=` | `small`, `note`, `large` (with every style) | the theme's size |
| `widths=` | column widths in pixels, `0` = automatic (`widths=160,0,90`) | automatic |

Unknown tokens are kept as they are. Invalid values are ignored, never passed to the page. Tokens are written in the order above, defaults left out (except `style` and `banding`).

### The four styles

- **Plain**: no lines between rows, the accent draws a rule under the header.
- **Ledger**: a line between rows, the accent rule under the header.
- **Grid**: every cell boxed, the header tinted with the accent.
- **Report**: a line between rows, the header tinted with the accent, a total row tinted too.

Tables saved by an earlier version of this tool may name a style that no longer exists. They are drawn with the closest one and their line is left alone until you pick another style: `tide` shows as Report, `index` and `marker` as Plain.

### Rewriting a table

Every action that changes a table rewrites it whole, as one undo step: cells trimmed, then padded so the pipes line up, delimiter cells at least three characters (`---`, `:--`, `:-:`, `--:`). Wide characters (CJK, emoji) count as two. Short rows get empty cells; no cell is ever dropped.

In Live Preview, while a cell is being edited, row and column actions and alignment use Obsidian's own table commands (same result, native animation). Sorting and styles are always done by Tables.

### Rows and columns

The header is row 0: it cannot be moved, duplicated or deleted, and nothing goes above it. The last column cannot be deleted. Inserted and duplicated columns keep the alignment of the current column. After an action the cursor stays in the same cell, or follows the moved, inserted or duplicated one.

### Sorting

1. The header stays first. With `total`, the last row stays last.
2. The column's kind is decided from its non-empty cells, read as plain text (links show their text, `**`, `==`, backticks and HTML tags are dropped):
   - **number** when every cell is a number: optional sign, optional currency (`€ $ £ ¥ ₹ EUR USD GBP CHF`, before or after), optional `%`, spaces as thousands separators. With both `,` and `.`, the last one is the decimal separator. A lone `,` followed by groups of three digits (`1,234`) separates thousands, otherwise it is decimal (`1,5`). A lone `.` is decimal unless it appears twice or more in groups of three (`1.234.567`).
   - **date** when every cell is a real date: `YYYY-MM-DD` (optionally with `HH:MM`) or `DD/MM/YYYY` (also `.` or `-`, two-digit years are 20xx). **Date order** decides how `03/04/2026` is read.
   - **text** otherwise: ignoring case and accents, numbers inside text compared as numbers.
3. Empty cells go last in both directions. Equal values keep their order.

Menus name the direction by kind: A to Z, low to high, oldest first. A table with fewer than two rows below the header is not sorted.

### Column widths

In Live Preview on desktop, hovering the right edge of a header cell shows a handle. Drag it (48 px minimum), or double-click it to go back to automatic width. The width is saved in the style line (`widths=`) as one undo step; a table without one gets one (`style=none` when **Style for other tables** is Theme). Widths are minimums: a long word still widens its column. Widths follow the column position, not the column: after moving or deleting a column, set them again if needed.

### Toolbar

- Appears 150 ms after the cursor enters a table (a Live Preview cell, or a table line in Source mode), above the table and inside the pane. Hides when the focus leaves the table, the toolbar and its menus.
- When the table's top is scrolled away, it shrinks to one button at the top right of the pane; click it to expand.
- Keyboard: the command **Focus table tools** moves the focus to it; Left and Right move between buttons; Escape closes it and returns to the cell. It stays hidden for that table until the cursor leaves and comes back.
- On phones it sits at the bottom of the screen, above the keyboard and Obsidian's toolbar.

### Style panel

- Hovering or focusing a style previews it on the table. Clicking applies it.
- Accent swatches apply at once; the pipette opens a color picker, previewed while picking.
- Banding, header row, text size, first column and total row apply at once.
- **Reset appearance** removes the style line (or keeps only `style=none` and the widths).
- **Use as default for new tables** saves this look (everything except widths) for new tables.
- Escape, the close button or a click outside close it. Each change edits only the style line, as one undo step.

### Keyboard in tables

Active in Source mode with one cursor.

| Key | Action |
| --- | --- |
| Tab | Next cell; after the last cell of a row, the next row; after the last cell of the table, a new row. The cell's text is selected. |
| Shift+Tab | Previous cell; from the first cell of a row, the last cell of the row above. |
| Enter | Same column, next row; on the last row, a new row. On an empty last row: the row goes and the cursor moves below the table. |

Each key realigns the table. Shift+Enter keeps its normal behavior.

### Commands and menus

Commands: Insert table, Table style, Focus table tools, Sort column ascending / descending, Format table source, Format all tables in the note, every row and column action, the three alignments, Copy table as CSV, Delete table. All but the two insert and format-all commands need the cursor in a table. None has a default hotkey.

Right-click in a table (Source mode): sort the column both ways and **Table style...**. Elsewhere: **Insert table...**.

### Reading view

Tables are drawn with their style line, and **Style for other tables** applies too. Styles are changed in the editor.

### Known limits

- Live Preview tables rely on parts of Obsidian that are not a public API. If a future Obsidian version changes them, the toolbar, header button and resize handle may stop appearing on Live Preview tables; every command still works in Source mode, and nothing is written to a table that cannot be read safely.
- No merged cells, nested tables or per-cell colors (Markdown has none).
- `1,234` is read as one thousand two hundred thirty-four, `1,5` as one and a half.
- Column resizing and the header button are desktop only.
