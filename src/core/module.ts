// The contract every Snailkit module follows. A module is one folder in src/modules/<id>/ that
// exports a `defineModule({...})` object, plus one line in src/modules/registry.ts.
import type { App } from "obsidian";
import type { Strings, Translations } from "../i18n";
import type { SettingsPage } from "../ui/settings-page";
import type { ModuleContext } from "./context";

/** Where the module is listed in the settings. Add a category here (and its strings) when needed. */
export type ModuleCategory = "write" | "organize" | "export";
export const CATEGORY_ORDER: ModuleCategory[] = ["write", "organize", "export"];

/** Every module's strings must at least name and describe it. */
export type ModuleStrings = Strings & { "module.name": string; "module.description": string };

export interface ModuleDefinition<S extends object = object> {
	/** Stable id: settings key, command prefix, CSS prefix and docs page name. Never change it once published. */
	id: string;
	/** Lucide icon id shown on the card and the settings page. */
	icon: string;
	category: ModuleCategory;
	strings: Translations<ModuleStrings>;
	/** Default settings. Stored settings are merged over a copy of it, so new keys get their default. */
	defaults: S;
	/** Needs Node or Electron: the module is shown but cannot be turned on on mobile. */
	desktopOnly?: boolean;
	/** Returns why the module cannot run right now (already translated), or null when it can. */
	unavailableReason?(app: App, t: (key: string) => string): string | null;
	/** Starts the module. Everything registered through `ctx` is undone when the module is turned off. */
	activate(ctx: ModuleContext<S>): void | Promise<void>;
	/**
	 * Builds the module's settings page, whether the module is on or off. Every change is saved
	 * at once; an active module hears about it through `ctx.onSettingsChange`.
	 */
	settings?(page: SettingsPage<S>): void;
	/**
	 * Settings keys that hold the user's data rather than preferences (pins, picked colors...).
	 * "Reset to defaults" keeps them.
	 */
	keepOnReset?: (keyof S & string)[];
	/** Upgrades settings saved by an older version. Receives the raw stored object. */
	migrate?(stored: Record<string, unknown>): Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyModule = ModuleDefinition<any>;

export function defineModule<S extends object>(definition: ModuleDefinition<S>): ModuleDefinition<S> {
	return definition;
}
