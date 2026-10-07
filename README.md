# Snailkit

Small, calm tools for your notes. Turn on only the ones you want.

Snailkit is one plugin that holds several small tools. Every tool starts **off**: open the
settings, switch on the ones you need, and each one gets its own short settings page. Turned
off, a tool leaves nothing behind: no command, no button, no background work.

## Tools

**Writing**

| Tool | What it does |
| --- | --- |
| [Brainstorm](docs/sessions.md) | Write your ideas freely in one note, then catch the tasks in it and close with a short summary. |
| [Column select](docs/column-select.md) | Select a column of text and edit several rows at once (Alt+Shift+arrows, Alt+drag). |
| [Move text](docs/move-text.md) | Extract a passage to a sub-note, archive it, or send it to the end of another note, without losing a line. |
| [Slash menu](docs/slash-menu.md) | Type `/` to insert blocks, callouts, snippets or run any command from a menu at your cursor. |
| [Tables](docs/tables.md) | Insert, sort, resize and style Markdown tables with a small toolbar, like in a word processor. |

**Organize**

| Tool | What it does |
| --- | --- |
| [Home](docs/home.md) | The first tab of the [Workbench](docs/workbench.md): today, your pins, your domains, a map of your notes and what you opened lately, filled in from your notes. |
| [Note rail](docs/note-rail.md) | A quiet row of icons on every note: search, where the note belongs, contents, bookmarks, open tasks and a calendar of daily notes. |
| [Search](docs/search.md) | One search for everything: notes, sections, tasks, brainstorms, domains, tags and the text of your notes. |
| [Tag colors](docs/tag-colors.md) | Recognize tag families at a glance with stable colors and compact capsules. |
| [Tasks](docs/tasks.md) | Every task with a `#tag`, from all your notes, in one list grouped by tag: check, prioritize, schedule and move them without opening the notes. |

**Export**

| Tool | What it does |
| --- | --- |
| [PDF export](docs/pdf-export.md) | Export a note to PDF exactly as it looks in Obsidian: your theme, images and drawings, selectable text and clickable links. Desktop only. |
| [Slides to PowerPoint](docs/slides-export.md) | Export the frames of an Excalidraw drawing, in slideshow order, to a PowerPoint file. Needs the Excalidraw plugin. |

## Install

1. In Obsidian, open **Settings → Community plugins → Browse**, search for **Snailkit** and
   install it.
2. Enable Snailkit, then open **Settings → Snailkit** and switch on the tools you want.

Manual install: copy `main.js`, `manifest.json` and `styles.css` from the latest release into
`<your vault>/.obsidian/plugins/snailkit/`, then enable the plugin.

Requires Obsidian 1.8.7 or later. Works on desktop and mobile (a tool that needs the desktop
app says so on its card).

## Languages

The interface is available in English, French, Dutch and Spanish. Snailkit follows Obsidian's
language, or the one you pick at the top of its settings. Other languages fall back to English.

## Privacy

Snailkit works inside your vault and sends nothing about you or your notes anywhere. The only network access is PDF export loading the web images that your note already displays.

## Feedback

Found a problem, or a sentence that is not clear? [Open an issue](https://github.com/arnaudgastelblum/snailkit/issues).

## License

[MIT](LICENSE)
