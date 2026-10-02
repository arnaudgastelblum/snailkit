[Snailkit](../README.md) · **Move text**

# Move text

Extract a passage to a sub-note, archive it, or send it to the end of another note, without losing a line.

## What it does

A note grows. Some parts deserve their own note, some are done and only clutter it, some belong somewhere else. Move text gives you three actions for that:

- **Extract to a sub-note**: the passage becomes a new note (`Project X - Redesign idea`), and a link to it takes its place in a short list at the top of the note.
- **Archive this passage**: the passage moves to the note's archive (`Archives/Project X (archive).md`), under a dated heading.
- **Append to a note...**: the passage goes to the end of any note you pick, or a new one. Tick **Keep the text here** to copy instead of move.

The text is always written to its destination **before** it leaves your note. If anything goes wrong, you get at worst a copy in two places, never a loss.

## How to use it

1. Turn on **Move text** in **Settings → Snailkit**.
2. Select some text, or just put the cursor inside a section (no selection needed: the whole section under the nearest heading is taken).
3. Right-click and choose one of the three actions, or run it from the command palette. You can assign hotkeys in **Settings → Hotkeys** (search for "Snailkit").

After **Extract** or **Archive**, the top of the note looks like this:

```markdown
# Project X

- [[Project X (archive)]]
- [[Project X - Redesign idea]]

A small website redesign...
```

Ctrl+Z (Cmd+Z on Mac) brings the text back into the note. The note it was sent to keeps its copy.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Prefix sub-notes with the note name | On | New sub-notes are named `Project X - Title`, so they sort next to their note. Off: just `Title`. |
| Archive folder | `Archives` | Where archive notes are created (missing folders are created). Empty: the vault root. Existing archives are not moved when you change it. |
| Provenance line | On | Adds a line such as `Extracted from [[Project X]] on 2026-10-02` before the text, in sub-notes, archives and appended notes. |
| Date format | `YYYY-MM-DD` | Format of the dates in provenance lines and archive headings ([Moment.js tokens](https://momentjs.com/docs/#/displaying/format/)). Keep the year first if you want archive headings to sort by date. |

## Exact behavior

### What an action takes

- **With a selection**: Extract and Archive take the selected lines, whole (selecting three words takes their whole line). Append takes exactly the selected text. A selection ending at the very start of a line does not include that line.
- **Without a selection**: the section of the nearest heading above the cursor, down to the next heading of the same or higher level. A `###` sub-section wins over its `##` parent. No heading above the cursor: nothing happens and a notice explains why.
- **Refused**, with a notice: a passage that touches the properties (frontmatter), one that cuts a code block in two, an empty one. A selection entirely inside one code block is fine for Append.

### Extract to a sub-note

The dialog offers **Create: `<name>`** (the first heading of the passage, or its first words, prefixed with the note name when the setting is on) and **Append to: `<sub-note>`** for each existing sub-note. Type to change the title or filter the list.

- Existing sub-notes are the notes named `<note> - ...` and the notes linked in the list at the top (the archive excluded).
- A new sub-note is created in the same folder as the note. Characters that break file names or links (`\ / : * ? " < > | # ^ [ ]`) become `-`.
- When the passage starts with a heading and you kept its text as title, that heading is dropped (the file name carries it) and the other headings move up one level.
- If a note with that name already exists, the text is appended to it. Nothing is ever overwritten.

### Archive this passage

The dialog asks for an optional title. The passage is added at the end of the archive under `## Title (2026-10-02)`, or `## 2026-10-02` without a title. An archive is only ever added to, never rewritten. On the first archiving, the archive note starts with `Archive of [[Project X]]` and a link to it joins the list at the top.

### Append to a note

The dialog lists every note of the vault, recently opened ones first. Type to filter on the path. When the name you type does not exist, **Create: `<name>`** makes the note (a plain name goes next to the current note, `Folder/Name` is taken from the vault root). Alt+K ticks or unticks **Keep the text here**.

The text goes at the very end of the chosen note, after a blank line and `Moved from [[Project X]] on 2026-10-02` (or `Copied from`). A link to that note (`[[Note]]`) is put in your clipboard, ready to paste. No link is added to the current note.

### The list at the top

Consecutive `- [[...]]` lines right after the properties and the `#` title, if any. Move text adds to it, or creates it. A link already there (even with an alias, `[[target|alias]]`) is never added twice.

### Languages

The lines Move text writes in your notes (provenance lines, `Archive of`, the archive suffix) follow Snailkit's language. Archives created in another language are still found: switching from English to Dutch keeps using `Project X (archive)` rather than starting `Project X (archief)`.

### Safety

- The destination is written and confirmed before anything is removed from your note.
- If the note changed while a dialog was open (typing, sync, another plugin), nothing is removed: the copy stays in the destination and a notice tells you.
- Removing the text goes through the editor, so Ctrl+Z restores it.

### Known limits

- The archive folder is flat: two notes with the same name in different folders share one archive.
- Links from other notes to a moved section (`[[Project X#Redesign idea]]`) are not updated and will break. Links inside the moved text keep working.
- Removing a passage can leave an extra blank line. Cosmetic.
