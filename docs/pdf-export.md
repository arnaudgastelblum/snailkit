[Snailkit](../README.md) · **PDF export**

# PDF export

Export a note to PDF exactly as it looks in Obsidian: your theme, your fonts, your images and drawings, selectable text and clickable links. Desktop only.

## What it does

Obsidian's own export forces a plain print look, and tools that turn pages into pictures lose the text. PDF export renders your note with Obsidian's own engine, the way reading view shows it, then prints that page with the print engine built into the desktop app. Nothing is turned into an image:

- **Your theme travels**: colors, fonts, CSS snippets, callout styling. The print rules that strip your colors are ignored on purpose.
- **Real text**: selectable, searchable, copyable.
- **Drawings and diagrams**: Excalidraw previews in SVG stay vector, Mermaid diagrams and tables are laid out for the width of the paper, charts drawn on a canvas print as they look.
- **Clickable links**: `[[Note]]` opens the note in Obsidian, `[[#Heading]]` jumps inside the PDF, and a click on an image opens its file.
- **Page setup**: size, orientation, margins, scale, page numbers, page breaks where you want them, and PDF bookmarks from your headings.

The note is only read. The module writes the PDF and nothing else.

## How to use it

1. Turn on **PDF export** in **Settings → Snailkit** (desktop app only).
2. Open a note and run **Export current note to PDF** from the command palette, or right-click in the note or on a note in the file explorer and choose **Export to PDF**. You can assign a hotkey in **Settings → Hotkeys** (search for "Snailkit").
3. Choose where to save (the folder you used last is offered first). The PDF opens in your default reader.

To start a new page at a precise spot, put this line alone in the note. It is an Obsidian comment, invisible in reading view:

```markdown
## Budget

%% pagebreak %%

## Planning
```

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Page size | `A4` | `A3`, `A4`, `A5`, `Letter`, `Legal` or `Tabloid`. The note is laid out for the width of the paper, so tables and diagrams re-flow instead of being cut. |
| Landscape | Off | Turns the page on its side. The best first move for wide tables and diagrams. |
| Margin | `15 mm` | The same margin on all four sides, from 0 to 40 mm. With a header or a footer, top and bottom margins are at least 12 mm. |
| Scale | `100 %` | Print scale, from 50 to 150 %. Below 100 everything shrinks and more fits on each page. |
| Page numbers | On | A small centered `page / total` at the bottom of every page. |
| Note name in the header | Off | The note name at the top of every page. |
| Color scheme | Same as Obsidian | **Same as Obsidian**: your current theme, dark included. **Light** or **Dark**: your theme's light or dark variant, for this export only. Use **Light** for paper. |
| Page background | White | **White**: a plain white page, whatever tint the theme gives the note area. **Same as theme**: the theme's own background. A dark color scheme always keeps its own background. |
| Add the note name as a title | On | When the note does not start with a level 1 `#` heading, the note name is added as the title. |
| Page break marker | `%% pagebreak %%` | A line with exactly this text, and nothing else, starts a new page. Empty: manual page breaks are off. |
| Page break before | Never | **Heading 1**: every `#` heading starts a new page. **Heading 1 and 2**: every `#` and `##`. The top of the note never gets a break. |
| Internal links | Open in Obsidian | **Open in Obsidian**: `[[Note]]` links open the note in Obsidian. **Plain text**: they keep their look but do nothing, for a PDF you send to someone else. Links to a heading of the same note always jump inside the PDF. |
| Clickable images | On | Every image that is not already a link opens its file in Obsidian (an Excalidraw preview opens the drawing), or its web page. The image looks the same. |
| PDF outline | On | Bookmarks built from your headings, shown as a navigation panel in PDF readers. |
| Save the PDF | Ask where to save | **Ask where to save**: the system save dialog. **Next to the note**: in the note's folder. **In a vault folder**: in the output folder below. |
| Output folder | `PDF` | Shown only with **In a vault folder**. Created if missing, nested folders included. Empty: the vault root. |
| Open after export | On | Opens the finished PDF in your default PDF reader. |

The folder you pick in the save dialog is remembered for next time. It has no setting.

## Exact behavior

### Command and menus

- **Export current note to PDF** acts on the active Markdown note. **Export to PDF** sits in the editor's right-click menu and in the file explorer's right-click menu, on `.md` files only.
- One export at a time: asking for a second one while the first runs shows `An export is already running.` and changes nothing.
- During the export a notice reads `Exporting <note>...`. It is replaced by `PDF saved: <path>`, or by `PDF export failed: <message>` (details in the developer console).

