// Shape of data.json and how stored values are merged over defaults. Pure functions, tested in test/.
import { isLang, type LanguageSetting } from "../i18n";
import type { AutoOpenMode } from "./workbench/types";

export interface ModuleRecord {
	enabled: boolean;
	settings: Record<string, unknown>;
}

export interface SnailkitData {
	/** Format of this file, bumped when the shape changes. */
	version: 1;
	language: LanguageSetting;
	/** False until the welcome notice has been shown once. */
	welcomed: boolean;
	/** One-time hints of the core already shown (for example "workbench-tabs"). */
	hints: string[];
	/** Settings of the Workbench, a part of the core (not a module). */
	workbench: WorkbenchSettings;
	modules: Record<string, ModuleRecord>;
}

export interface WorkbenchSettings {
	/** When the Workbench opens by itself, on Home (else its first tab). Phones follow the same setting. */
	autoOpen: AutoOpenMode;
}

export const AUTO_OPEN_MODES: AutoOpenMode[] = ["startup-and-new-tabs", "startup", "never"];
const isAutoOpen = (value: unknown): value is AutoOpenMode => AUTO_OPEN_MODES.includes(value as AutoOpenMode);

/** The hint bubble of the Workbench's tabs (shown once). */
export const HINT_WORKBENCH_TABS = "workbench-tabs";

export function defaultData(): SnailkitData {
	return { version: 1, language: "auto", welcomed: false, hints: [], workbench: { autoOpen: "startup-and-new-tabs" }, modules: {} };
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads whatever was stored (possibly nothing, possibly hand-edited) into a valid SnailkitData. */
export function normalizeData(raw: unknown): SnailkitData {
	const data = defaultData();
	if (!isObject(raw)) return data;
	if (raw.language === "auto" || isLang(raw.language)) data.language = raw.language;
	data.welcomed = raw.welcomed === true;
	if (Array.isArray(raw.hints)) {
		for (const hint of raw.hints) if (typeof hint === "string" && hint && !data.hints.includes(hint)) data.hints.push(hint);
	}
	if (isObject(raw.modules)) {
		for (const [id, record] of Object.entries(raw.modules)) {
			if (!isObject(record)) continue;
			data.modules[id] = {
				enabled: record.enabled === true,
				settings: isObject(record.settings) ? record.settings : {},
			};
		}
	}
	// The Workbench's hint was a setting of the Tasks module before the Workbench moved to the core.
	const tasks = data.modules.tasks?.settings;
	if (tasks?.workbenchTabsHintSeen === true && !data.hints.includes(HINT_WORKBENCH_TABS)) data.hints.push(HINT_WORKBENCH_TABS);
	// When the Workbench opens by itself was a setting of the Home module before it moved to the core.
	const workbench = isObject(raw.workbench) ? raw.workbench : {};
	const formerAutoOpen = data.modules.home?.settings.openWorkbench;
	if (isAutoOpen(workbench.autoOpen)) data.workbench.autoOpen = workbench.autoOpen;
	else if (isAutoOpen(formerAutoOpen)) data.workbench.autoOpen = formerAutoOpen;
	return data;
}

/**
 * Stored settings over a deep copy of the defaults. Only keys known to the defaults are kept,
 * and only when their type matches the default (a number stays a number), at every depth.
 * Arrays are taken whole when the stored value is an array. A `null` default accepts any value.
 */
export function mergeSettings<S extends object>(defaults: S, stored: Record<string, unknown>): S {
	return mergeObject(defaults as Record<string, unknown>, stored) as S;
}

function mergeObject(defaults: Record<string, unknown>, stored: Record<string, unknown>): Record<string, unknown> {
	const result = structuredClone(defaults);
	for (const [key, fallback] of Object.entries(defaults)) {
		if (!(key in stored)) continue;
		const value = stored[key];
		if (fallback === null) result[key] = structuredClone(value);
		else if (Array.isArray(fallback)) {
			if (Array.isArray(value)) result[key] = structuredClone(value);
		} else if (isObject(fallback)) {
			if (isObject(value)) result[key] = mergeObject(fallback, value);
		} else if (typeof value === typeof fallback) {
			result[key] = value;
		}
	}
	return result;
}
