[Snailkit](../README.md) · **Slash menu**

# Slash menu

Insert blocks, snippets and commands without leaving the keyboard.

## What it does

Typing `/` opens a floating menu at the cursor. Search by name, alias, keyword or category, then insert a block or run an Obsidian command. The menu keeps the source plugin's gliding selection, entrance animation, choice pulse and inserted text glow, using Snailkit's theme colors.

Built-in entries cover paragraphs, headings 1 to 3, lists, tasks, quotes, code, horizontal rules, 13 callout types, links, internal links, tables, math, dates, times and new notes. Add your own renamed commands, Markdown snippets and callouts. Pin frequently used entries and keep recently chosen entries near the top.

## How to use it

1. Enable **Slash menu** in **Settings → Snailkit**.
2. If Obsidian's core **Slash commands** plugin is enabled, turn it off or choose a different trigger in this module's settings. Snailkit yields to the core plugin when both use `/`.
3. Type `/` at the beginning of a line or after whitespace. Keep typing to search.
4. Use the arrow keys and Enter, or tap an entry. Tab completes its name; a second Tab runs it. Escape closes the menu and keeps the typed text.
5. In **Menu entries**, add a command, snippet, callout or category. Edit the name, description, icon, aliases, keywords and category, then choose **Save**. Drag entries and categories to reorder them. Arrow buttons offer the same reordering on touch screens and with a keyboard; the entry editor's category selector moves an entry between categories.

The **Open slash menu** command can also be assigned a hotkey. Over a selection, Escape restores that selection; choosing a block or command restores it before running the action. A snippet replaces it, and a callout uses it as its body.

Example snippet:

```markdown
## Meeting notes {{date}}

Project: {{title}}

{{cursor}}
```

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Trigger | `/` | One to three characters, without whitespace. Opens at line start or after whitespace. |
| Descriptions | On | Shows a short explanation beneath entries. |
| Pinned entries | On | Shows pinned entries first. |
| Recent entries | On | Shows the five most recently chosen entries, excluding entries already pinned at the top. |
| Animations | On | Enables menu motion and insertion glow. System reduced-motion preferences take precedence. |
| Menu entries | Built-in entries | Add, rename, reorder, pin, disable, duplicate or delete entries. Rename, reorder or hide categories. |
| Maximum search results | 50 | Limits the ranked search list; the unfiltered category list remains complete. |
| Unavailable entries | Dim | Dims missing commands with an explanation, or hides them. |
| Date format | `YYYY-MM-DD` | Format used by `{{date}}`. |
| Time format | `HH:mm` | Format used by `{{time}}`. |
| Date and time format | `YYYY-MM-DD HH:mm` | Format used by `{{datetime}}`. |
| Reset to defaults | Page reset button | Restores all module settings and built-ins, removing custom entries and recent history. Click again to confirm. |

## Exact behavior

- Search ignores case and accents. Name matches rank exact, prefix, word start, substring, then loose subsequence. Aliases, keywords and category names also contribute; every word of a multiword query can match a different field. Ties preserve configured order. Matching name characters are highlighted. Available results appear before unavailable results within the result limit.
- Hidden categories and disabled entries are excluded from search, pinned and recent sections. Pinned and recent entries also remain in their regular category. Unavailable commands stay open with an explanation when selected.
- The trigger opens only on typing, not paste, and not inside code, math, frontmatter or comments recognized by Obsidian's syntax tree. It does not open inside URLs. The explicit command can open at any editor position. A leading space, two trailing spaces, a query longer than 60 characters, leaving the line, losing editor focus or deleting the trigger closes the menu.
- When the core Slash commands plugin is enabled, Snailkit's automatic trigger and explicit open command both yield for triggers starting with `/`, including `//`. Choose another first character to use Snailkit's menu. The settings page explains the conflict. Snailkit never changes the core plugin's settings.
- Block conversion changes the current line's Markdown marker. Multiline snippets and callouts inserted in the middle of a line get their own line. A horizontal rule gets a preceding blank line where needed to avoid creating a Setext heading.
- Supported variables are `{{date}}`, `{{time}}`, `{{datetime}}`, `{{title}}` and `{{cursor}}`. Date variables accept a Moment format override, for example `{{date:YYYY}}`. The first cursor marker determines cursor placement; every cursor marker is removed. Unknown variable names stay literal. Dates use Obsidian's Moment locale.
- A new note uses Obsidian's default location for new notes, a translated "New note" name, and a numeric suffix when needed. Its link is inserted into the source note and it opens in a new tab. No existing file is overwritten.
- Untouched built-in names, descriptions and categories follow Snailkit's language. Edited or user-created text stays as typed. Stable entry ids preserve ordering, pins and recent history across language changes.
- Stored workflow and drawing actions, plus entries using the removed clipboard or selection variables, are ignored safely. Configuration import/export and integration-specific settings are not included.
- Open menus and animation timers are disposed when the module is disabled or restarted. Pending text insertion is skipped if the original document changed while an asynchronous action was preparing it.

Known limits: removing the trigger and inserting text are separate undo steps. Undoing a new-note link does not delete the created file. Command availability checks whether a command is registered; a command can still refuse to run in the current context. Renaming a built-in through the editor makes its displayed text user-owned. The menu requires Obsidian's CodeMirror Markdown editor. Live visual and mobile behavior should be checked in Obsidian before release.
