[Snailkit](../README.md) · **Note rail**

# Note rail

A quiet row of icons on every note: search, where the note belongs, the note's contents, its bookmarks, its open tasks, and a calendar of daily notes, each one hover or click away.

## What it does

A small rail of icons sits in the top corner of every note, faint until you move the pointer over the note. Each icon opens a panel that slides out next to it, when you rest the pointer on it or click it:

- **Contents**: the headings of the note. The section you are reading is marked, a thin bar shows how far you are. Hover a heading and the note scrolls to it; move away and it glides back to exactly where you were. Click to stay there.
- **Bookmarks**: notes you pinned to this note (saved in the note itself), and notes pinned for the whole vault, shown on every note.
- **Open tasks**: the unchecked tasks of this note and of its pinned notes. Check one from the panel, or click it to jump to its line.
- **Calendar**: a month of daily notes, with a dot for each day that has a note and another for days with open tasks. Click a day to open its note, or create it from your template.
- **Brainstorms** (the lightning button, with the Brainstorm module): start a brainstorm, close or reopen the one you are in, and open the brainstorms still waiting to be sorted.

Above the panel buttons, three buttons act on click:

- **Search** (the magnifier, with the [Search](search.md) tool on): the search window, growing from the rail.
- **Where the note belongs**: the colored initial of the note's area (its domain). With the [Home](home.md) tool on, a click opens the page of that domain in the Workbench, the note marked "you are here"; without it, the area note itself. Hover it to read the path.
- **Today**: today's daily note, created from your template if needed.

**Make room** slides the text aside while a panel is open, so it never covers what you are reading.

## How to use it

1. Turn on **Note rail** in **Settings → Snailkit**.
2. Open any note. The rail is in its top left corner (top right if you prefer).
3. Rest the pointer on an icon: its panel opens, and closes when you move away. Move to another icon to switch panels.
4. Click an icon to keep its panel open; click it again (or press Esc, or click elsewhere) to close it.
5. The pin at the top of a panel keeps it open while you click around and change notes.

Commands (search "Snailkit" in the command palette, assign hotkeys in **Settings → Hotkeys**): **Open contents**, **Open bookmarks**, **Open tasks**, **Open calendar**, **Open today's daily note**, **Pin current note to the vault**, **Pin a note to this note**.

Pinning **Meeting notes** and **Reading list** to **Project X** adds this to Project X:

