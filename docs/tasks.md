[Snailkit](../README.md) · **Tasks**

# Tasks

Every task with a `#tag`, from all your notes, in one list grouped by tag: check, prioritize, schedule and move them without opening the notes.

## What it does

The list is the **Tasks** tab of the [Workbench](workbench.md), Snailkit's window for Home, Tasks and Brainstorm, as a page or in the side panel. Notes recognized by the Brainstorm module have a small lightning icon beside their name in task rows.

Your tasks live where you wrote them: a meeting note, a project note, today's daily note. Tasks gathers every open checkbox that carries a tag into one list, grouped by tag, and lets you act on it from there:

- **Check** a task: it is ticked in its note, with an Undo button for a few seconds.
- **Prioritize** it (`#high`, `#medium`, `#low`), give it a **due date** (`📅 2026-10-12`), **rename** it, or **move** it to another tag.
- See what is due in the **Today** and **Upcoming** views.
- **Add** a task in a few keystrokes: `Call the bank !1 @tomorrow`.

Nothing is stored apart: every change is written in the note, in plain Markdown that other tools (such as the Tasks plugin) read too.

```markdown
- [ ] Fix the footer #project/website #high 📅 2026-10-12
- [ ] Book the venue #project/party
- [x] Read chapter 3 #reading ✅ 2026-10-01
```

## How to use it

1. Turn on **Tasks** in **Settings → Snailkit**.
2. Click the list icon in the left ribbon, or run **Snailkit: Open the workbench as a page** from the command palette. Right-click the ribbon icon to open it in the side panel instead. An open Workbench keeps the tab it shows; a new one opens on Tasks.
3. Click a task to see its details, tick its box to complete it, right-click it for every action.

The list adapts to its width. In the side panel it is a compact list whose details unfold under the task; its **Open as a page** button shows the Tasks tab of a page Workbench, whatever tab that page showed. As a page it shows a navigator of views and tags on the left, the list in the middle and the details of the selected task on the right.

Keyboard, once the list has the focus:

| Key | Action |
| --- | --- |
| `↑` `↓` (or `J` `K`) | Select the next or previous task |
| `X` or `Space` | Complete the selected task |
| `Enter` | Side panel: show or hide its details. Page: open its note |
| `O` | Open the note at the task |
| `1` `2` `3` `0` | High, medium, low, no priority |
| `T` | Due today (again: no due date) |
| `M` | Move to tag... |
| `F2` | Rename |
| `N` | New task |
| `/` | Search |
| `Z` or `Ctrl+Z` | Undo the last completion or move (while its message shows) |
| `Esc` | Close the details |

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Excluded folders | empty | Comma separated folders whose tasks are left out, for example `Archive, Templates`. The folder of the core Templates plugin is always left out. |
| Flag tags | empty | Comma separated tags that never make a group. With `urgent` here, `- [ ] Call the bank #home #urgent` is listed under #home only. `#high`, `#medium` and `#low` are always flags. |
| Stamp the completion date | On | Checking a task from the list adds `✅ 2026-10-02` at its end. Off: only the box is ticked. |
| New tasks go to | empty | The note where new tasks are written, such as `Inbox.md` (created if missing, folders included). Empty: today's daily note, see [Where new tasks go](#where-new-tasks-go). |

The sort order, the priority filter and the folded groups are chosen in the list itself and remembered.

## Exact behavior

### Which lines are tasks

A line is a task when it is a checkbox list item (`-`, `*`, `+` or `1.`, then `[ ]` or `[x]`, at any indentation) that carries at least one **group tag**: a `#tag` at the start of the text or after a space, not only digits, and not a flag. Lines in the properties (frontmatter) or in code blocks never count, nor notes in an excluded folder. Other statuses (`[>]`, `[-]`...) are ignored.

The **group** of a task is its first tag that is not a flag, lowercased. Other tags stay in its title.

What the list reads in a line:

| In the line | Meaning |
| --- | --- |
| `#high` `#medium` `#low` | Priority. A standalone `⭐` also counts as high. |
| `📅 2026-10-12` | Due date. |
| `✅ 2026-10-01` | Completion date. |
| `⏳` `🛫` `➕` `❌` with a date, `⏰ 14:30`, `↻2`, `%%...%%`, `^block-id` | Kept as they are, not shown. |

The **title** is the text without the group tag, the flags and these tokens. Inline Markdown (code, bold, links) is shown formatted. Checkboxes indented under a task without a tag of their own are its **subtasks**: their count shows on the row, and they can be ticked in the details.

### Groups and views

- **All**: every open task, under its tag. Nested tags sit inside their parent (`#project/website` inside `#project`), each group with the number of tasks it holds, nested ones included. A group folds with a click on its header; folds are remembered (a search shows every group open).
- **A tag** (navigator, or **Focus on a tag...**): that tag and its nested tags.
- **Today**: overdue tasks (oldest first), then tasks due today (highest priority first).
- **Upcoming**: tasks due after today, one section per day.

**Sort** applies inside each group: **Note order** (note path, then line: the default), **Priority** (high to none, then due date), **Due date** (earliest first, no date last, then priority).

