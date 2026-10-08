// Obsidian's moment, with the few types Snailkit uses written here. The types of the "moment"
// package are not always found where the plugin is checked (it only comes with Obsidian's own
// typings), and an untyped moment makes every date call unsafe for the linter.
import { moment as obsidianMoment } from "obsidian";

export type DateUnit = "day" | "days" | "week" | "weeks" | "month" | "months" | "year" | "years";

export interface Moment {
	format(format?: string): string;
	locale(lang: string): Moment;
	isValid(): boolean;
	year(): number;
	month(): number;
	date(): number;
	/** 0 Sunday to 6 Saturday. */
	day(): number;
	isoWeek(): number;
	add(amount: number, unit: DateUnit): Moment;
	subtract(amount: number, unit: DateUnit): Moment;
	clone(): Moment;
	toDate(): Date;
}

export interface MomentLocale {
	weekdaysMin(): string[];
	/** 0 Sunday, 1 Monday... */
	firstDayOfWeek(): number;
}

export interface MomentStatic {
	(input?: string | number | Date | number[], format?: string, strict?: boolean): Moment;
	/** The current locale. */
	localeData(): MomentLocale;
	/** The locale of `lang`, null when moment does not bundle it. */
	localeData(lang: string): MomentLocale | null;
}

export const moment = obsidianMoment as unknown as MomentStatic;
