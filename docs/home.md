[Snailkit](../README.md) · **Home**

# Home

The first tab of the [Workbench](workbench.md): today, your pins, a map of your notes (or your domains, or your tags) and what you opened lately, filled in from your notes. It replaces the index note you used to keep up to date by hand.

## What it does

Home is one calm column, read like a table of contents:

- **Search** at the top, the cursor already in it (with the [Search](search.md) tool on). Typing replaces the page with the results; Esc brings the page back.
- **Today**: today's daily note (created from your template when missing), the tasks overdue and due today, the brainstorms waiting to be sorted, the tasks left in older daily notes, and **New brainstorm** (with the [Brainstorm](sessions.md) tool on). A chip with nothing to say is not shown.
- **Pins**: the vault pins of the Note rail's Bookmarks panel, the same list and folders (with Note rail on). The × of a pin removes it (with Undo), dragging reorders, a folder opens in a small popover, a right click gives the menu (move, folders).
- **Map · Domains · Tags**: three views of your vault. Home opens on the Map until you pick another view; then it opens on the one you picked last.
  - **Map**: the tree of your notes drawn from left to right, unfolding as you hover or move with the arrow keys, four levels deep; a tree you tap on phones and in narrow views. On a computer, drag a note to move it (see below); a right click on a note gives **New note here**.
  - **Domains**: one block per domain, in up to three columns, with its color, its open tasks and its latest notes. A domain is a note that other notes sit under (a summary note, or MOC); a **sub-MOC** is a note of a domain that has notes of its own. The ⋯ menu of a block (or a right click) arranges them.
  - **Tags**: every tag, the most used first, with their sub-tags.
- **Recent**: the last ten notes you opened on this device (opened, not modified), grouped Today, Yesterday, This week, Earlier.

Clicking a domain, a sub-MOC, a tag or the older daily notes opens a **page** in the tab, with a breadcrumb: a domain page lists its sub-MOCs, its notes (most recent first), its open tasks (check them in place) and its brainstorms, with **Open the note** and **See on the map**; a tag page lists its tasks, then its notes as cards, with its sub-tags on top.

Home writes in a note only when you move it or create it on the Map, and then only its `up` property (see below). The order of the domains and of the notes, the groups and what you hide are kept in Snailkit's settings.

### Moving and creating notes on the Map

- **Change the order**: drag a note onto the top or bottom third of a neighbor (a line shows where it lands). The order is kept in Snailkit's settings, per parent; notes you never placed come first. Under the home page, this is the order of the domains, the same as in the Domains view.
- **Move a note under another**: drag it onto the middle of a neighbor, or anywhere on a note of another column (that note lights up). Hold it still a moment over a folded note to unfold it and go deeper. Near the edges, the Map and the page scroll. What lights up or the line is exactly what the release does; Esc cancels. Home writes `up: "[[Other note]]"` in the moved note's properties; a toast offers **Undo**, which puts back the value it had, or no property at all. If the note already names its parent with `parent`, `parents`, `moc` or `mocs`, that property is changed instead of adding `up`. The body of the note is never changed. A note cannot go under itself or under a note below it.
- **New note here**: a right click on a note creates a note in the same folder, with `up` toward it, and opens a name field on the Map. **Enter** keeps the name, **Esc** removes the note (while it is still empty).

### Where each note sits

One rule, shared by Home, the Map, Search and the Note rail's area pill:

- A note has at most one parent: the note named by its `up` property (or `parent`, `parents`, `moc`, `mocs`), else the first `[[link]]` within the first three lines after its properties.
- Following parents up gives the note's chain. The **home page** is the top note that more than half of the linked notes lead to (or the note chosen in the settings). Its children that have children are your **domains**. Without a home page, the domains are the notes at the top of their chains that have children.
- A tree that does not lead to the home page holds no domain and is not on the Map; the Note rail's area pill still shows its top note.
- A note without a parent is in no domain and not on the Map. Loops are cut. Notes in ignored folders stay out.

To make a domain: create a note such as **Clients**, link it from your home page, then add `up: "[[Clients]]"` to the notes that belong to it (or put that link in their first three lines).

## How to use it

1. Turn on **Home** in **Settings → Snailkit**. Turn on **Search**, **Tasks**, **Brainstorm** and **Note rail** too for the full Home: each part shows up when its tool is on.
2. Home opens at startup and in new tabs (see the settings), or with the house ribbon icon or the command **Snailkit: Open Home**.
3. Move with the mouse or the arrow keys: a rounded cursor glides from line to line in the domain's color.

