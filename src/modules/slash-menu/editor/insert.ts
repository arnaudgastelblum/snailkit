import type { Text } from "@codemirror/state";
import type { Editor, EditorPosition } from "obsidian";
import type { ActionContext } from "../actions/types";
import { extractCursor, renderVariables } from "../utils/variables";
import { flashRange } from "./flash";

/** Lines that must start at column 0 of their own line to render as blocks. */
const BLOCK_START_RE = /^(#{1,6}\s|>|\||```|~~~|\$\$|---|\*\*\*|[-*+]\s|\d+[.)]\s)/;
const RULE_RE = /^(---|\*\*\*|___)\s*$/m;

function isBlock(text: string): boolean {
	return text.includes("\n") || BLOCK_START_RE.test(text);
}

/**
 * Inserts rendered Markdown at the cursor (replacing the selection), in one
 * undoable transaction, then places the cursor on {{cursor}} or at the end.
 * Block content typed in the middle of a line goes to its own line.
 */
export async function insertTemplate(ctx: ActionContext, template: string, extra?: Record<string, string>): Promise<void> {
	const editor = requireEditor(ctx);
	const target = captureTarget(ctx, editor);
	const rendered = await renderVariables(template, { settings: ctx.settings, file: ctx.file, extra });
	insertText(ctx, editor, rendered, target);
}

/** Where an action will insert, taken before it awaits anything (file creation). */
export interface InsertTarget {
	from: number;
	to: number;
	/** Document at capture time (CodeMirror text is immutable, so identity means "unchanged"). */
	doc: Text | null;
}

export function captureTarget(ctx: ActionContext, editor: Editor): InsertTarget {
	return {
		from: editor.posToOffset(editor.getCursor("from")),
		to: editor.posToOffset(editor.getCursor("to")),
		doc: ctx.cmView?.state.doc ?? null,
	};
}

/**
 * Range to replace: the captured one while the document is unchanged (a selection made
 * meanwhile is never overwritten); if the text changed, the captured start, replacing nothing.
 */
function resolveTarget(ctx: ActionContext, editor: Editor, target?: InsertTarget): { from: EditorPosition; to: EditorPosition } {
	if (!target) return { from: editor.getCursor("from"), to: editor.getCursor("to") };
	const unchanged = target.doc !== null && ctx.cmView?.state.doc === target.doc;
	const length = editor.getValue().length;
	const from = editor.offsetToPos(Math.min(target.from, length));
	return { from, to: unchanged ? editor.offsetToPos(Math.min(target.to, length)) : from };
}

export function insertText(ctx: ActionContext, editor: Editor, raw: string, target?: InsertTarget): void {
	if (!ctx.host.active()) return;
	if (target?.doc && ctx.cmView?.state.doc !== target.doc) return;
	const { text: body, cursor } = extractCursor(raw);
	const { from, to } = resolveTarget(ctx, editor, target);
	const line = editor.getLine(from.line);
	const before = line.slice(0, from.ch);
	const after = line.slice(to.ch);

	let prefix = "";
	let suffix = "";
	if (isBlock(body)) {
		if (before.trim() !== "") prefix = "\n";
		// A rule right under text would turn that text into a heading (setext).
		const firstLine = body.split("\n")[0];
		if (RULE_RE.test(firstLine)) {
			const prevLine = from.line > 0 ? editor.getLine(from.line - 1) : "";
			if (before.trim() !== "") prefix = "\n\n";
			else if (prevLine.trim() !== "") prefix = "\n";
		}
		if (after.trim() !== "") suffix = "\n";
	}

	const text = prefix + body + suffix;
	const startOffset = editor.posToOffset(from);
	editor.replaceRange(text, from, to);
	editor.setCursor(offsetToPosIn(text, from, prefix.length + (cursor ?? body.length)));
	flash(ctx, startOffset + prefix.length, startOffset + prefix.length + body.length);
}

/** Position of `offset` characters after `start`, inside freshly inserted `text`. */
function offsetToPosIn(text: string, start: EditorPosition, offset: number): EditorPosition {
	const lines = text.slice(0, offset).split("\n");
	if (lines.length === 1) return { line: start.line, ch: start.ch + lines[0].length };
	return { line: start.line + lines.length - 1, ch: lines[lines.length - 1].length };
}

export function flash(ctx: ActionContext, from: number, to: number): void {
	if (ctx.settings.flashInserted && ctx.settings.animations && ctx.cmView) flashRange(ctx.cmView, from, to, ctx.host.later.bind(ctx.host));
}

export function requireEditor(ctx: ActionContext): Editor {
	if (!ctx.editor) throw new Error("needs an open Markdown note");
	return ctx.editor;
}
