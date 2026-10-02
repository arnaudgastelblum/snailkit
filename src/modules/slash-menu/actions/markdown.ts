import { insertTemplate } from "../editor/insert";
import type { MarkdownActionConfig } from "../types/settings";
import type { ActionType } from "./types";

export const markdownAction: ActionType<MarkdownActionConfig> = {
	type: "markdown",
	isAvailable: (_config, ctx) => (ctx.hasEditor ? { available: true } : { available: false, reason: ctx.host.t("reason.noEditor") }),
	execute: (config, ctx) => insertTemplate(ctx, config.template),
};