| Key | Effect |
| --- | --- |
| `/` | Search (from a page: back to Home first) |
| `↑` `↓` `←` `→` | Move; `↓` from the empty search field enters the page |
| `Tab` | Next section (one stop per section) |
| `Enter` | Open (a note, a page) |
| `Ctrl+Enter` (`Cmd+Enter`) | Open in a new tab (middle click too) |
| `P` | Pin or unpin the note under the cursor (with Note rail) |
| `Space` | Check the task under the cursor |
| `T` | Today's daily note (from a line of the page) |
| Any other character | Typed on Home itself (after `Esc` in the empty search field, or a click on an empty spot), it starts a search with it, `T` included: a word typed there never lands in a note |
| `Esc` | Up one level: sub-MOC page, domain page, Home, search field |
| `Shift+F10`, menu key | The ⋯ menu of the domain under the cursor |
| `Alt+1` `Alt+2` `Alt+3` | Workbench tabs |
| `?` | Every shortcut, with those of the Map and of Search |

On the Map: `↑` `↓` in a column, `→` unfolds and goes in, `←` back to the parent, `Enter` opens, `Enter` held recenters, double-click recenters, `Esc` goes up one level. When a branch reaches the fourth level, the home page folds into a small round button on the left (its name moves to the line above): click either to bring it back.

**Arranging the domains** (⋯ menu, right click, or drag a block on a computer): move up or down, put first (full width at the top), move to a group (create one, rename or delete it there or with a right click on its heading), pull a sub-MOC out into its own block, open the note, hide. Hidden domains are listed at the bottom of the Domains view and of the Map.

Obsidian's back and forward arrows go back to the previous page of Home.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Open the Workbench | At startup and in new tabs | **At startup and in new tabs**: when Obsidian starts, the Workbench is the first tab, pinned, on Home, never twice (restored tabs stay); a new empty tab (`Ctrl+T`, closing the last tab) shows Home with the cursor in the search, and a note opened from it takes its place. **At startup**: only when Obsidian starts. **Never**. Phones follow the same setting. |
| Home page | empty | The root of the Map and of the domains, as a note path (`Home.md`). Empty: the home page found by the rule above (the settings show which). |
| Ignored folders | empty | Folders whose notes stay out of the Map, the domains and the Note rail's area pill, comma separated (`Templates, Archive`). |
| Hidden domains | | **Show them** brings every hidden domain back. |
| Arrangement | | **Reset the arrangement** forgets the order of the domains and of the notes on the Map, the groups, first domain, pulled-out sub-MOCs and hidden domains. **Reset to defaults** keeps them. |

The home page and the ignored folders apply to all of Snailkit while Home is on (the Note rail's area pill included), and go back to the automatic rule when Home is off.

## Exact behavior

- **Order of the domains**: the most recently active first (the latest change in the domain or below it), until you move one; then the order you made is kept, and new domains come after it. Renaming or moving a note keeps its place, group and state; deleting it forgets them. An empty group goes away.
- **A block** shows its sub-MOCs (each followed by its notes), then its other notes, most recent first: 4 lines, 6 for the first domain, then **N more**, which opens the domain page. Brainstorms are not listed in the blocks (they have their own tab) but appear on the Map and on the domain page. The count is the open tasks of the domain and everything below it; a pulled-out sub-MOC counts its own. A block with no line left says why: only brainstorms, its sub-MOCs pulled out into blocks of their own, or both.
- **A note's line** shows its title without a leading date (`2026-10-01 Pilot review` shows `Pilot review`, with the date on the right), or how long ago it changed.
- **The Map** shows the domains under the home page in the order of the Domains view (hidden ones left out, with the group names), then elsewhere the notes that have notes first, then the others from the most recent, then the brainstorms, unless you dragged them into an order of your own; at most 8 per node, then **N more**: hover it a moment, click it, or press `Enter` or `→` on it, and the column shows every child in place (the Map grows taller, and a very long column scrolls); it folds back when you open another branch. The page of a domain stays in the right-click menu. At first, the branch of the note you opened last is unfolded (four levels at most), else three columns. Four columns at most: further down, `→` or a click on the recenter button slides the Map. While the pointer is on the Map, the folded home page stays folded so that the columns do not move under it; it comes back when the pointer leaves.
- **Moving a note** rewrites its properties through Obsidian, which may reformat them (a list written `[a, b]` becomes one item per line). Dragging is for computers (mouse); on phones, **New note here** comes with a long press.
- **Today**: overdue is an open task due before today; older daily notes are the daily notes (Note rail's Calendar settings, else Obsidian's Daily notes settings) dated before today. Its chip opens a page of their open tasks, grouped by note.
- **Recent** notes are kept per device (in Obsidian's local storage, never synced), at first taken from Obsidian's own list of last opened files.
- **Without a tool**: no search field without Search, no task chips or task lists without Tasks, no brainstorms without Brainstorm, no Pins row without Note rail (`P` then says so), tags in neutral colors without Tag colors. Each part comes back as soon as its tool is on.
- **Phones**: one column, the domains folded into headers (tap to unfold), the Map as a tree, 44 px targets, no drag (use ⋯), no keyboard hints. Tapping the search field opens Search full screen; the keyboard is not opened by itself.
- **Tablets**: the computer's layout, with the domains open, but no drag and no keyboard hints (`?` still lists the shortcuts when a keyboard is attached); the Map unfolds by a tap.
- **Side panel**: the same column, narrower; the Map is a tree.
