[Snailkit](../README.md) · **Brainstorm**

# Brainstorm

Write your ideas freely in one note, then catch the tasks in it and close with a short summary.

## What it does

Some mornings the ideas come faster than you can sort them. A brainstorm is one note where you write them all down in one go, without structure: remarks, half thoughts, things to do. Then, sentence by sentence, you **catch** the tasks in it:

- A pale dot in the margin marks sentences that start with an action verb ("Call the insurer...", "Penser à acheter...", "De verzekering bellen", "Llamar al seguro"). A small orange **?** marks questions.
- Hover a sentence (tap it on a phone): it lights up, with a **+** and a **?** in the margin.
- **+** turns the sentence into a real task line, `- [ ] Call the insurer about the car`, right where it was. What came before it on the line stays a free line above; what came after goes on its own line below. The title is cleaned (no "don't forget to", no final period) and you can rename it in the line itself.
- A small numbered window slides in under the task: **1** the title (in the line itself), **2** the **tag**, **3** the **description** when lines follow the task. The tag is a calm column: one tag in color at a time (the one under the cursor, in its Tag colors tint), the reason of its rank next to it (*learned · "garage"*, *recent*, *subject of the note*), its sub-tags in grey behind it. The description is a bracket in the margin that takes the paragraph that follows; pull its grip to take more or fewer lines.
- **Place** writes `- [ ] Call the insurer about the car #home/car` and indents the description lines under it. The Tasks module shows that description with the task.
- **?** keeps a sentence "to decide": `- [?] Do we keep the newsletter?`. Press it again to give the sentence back.
- **Close** the brainstorm: a summary shows the thread of your ideas, the tasks and what is left to decide, then a line in italics closes the note, for example *Brainstorm closed at 08:12 · 7 ideas · 3 tasks · 1 to decide*.

Everything you did not catch stays in the note, where you wrote it. Nothing is stored apart from the note, except the list of your brainstorms and the words used to suggest tags.

```markdown

[[Inbox]]
October 5, 2026 · 07:48

Clean up the garage before winter.
- [ ] Take the bikes out #home
	Put the metal shelves at the back.
	Hang the summer tires on the rack.

- [?] Do we keep the monthly newsletter?

*Brainstorm closed at 08:12 · 4 ideas · 1 task · 1 to decide*
```

## How to use it

1. Turn on **Brainstorm** in **Settings → Snailkit**.
2. Run **Snailkit: New brainstorm** (or **New brainstorm** in the lightning panel of Note rail). A note named after the moment ("Brainstorm of Oct 5, morning") opens, with a link to the parent note on line 2 when you set one, then the date. Write.
3. To use an existing note, run **Snailkit: Treat this note as a brainstorm**.
4. Catch a sentence: hover it and click **+**, click its dot, or put the cursor in it and press `Ctrl+Enter` (`Cmd+Enter` on macOS).
5. Rename the title if you like, press `Enter` to keep the proposed tag (or `Tab` to choose one: type to filter, `↑` `↓` to move, `Enter` to choose). When lines follow the task, adjust the description with `↓` and `↑` and press `Enter` to place it; otherwise the task is placed as soon as its tag is chosen.
6. Sort what waits: in the pill at the top right of the note, **Sort N lines** (see *Sorting* below).
7. When you are done, **Finish** (in the pill, or at the end of the sorting): the closing line is written, the note is sealed. **Reopen** is always there. **Snailkit: Close the brainstorm** (or **Close this brainstorm** in the lightning panel of Note rail, or a click on the brainstorm in the status bar) still shows the summary first; **Snailkit: Reopen the brainstorm** removes the closing line.

### Where it stands: four steps

A brainstorm goes through four steps: **Write → Sort → Finish → Archive**. Where it stands is computed from the note, never stored: while it holds tasks without a tag or lines to decide (`- [?]`), the next step is **Sort**; otherwise **Finish**. It is said in words, color only helps: *New brainstorm*, *In progress*, *In progress · 2 without tag · 1 to decide*, *Ready to finish ✓*, *Finished*, *Archived*.

