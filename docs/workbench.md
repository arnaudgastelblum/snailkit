[Snailkit](../README.md) · **Workbench**

# Workbench

One window for the tools that need room: Home, Tasks and Brainstorm, each in its own tab, as a page or in the side panel.

## What it does

The Workbench is a view of Snailkit itself, not of one tool. Its tabs come from the tools that are on, always in this order:

| Tab | Tool | Page |
| --- | --- | --- |
| **Home** | Home | [home.md](home.md) |
| **Tasks** | Tasks | [tasks.md](tasks.md) |
| **Brainstorms** | Brainstorm | [sessions.md](sessions.md) |

A tab exists only while its tool is on: turn a tool off and its tab goes away at once, turn it on again and the tab comes back (the Workbench shows it again if it was the one you were using). Tabs added by companion plugins come after these three. When no tool with a tab is on, the Workbench says so and offers a button to Snailkit's settings.

The tabs sit in Obsidian's own view header, next to the back and forward arrows, with a small count next to some of them (open tasks, brainstorms to sort in orange). Where that header is hidden, as in the side panel, they sit in a slim row on top. With a single tab, the row is hidden.

## How to use it

- Open it from a tool: the Tasks ribbon icon or **Snailkit: Open the workbench as a page**, **Snailkit: Open the workbench: brainstorms**, the lightning and task buttons of Note rail, or **Open in Workbench** at the bottom of their panels.
- Click a tab, or press `Alt+1`, `Alt+2`, `Alt+3`... to show the first, second, third tab from anywhere in the Workbench, also while typing in a field (on macOS, `Option` and a digit type their character in a field, so press them outside it). In the tab row, `←` `→` move between tabs.
- Obsidian's back and forward arrows (and `Ctrl+Alt+←` `→`, `Cmd+Alt+←` `→` on macOS) go back to the tab shown before, and to the previous page of a tab that has pages.
- You can open several Workbenches: one as a page and one in the side panel, or one in a pop-out window. Each one remembers its tab and the state of each tab (for example the Tasks view it shows), also when Obsidian restarts.

### Opening by itself

The Home tool's setting **Open the Workbench** decides whether the Workbench opens by itself:

- **At startup and in new tabs** (default): when Obsidian starts, the Workbench is the first tab, pinned, on Home. A new empty tab (`Ctrl+T` or `Cmd+T`, or closing the last tab) shows Home too, like a browser's start page: open a note from it and the note takes its place.
- **At startup**: only when Obsidian starts.
- **Never**.

Phones follow the same setting.

## Settings

The Workbench has no settings of its own. **Open the Workbench** is a setting of the [Home](home.md) tool; without Home, the Workbench never opens by itself.

## Exact behavior

- **Page or side panel.** The Workbench is laid out as a page from 760 pixels wide, as a side panel below. While you type in a field of a tab, a change of width waits until the field loses the focus.
- **Which tab shows.** The one you chose last in this Workbench. If its tool is not on (yet), the first tab shows meanwhile, and yours comes back as soon as its tool starts, unless you chose another tab in between.
- **Opening the Workbench from a tool** reuses the Workbench you used last (page, side panel or pop-out window), else opens a page. The tab asked for is selected; the Workbench takes the focus.
- **Opening a note from a tab** reuses a tab that already shows the note; otherwise, from a Workbench in the main area, the note opens in a new tab so the Workbench stays. `Ctrl`/`Cmd` always opens a new tab. From a Workbench standing in a new tab, the note opens in its place, and the back arrow comes back to the Workbench; once you pin that tab, it keeps the Workbench and the note opens in a new tab.
- **At startup** (only when Obsidian starts, never when Snailkit is updated or turned on again): a Workbench restored in the main window is reused (a pinned one first), moved to the front of its tab group, pinned and shown on Home; otherwise one is created as the first tab of the main window and pinned. A Workbench in a pop-out window stays as it was. When the only tab of the main area is empty, it becomes the Workbench. Your other tabs stay, except Workbenches left in new tabs by the last session: they close (the startup Workbench stands for them), and with **Never** they become empty tabs again. On a computer, what you type while it opens never lands in the note Obsidian restored: it goes to the Home search once the Workbench is up (Enter, Backspace, Delete and Tab typed in that moment are dropped). If another plugin already opens a page at startup (a home page plugin, for example), turn one of them off.
- **New tabs**: only an empty tab of the main area or of a pop-out window that is still empty and active an instant later becomes a Workbench. A tab opened to show a note is never replaced, and nothing happens in the side panels.
- **Focus.** On a computer, the Workbench puts the focus where typing goes (the search of Home, the task list, the Brainstorm tab, where `/` reaches the search). On a phone it does not, so that the keyboard does not pop up.
- **Clock.** The tab shown is drawn again every minute, so that relative times ("5 min ago") and "today" stay right, past midnight too.
- **Hint.** The first time several tabs show, a short bubble explains them; it is shown once.
- **Saved layouts.** The Workbench keeps the internal name of the former task list (`snailkit-tasks`), so workspaces saved before it became Snailkit's own view open as they were, on the same tab and the same Tasks view.

## For developers

Companion plugins add a tab through the Tasks API (`addViewTab`, see [tasks.md](tasks.md#for-developers)); the tab then lives while the Tasks tool is on. The full contract of a tab and of its host is in [`src/core/workbench/types.ts`](../src/core/workbench/types.ts). Besides `layout`, `open(path, line, event?)` and `refresh()`, a tab's host has:

| Member | What it does |
| --- | --- |
| `leaf` | The Workbench's leaf. |
| `transient` | True when the Workbench stands in a new tab: opening a note replaces it (unless its tab is pinned). |
| `state` | The state the tab saved last in this Workbench (`{}` at first). |
| `saveState()` | Saves the tab's state (its `getState()`) with the workspace. |
| `navigate(state)` | Saves it as a step that the back and forward arrows return to (they call the tab's `setState`). |
| `select(tabId, state?)` | Shows another tab of this Workbench. |

The tab's instance may also have `getState()`, `setState(state)`, `focus()` and `busy()` (true while the user types: a change of layout waits). When the back and forward arrows, or an opening with a state, bring a state for the tab already shown, `setState(state)` receives it; a tab without `setState` is mounted again with that state as `host.state`.
