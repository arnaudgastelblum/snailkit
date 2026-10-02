import type { App, Editor, TFile } from "obsidian";
import type { EditorView } from "@codemirror/view";
import type { Availability, SlashMenuHost } from "../types/host";
import type { ActionConfig, SlashItem, SlashMenuSettings } from "../types/settings";

/** Everything an action may need when it runs. */
export interface ActionContext {
	app: App;
	host: SlashMenuHost;
	settings: SlashMenuSettings;
	/** The item being run (for messages). */
	item: SlashItem;
	/** Markdown editor the menu was opened in; null when run without an editor. */
	editor: Editor | null;
	/** CodeMirror view behind `editor` (for visual effects only). */
	cmView: EditorView | null;
	/** Note the editor shows. */
	file: TFile | null;
	/** Text that was selected when the menu was opened (via the command), else "". */
	selection: string;
}

/** Context used only to decide whether an action can run (no side effects). */
export interface AvailabilityContext {
	app: App;
	host: SlashMenuHost;
	hasEditor: boolean;
	hasFile: boolean;
}

/**
 * One kind of action. To add a new kind: add its config to ActionConfig
 * (types/settings.ts), sanitize it in migrations.ts, implement this interface
 * and register it in actions/registry.ts.
 */
export interface ActionType<C extends ActionConfig = ActionConfig> {
	type: C["type"];
	isAvailable(config: C, ctx: AvailabilityContext): Availability;
	execute(config: C, ctx: ActionContext): Promise<void>;
}

/** Error with a message meant for the user (shown as is in a Notice). */
export class ActionError extends Error {}
