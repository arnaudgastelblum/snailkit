import { commandExists, executeCommand, getCommand } from "../integrations/obsidian-commands";
import type { CommandActionConfig } from "../types/settings";
import { ActionError, type ActionType } from "./types";

export const commandAction: ActionType<CommandActionConfig> = {
	type: "command",
	isAvailable(config, ctx) {
		return commandExists(ctx.app, config.commandId) ? { available: true } : { available: false, reason: ctx.host.t("reason.commandMissing") };
	},
	async execute(config, ctx) {
		const cmd = getCommand(ctx.app, config.commandId);
		if (!cmd) throw new ActionError(ctx.host.t("notice.commandMissing", { name: ctx.item.name }));
		// Give the editor its focus back first: editor commands act on the focused editor.
		ctx.editor?.focus();
		if (!executeCommand(ctx.app, config.commandId)) throw new ActionError(ctx.host.t("notice.commandFailed", { name: ctx.item.name }));
	},
};
