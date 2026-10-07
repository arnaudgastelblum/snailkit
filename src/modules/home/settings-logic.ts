// Settings of the Home module as the code reads them: every value checked, the arrangement
// cleaned (logic/arrange.ts). Pure, tested in test/home.test.ts.
import type { AutoOpenMode } from "../../core/workbench/types";
import { normalizeArrangement, type Arrangement } from "./logic/arrange";
import { DEFAULTS, type HomeLens, type HomeSettings } from "./types";

export const OPEN_MODES: AutoOpenMode[] = ["startup-and-new-tabs", "startup", "never"];
export const LENSES: HomeLens[] = ["domains", "map", "tags"];

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
		openWorkbench: OPEN_MODES.includes(settings.openWorkbench) ? settings.openWorkbench : DEFAULTS.openWorkbench,
		homePage: cleanNotePath(settings.homePage),
		ignoredFolders: typeof settings.ignoredFolders === "string" ? settings.ignoredFolders : "",
		lens: LENSES.includes(settings.lens as HomeLens) ? settings.lens : DEFAULTS.lens,
	};
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
