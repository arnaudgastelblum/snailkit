import { captureTarget, insertText, requireEditor } from "../editor/insert";
import type { CalloutActionConfig } from "../types/settings";
import { CURSOR_TOKEN, renderVariables } from "../utils/variables";
import type { ActionType } from "./types";

const FOLD_MARK = { none: "", open: "+", closed: "-" } as const;

/** First line of a callout, e.g. `> [!faq]- FAQ`. */
export function calloutHeader(config: Pick<CalloutActionConfig, "calloutType" | "fold" | "title">): string {
	const type = config.calloutType.trim().replace(/[^\w-]/g, "") || "note";
	const title = config.title.replace(/[\r\n]+/g, " ").trim();
	return `> [!${type}]${FOLD_MARK[config.fold]}${title ? " " + title : ""}`;
}

/** Full callout Markdown with a {{cursor}} marker. */
export function buildCallout(config: CalloutActionConfig, content: string): string {
	const header = calloutHeader(config);
	if (!content) return `${header}\n> ${CURSOR_TOKEN}`;
	const body = content.split("\n").map((l) => (l ? `> ${l}` : ">"));
	return `${header}\n${body.join("\n")}${CURSOR_TOKEN}`;
}

export const calloutAction: ActionType<CalloutActionConfig> = {
	type: "callout",
	isAvailable: (_config, ctx) => (ctx.hasEditor ? { available: true } : { available: false, reason: ctx.host.t("reason.noEditor") }),
	async execute(config, ctx) {
		const editor = requireEditor(ctx);
		const target = captureTarget(ctx, editor);
		const vars = { settings: ctx.settings, file: ctx.file, selection: ctx.selection };
		// Selected text becomes the callout body; otherwise the configured content.
		const content = ctx.selection || (await renderVariables(config.content, vars));
		const title = await renderVariables(config.title, vars);
		insertText(ctx, editor, buildCallout({ ...config, title }, content.replace(/\s+$/, "")), target);
	},
};
