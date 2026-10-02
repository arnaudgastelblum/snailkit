import { flash, requireEditor } from "../editor/insert";
import type { BlockActionConfig, BlockKind } from "../types/settings";
import type { ActionType } from "./types";

/** Any existing line-level marker: heading, task, bullet, number, quote. */
const LINE_PREFIX_RE = /^(\s*)(#{1,6}\s+|[-*+]\s+\[.\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)?/;

const PREFIX: Record<BlockKind, string> = {
	text: "",
	h1: "# ",
	h2: "## ",
	h3: "### ",
	h4: "#### ",
	h5: "##### ",
	h6: "###### ",
	bullet: "- ",
	numbered: "1. ",
	todo: "- [ ] ",
	quote: "> ",
};

/** Pure: turns one line into the requested block. Returns the new line and how much the prefix grew. */
export function convertLine(line: string, kind: BlockKind): { line: string; delta: number } {
	const m = LINE_PREFIX_RE.exec(line);
	const indent = m?.[1] ?? "";
	const old = m?.[2] ?? "";
	// Headings and quotes do not keep list indentation.
	const keepIndent = kind === "bullet" || kind === "numbered" || kind === "todo" || kind === "text";
	const newIndent = keepIndent ? indent : "";
	const rest = line.slice(indent.length + old.length);
	const next = newIndent + PREFIX[kind] + rest;
	return { line: next, delta: newIndent.length + PREFIX[kind].length - indent.length - old.length };
}

export const blockAction: ActionType<BlockActionConfig> = {
	type: "block",
	isAvailable: (_config, ctx) => (ctx.hasEditor ? { available: true } : { available: false, reason: ctx.host.t("reason.noEditor") }),
	async execute(config, ctx) {
		const editor = requireEditor(ctx);
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const { line: next, delta } = convertLine(line, config.block);
		if (next !== line) editor.replaceRange(next, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length });
		editor.setCursor({ line: cursor.line, ch: Math.max(0, Math.min(next.length, cursor.ch + delta)) });
		const start = editor.posToOffset({ line: cursor.line, ch: 0 });
		flash(ctx, start, start + next.length);
	},
};
