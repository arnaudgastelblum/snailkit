// Daily notes engine of the Calendar panel: the month grid and a lazy index of existing daily notes.
// Where daily notes are, their names, the template and creating them now live in the core
// (src/core/daily.ts), shared with Home and Search; they are re-exported here unchanged.
import { moment, TFile } from "obsidian";
import type { App, EventRef } from "obsidian";
import type { Locale } from "moment";
import { parseDailyPath, type DailyConfig } from "../../../../core/daily";

export { applyDailyTemplate, dailyPath, getDailyConfig, getOrCreateDailyNote, parseDailyPath, type DailyConfig } from "../../../../core/daily";

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
