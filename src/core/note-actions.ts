// Note actions: what a module can do with the note on screen (export it, move a selection out of
// it...). A module declares them while it runs (ModuleContext.addNoteAction); the Note menu's
// Actions panel lists the ones that apply to the open note. The core only keeps the list.
import type { MarkdownView } from "obsidian";

export interface NoteAction {
	/** Unique within the module. */
	id: string;
	/** Lucide icon. */
	icon: string;
	/** Translated label, a short verb phrase ("Export to PDF"). */
	label: string;
	/** True when the action applies right now (editing mode, a selection, a file type). */
	available(view: MarkdownView): boolean;
	run(view: MarkdownView): void | Promise<void>;
}

/** An action as the core stores it: the module it comes from, and its global key. */
export interface RegisteredNoteAction extends NoteAction {
	moduleId: string;
	key: string;
}
