import { ACTIONS } from "./logic";

/** A tab of the main area with a file, as the workspace gives it. */
export interface OpenTab {
	path: string;
	activeTime: number;
}

/** The open files, most recently active first, each once, without current; at most limit (default 5). */
export function recentTabs(tabs: readonly OpenTab[], current: string | null, limit = 5): string[] {
	if (limit <= 0) return [];
	const times = new Map<string, number>();
	for (const tab of tabs) {
		if (tab.path === current) continue;
		const previous = times.get(tab.path);
		if (previous === undefined || tab.activeTime > previous) times.set(tab.path, tab.activeTime);
	}
	return [...times].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([path]) => path);
}

/**
 * Show the two nearest parents, top first, joined by " › ". Parents arrive nearest first.
 * Leave out home unless it is the only parent. Return an empty string without parents.
 */
export function crumb(parents: readonly string[], home: string | null): string {
	const visible = parents.length === 1 ? parents : parents.filter((parent) => parent !== home);
	return visible.slice(0, 2).reverse().join(" › ");
}

/**
 * Copy older settings, assigning D to the launcher and moving New tab from D to DU.
 * Use defaults for missing action values. Disable either assignment if another action uses it.
 * Settings with a launcher key are copied unchanged. Neither input is mutated.
 */
export function withLauncher(stored: Record<string, unknown>, defaults: Record<string, string>): Record<string, unknown> {
	const out = { ...stored };
	if ("launcher" in stored) return out;
	const used = (gesture: string, action: string): boolean => ACTIONS.some((other) =>
		other !== action && (out[other] ?? defaults[other]) === gesture);
	if ((out.newTab ?? defaults.newTab) === "D") out.newTab = used("DU", "newTab") ? "" : "DU";
	out.launcher = used("D", "launcher") ? "" : "D";
	return out;
}
