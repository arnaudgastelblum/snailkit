// Daily notes for every module: where they are (the note rail's Calendar settings when it runs,
// else Obsidian's Daily notes plugin), today's note, and creating it from its template.
// Moved from the note rail's Calendar (which re-exports these helpers); behavior unchanged.
import { TFile, TFolder, type App } from "obsidian";
import type { NoteRailService } from "./services";
import { moment } from "./moment";

/** Where daily notes live and how they are named. */
export interface DailyConfig {
	/** Folder path without leading/trailing slash, "" = vault root. */
	folder: string;
	/** moment format of the note name (may contain "/" for nested folders, like YYYY/MM/YYYY-MM-DD). */
	format: string;
	/** Template note path ("" = none), as written in the settings (with or without ".md"). */
	template: string;
}

/** Overrides of Obsidian's Daily notes settings (the note rail's Calendar settings); "" = Obsidian's. */
export interface DailyOverrides {
	calendarFolder: string;
	calendarFormat: string;
	calendarTemplate: string;
}

const NO_OVERRIDES: DailyOverrides = { calendarFolder: "", calendarFormat: "", calendarTemplate: "" };

/** Options of the core Daily notes plugin, when Obsidian exposes them (even with the plugin off). */
function coreDailyOptions(app: App): Record<string, unknown> | undefined {
	try {
		const internal = (app as unknown as { internalPlugins?: { getPluginById?(id: string): { instance?: { options?: Record<string, unknown> } } | null } }).internalPlugins;
		return internal?.getPluginById?.("daily-notes")?.instance?.options;
	} catch {
		return undefined;
	}
}

/** Settings overrides first, then the core Daily notes plugin options, then defaults (root folder, YYYY-MM-DD). */
export function getDailyConfig(app: App, settings: DailyOverrides): DailyConfig {
	const core = coreDailyOptions(app);
	const nonEmpty = (value: unknown): string => typeof value === "string" ? value.trim() : "";
	return {
		folder: (nonEmpty(settings.calendarFolder) || nonEmpty(core?.folder)).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/"),
		format: nonEmpty(settings.calendarFormat) || nonEmpty(core?.format) || "YYYY-MM-DD",
		template: nonEmpty(settings.calendarTemplate) || nonEmpty(core?.template),
	};
}

/** Vault path ("Daily/2026-10-02.md") of the daily note of `key` ("YYYY-MM-DD"). */
export function dailyPath(key: string, cfg: DailyConfig): string {
	const name = moment(key, "YYYY-MM-DD", true).format(cfg.format);
	return `${cfg.folder ? cfg.folder + "/" : ""}${name}.md`;
}

/** "YYYY-MM-DD" when `path` is a daily note under cfg (strict parse), else null. Pure. */
export function parseDailyPath(path: string, cfg: DailyConfig): string | null {
	const prefix = cfg.folder ? cfg.folder + "/" : "";
	if (!path.endsWith(".md") || !path.startsWith(prefix)) return null;
	const name = path.slice(prefix.length, -3);
	const date = moment(name, cfg.format, true);
	return date.isValid() && date.format(cfg.format) === name ? date.format("YYYY-MM-DD") : null;
}

/** Template text with {{title}}, {{date}}, {{date:FMT}}, {{time}}, {{time:FMT}} replaced (Obsidian core rules). Pure given `now`. */
export function applyDailyTemplate(text: string, key: string, title: string, now: Date): string {
	const day = moment(key, "YYYY-MM-DD", true);
	const time = moment(now);
	return text.replace(/\{\{\s*(title|date|time)(?:\s*:\s*([^{}]*?))?\s*\}\}/g, (token, kind: string, format?: string) => {
		if (kind === "title") return format === undefined ? title : token;
		return kind === "date" ? day.format(format?.trim() || "YYYY-MM-DD") : time.format(format?.trim() || "HH:mm");
	});
}

/** Existing daily note of `key`, or a new one (folders created, template applied). Never overwrites. */
export async function getOrCreateDailyNote(app: App, key: string, cfg: DailyConfig): Promise<TFile> {
	const path = dailyPath(key, cfg);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return existing;
	const parts = path.split("/");
	for (let i = 1; i < parts.length; i++) {
		const folder = parts.slice(0, i).join("/");
		if (app.vault.getAbstractFileByPath(folder) instanceof TFolder) continue;
		try {
			await app.vault.createFolder(folder);
		} catch (error) {
			if (!(app.vault.getAbstractFileByPath(folder) instanceof TFolder)) throw error;
		}
	}
	let text = "";
	if (cfg.template) {
		const template = app.vault.getAbstractFileByPath(cfg.template.endsWith(".md") ? cfg.template : cfg.template + ".md");
		if (template instanceof TFile) text = await app.vault.read(template);
		else console.warn(`[Snailkit] daily notes: template not found: ${cfg.template}`);
	}
	const title = parts[parts.length - 1].slice(0, -3);
	try {
		return await app.vault.create(path, applyDailyTemplate(text, key, title, new Date()));
	} catch (error) {
		const raced = app.vault.getAbstractFileByPath(path);
		if (raced instanceof TFile) return raced;
		throw error;
	}
}

/** Where daily notes are: the note rail's settings when it runs (they override Obsidian's), else Obsidian's. */
export function dailyConfig(app: App, rail: NoteRailService | undefined): DailyConfig {
	try {
		if (rail?.version === 1 && typeof rail.dailyConfig === "function") return rail.dailyConfig();
	} catch {
		/* fall back on Obsidian's settings */
	}
	return getDailyConfig(app, NO_OVERRIDES);
}

/** "YYYY-MM-DD" of today, in local time. */
export function todayKey(): string {
	return moment().format("YYYY-MM-DD");
}

/** Today's daily note when it exists, else null (nothing is created). */
export function todayNote(app: App, cfg: DailyConfig): TFile | null {
	const file = app.vault.getAbstractFileByPath(dailyPath(todayKey(), cfg));
	return file instanceof TFile ? file : null;
}

/** The daily note of `key` ("YYYY-MM-DD"), created from its template when missing. */
export function getOrCreateDaily(app: App, key: string, cfg: DailyConfig): Promise<TFile> {
	return getOrCreateDailyNote(app, key, cfg);
}
