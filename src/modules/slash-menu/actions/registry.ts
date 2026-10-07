import type { ActionConfig, ActionTypeId } from "../types/settings";
import { blockAction } from "./block";
import { calloutAction } from "./callout";
import { commandAction } from "./command";
import { markdownAction } from "./markdown";
import { newNoteAction } from "./new-note";
import type { ActionType } from "./types";

// One entry per ActionConfig["type"]; the mapped type makes a missing or mismatched one a compile error.
const REGISTRY: { [K in ActionTypeId]: ActionType<Extract<ActionConfig, { type: K }>> } = {
	command: commandAction,
	markdown: markdownAction,
	callout: calloutAction,
	block: blockAction,
	"new-note": newNoteAction,
};

export function getActionType(type: ActionTypeId): ActionType<ActionConfig> {
	return REGISTRY[type];
}