- **The pill** at the top right of the note says it. Hover it (tap it on a phone: a sheet) for the **card**: the four steps, the current one lit; what you dropped and launched (*14 ideas dropped · 4 tasks launched · 1 to decide · 23 lines*: what was done, never what is left); one button for the next step (**Sort 3 lines**, **Finish**, **Archive**); and **Show me**, which lights the lines that wait one by one in the note (`←` `→` or the arrows to go from one to the next, `Esc` to stop). When the last tag is placed, the pill becomes *Ready to finish ✓* with a small ripple.
- **A new brainstorm** waits with a soft question on its first empty line, *What is on your mind?*, gone with the first letter.
- **Finish** writes the closing line and seals the note: a discreet stamp, a slightly tinted page, and one sentence, *13 ideas dropped, 4 launched. Mind lighter.*, with **Reopen**.

### Sorting

**Sort** opens one line at a time in the middle of the screen: from the pill, the lines of that brainstorm; from the Brainstorms tab, those of every brainstorm in progress. Each line shows where it comes from and offers four choices:

| Key | Choice | In the note |
| --- | --- | --- |
| `1` | **Task + tag** | the tag column opens (the same as when composing); the line becomes `- [ ] Text #tag` |
| `2` | **To decide** | `- [?] Text` (a line already to decide stays as it is) |
| `3` | **Keep as an idea** | the checkbox goes, the text stays (`- Text`) |
| `4` | **Delete** | the line goes, with its description |

`Backspace` takes the last decision back, in the note too; `Esc` leaves (what was decided stays). A bar moves on, the card flies to its choice, and a short screen closes the round, with **Finish the brainstorm** when it is ready. In the note, each decision is also one step of the editor's history (`Ctrl+Z`).

On a phone, tap a sentence: **+ Task** and **? To decide** appear under it. The window becomes a sheet at the bottom of the screen, open on the tag column, with large **−** and **+** buttons for the description.

### All your brainstorms, in the Workbench

The [Workbench](workbench.md) gets a **Brainstorms** tab, whether the Tasks module is on or not, with the number of brainstorms still to sort next to its name. Open it with **Snailkit: Open the workbench: brainstorms**, or **All brainstorms** in the lightning panel of Note rail.

- At the top, one sentence rather than a dashboard: *3 in progress · 4 tasks await a tag · 1 to decide*, with **Sort** (every brainstorm in progress). Under it, a discreet recap, *This week: 3 brainstorms, 9 tasks launched*; its **×** hides it on this device.
- A **timeline**: one bubble per brainstorm on a time axis (the last weeks, scroll sideways for older ones), larger when the brainstorm holds more tasks. Its shape says its state: full while in progress, a ring with a dot while something is to sort, hollow with a check once finished (a legend shows while the pointer is over it). Today is marked. Hover a bubble for its title and counts. The button next to the search shows or hides it.
- A **search** (title and text of the brainstorms), **context chips** (All, then each context in use) when at least one brainstorm has a context, and **Archived** once something is archived.
- The **list**, in groups: **In progress**, then **Finished** (folded; a click unfolds it, kept on this device), then **Archived** when shown. Pinned brainstorms come first in their group. Each row shows the title, the context, the four steps in small, one state in words and the date. Hover a row for the card (the steps, the tally, the next step, **Open**). A brainstorm left for a week without change says *Finish it?*.

When the Workbench is a page, the **detail** of the selected brainstorm sits on the right:

- its title (click it, or the pencil, or press `F2` to rename the note: links to it follow), its state and its **context**;
- when it started and when it was last edited;
- the card: the four steps, the tally and the next step;
- its **tasks** (check them right there; click one to open the note at its line), the lines **to decide** (**Task** opens the note at the line and starts catching it as a task), and the **free ideas** (click one to open the note at its line);
- at the bottom: **Open to edit** (the note opens in a tab next to the Workbench, with everything you need to catch tasks), **Pin**, **Context**, **Archive** and **Delete**.

In the side panel and on phones the list is alone: a click (a tap) opens the brainstorm, and the actions are in a menu: right click, long press, or the **⋯** button of the row.