**Search** keeps the tasks whose title or note path contains every word typed; a word starting with `#` matches tags that start with it. **Filter** by priority (High, Medium, Low, No priority): several can be on at once; the filter icon of the side panel shows a dot while one is.

### Changing a task

Every change edits the task line in its note:

| Action | Change in the line |
| --- | --- |
| Complete | `[ ]` becomes `[x]`, `✅ today` added (setting), before a block id if there is one. Undo puts the line back exactly. |
| Priority | `#high` `#medium` `#low` and `⭐` removed, the new one added. |
| Due date | `📅 date` replaced where it stands, added, or removed. Quick choices: Today, Tomorrow, Next week (next Monday), or a date picker. |
| Move to tag | The group tag is replaced where it stands. Drag a task onto a group, onto a tag of the navigator, or press `M`. Typing a new tag in the picker creates it. |
| Rename | Only the title changes (in the details, by a double click on the title, `F2` or the menu). When the old title appears once as such, it is replaced in place; else the line becomes the new title followed by every tag and token, in their order. A rename that would remove the group tag is refused. |

New tokens are added before a trailing run of `✅ date`, `↻n`, `%%...%%` and `^block-id`, so tools that expect those at the very end keep finding them.

Dropping a task onto **Today** gives it today as due date.

### Quick add

Press `N`, the **New task** button, or the `+` of a group, type, then `Enter` (the row stays open for the next one; `Esc` closes it).

- `!1`, `!2`, `!3` set a high, medium or low priority.
- `@today`, `@tomorrow` or `@2026-10-12` set the due date. The words of every interface language work too (`@demain`, `@morgen`, `@mañana`...).
- The task gets the tag of its group (from a `+`, or the tag in focus). Typed anywhere else without a tag, it gets `#inbox`. A tag typed in the text wins. Added in **Today**, it is due today unless you set another date.

The line written is `- [ ] text #tag` plus the priority and the due date, for example `- [ ] Call the bank #home #high 📅 2026-10-03`.

### Where new tasks go

1. The note of **New tasks go to**, when set.
2. Else today's daily note, from the folder and date format of the core **Daily notes** plugin.
3. Else, when Daily notes is off, a note named after the module (`Tasks.md` in English, `Tâches.md` in French...) at the vault root.

A missing note is created (empty: your daily note template is not applied). When the note has a heading `## #tag` (any level) for the task's tag, the task goes after the last line of that section; else at the end of the note.

### Opening a task

The **Note** section below the task details shows its source note as read-only Markdown, with the task gently highlighted and brought into view. Its header shows the note name and folder; **Open note** opens it at the task line (Ctrl/Cmd opens a new tab). Links work normally, and preview checkboxes cannot change the note. In the side panel, this section starts collapsed.

Initially, the preview shows at most 40 lines before and after the task. **Show whole note** expands it; **Show task context** returns to the excerpt. An excerpt may cut a Markdown block or omit link definitions; use the whole note for full context. Note changes refresh the preview after a short delay, preserving its scroll position where possible. Selecting another task resets the preview. An unavailable note shows a message instead.