### The export, step by step

1. **Read and prepare.** The note is read. Its properties (frontmatter) are removed, page break markers become page breaks, and the title is added if needed.
2. **Render.** The note is rendered by Obsidian into a hidden area of the window, exactly as wide as the usable width of the page (`page width - 2 × margin`, orientation included).
3. **Wait for the embeds.** Until the content has stopped changing for just under a second and every image has loaded, for 10 seconds at most. Reaching the limit is not an error: what is rendered gets exported, with the notice `Some embeds may not have finished rendering.`
4. **Snapshot.** The rendered note is copied into one standalone page, with all your stylesheets.
5. **Print.** The page is written to a temporary file in your system's temporary folder, loaded in a hidden window, given up to 5 seconds for its fonts and images, and printed.
6. **Save** where the setting says, then open the PDF if asked.

Whatever happens, everything is cleaned up: the hidden area, the hidden window and the temporary file (which holds the text of your note) are removed as soon as printing is over, after a failure too. Turning the module off during an export cancels it the same way.

### Page breaks

- **Manual**: a line whose content, spaces trimmed, is exactly the marker. Markers inside code blocks are text.
- **Automatic**: only headings that are blocks of the note itself count. A heading inside a callout, a list or an embed never forces a break.
- **Kept together**, always: code blocks, callouts, tables and their rows, math blocks, Excalidraw drawings, image embeds, figures. A page never breaks right after a heading. Long code lines wrap, and images are never wider than the page.

### Images

- **Vault images** are read from the disk at full quality.
- **Data images** (Excalidraw SVG previews, Mermaid) are kept as they are: vector stays vector.
- **Web images** are fetched again when the PDF is printed.
- **Canvas drawings** (charts) are captured as an image at their on-screen size. A canvas that cannot be read (one that drew a web image) becomes a link instead.
- Task checkboxes print checked or unchecked, as in the note.

### Links

| In the note | In the PDF |
| --- | --- |
| `[[Note]]`, `[[Note#Heading]]` | opens the note in Obsidian (`obsidian://open?vault=...&file=...`) |
| `[[Note]]` that resolves to nothing | no target |
| `[[#Heading]]` (same note) | jumps to that heading inside the PDF |
| `[[#^block]]`, `[[Note#^block]]` | no target |
| `#tag` | no target |
| external link | unchanged |

The `obsidian://` link carries the vault name and the file path, so it works on any computer where that vault exists. For `[[Note#Heading]]`, Obsidian opens the note, not the heading.

### Embeds that cannot be printed

Embedded PDFs, videos, audio and iframes become a short paragraph with a link and the file name: an `obsidian://` link for a vault file, the source URL otherwise. Inside an embedded note, only that element is replaced.

### Collapsed content

Collapsed callouts and `<details>` blocks are opened: a PDF cannot unfold. Fold arrows, copy buttons and embed link icons are hidden.

### Theme

- The page reuses the classes and inline style of your Obsidian window: theme, Style Settings choices, font size, and the reading view structure the theme's selectors expect.
- All stylesheets are collected in load order. `@media print` rules and `@page` rules are dropped, `@media screen` rules are applied as they are.
- Pane decorations (borders, rounded corners, shadows, tinted backgrounds) are removed: on paper they would be a frame around the note.

### Saving

- The file is always named `<note name>.pdf`.
- Exporting again **replaces** the previous PDF: in the vault without asking, in the save dialog after your system's confirmation.
- Closing the save dialog without saving ends the export with `Export cancelled.`

### Known limits

- **Desktop only**: printing relies on the desktop app's built-in browser engine.
- **Properties (frontmatter) are not in the PDF.**
- **A table wider than the page is cut**, not shrunk. Try landscape or a smaller scale.
- `[[Note]]` links open Obsidian, they do not jump inside the PDF. How `[[#Heading]]` jumps behave depends on the PDF reader.
- **Two headings with the same text share one anchor**: a link to them lands on the first.
- **The marker must be alone on its line.**
- **A very slow embed can be missing** after the 10 second wait (a notice tells you).
- **A theme may define colors with `@media (prefers-color-scheme)` rules.** Those follow your system's light or dark setting, not the Color scheme setting.
- An embed drawn in a shadow DOM prints empty.
