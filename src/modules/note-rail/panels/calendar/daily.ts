// Daily notes engine of the Calendar panel: where daily notes are, the month grid, the template,
// and a lazy index of existing daily notes. Everything but the index and creation is pure.
import { moment, TFile, TFolder } from "obsidian";
import type { App, EventRef } from "obsidian";
import type { Locale } from "moment";
import type { NoteRailSettings } from "../../types";

/** Where daily notes live and how they are named. */
export interface DailyConfig {
	/** Folder path without leading/trailing slash, "" = vault root. */
	folder: string;
	/** moment format of the note name (may contain "/" for nested folders, like YYYY/MM/YYYY-MM-DD). */
	format: string;
	/** Template note path ("" = none), as written in the settings (with or without ".md"). */
	template: string;
}

/** One cell of the month grid. */
export interface CalendarDay {
	/** "YYYY-MM-DD". */
	key: string;
	year: number;
	/** 0-11. */
	month: number;
	/** 1-31. */
	day: number;
	/** 0 = Sunday ... 6 = Saturday. */
	weekday: number;
	/** True when the day belongs to the displayed month. */
	inMonth: boolean;
	isToday: boolean;
	/** ISO 8601 week number of this day. */
	isoWeek: number;
}

type DailySettings = Pick<NoteRailSettings, "calendarFolder" | "calendarFormat" | "calendarTemplate">;

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
export function getDailyConfig(app: App, settings: DailySettings): DailyConfig {
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

/** Always 6 rows x 7 days covering `month` of `year`, starting on `weekStart` (0 = Sunday, 1 = Monday). Pure. */
export function monthGrid(year: number, month: number, weekStart: number, todayKey: string): CalendarDay[] {
	const date = moment([year, month, 1]);
	date.subtract((date.day() - weekStart + 7) % 7, "days");
	return Array.from({ length: 42 }, () => {
		const key = date.format("YYYY-MM-DD");
		const cell = {
			key, year: date.year(), month: date.month(), day: date.date(), weekday: date.day(),
			inMonth: date.year() === year && date.month() === month, isToday: key === todayKey, isoWeek: date.isoWeek(),
		};
		date.add(1, "day");
		return cell;
	});
}

/** 0 (Sunday) or 1 (Monday) from the setting; "language" reads the first day of the week of `lang`. */
export function weekStartOf(setting: string, lang: string): number {
	if (setting === "sunday") return 0;
	if (setting !== "language") return 1;
	return localeData(lang).firstDayOfWeek() === 0 ? 0 : 1;
}

/** moment's data for `lang` (falls back to moment's current locale when that language is not bundled). */
export function localeData(lang: string): Locale {
	return moment.localeData(lang) ?? moment.localeData();
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

/**
 * Index of existing daily notes, "YYYY-MM-DD" -> file. Built lazily from vault.getMarkdownFiles(),
 * invalidated by the vault events it registers. Call destroy() to release them.
 */
export class DailyIndex {
	private files = new Map<string, TFile>();
	private builtConfig: DailyConfig | null = null;
	private dirty = true;
	private listeners = new Set<() => void>();
	private vaultRefs: EventRef[];
	private metadataRef: EventRef;
	private timer: number | null = null;
	private destroyed = false;
	constructor(private app: App, private getConfig: () => DailyConfig) {
		this.vaultRefs = [
			app.vault.on("create", () => this.invalidate()),
			app.vault.on("delete", () => this.invalidate()),
			app.vault.on("rename", () => this.invalidate()),
		];
		this.metadataRef = app.metadataCache.on("changed", (file) => {
			if (parseDailyPath(file.path, this.getConfig()) !== null) this.invalidate();
		});
	}
	private invalidate(): void {
		if (this.destroyed) return;
		this.dirty = true;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			// Folder rename events can precede updates to their descendants.
			this.dirty = true;
			for (const listener of this.listeners) listener();
		}, 100);
	}
	get(key: string): TFile | null {
		if (this.destroyed) return null;
		const cfg = this.getConfig();
		if (this.dirty || this.builtConfig?.folder !== cfg.folder || this.builtConfig?.format !== cfg.format) {
			this.files.clear();
			for (const file of this.app.vault.getMarkdownFiles()) {
				const day = parseDailyPath(file.path, cfg);
				if (day !== null) this.files.set(day, file);
			}
			this.builtConfig = { ...cfg };
			this.dirty = false;
		}
		return this.files.get(key) ?? null;
	}
	/** Number of open tasks ("- [ ]") of the daily note of `key`, from the metadata cache (0 if none). */
	openTasks(key: string): number {
		const file = this.get(key);
		return file ? this.app.metadataCache.getFileCache(file)?.listItems?.filter((item) => item.task === " ").length ?? 0 : 0;
	}
	/** Called after any change that may alter the index or task counts (debounced ~100 ms). Returns an unsubscribe. */
	onChange(listener: () => void): () => void {
		if (!this.destroyed) this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		for (const ref of this.vaultRefs) this.app.vault.offref(ref);
		this.app.metadataCache.offref(this.metadataRef);
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		this.listeners.clear();
		this.files.clear();
	}
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
		else console.warn(`[Snailkit] note-rail: daily note template not found: ${cfg.template}`);
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