**Open in note** (the arrow of a row, `O`, a double click outside the title) shows the note in a tab that already has it, else opens it (in a new tab when the list is a page, so the list stays), and puts the cursor at the end of the task line. From a Workbench standing in a new tab (see [Opening by itself](workbench.md#opening-by-itself)), the note takes its place, unless you pinned that tab.

### Safety

- Before any change the task line is found again: at its known place if unchanged, else the only identical line of the note. If it is gone or ambiguous, nothing is written and a notice says so.
- A note open in an editor is changed through the editor (one small change, `Ctrl+Z` in the note undoes it); a closed note is changed in one atomic write.
- Line endings are read as `\n` or `\r\n` and written as `\n`.

### Colors

Each tag has a stable color of its own. When the **Tag colors** module is on, its colors are used instead, and the list follows them as you change them.

### Known limits

- Recurring tasks of the Tasks plugin (`🔁`) are shown as plain tasks: completing one does not create the next occurrence.
- Quick add creates a missing daily note empty, without your template.
- Dragging tasks does not work on mobile: use **Move to tag...** from the menu.
- Changing Snailkit's language draws the list again (the module restarts): the scope, the search and the selection are kept.
- Text typed in the quick add row and not added yet stays there when the list redraws, when you switch to another tab of the Workbench and back, or when the Workbench changes between page and panel. `Esc`, or coming back on another scope, drops it.

## For developers

The module shares a small public API while it is on, so that another plugin can read and update tasks. It has no network code and knows nothing of other services.

```ts
const tasks = app.plugins.plugins.snailkit?.api.service("tasks"); // undefined while the module is off
```

Listen to the workspace event `snailkit:services-changed` to know when the API appears or goes away, and ask for it again then. The full typed interface is [`src/modules/tasks/api.ts`](../src/modules/tasks/api.ts). Version 1:

| Member | Returns | What it does |
| --- | --- | --- |
| `version` | `1` | Bumped when a change would break callers. |
| `isReady()` | `boolean` | False until the vault has been read once (a `change` event follows). |
| `getTasks({ includeDone? })` | `TaskInfo[]` | Tagged tasks, in note order; open ones only unless `includeDone`. |
| `find(location)` | `TaskInfo \| null` | The task at that place now (same line, else the only identical line of the note). |
| `getTags()` | `string[]` | Group tags of the tasks and the other tags of the vault (not the flags). |
| `on("change", callback)` | unsubscribe function | Called after any change of the tasks. |
| `setDone(location, done)` | `Promise<TaskInfo \| null>` | Checks or unchecks (with the completion stamp of the settings). |
| `setDue(location, "YYYY-MM-DD" \| null)` | same | Sets or removes the due date. |
| `setPriority(location, "high" \| "medium" \| "low" \| null)` | same | Sets or removes the priority. |
| `rename(location, title)` | same | Changes the title only. |
| `moveToTag(location, tag)` | same | Replaces the group tag (not a flag). |
| `setMarker(location, name, value \| null)` | same | Sets or removes a hidden `%%name:value%%` comment in the line. |
| `addTask({ title, tag, priority?, due?, markers? })` | same | Writes a new open task where quick add writes. |
| `addViewAction(get)` | remove function | Puts a button in the header of the task list. `get()` returns `{ icon, label, text?, state?, onClick }` as it is now (or null to hide it); it is read again at each redraw. `state`: `"busy"` turns the icon, `"error"` colors it. `text` shows next to the icon when the list is a page. |
| `addViewTab(tab)` | remove function | Adds a [Workbench](workbench.md) tab after Snailkit's own tabs (Home, Tasks, Brainstorm). `tab` is `{ id, icon, label, count?, countTone?, mount }`; `icon` is a Lucide name, `label` is already translated, and `count()` returns a number or null. Optional `countTone?(): "warn" \| null` colors the count like overdue task counts when it returns `"warn"`. Ids start with a letter and contain only `a-z` and `-`; `home`, `tasks` and `sessions` are reserved. Invalid or duplicate ids and a stopped module return a no-op remover. The tab goes away when the remover runs or when the Tasks module stops. |
| `refreshViews()` | nothing | Redraws the open views soon, after a button or tab changed. |
| `openWorkbench(options?: { tab?: string; scope?: "all" \| "today" })` | `Promise<void>` | Reveals the Workbench used last (page or side panel), or opens a page. Selects `tab` when registered, otherwise Tasks. Applies the optional scope only on Tasks; Today includes overdue tasks. Quietly does nothing after the module stops. |
| `openTag(tag)` | `Promise<boolean>` | Opens the list as a page on one tag and its sub-tags. |

`ViewTab.mount(el, host)` receives an empty content area and a `ViewTabHost`: readonly `layout` (`"page"` or `"side"`), `open(path, line, event?)` (0-based line or null for the top, Ctrl/Cmd opens a new tab), and `refresh()` to request an update soon. It returns a `ViewTabInstance` or nothing. The instance's optional `update()` runs on view refreshes, including vault changes, `refreshViews()` and `host.refresh()`; keep focus and scroll when updating. Its optional `destroy()` runs when switching away, changing layout, removing the tab or closing the view. Showing it again mounts a fresh instance. Call the remover when your module or plugin stops. The host is the Workbench's, which has more members (see [the Workbench page](workbench.md#for-developers)); `layout`, `open` and `refresh` keep their meaning. Tabs sit in the view header, hidden when only one tab exists. Tab reaches the selected button; Left/Right selects and focuses the adjacent tab (wrapping), and Enter or Space activates it. Warning counts use the same `is-warn` color as overdue task counts. A one-time hint disappears on click, tab change or after eight seconds; its seen state is saved internally, with no settings control. The commands **Open the workbench: tasks** and **Open the workbench: today** select Tasks or its Today scope; the existing page and side-panel command ids stay unchanged.

A `TaskInfo` is a copy of what the task says: `path`, `line` (0-based), `raw` (the whole line), `key` (group tag and words, stable when priority or dates change and when the task moves to another note), `text`, `title`, `plainTitle`, `description`, `tag`, `tags`, `priority`, `due`, `done`, `doneDate`, `markers`.

`description` is the task's indented block text without checkbox lines or fenced code, with common indentation and leading/trailing empty lines removed, joined by `\n` (empty string when absent).

A **location** is `{ path, line, raw }`: any `TaskInfo` works. Every write finds the line again first and resolves to the task as written (with its new `line` and `raw`), or to `null` when nothing was written (line gone or ambiguous, invalid value, module turned off). Writes show no notice; the caller decides what to say. Use the returned task for the next call: the old `raw` no longer matches.

**Markers** link a task to something else without changing what the user sees: `setMarker(task, "sync", "a1b2")` writes `%%sync:a1b2%%` (hidden in Reading view), read back in `markers.sync`. Names use `a-z`, `0-9` and `-`; values use letters, digits, `_`, `.` and `-`. The marker stays with the line when the task is renamed, moved to another tag or completed.
