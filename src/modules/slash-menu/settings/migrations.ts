import type { ActionConfig, SlashCategory, SlashItem, SlashMenuSettings } from "../types/settings";
import { SETTINGS_VERSION } from "../types/settings";
import { defaultSettings } from "./defaults";

type Raw = Record<string, unknown>;

/**
 * Migrations from version N to N+1, indexed by N. Each one receives the raw
 * object of version N and returns the raw object of version N+1.
 * Add an entry here (and bump SETTINGS_VERSION) whenever the format changes.
 */
const MIGRATIONS: Record<number, (data: Raw) => Raw> = {
	// 1: (data) => ({ ...data, version: 2, newField: ... }),
};

function isObject(v: unknown): v is Raw {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback: string): string {
	return typeof v === "string" ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
	return typeof v === "boolean" ? v : fallback;
}

function num(v: unknown, fallback: number, min: number, max: number): number {
	return typeof v === "number" && isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

function strList(v: unknown): string[] {
	return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim()) : [];
}

/** Returns a valid ActionConfig or null when the stored action is unusable. */
export function sanitizeAction(raw: unknown): ActionConfig | null {
	if (!isObject(raw)) return null;
	if (Object.values(raw).some((v) => typeof v === "string" && /\{\{\s*(clipboard|selection)\b/i.test(v))) return null;
	switch (raw.type) {
		case "command":
			return typeof raw.commandId === "string" && raw.commandId ? { type: "command", commandId: raw.commandId } : null;
		case "markdown":
			return { type: "markdown", template: str(raw.template, "") };
		case "callout": {
			const fold = raw.fold === "open" || raw.fold === "closed" ? raw.fold : "none";
			return { type: "callout", calloutType: str(raw.calloutType, "note") || "note", title: str(raw.title, ""), fold, content: str(raw.content, "") };
		}
		case "block": {
			const kinds = ["text", "h1", "h2", "h3", "h4", "h5", "h6", "bullet", "numbered", "todo", "quote"];
			return typeof raw.block === "string" && kinds.includes(raw.block) ? { type: "block", block: raw.block as never } : null;
		}
		case "new-note":
			return {
				type: "new-note",
				nameTemplate: str(raw.nameTemplate, ""),
				folder: str(raw.folder, ""),
				insertLink: bool(raw.insertLink, true),
				openInNewTab: bool(raw.openInNewTab, true),
			};
		default:
			return null;
	}
}

function sanitizeItem(raw: unknown, categoryIds: Set<string>, fallbackCategory: string): SlashItem | null {
	if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) return null;
	const action = sanitizeAction(raw.action);
	if (!action) return null;
	const categoryId = typeof raw.categoryId === "string" && categoryIds.has(raw.categoryId) ? raw.categoryId : fallbackCategory;
	return {
		id: raw.id,
		customized: bool(raw.customized, false),
		enabled: bool(raw.enabled, true),
		pinned: bool(raw.pinned, false),
		name: str(raw.name, "Untitled").trim() ? str(raw.name, "Untitled") : "Untitled",
		description: str(raw.description, ""),
		icon: str(raw.icon, ""),
		categoryId,
		keywords: strList(raw.keywords),
		aliases: strList(raw.aliases),
		action,
	};
}

function sanitizeCategories(raw: unknown): SlashCategory[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: SlashCategory[] = [];
	for (const c of raw) {
		if (!isObject(c) || typeof c.id !== "string" || !c.id || seen.has(c.id)) continue;
		seen.add(c.id);
		out.push({ customized: bool(c.customized, false), id: c.id, name: str(c.name, c.id).trim() ? str(c.name, c.id) : c.id, hidden: bool(c.hidden, false) });
	}
	return out;
}

/**
 * Turns whatever loadData() returned (null on first run, an older version, a
 * hand-edited file, an imported file) into a complete, valid settings object.
 * Unknown fields are dropped so we never store unnecessary data.
 */
export function migrateSettings(data: unknown): SlashMenuSettings {
	const defaults = defaultSettings();
	if (!isObject(data)) return defaults;

	let raw: Raw = { ...data };
	let version = typeof raw.version === "number" ? raw.version : 1;
	while (version < SETTINGS_VERSION && MIGRATIONS[version]) {
		raw = MIGRATIONS[version](raw);
		version++;
	}

	let categories = sanitizeCategories(raw.categories);
	if (categories.length === 0) categories = defaults.categories;
	const categoryIds = new Set(categories.map((c) => c.id));
	const fallbackCategory = categories[0].id;

	const items: SlashItem[] = [];
	const seenItems = new Set<string>();
	const rawItems = Array.isArray(raw.items) ? raw.items : defaults.items;
	for (const r of rawItems) {
		const it = sanitizeItem(r, categoryIds, fallbackCategory);
		if (it && !seenItems.has(it.id)) {
			seenItems.add(it.id);
			items.push(it);
		}
	}

	const unavailableDisplay = raw.unavailableDisplay === "hide" ? "hide" : raw.unavailableDisplay === "dim" ? "dim" : defaults.unavailableDisplay;
	const trigger = str(raw.triggerChar, defaults.triggerChar);

	return {
		version: SETTINGS_VERSION,
		triggerChar: trigger.length > 0 && trigger.length <= 3 && !/\s/.test(trigger) ? trigger : defaults.triggerChar,
		triggerAfterSpaceOnly: true,
		showDescriptions: bool(raw.showDescriptions, defaults.showDescriptions),
		showIcons: bool(raw.showIcons, defaults.showIcons),
		showCategories: bool(raw.showCategories, defaults.showCategories),
		showPinned: bool(raw.showPinned, defaults.showPinned),
		showRecent: bool(raw.showRecent, defaults.showRecent),
		maxRecent: num(raw.maxRecent, defaults.maxRecent, 1, 20),
		animations: bool(raw.animations, defaults.animations),
		flashInserted: bool(raw.flashInserted, defaults.flashInserted),
		unavailableDisplay,
		maxResults: num(raw.maxResults, defaults.maxResults, 10, 500),
		dateFormat: str(raw.dateFormat, defaults.dateFormat) || defaults.dateFormat,
		timeFormat: str(raw.timeFormat, defaults.timeFormat) || defaults.timeFormat,
		datetimeFormat: str(raw.datetimeFormat, defaults.datetimeFormat) || defaults.datetimeFormat,
		categories,
		items,
		recent: strList(raw.recent).filter((id) => seenItems.has(id)),
	};
}
