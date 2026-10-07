// Settings of the Home module as the code reads them: every value checked, the arrangement
// cleaned (logic/arrange.ts). Pure, tested in test/home.test.ts.
import { normalizeArrangement, type Arrangement } from "./logic/arrange";
import { cleanOrder } from "./logic/order";
import { DEFAULTS, type HomeLens, type HomeSettings } from "./types";

/** The views of the Home, in the switch's order; the Map first and by default. */
export const LENSES: HomeLens[] = ["map", "domains", "tags"];

/** "Templates, /Archive/" to clean vault folders, each once. */
export function splitFolders(text: string): string[] {
	const out: string[] = [];
	for (const raw of String(text ?? "").split(",")) {
		const folder = raw.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
		if (folder && !out.includes(folder)) out.push(folder);
	}
	return out;
}

/** A note path as typed in the "Home page" setting: no brackets, no leading slash. */
export function cleanNotePath(text: string): string {
	return String(text ?? "")
		.trim()
		.replace(/^\[\[|\]\]$/g, "")
		.replace(/\|.*$/, "")
		.replace(/\\/g, "/")
		.replace(/^\/+/, "")
		.trim();
}

/** Settings with every value checked (what mergeSettings cannot check: allowed values, array items). */
export function cleanSettings(settings: HomeSettings): HomeSettings {
	const arr = normalizeArrangement(settings);
	return {
		...arr,
		homePage: cleanNotePath(settings.homePage),
		ignoredFolders: typeof settings.ignoredFolders === "string" ? settings.ignoredFolders : "",
		lens: LENSES.includes(settings.lens as HomeLens) ? settings.lens : DEFAULTS.lens,
		lensChosen: settings.lensChosen === true,
		noteOrder: cleanOrder(settings.noteOrder),
	};
}

/** The view the Home opens on: the one the user picked, else the Map. */
export function startLens(settings: Pick<HomeSettings, "lens" | "lensChosen">): HomeLens {
	return settings.lensChosen && LENSES.includes(settings.lens as HomeLens) ? (settings.lens as HomeLens) : "map";
}

/**
 * Settings saved before the Map became the first view: a Map or Tags view kept there was the
 * user's choice; "domains" was the old default and may never have been chosen.
 */
export function migrateSettings(stored: Record<string, unknown>): Record<string, unknown> {
	if (typeof stored.lensChosen === "boolean") return stored;
	return { ...stored, lensChosen: stored.lens === "map" || stored.lens === "tags" };
}

/** The arrangement part of the settings. */
export function arrangementOf(settings: HomeSettings): Arrangement {
	return normalizeArrangement(settings);
}

/** Writes an arrangement into the settings object (in place). */
export function writeArrangement(settings: HomeSettings, arr: Arrangement): void {
	settings.domainOrder = [...arr.domainOrder];
	settings.featured = arr.featured;
	settings.groups = arr.groups.map(([a, b]) => [a, b]);
	settings.domainGroups = arr.domainGroups.map(([a, b]) => [a, b]);
	settings.hidden = [...arr.hidden];
	settings.pulledOut = [...arr.pulledOut];
}