**Context.** A tag that says where a brainstorm belongs, for example `#work` or `#home`. **Context** offers the contexts already used by your other brainstorms; type to filter or to name a new one, `Enter` to choose; **Remove the context** takes it away. It is written in the note itself (see *Exact behavior*).

**Archive** takes a brainstorm out of the list without touching the note; **Archived** shows them, and **Unarchive** brings one back. **Delete** asks for a confirmation in the page, then moves the note to the trash, as your Obsidian settings say (system trash, Obsidian's `.trash` folder, or deleted for good).

Keys in the tab:

| Keys | Action |
| --- | --- |
| `/` or `Ctrl+F` | Go to the search (`Esc` clears it) |
| `↓` `↑` | Move in the list (in the page, the detail follows) |
| `Enter` | Open to edit |
| `P` | Pin, or unpin |
| `C` | Context |
| `E` | Archive, or unarchive |
| `F2` | Rename |
| `Delete` | Delete (with a confirmation: `Enter` deletes, `Esc` keeps it) |

In the page, a bar under the list recalls these keys.

### Shortcuts

In a brainstorm:

| Keys | Action |
| --- | --- |
| `Ctrl+Enter` | Catch the sentence under the cursor (on a task: edit it) |
| `Ctrl+Shift+Enter` | Keep the sentence to decide, or no longer |
| `Alt+↓` / `Alt+↑` | Next / previous likely task |
| `Ctrl+Z` / `Ctrl+Y` | Undo the task just placed (the sentence goes back as it was) / place it again |

While composing a task:

| Step | Keys | Action |
| --- | --- | --- |
| Title | `Enter` | Keep the proposed tag and go to the description (no lines to take: place; no proposal: go to the tag) |
| Title | `Tab` | Go to the tag |
| Title | `↓` / `↑` | One description line more / less |
| Tag | `↑` `↓` | Move in the column (`←` `→` too, when the field is empty they go into the sub-tags and back) |
| Tag | `Tab` / `Shift+Tab` | Go into the sub-tags / back up (or back to the title) |
| Tag | typing | Filter (the match is underlined), or name a new tag; `parent/` goes into the sub-tags of `parent` |
| Tag | `Backspace` on an empty field | Back up one level |
| Tag | `Enter` | Choose the tag under the cursor (or create it), then the description, or place when no lines follow |
| Tag | `Esc` | Clear the filter; on an empty field, cancel |
| Description | `↓` / `↑` | One line more / less (`Home`: none, `End`: all) |
| Description | `Enter` | Place |
| Description | `Shift+Tab` | Back to the tag |
| Any | `Alt+↓` / `Alt+↑` | Adjust the bracket |
| Any | Mouse wheel over the bracket, its lines or the description row | One line more or less (elsewhere the wheel scrolls the note) |
| Any | `Ctrl+Enter` | Place at once (with the proposed or highlighted tag) |
| Any | `Ctrl+/` or the **?** of the window | All the shortcuts of the step |
| Any | `Esc` | Cancel: the text is given back exactly as it was |

The bar at the bottom of the window shows the two or three keys of the current step; the **?** next to it (hover or click, or `Ctrl+/`) shows them all. While a task is composed, `Ctrl+/` opens this list instead of Obsidian's **Toggle comment**. The same list is in the module's settings. On macOS, `Ctrl` is `Cmd` and `Alt` is `Option`.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Folder | Empty | Where new brainstorms are created. Empty: where Obsidian puts new notes. The folder is created if needed. |
| Parent note | Empty | A link to this note goes on line 2 of each new brainstorm, for example `Inbox`. Empty: no link. |
| Where it works | Brainstorms only | Catching tasks (dots, grips, keys) works in brainstorms only, or in every note. |
| Likely tasks in the margin | On | The pale dots and question marks in the margin. Off: the grips still show on hover. |
| Suggested tags | Empty | The words of placed tasks and the tag chosen for them, remembered to suggest a tag next time. **Forget** clears them. |

## Exact behavior

**Brainstorms.** A brainstorm is a note whose path is remembered in the module's settings. Existing notes keep their names, including titles starting with "Session of", "Session du", "Sessie van" or "Sesión del": recognition uses the saved path, not the title. Renaming or moving the note keeps it a brainstorm; deleting it forgets it (also when it was deleted while the module was off). **Stop treating this note as a brainstorm** forgets it without touching the note. A new brainstorm gets an empty first line, the parent link on line 2 when set, then the date and time, then an empty line where the cursor waits. The file name is the proposed title ("Brainstorm of Oct 5, morning": morning before noon, afternoon before 6 pm, evening after), in the interface language, with " 2", " 3"... when it already exists.

**Sentences.** A sentence ends with `.`, `!`, `?` or `…` followed by a space or the end of the line. Numbers (`3.5`), file names (`notes.md`), links, URLs and inline code never cut a sentence. A sentence is a likely task when its first word, after phrases such as "don't forget to", "il faut", "niet vergeten", "hay que", is one of about 300 common action verbs in English, French, Dutch or Spanish, or when a Dutch sentence ends with an infinitive ("de verzekering bellen"). A sentence with `?` (or `¿`) is a question. Headings, code blocks, properties, quotes, tables, lines that are only a link, the closing line and the description lines of a task never get a dot.

**Catching.** The sentence becomes a task line where it was. A list item keeps its marker and indentation; a plain line becomes `- [ ] `. The title loses the announcing phrase, its final punctuation (a question keeps its `?`) and gets a capital letter. While composing, only the title can be edited (one line), the other lines step back, and a click on a line below sets the description to end there. `Esc` (or **Cancel**) replaces the rewritten lines with the original line, character for character. If another tool changes the caught lines meanwhile, or the note stops being a brainstorm, the composition stops and the original line comes back. Closing the note (or opening another one in its place) while composing gives the sentence back in the file; on a phone, switching to another note cancels the composition the same way. Catching a `- [?]` line makes it a task; catching a task edits it: its group tag (its first tag that is not `#high`, `#medium` or `#low`) is taken out of the line while composing and put back at the end when placing, priorities stay where they are, and its current description is taken again.

**Description.** The candidates are the lines that follow the task: its current description (lines indented under it, blank lines inside included), then free lines and blank lines, up to a task, a heading, other Markdown blocks or the closing line. At first the bracket takes the paragraph that follows (up to the first blank line). Placing indents the lines taken by one indentation unit of the editor (a tab, or the spaces set in Obsidian's editor settings) under the task, keeping their relative indentation; blank lines inside stay empty, trailing blank lines are never taken. Lines that leave the description of an edited task go back to the task's level. When an existing description is lengthened, it and the newly taken lines are leveled separately. This matches what the Tasks module reads as a task's description.

**Tags.** The column lists, before you type: the chosen tag, the proposed one, the tags of this note and those of its area (with Note rail), the recently chosen ones, then the top-level tags of the vault, most used first. Each tag shows a dot in its color (grey without Tag colors) and its name; next to it, why it ranks there: *chosen*, *learned · "word"* (the word of the sentence that earned the proposal), *recent*, *subject of the note*; the vault's tags carry nothing. The direct sub-tags of a tag appear in grey behind it (four at most, then *+n*), and a chevron, or `Tab`, opens them: the parent itself comes first ("the tag alone"), then its sub-tags; the field shows the parent as a crumb. Only the tag under the cursor is in color: a tinted bar slides from row to row, and when you choose one its capsule flies to the end of the task line. Typing filters every tag of the vault (tags starting with the text first, the match underlined, accents and case ignored, spelling kept) and offers to create a new one as the last row, unless a tag spelled like it exists; a new name needs at least one letter, as Obsidian wants (`2026` is not a tag). Typing `parent/` goes into its sub-tags; inside a parent, hits from elsewhere in the vault keep their full path. `#high`, `#medium` and `#low` are never offered. **Place** or `Ctrl+Enter` at the tag step takes the tag under the cursor, the one the line previews. The proposal comes from what you chose before: each placed task remembers its words (common words left out) with its tag, up to 400 pairs, the most used kept. A word seen once is not enough; two words, or one word seen twice with the same tag, are. A tag of the vault whose last part is a word of the sentence is proposed too. No word list is built in.

**Steps.** The window has one row per step after the title: **2 · Tag** and, only when lines follow the task, **3 · Description**. The step at hand is open; the others fold into one line (the tag chosen or proposed and why, the number of lines taken) and a click on a row or its number goes there. The checkbox of the task shows the **1** of the title step. Without lines to take, choosing the tag (or `Enter` on the title with a proposal) places the task at once.

**Placing.** The line becomes `- [ ] Title #tag` (no tag if you chose none: the task is then counted as waiting). The task springs into place, a dot of the tag's color flies to the Tasks button of Note rail when it is visible, and a message offers **Undo** for 6 seconds. Catching and placing are one step in the editor's history: `Ctrl+Z` gives back the original sentence and the lines taken, exactly as they were, and `Ctrl+Y` places the task again. Edits made after placing (renaming the task, for example) are undone first, one by one, like any typing. **Undo** in the message does the same, as long as nothing was edited since. **To decide** splits the line the same way and writes `- [?] ` before the sentence, words untouched; pressing it again restores the original line when nothing changed around it, otherwise it only removes the checkbox.

**Summary and closing.** Ideas are counted after the header of the brainstorm (properties, a line with only a link, a short date line): each task (with its description), each question or `- [?]` line, and each paragraph of free text is one idea. The bar of a task has the color of its tag (with Tag colors), questions are yellow, free notes grey; a bar is as wide as the idea is long. **Make it a task** closes the summary and catches that question. **Close the brainstorm** appends an empty line and the closing line in italics, in the interface language; the closing line is recognized in all four languages, so **Reopen** removes it whatever the language it was written in. A brainstorm is "waiting" while it is open and holds tasks without a tag or `- [?]` lines: the lightning button of Note rail shows a dot then.

**The Brainstorms tab.** It is added to the Workbench while this module is on, after the Home and Tasks tabs; the Tasks module does not need to be on. Its counts come from the summary logic above, read from each brainstorm when it changes (never the whole vault at each keystroke). A brainstorm is "to sort" while it is open and holds tasks without a tag or `- [?]` lines; "Open" includes those. The date of a brainstorm is the moment it began, kept in the module settings: when it is created, or, for an adopted note, the date of the note at that moment. It follows renames and does not change when a synced copy of the note gets another file date. Brainstorms tracked before this date was kept take the file date once, then keep it. The timeline starts three weeks back (or at the first brainstorm, if older) and ends tomorrow; brainstorms of the same day stack up. Without a choice of yours, it is shown when the window is at least 640 pixels high; your choice is then kept on this device. The search looks for every word typed, ignoring case and accents, in the title and the first 20,000 characters of the note. The detail is shown when the Workbench is a page on a computer; on a phone, the list is always alone.

**The steps and the counts.** *Without tag* counts the open tasks without a tag; *to decide* the `- [?]` lines. While either is not zero, the step is **Sort**; then **Finish** once the brainstorm holds at least one task (a brainstorm without tasks can be finished too: its next step says so); the closing line makes it *Finished*, and archiving it, *Archived*. *Ideas dropped* counts the ideas as the summary does, *tasks launched* every task (checked or not), *lines* the lines written after the header (not blank, outside code and properties, closing line left out). *Free ideas* are the ideas that are neither a task nor a `- [?]` line: paragraphs of free text and questions left as sentences. A brainstorm in progress whose note did not change for 7 days is invited to finish (*Finish it?*); nothing more. Without anything to sort, **Sort** says so and opens nothing.

**Sorting, exactly.** The lines offered are the open tasks without a tag and the `- [?]` lines, in the order of the notes (from the tab: brainstorms in progress, pinned first, then newest first). Each decision finds its line again just before writing it: at its place (which follows the decisions already made in the same note) if it still reads the same, else the only line of the note reading the same; it must still be something to sort (an open task without a tag, or a line to decide, outside code and properties). Otherwise nothing is written and a message says so. The change goes through the open editor of the note when there is one (one step of its history), else into the file. **Task + tag** writes the tag at the end of the line as the composition does and remembers it for the suggestions. **Delete** removes the task's description with it, only as it was shown: when the description changed meanwhile, the card shows it again as it is now and nothing is deleted; a line whose description holds a code block is never deleted from here. `Backspace` (or **Undo the last one**) puts the lines back exactly, only at the place the decision was made and only if that place and its neighbours still read as they were left; otherwise nothing is undone and a message says so. A note emptied by Delete is filled again. Keys pressed while a card flies are played in order once it has landed.

**Checking a task** in the detail goes through the Tasks module when it knows the task (a tagged task: it writes its completion date as usual); otherwise only the checkbox changes. Nothing is written when the line changed since it was read.

**Task (from a line to decide)** opens the note at that line. Once the note is open, the line is looked for again just before anything is written: at the same place if it still reads the same, else the only line of the note that reads the same (it moved). Then the window to catch it as a task opens at once. When it changed, or reads the same in several places, nothing is rewritten: the note is only opened there.

**Context.** It is the first tag of the line with the parent link (line 2 of new brainstorms, `[[Inbox]] #work`), or of a line made only of tags at the top of the note. Only the top is read: the heading, the parent link line, a tag line and the date line, up to the first idea, task or block (code, quote, table); a tag in an idea, a task, a code block or inside a link (`[[Inbox| #label]]`) is never a context, and is never rewritten. Choosing a context replaces the current one where it is. Without one, the tag goes at the end of the parent link line; without a parent link, on its own line under a first heading, or else at the top of the note (after the properties and the empty first line, before any block). Removing it takes the tag away, and the line too when it held nothing else. A line made only of tags is never counted as an idea. Context names follow Obsidian's rules for tags (at least one letter); the chips and the menu ignore case.

**Pins and archive.** Both are lists of paths kept in the module settings, like the list of brainstorms: they follow renames and moves, forget deleted notes (also when they were deleted while the module was off), and are kept when the module settings are reset. The last pinned comes first. Archived brainstorms leave the list, the timeline, the count of the tab and the lightning button of Note rail; their notes are not touched. **Undo** in the message after archiving puts it back as it was, even if the note was renamed or moved meanwhile (nothing happens if it was deleted). When Obsidian Sync brings new settings from another device (brainstorms, pins, archive), the tab, its count and the lightning button follow, and newly tracked brainstorms are read.

**Rename** gives the note a new name in the same folder, through Obsidian (links follow). Characters Obsidian refuses in names are replaced by spaces; a name already used in that folder is refused with a message. If the note is renamed, moved or deleted elsewhere while you type its new name, your edit is dropped.

**Delete** never asks with a system dialog: the confirmation is in the page (in the detail, or under the row in the side panel). The note goes where Obsidian's "Deleted files" setting says; the brainstorm, its pin and its archive entry are forgotten.

**Phones.** There is no hover: a tap on a sentence shows **+ Task** and **? To decide** under its line, until you tap elsewhere. While composing, the keyboard closes, the window is a sheet at the bottom of the screen above the editing toolbar, open on the tag column (a tap on the field brings the keyboard back to filter), the rows are taller, the chevron of a parent opens its sub-tags, and the grip is larger. The help bar and the **?** are not shown.

**Buttons.** The window, the summary and the Brainstorms tab use Snailkit's shared buttons: **Place**, **Close the brainstorm**, **Open to edit** and the next step of a card are the primary ones, **Cancel** and **Back** are quiet.

**Finish and Reopen.** **Finish** writes the same closing line as **Close the brainstorm** (without the summary) and shows the sealed note: the closing line stays the only trace in the file. **Reopen** (on the seal, in the card, in the message after finishing, or the command) removes it.

**Motion.** Every animation follows the system's reduced motion setting: with it, things appear in place without moving.

**Turning the module off** removes the dots, grips and window; a composition in progress is cancelled and its text given back. Your notes, tasks and closing lines stay as they are.

## For developers

While enabled, the module publishes this service, read by Note rail's lightning panel. Defined in [`types.ts`](../src/modules/sessions/types.ts):

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
