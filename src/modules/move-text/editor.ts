// Editor changes stay undoable in the origin note.
import type { Editor } from "obsidian";
import { linkZoneInsertion } from "./logic";
import type { Block } from "./types";

export function insertLinkInZone(editor: Editor, target: string): void {
	const insertion = linkZoneInsertion(editor.getValue().split(/\r?\n/), target);
	if (insertion) editor.replaceRange(insertion.text, insertion.from);
}

// Replace lines start..end (inclusive) with `replacement` ("" removes them).
export function replaceBlock(editor: Editor, start: number, end: number, replacement: string) {
	const lastLine = editor.lineCount() - 1;
	if (end < lastLine) {
		editor.replaceRange(
			replacement ? replacement + "\n" : "",
			{ line: start, ch: 0 },
			{ line: end + 1, ch: 0 }
		);
	} else if (start > 0) {
		editor.replaceRange(
			replacement ? "\n" + replacement : "",
			{ line: start - 1, ch: editor.getLine(start - 1).length },
			{ line: end, ch: editor.getLine(end).length }
		);
	} else {
		editor.replaceRange(
			replacement || "",
			{ line: 0, ch: 0 },
			{ line: end, ch: editor.getLine(end).length }
		);
	}
}

// The block coordinates are captured before the modal opens and before the
// destination is written. If the note changed in between (typing, sync,
// another plugin), deleting start..end would remove the wrong lines.
export function blockUnchanged(editor: Editor, block: Block) {
	if (editor.getValue() !== block.source || block.isCurrent?.() === false) return false;
	if (block.end >= editor.lineCount()) return false;
	for (let i = block.start; i <= block.end; i++) {
		if (editor.getLine(i) !== block.lines[i - block.start]) return false;
	}
	return true;
}
