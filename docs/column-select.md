[Snailkit](../README.md) · **Column select**

# Column select

Select a column of text and edit several rows at once, including past the ends of short lines.

## What it does

- Select a rectangle with Alt+Shift+arrows or Alt+drag.
- Type, replace, delete, copy and paste across its rows.
- Add or remove individual cursors with Alt+click.
- Shade the part of a rectangle beyond the text. Typing there fills the gap with spaces.

## How to use it

1. Enable **Column select** in **Settings → Snailkit** and open a note in editing mode.
2. Put the cursor before a word. Hold **Alt+Shift**, press **Down** to include more lines, then **Right** to select text on each line. Alternatively, hold **Alt** and drag.
3. Type to replace the selected text on every row, or paste a list with one item per row.
4. Press **Home** or **End** to move each cursor to its own line's start or end. Press **Escape** to keep only the main cursor.

**Alt+Shift+click** extends the rectangle from its anchor. **Alt+click** adds a cursor, or removes one you click again when several exist. The four **Extend column selection...** commands also work from the command palette. You can assign your own hotkeys in Obsidian; no command hotkeys are assigned by default.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Alt+Shift+arrows | On | Draw a rectangle with the keyboard. Off: these keys go back to Obsidian. The four commands still work. |
| Alt+drag | On | Draw or extend rectangles with the mouse and add or remove cursors with Alt+click. Off: Obsidian handles the mouse. Some Linux systems use Alt+drag to move windows. |
| Spread the clipboard over the rows | On | Paste one clipboard line per selected row or cursor. Off: Obsidian handles paste, including its own distribution rules. |

Settings apply immediately. Turning the module off removes its handlers and shading, including an active mouse gesture, without reloading.

## Exact behavior

### Selection and virtual space

A rectangle spans logical document lines, including empty lines, from its anchor to its head. The main cursor is on the head line. Up and Down stop at the document boundaries; Left stops at column zero. Right can continue beyond the text. A selection on one line supplies the initial anchor and head; a selection spanning several lines starts a rectangle at its head.

Columns count characters, with tabs reaching the next editor tab stop. A Unicode surrogate pair, such as a simple emoji, counts as one column and is never split. Actual ranges stop at each line end; shaded virtual space does not insert text until you type or paste. Changing the selection normally drops the rectangle, unless the resulting consecutive ranges still describe one.

### Editing

Typing replaces every selected row. Short lines receive spaces up to the left column before the text is inserted. A cursor inside a tab splits that tab into spaces. When virtual space is not needed, CodeMirror handles typing normally, including its usual bracket pairing.

Backspace and Delete within a rectangle never join lines. A nonempty rectangle deletes its actual selected text and collapses to its left edge. For a zero-width rectangle, Backspace removes the preceding character on rows that reach the column and moves the column left; shorter rows remain unchanged. At column zero it does nothing. Delete removes the next character where one exists and does nothing at a line end. A tab touched by a zero-width deletion loses one column and becomes spaces.

Home and End move every cursor to the start or end of its logical line and clear virtual space. Escape keeps only the main cursor at its actual position. Read-only notes are never changed by module editing handlers.

Each edit performed by the module is one undo step across all affected rows. Normal CodeMirror typing keeps its usual undo grouping. Undo restores text and actual selections; it does not restore virtual columns beyond line ends.

### Copy, cut and paste

Copy and cut of a rectangle with width produce one clipboard line per row, including empty rows. Virtual shading does not become spaces in the copied text. With unrelated selections, every range is included in document order. Only empty cursors, without a rectangle with width, keep Obsidian's normal whole-line copy behavior. Cut in a read-only note only copies.

With several cursors and clipboard spreading enabled:

- One clipboard line repeats at every cursor.
- An equal number of lines fills one row each, in document order.
- Fewer lines repeat in order, for example `A, B, A, B` across four rows.
- Extra lines are ignored, with a notice saying how many were not pasted.

LF and CRLF line endings are accepted. One trailing line break is ignored for external clipboard text. An unchanged column copied during this module activation retains its exact rows, including a final empty row. Short rectangle rows are padded before paste; each cursor ends immediately after its inserted text.

**Paste at a single cursor always uses Obsidian's normal paste**, including a single cursor in virtual space. There is no command or setting to paste a block down subsequent lines.

### Known limits

- Mouse dragging does not automatically scroll the editor. Virtual space outside the visible editor can be clipped.
- Columns use character counts, not measured glyph widths. Proportional fonts, mixed text directions, combining accents and multi-code-point emoji can look uneven. Rectangles use logical lines, not individual wrapped screen lines; folded or hidden text between the endpoints is included.
- A nonzero-width rectangle whose edge falls inside a tab snaps that edge to the end of the tab. Zero-width editing inside a tab is exact.
- IME composition, autocorrect, spell-check replacements and input containing line breaks are left to CodeMirror. Virtual padding is not applied during composition; use real text positions for IME input.
- Keyboard rectangle shortcuts, mouse rectangle gestures and extension commands are inactive on mobile. Ordinary touch editing stays with Obsidian.
- OS shortcuts and other plugins can intercept Alt gestures before the editor receives them. Test Source mode and Live Preview with your theme; rendered Markdown can shift visible character positions.
