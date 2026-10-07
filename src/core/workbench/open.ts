// Opening a note from a Workbench tab (a task row, a search result, a domain page). The rules of
// the Tasks module's list, shared by every tab:
// - a tab that already shows the note is reused (unless Ctrl/Cmd asks for a new one);
// - in a transient Workbench (a new tab showing Home), the note takes the Workbench's place,
//   like a browser's start page, unless that tab is pinned (a pinned tab keeps what it shows, as
//   with Obsidian's own openings);
// - else the most recent note is replaced, or a new tab opens when Ctrl/Cmd is held or when the
//   most recent leaf is a Workbench in the main area (so the Workbench stays).
// The cursor goes to the end of the line (or the top of the note when `line` is null).
import { MarkdownView, TFile, type App, type WorkspaceLeaf } from "obsidian";
import { WORKBENCH_VIEW_TYPE } from "./types";

export interface OpenNoteOptions {
	event?: MouseEvent | KeyboardEvent;
	/** The leaf of a transient Workbench: the note opens in it (not when the leaf is pinned). */
	replace?: WorkspaceLeaf | null;
	/** Finds the line again in the note's current lines (the Tasks module checks the task's text). */
	locate?: (lines: string[]) => number;
}

/** Pinned tab (Obsidian keeps it from being replaced by its own openings, see getLeaf(false)). */
function isPinned(leaf: WorkspaceLeaf): boolean {
	const pinned = (leaf as unknown as { pinned?: unknown }).pinned;
	if (typeof pinned === "boolean") return pinned;
	try {
		return !!leaf.getViewState().pinned;
	} catch {
		return false;
	}
}

export async function openNoteAt(app: App, path: string, line: number | null, options: OpenNoteOptions = {}): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return;
	const { event } = options;
	const mod = !!(event?.ctrlKey || event?.metaKey);
	const workspace = app.workspace;
	let leaf = null as WorkspaceLeaf | null;
	workspace.iterateAllLeaves((l) => {
		if (!mod && !leaf && l.view instanceof MarkdownView && l.view.file?.path === path) leaf = l;
	});
	if (!leaf) {
		const asked = options.replace;
		const replace = !mod && asked && asked.view?.getViewType() === WORKBENCH_VIEW_TYPE && !isPinned(asked) ? asked : null;
		if (replace) leaf = replace;
		else {
			const recent = workspace.getMostRecentLeaf();
			const listInMain = recent?.view.getViewType() === WORKBENCH_VIEW_TYPE;
			leaf = workspace.getLeaf(mod || listInMain ? "tab" : false);
		}
		await leaf.openFile(file);
	}
	workspace.setActiveLeaf(leaf, { focus: true });
	const view = leaf.view;
	if (!(view instanceof MarkdownView)) return;
	const lines = view.editor.getValue().split(/\r?\n/);
	const at = Math.min(lines.length - 1, Math.max(0, options.locate ? options.locate(lines) : line ?? 0));
	const ch = line === null ? 0 : lines[at]?.length ?? 0;
	view.editor.setCursor({ line: at, ch });
	view.editor.scrollIntoView({ from: { line: at, ch: 0 }, to: { line: at, ch } }, true);
}
