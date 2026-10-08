[Snailkit](../README.md) · **For developers**

# For developers

Snailkit's public API lets companion plugins read and update tasks, share tool services and add Workbench tabs.

## Tasks

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
| `taskNote?.read(key)` | `Promise<string \| null>` | Reads the task note body below its breadcrumb. Null when the task, service or note is missing, or the module has stopped. |
| `taskNote?.write(key, body)` | `Promise<boolean>` | Writes the body, creating the note and its 📝 link when needed. False when the task or service is missing, or the module has stopped. |
| `addViewAction(get)` | remove function | Puts a button in the header of the task list. `get()` returns `{ icon, label, text?, state?, onClick }` as it is now (or null to hide it); it is read again at each redraw. `state`: `"busy"` turns the icon, `"error"` colors it. `text` shows next to the icon when the list is a page. |
| `addViewTab(tab)` | remove function | Adds a [Workbench](workbench.md) tab after Snailkit's own tabs (Home, Tasks, Brainstorm). `tab` is `{ id, icon, label, count?, countTone?, mount }`; `icon` is a Lucide name, `label` is already translated, and `count()` returns a number or null. Optional `countTone?(): "warn" \| null` colors the count like overdue task counts when it returns `"warn"`. Ids start with a letter and contain only `a-z` and `-`; `home`, `tasks` and `sessions` are reserved. Invalid or duplicate ids and a stopped module return a no-op remover. The tab goes away when the remover runs or when the Tasks module stops. |
| `refreshViews()` | nothing | Redraws the open views soon, after a button or tab changed. |
| `openWorkbench(options?: { tab?: string; scope?: "all" \| "today" })` | `Promise<void>` | Reveals the Workbench used last (page or side panel), or opens a page. Selects `tab` when registered, otherwise Tasks. Applies the optional scope only on Tasks; Today includes overdue tasks. Quietly does nothing after the module stops. |
| `openTag(tag)` | `Promise<boolean>` | Opens the list as a page on one tag and its sub-tags. |

