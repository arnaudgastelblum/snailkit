import { Notice } from "obsidian";
import type { SlashItem } from "../types/settings";
import { errorMessage } from "../utils/errors";
import { getActionType } from "./registry";
import { ActionError, type ActionContext, type AvailabilityContext } from "./types";
import type { Availability } from "../types/host";

export function itemAvailability(item: SlashItem, ctx: AvailabilityContext): Availability {
	try {
		return getActionType(item.action.type).isAvailable(item.action, ctx);
	} catch (e) {
		return { available: false, reason: errorMessage(e) };
	}
}

/**
 * Runs an item. Never throws: failures become a Notice, so a broken action
 * can never break the editor. Returns whether it succeeded.
 */
export async function runItem(ctx: ActionContext): Promise<boolean> {
	const { item } = ctx;
	try {
		await getActionType(item.action.type).execute(item.action, ctx);
		return true;
	} catch (e) {
		if (e instanceof ActionError) new Notice(e.message, 6000);
		else {
			console.error(`[Snailkit] "${item.name}" failed`, e);
			new Notice(ctx.host.t("notice.actionFailed", { name: item.name, error: errorMessage(e) }), 6000);
		}
		return false;
	}
}
