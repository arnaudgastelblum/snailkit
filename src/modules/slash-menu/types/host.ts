import type { App } from "obsidian";
import type { SlashMenuSettings } from "./settings";
import type { Vars } from "../../../i18n";
export interface Availability { available: boolean; reason?: string }
export interface SlashMenuHost {
	app: App;
	store: { readonly settings: SlashMenuSettings };
	t: (key: string, vars?: Vars) => string;
	later(callback: () => void, delay: number): void;
	active(): boolean;
}
