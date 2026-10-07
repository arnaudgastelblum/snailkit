# Search

## What it does

Search finds notes, headings, tasks, brainstorms, domains, tags and note text in one place.
It works alone and includes information from other Snailkit modules while they are enabled.

## How to use it

Enable Search in Snailkit settings. Run **Snailkit: Search**, click the rail magnifier, or type
in Home's search field. The command has no default shortcut; you can assign Ctrl/Cmd+O in
Obsidian's hotkey settings.

Type words, `#project/site ` or `in:design ` to narrow your search. A trailing space turns a
filter into a removable token. An exact tag with no other tag starting with the same text also becomes a token without
a space. Backspace at the beginning removes the last token. Use All, Notes, Tasks or
Brainstorms to choose what to show.

- Enter opens the selected result. Ctrl/Cmd+Enter opens a note in a new tab.
- Shift+Enter inserts a link in the note you came from, at its cursor when that note is open in editing mode, otherwise at the top of its body after any YAML properties.
- Down enters the results; Up and Down move between them; Up on the first row returns to the field. Typing on a row edits the query.
- Tab shows additional actions: open beside, pin, unpin, copy link, complete a task, or filter by a tag.
- Escape closes the actions, clears the search, then closes the floating window or returns to Home.

An empty floating search offers today's note (or its creation), recent notes and vault pins.
When nothing matches free text, a Create note row creates a note using Obsidian's new-note folder.
If Omnisearch is running, a final row continues the query there.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Search note content | On | Also searches the text inside notes. Desktop keeps a temporary memory index; phones read on demand. |

## Exact behavior

The groups always appear in this order: Notes (5), Sections (4), Tasks (4), Brainstorms (3),
Domains (3), Tags (5), Content (4). Empty groups disappear. The Tasks chip allows 14 tasks.
A brainstorm's title appears in Brainstorms only while that module is enabled, and returns
to Notes when it is disabled. Its aliases remain searchable.
Exact titles rank above prefixes, word starts, substrings and fuzzy matches. Aliases score
just below the equivalent title match. Fuzzy matching requires at least three letters in order,
starting at a word boundary, within a compact span. Multiple words may occur in any order; their weakest match determines the score, with exact phrases and full prefixes ranking first.
Recency adds at most 0.5 and the current domain at most 0.3, so neither overrides match quality.

Case and accents are ignored. Folding keeps UTF-16 offsets intact for highlighting; ligatures
use one letter (`œ` becomes `o`, `æ` becomes `a`, `ß` becomes `s`), never two. Separate combining
marks retain their position. Two-letter transliterations and typographic ligatures such as `fi` are not expanded. Tags include descendants and combine with domain filters.
Domain filters match the start of a word in the domain's name.

The metadata cache supplies titles, aliases, headings and tags. Obsidian's excluded files are
omitted, including their tasks and content. Updates follow metadata changes, modification,
renaming and deletion. Tasks and brainstorms come from their version 1 services; switching
modules on or off updates an open search. Domain and tag results use Home when it is available,
otherwise they open the domain note or Obsidian's tag search.

Mounting an idle inline field does not start the index. The desktop content index starts on focus or an active query, exists only in memory, and yields after work
slices of about 8 ms. Each note is capped at 1 MiB of UTF-8 text, keeping complete characters. No index is written to
disk. While it builds, desktop content searches use the already indexed notes and show an indexing message. Phone searches wait 220 ms after typing, require three characters, stop after 20 matching
notes, and cancel on the next input. Content snippets are read from the original note to retain
accents. Missing or unreadable files are skipped.
Content searches and previews omit YAML properties, `%%...%%` and HTML comments, task
checkbox syntax, link destinations and Markdown formatting. Link labels remain readable;
all matched words are highlighted, and opening a match still targets the original note line.

The floating window belongs to the anchor's document, supports popout windows, and fills phone
screens. Its height follows the visual viewport when the keyboard opens. Preview text appears
on desktop. Motion follows the reduced-motion preference.
Inline results use Home's page scrolling, without a separate height limit that clips rows.

The `search` service (version 1) publishes `open(options)`, `attach(host)` and asynchronous
`query(text, options)`. Inline hosts retain ownership of their input and containers; `destroy()`
removes Search's listeners and rendered elements. Disabling Search closes its windows, cancels
its pending work and removes the service.
