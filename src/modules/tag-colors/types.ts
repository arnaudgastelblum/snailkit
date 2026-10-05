import type { App } from "obsidian";
import type { Vars } from "../../i18n";
import { tagKey, type Registry } from "./colors";

export interface TagColorsSettings {
	uppercase: boolean;
	colorPanes: boolean;
	/** A click on a tag opens the tag card instead of the search pane (Ctrl or Cmd click: the search). */
	tagCard: boolean;
	/** The tag menu on "#" (in place of Obsidian's): this note, its area, then the vault; Tab, Enter, Shift+Enter. */
	tagSuggest: boolean;
	slots: Array<[string, number]>;
	overrides: Array<[string, number]>;
}

export interface ColorHost {
	app: App;
	readonly settings: TagColorsSettings;
	t(key: string, vars?: Vars): string;
	save(): Promise<void>;
}

// Arrays survive the core's settings merge, which intentionally filters object keys.
export function entries(value: unknown, slots: boolean): Array<[string, number]> {
	const result: Registry = Object.create(null);
	const pairs = Array.isArray(value) ? value : value && typeof value === "object" ? Object.entries(value) : [];
	for (const pair of pairs) {
		if (!Array.isArray(pair) || pair.length !== 2) continue;
		const [key, number] = pair;
		if (typeof key !== "string" || !tagKey(key) || typeof number !== "number" || !Number.isFinite(number)) continue;
		if (number < 0 || number >= (slots ? 14 : 360) || (slots && !Number.isInteger(number))) continue;
		result[tagKey(key)] = number;
	}
	return Object.entries(result);
}

export function migrate(stored: Record<string, unknown>): Record<string, unknown> {
	return { ...stored, slots: entries(stored.slots, true), overrides: entries(stored.overrides, false) };
}

export function registry(settings: TagColorsSettings, key: "slots" | "overrides"): Registry {
	return Object.fromEntries(entries(settings[key], key === "slots"));
}

export function frequencies(app: App): Registry {
	return (app.metadataCache as typeof app.metadataCache & { getTags?(): Registry }).getTags?.() ?? {};
}