```yaml
---
pins:
  - "[[Meeting notes]]"
  - "[[Reading list]]"
---
```

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Where the note belongs | On | The area pill: the colored initial of the note's area. |
| Today | On | The sun button: today's daily note. |
| Brainstorm | On | The lightning button and its panel (shown only while the Brainstorm module is on). |
| Contents, Bookmarks, Open tasks, Calendar | On | Show or hide each button. The arrows change their order on the rail. |
| Position | Top left | Top left or top right corner of the note. |
| Position on phones and tablets | Top right | The same, on a phone or a tablet. |
| Rest opacity | 0.5 | How visible the rail is while the pointer is outside the note (0.2 to 1). |
| Make room | On | Slide the text aside when an open panel would cover it. |
| Open on hover | On | On a computer, resting the pointer on a button opens its panel, which closes when you move away. A click keeps it open. Off: panels open on click only. |
| Hover preview | On | Hovering a heading scrolls the note to it, leaving scrolls back. Off: only clicks move the note. |
| Hover delay | 100 ms | How long the pointer rests on a heading before the preview starts (0 to 500 ms). |
| Deepest heading level | 6 | Headings below this level are not listed. |
| Pins property | `pins` | Property where the pins of a note are saved. Changing it does not move existing pins: the panel reads the new property. |
| Include notes pinned to this note | On | Open tasks also lists the tasks of the notes pinned to the current note. |
| Include vault pins | Off | Open tasks also lists the tasks of the vault pins. |
| Count on the rail button | On | A badge on the Open tasks button: the open tasks of the current note, or, with the Tasks module on, the tasks of the vault overdue or due today (orange when some are overdue). |
| First day of the week | Monday | Monday, Sunday, or as in Snailkit's language. |
| Week numbers | On | ISO week numbers in a column on the left. |
| Mark days with open tasks | On | A colored dot on days whose daily note has unchecked tasks. |
| Ask before creating a daily note | Off | Clicking a day without a note asks first, inside the panel. Off: the note is created right away. |
| Folder | empty | Folder of the daily notes. Empty: the core Daily notes setting, else the vault root. |
| Date format | empty | [Moment.js format](https://momentjs.com/docs/#/displaying/format/) of daily note names, previewed with today's date. Empty: the core Daily notes setting, else `YYYY-MM-DD`. |
| Template | empty | Note copied into each new daily note. Empty: the core Daily notes setting, else none. |

Vault pins are managed from the panel and the commands, not from the settings page. **Reset to defaults** on the settings page keeps your vault pins.

## Exact behavior

### The rail

- One rail per note pane, in every tab, split and popout window, in Live Preview, Source mode and Reading view. Other views (canvas, PDF, graph) get none.
- It sits below the view header, so it stays put while the note scrolls. At rest it uses **Rest opacity**; it turns fully visible while the pointer is over the note or a panel is open.
- A button is hidden when its panel has nothing for this note (a pane without a note). The Open tasks button can carry a badge (99+ at most).
- **Open on hover** (computers with a mouse, on by default; a pen or a finger taps): resting the pointer on a button for 150 ms opens its panel; sweeping across the rail opens nothing. While a panel opened this way is shown, moving onto another button switches at once, and the card does not close: it changes size smoothly and its content fades in. Moving diagonally from a button to its panel across other buttons does not switch (the pointer is heading for the panel). The panel closes 300 ms after the pointer has left both the rail and the panel; Obsidian's page preview (Ctrl or Cmd hover), menus and dialogs count as still inside. Holding Ctrl or Cmd while reaching a button opens nothing.
- **Click** a button to keep its panel open: it stays until you click the button again, click elsewhere, or press Esc. Pressing anywhere inside a panel opened by hovering keeps it open too. A panel kept open does not switch when you hover other buttons; click them instead. A panel pinned with its pin stays kept open, even when it is opened again by hovering.
- The area of the note and Today never open on hover: they act on click.
- With **Open on hover** off: click a button to open its panel, click again to close; while a panel is open, hovering another button for a short moment switches panels.
- On touch screens, buttons react to taps only (no hover).
- A glowing mark glides along the rail to the button of the open panel. The card grows out of the side of the rail. With reduced motion turned on in the system, nothing moves: panels appear and change at once.
- Turning the module off removes every rail and panel, puts the text back in place and restores any previewed scroll.

### Search, the area pill and Today

- **Search** shows only while the Search tool is on. A click opens the search window (see [Search](search.md)), growing from the magnifier, in the window of the note; Shift+Enter on a result inserts a link to it in this note, at the cursor (in Reading view, at the end of the note). Closing the search gives the focus back to the note. It never opens anything on hover; its tooltip says **Search**, followed by the hotkey of the **Snailkit: Search** command when you gave it one.
- **The area pill** shows when the note has a parent (the rule is described in [Home](home.md#where-each-note-sits)); its letter is the first letter or digit of the area's name, its color is fixed for that area. Hovering it shows the path from the area down to the note's parent.
  - **With Home on**, a click (or a tap) opens the page of the nearest domain or sub-MOC in the Workbench, the note under the cursor; on the area note itself, its own page; when Home has no page for it, and with Ctrl or Cmd held, the click does what it does without Home.
  - **Without Home**, a click opens the area note in this pane (Ctrl or Cmd click: a new tab); on a phone, or on the area note itself, it shows the path as a menu.
  - A right click, or a long press on touch screens (half a second), always shows the path as a menu: each step opens that note.
- **Today** opens today's daily note in this pane (Ctrl or Cmd click: a new tab), created from the template when missing (see Calendar). It is lit on today's note.

### Panels

- A panel is a card next to the rail: title, a small count, the note name, a pin, the content, and a hint line at the bottom.
- It closes on Esc (when no dialog, menu or suggestion popup is open), on a click outside it (clicks in menus and dialogs do not count), when you click its button again, or after an action that opens something.
- **Pin** keeps it open through outside clicks, navigation and note changes (it rebuilds for the new note). A dot on the rail button shows it. Esc still closes it. Pins of panels are not remembered after a restart.
- **Make room**: while a panel overlaps the text column, the column moves aside by exactly the overlap (as far as the pane allows) and moves back when the panel closes. Nothing is written to the note.
- Opening a panel from the keyboard (Enter on a rail button, or a command) puts the focus inside it; closing it gives the focus back.

### Contents

- Lists the headings from Obsidian's metadata, down to **Deepest heading level**, indented relative to the shallowest level present. Formatting and links in headings are shown as plain text.
- The section you are reading is marked and follows the scroll; the bar under the title shows how far you are in the note.
- **Hover preview** (desktop): resting on a heading for the **Hover delay** scrolls the note so the heading is near the top and highlights it. The cursor, the selection and the undo history are untouched. Sweeping across the list retargets one smooth scroll instead of queueing jumps. Scrolling the note yourself stops it.
- Leaving the panel (pointer out, Esc, outside click, panel switch) after a preview scrolls the note back to exactly where it was before the first preview.
- **Click** (or tap) a heading: the note scrolls there, the heading flashes, the cursor goes to the end of the heading line (Live Preview and Source), and the panel closes unless pinned.
- Keyboard: Up, Down, Home and End move and preview like hovering, Enter or Space jumps.
- In Reading view the smooth preview relies on an internal part of Obsidian; if it is missing, the note jumps without animation.

### Bookmarks

**This note** lists the notes pinned to the current note, in the order of its pins property (`pins` unless changed in the settings).

- The property is a list of links written through Obsidian's frontmatter API: you never need to edit it. Links use the shortest unambiguous form, and Obsidian updates them when a pinned note is renamed (depending on **Settings → Files and links → Automatically update internal links**).
- Entries that do not lead to a note (a typo, a deleted note) are not shown and never removed. Every change is applied to the entries actually in the file, so edits made elsewhere meanwhile are kept.
- Obsidian rewrites the properties in its own YAML style when it saves them. Removing the last pin removes the property, unless unresolved entries remain.
- The current note, duplicates and non-Markdown files are never listed.
- **Pin a note here** opens a search in the panel: recent notes first, then fuzzy matching on the note name (and, lower, the folder). Up and Down move, Enter pins, Esc closes the search.

**Vault** lists the vault pins, the same on every note, saved in Snailkit's settings. **Pin current note** adds the current note, or removes it when it is already there. Renaming or moving a pinned note or its folder updates the pin; deleting the note removes it.

On both lists:

- Click a pin to open it in the same pane; Ctrl or Cmd click, or middle click, opens a new tab. Clicking the current note only closes the panel.
- Hover a pin while holding Ctrl or Cmd to see Obsidian's page preview (core plugin **Page preview**; the source is listed as Snailkit: Note rail).
- Drag a pin up or down to reorder (on touch screens, hold it first). Esc during a drag puts it back. A pin only moves within its own list.
- The x button removes a pin, never the note itself.
- Keyboard: Up and Down move, Enter opens, Delete or Backspace removes, Alt+Up and Alt+Down reorder.

### Open tasks

- An open task is a list item with an empty box: `- [ ]`, `* [ ]`, `+ [ ]`, `1. [ ]`, `1) [ ]`, at any indentation, also in quotes and callouts. `[x]` and other statuses (`[-]`, `[/]`, `[>]`) are not open. Tasks in the properties and in code blocks are ignored.
- Groups, in order: **This note**, then each note pinned to it (if **Include notes pinned to this note**), then each vault pin not listed yet (if **Include vault pins**). Empty groups are hidden. Each group folds with its arrow; clicking a pinned note's name opens it.
- The full text is shown and rendered like in Reading view (links, emphasis, tags). Nested tasks are indented. A `📅 2026-10-12` date shows as a chip: overdue (in red), today, tomorrow, or the short date.
- **Checking** a task (its circle, or Space) turns `[ ]` into `[x]` on that line and nothing else. If the note is open in an editor, the change goes through it, so Ctrl+Z undoes it. Otherwise the file is written directly, after checking that the line is still the same task; if it changed, nothing is written and a message says so.
- **Clicking** a task (or Enter) opens its note at that line. Ctrl or Cmd click, or middle click, opens a new tab.
- The list follows edits of the listed notes, undo included.
- **With the Tasks module on**, a line at the top sums up the vault: the tasks overdue and those due today (a count at 0 is left out, both at 0 leave only the link). Each count opens the Workbench on Today (overdue included). **Open in Workbench**, in the panel's footer, opens it on all tasks. These counts and the badge use the Tasks module's tasks (tasks with a tag), open ones only, and follow every change and the turn of the day. Without the Tasks module, the badge counts the open tasks of the current note.

### Brainstorms

Shown when the **Brainstorm** module is on (the lightning button, above the panel buttons). The button is lit on an open brainstorm and carries an orange dot while brainstorms wait to be sorted.

- **New brainstorm** starts a brainstorm and opens it.
- **Close this brainstorm** (on an open one) opens its summary, which offers to close it; **Reopen this brainstorm** (on a closed one) removes the closing line.
- **To sort**: up to 5 brainstorms waiting to be sorted (open, with tasks without a tag or lines to decide), newest first, with their counts. Click one to open it; Ctrl or Cmd click, or middle click, opens a new tab.
- **Open in Workbench**, in the panel's footer, opens the Workbench on its Brainstorms tab.

### Tasks and Brainstorm buttons: hover and click

With **Open on hover** on (computer, mouse), hovering the Tasks or the lightning button shows its panel, and a **click opens the Workbench** on the matching tab. With the keyboard (Enter or Space), or with Open on hover off, and on phones, the button opens its panel as before. Both panels have **Open in Workbench** at the same place, in their footer.
- Keyboard: Up and Down move, Home and End jump, Enter or Space runs (Ctrl or Cmd Enter: a new tab).

### Calendar

- **Where daily notes are**: **Folder**, **Date format** and **Template** when filled in, otherwise the options of the core **Daily notes** plugin, otherwise the vault root, `YYYY-MM-DD` and no template. A note is a daily note when its path is exactly `<folder>/<date in that format>.md` (`2026-10-02 notes.md` does not count). Formats with slashes (`YYYY/MM/YYYY-MM-DD`) put notes in sub-folders.
- Opens on the month of the current note when it is a daily note (that day gets a ring), otherwise on the current month.
- Always 6 weeks of 7 days, starting on **First day of the week**, the days of the neighboring months faded. **Week numbers** are ISO 8601 (the week of the row's Thursday).
- Today is filled with the accent color. A dot under the number: the day has a note. A colored dot in the corner (**Mark days with open tasks**): its note has at least one open task.
- Month and day names follow Snailkit's language. The bottom line describes the hovered or focused day, otherwise the month.
- The arrows, the mouse wheel (one month per gesture) and Page Up / Page Down change the month; it slides in from the side you move to. **Today** comes back to today's month; clicking the month name too.
- Click a day with a note to open it (Ctrl or Cmd click, or middle click: new tab). Click a day without one to create it, then open it. With **Ask before creating a daily note**, a small confirmation appears in the panel first.
- A new daily note gets its missing folders, then the template's text with `{{title}}`, `{{date}}`, `{{date:FORMAT}}`, `{{time}}` and `{{time:FORMAT}}` replaced. Dates are the clicked day, not today. A missing template gives an empty note. An existing note is never overwritten.
- Keyboard: arrows move by a day or a week, Home and End go to the start and end of the week, Page Up and Page Down change the month (with Shift, the year), T jumps to today, Enter or Space opens or creates.
- **Open today's daily note** works the same way, in the active pane, without asking.

### What it writes

Only the pins property of a note when you pin, unpin or reorder its pins, the box of a task you check, and new daily notes (with their folders). Nothing else in your notes changes. Vault pins live in Snailkit's settings.

### Known limits

- Pinned panels are forgotten when the module restarts (turning it off and on, changing Snailkit's language).
- Live Preview: the highlight of a previewed heading sits slightly high on some themes.
- With **Readable line length** off and a narrow pane, the rail can overlap the start of the text; Make room only uses the space the pane has.
- Touch screens: the panels work with taps; dragging pins needs a long press first.