`ViewTab.mount(el, host)` receives an empty content area and a `ViewTabHost`: readonly `layout` (`"page"` or `"side"`), `open(path, line, event?)` (0-based line or null for the top, Ctrl/Cmd opens a new tab), and `refresh()` to request an update soon. It returns a `ViewTabInstance` or nothing. The instance's optional `update()` runs on view refreshes, including vault changes, `refreshViews()` and `host.refresh()`; keep focus and scroll when updating. Its optional `destroy()` runs when switching away, changing layout, removing the tab or closing the view. Showing it again mounts a fresh instance. Call the remover when your module or plugin stops. The host is the Workbench's, which has more members (see [the Workbench contract](#workbench)); `layout`, `open` and `refresh` keep their meaning. Tabs sit in the view header, hidden when only one tab exists. Tab reaches the selected button; Left/Right selects and focuses the adjacent tab (wrapping), and Enter or Space activates it. Warning counts use the same `is-warn` color as overdue task counts. A one-time hint disappears on click, tab change or after eight seconds; its seen state is saved internally, with no settings control. The commands **Open the workbench: tasks** and **Open the workbench: today** select Tasks or its Today scope; the existing page and side-panel command ids stay unchanged.

A `TaskInfo` is a copy of what the task says: `path`, `line` (0-based), `raw` (the whole line), `key` (group tag and words, stable when priority or dates change and when the task moves to another note), `text`, `title`, `plainTitle`, `description`, `tag`, `tags`, `priority`, `due`, `done`, `doneDate`, `markers`.

`description` is the task's indented block text without checkbox lines or fenced code, with common indentation and leading/trailing empty lines removed, joined by `\n` (empty string when absent).

`TaskInfo.notePath: string | null` is the vault path of the note linked by `[[target|📝]]`, resolved by `app.metadataCache.getFirstLinkpathDest(target, task.path)`. It is null when there is no link or the destination does not exist. Short targets, full vault paths and targets ending in `.md` are accepted; only the exact alias `📝` identifies a task note. The link stays out of `title`, `plainTitle` and the task key.

`taskNote` is an optional, compatible addition to version 1: check for it before use. Both methods find open or done tasks by their current key and delegate to the task notes service. The note body is separate from the indented `description`; its breadcrumb is managed by Snailkit. Service errors reject the promise.

A **location** is `{ path, line, raw }`: any `TaskInfo` works. Every location-based write finds the line again first and resolves to the task as written (with its new `line` and `raw`), or to `null` when nothing was written (line gone or ambiguous, invalid value, module turned off). These writes show no notice; the caller decides what to say. Use the returned task for the next call: the old `raw` no longer matches.

**Markers** link a task to something else without changing what the user sees: `setMarker(task, "sync", "a1b2")` writes `%%sync:a1b2%%` (hidden in Reading view), read back in `markers.sync`. Names use `a-z`, `0-9` and `-`; values use letters, digits, `_`, `.` and `-`. The marker stays with the line when the task is renamed, moved to another tag or completed.

## Workbench

Companion plugins add a tab through the Tasks API (`addViewTab`, see [Tasks](#tasks)); the tab then lives while the Tasks tool is on. The full contract of a tab and of its host is in [`src/core/workbench/types.ts`](../src/core/workbench/types.ts). Besides `layout`, `open(path, line, event?)` and `refresh()`, a tab's host has:

| Member | What it does |
| --- | --- |
| `leaf` | The Workbench's leaf. |
| `transient` | True when the Workbench stands in a new tab: opening a note replaces it (unless its tab is pinned). |
| `state` | The state the tab saved last in this Workbench (`{}` at first). |
| `saveState()` | Saves the tab's state (its `getState()`) with the workspace. |
| `navigate(state)` | Saves it as a step that the back and forward arrows return to (they call the tab's `setState`). |
| `select(tabId, state?)` | Shows another tab of this Workbench. |

The tab's instance may also have `getState()`, `setState(state)`, `focus()` and `busy()` (true while the user types: a change of layout waits). When the back and forward arrows, or an opening with a state, bring a state for the tab already shown, `setState(state)` receives it; a tab without `setState` is mounted again with that state as `host.state`.

## Brainstorm

While enabled, the module publishes this service, read by Note menu's lightning panel. Defined in [`types.ts`](../src/modules/sessions/types.ts):

```ts
interface SessionsService {
	version: 1;
	isSession(file: TFile): boolean; // a brainstorm, open or closed
	isClosed(file: TFile): boolean;
	start(): Promise<void>;          // creates a brainstorm and opens it
	close(file: TFile): void;        // opens the summary, which offers to close
	reopen(file: TFile): void;
	pending(): number;               // open brainstorms with untagged tasks or lines to decide (archived ones left out)
	list(): Array<{                  // every brainstorm except the archived ones, newest first
		path: string;
		title: string;
		created: number;               // when it began (ms)
		state: "open" | "to-sort" | "closed";
		tasks: number;
		undecided: number;             // lines kept to decide
	}>;
	onChange(callback: () => void): () => void; // returns an unsubscribe function
}
```

Reach it with `app.plugins.plugins.snailkit?.api.service("sessions")`. `list()` returns what the module already read from the brainstorms (no new read of the vault). `onChange` callbacks run once per burst of changes (a brainstorm edited, created, renamed, closed, reopened or forgotten). The module also triggers the workspace event `snailkit:services-changed` when a brainstorm is created, closed, reopened or forgotten.

## Tags

The module publishes this service while enabled, defined in [`api.ts`](../src/modules/tag-colors/api.ts):

```ts
interface TagColorsAPI {
	readonly version: 1;
	classes(tag: string): string;
}
```

Use `ctx.service<TagColorsAPI>("tag-colors")` inside a module, or `app.plugins.plugins.snailkit.api.service("tag-colors")` from a companion plugin. Pass a tag without `#`, such as `project/website/design`. The returned space-separated classes set `--sk-tag-r-bg`, `--sk-tag-r-fg`, `--sk-tag-l-bg`, and `--sk-tag-l-fg` on any element for the current theme. The first pair represents its family; the second represents its own body. The service supplies colors only, not capsule markup.

Re-read the service and replace previously applied classes when `snailkit:services-changed` fires, or use `ctx.onServicesChange`. This event also fires when colors change. Do not retain the service after disable. Its dynamic CSS disappears when disabled; remove your saved classes and provide your own normal appearance when the service is absent. Theme changes select the matching CSS automatically.

## Note menu and Home pins

The `note-rail` service keeps `version: 1` and its existing `vaultPins()`, `isPinned()`, `setPinned()`, `onPinsChange()` and `dailyConfig()` members. Additions:

| Member | Behavior |
| --- | --- |
| `listPins()` | Detached `{ loose: string[], folders: { id, name, pins: string[] }[] }` snapshot. |
| `removePin(path)` | Removes a pin, including folder membership. |
| `movePin(path, index, folderId?)` | Moves an existing pin to its final zero-based index. Omit the folder or pass `null` for loose pins. Indices are clamped; `Infinity` appends. A missing destination is a no-op. |
| `createPinFolder(name)` | Returns the stable ID, or `null` for a blank name or a stopped service. |
| `renamePinFolder(id, name)` | Trims the name; blank names are ignored. |
| `deletePinFolder(id)` | Keeps the pins, appending them to the loose list. |
| `movePinFolder(id, index)` | Reorders folders using a final zero-based index. |

All mutations return promises and save only module settings. `onPinsChange` also covers folder creation, rename, deletion, membership and ordering, including settings received from another device. Its return value unsubscribes. Writes through a stopped service are ignored. New pins must resolve to an existing vault file.

`src/modules/home/pins-row.ts` exports a component ready for the Home owner to mount:

```ts
const pins = mountPinsRow(container, rail, {
	openNote: (path, event) => openNote(path, event),
	t: (key, vars) => t(key, vars),
	dot: (path) => colorForNote(path), // Optional CSS color or null.
	toast: (message, options) => toast(message, options), // Optional shared ToastOptions.
});
// Service changes update it automatically. Refresh dots or external display changes explicitly:
pins.update();
// Before replacing the view, or when the note-rail service disappears:
pins.destroy();
```

Pins are small tokens with an x on hover or focus; folders open a popover. The same context actions and keyboard moves work in both surfaces. Passing `toast` enables Undo after removal, restoring the previous position and folder if it still exists. Undo never overwrites a pin added meanwhile, and a deleted or renamed path is not re-created. The owner supplies translations through `t`; missing keys fall back to English. Home can copy these keys from the four Note menu language tables: `pins.new-folder`, `pins.rename-folder`, `pins.delete-folder`, `pins.folder-name`, `pins.remove`, `pins.removed`, `pins.undo`, `pins.loose`, `pins.move-to` (`{name}`), `pins.move-up`, `pins.move-down`, `pins.save`, `pins.cancel`, `pins.error`, `pins.empty`. Shared styles live in `src/styles/65-pins.css`.

## Search

The `search` service (version 1) publishes `open(options)`, `attach(host)` and asynchronous
`query(text, options)`. Inline hosts retain ownership of their input and containers; `destroy()`
removes Search's listeners and rendered elements. Disabling Search closes its windows, cancels
its pending work and removes the service.

## Showcase scenes

See [Showcase scenes](showcase.md) for the contract used by each tool's animated scene.
