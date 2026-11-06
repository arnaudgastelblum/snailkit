// The Home and Search services as the rail uses them (asked for each time: they come and go).
import type { HomeService, SearchService } from "../../../core/services";
import type { RailEnv } from "../types";

export function homeOf(env: Pick<RailEnv, "service">): HomeService | null {
	try {
		const home = env.service<HomeService>("home");
		return home && home.version === 1 && typeof home.openPlace === "function" ? home : null;
	} catch {
		return null;
	}
}

export function searchOf(env: Pick<RailEnv, "service">): SearchService | null {
	try {
		const search = env.service<SearchService>("search");
		return search && search.version === 1 && typeof search.open === "function" ? search : null;
	} catch {
		return null;
	}
}
