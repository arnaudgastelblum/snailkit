// Where a note belongs: the rule now lives in the core (src/core/places/rule.ts), shared by the
// rail, Home, the Map and Search. Re-exported here so the rail and its panels keep their imports.
import type { Place } from "../../core/places/types";
import type { TFile } from "obsidian";

export { PARENT_KEYS, PlaceFinder, chainOf, hueOf, linkpathOf, parentLinkpath, parentOf, placeFinder } from "../../core/places/rule";
export type { Place } from "../../core/places/types";

/** The first version of the "places" service (now published by the core, with more methods). */
export interface PlacesService {
	version: 1;
	placeOf(file: TFile): Place;
	hueOf(path: string): number;
}
