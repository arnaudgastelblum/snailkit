// Dates as the Home shows them: dated titles ("2026-10-01 Pilot review" shows "Pilot review"),
// day keys, relative labels. Pure; the caller gives "now" and the formatters.

const DATED = /^(\d{4}-\d{2}-\d{2})(?:\s+|\s*[-_·]\s*)(.+)$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_DAY = 86_400_000;

/** A title that starts with a date shows the rest; the date comes back separately. */
export function splitDated(title: string): { label: string; date: string | null } {
	const match = DATED.exec(title.trim());
	if (!match || !isDay(match[1])) return { label: title, date: null };
	return { label: match[2].trim(), date: match[1] };
}

export function isDay(value: string): boolean {
	if (!DAY.test(value)) return false;
	const [y, m, d] = value.split("-").map(Number);
	const date = new Date(y, m - 1, d);
	return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** "YYYY-MM-DD" of a moment, in local time. */
export function dayKey(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of a day key. */
export function dayStart(key: string): number {
	const [y, m, d] = key.split("-").map(Number);
	return new Date(y, m - 1, d).getTime();
}

/** Whole days from `a` to `b` (both "YYYY-MM-DD"): positive when b is later. Safe across DST. */
export function daysBetween(a: string, b: string): number {
	return Math.round((dayStart(b) - dayStart(a)) / MS_DAY);
}

export interface DateWords {
	today: string;
	yesterday: string;
	tomorrow: string;
	/** "Tue", "mar." */
	weekday(ms: number): string;
	/** "6 Oct", "6 oct." (with the year when not this year). */
	date(ms: number, withYear: boolean): string;
	/** "09:40" */
	time(ms: number): string;
}

/** How long ago, as a short label: the time today, "yesterday", a weekday this week, else a date. */
export function relLabel(ms: number, now: number, words: DateWords): string {
	if (!ms) return "";
	const days = daysBetween(dayKey(ms), dayKey(now));
	if (days <= 0) return words.time(ms);
	if (days === 1) return words.yesterday;
	if (days < 7) return words.weekday(ms);
	return words.date(ms, new Date(ms).getFullYear() !== new Date(now).getFullYear());
}

/** A due date: "today", "tomorrow", "yesterday", else the date. `late` when before today. */
export function dueLabel(due: string, today: string, words: DateWords): { text: string; late: boolean } {
	if (!isDay(due)) return { text: due, late: false };
	const days = daysBetween(today, due);
	const late = days < 0;
	if (days === 0) return { text: words.today, late };
	if (days === 1) return { text: words.tomorrow, late };
	if (days === -1) return { text: words.yesterday, late };
	const ms = dayStart(due);
	return { text: words.date(ms, due.slice(0, 4) !== today.slice(0, 4)), late };
}

/** The date of a dated title, as a label ("1 Oct"). */
export function dateLabel(date: string, today: string, words: DateWords): string {
	if (!isDay(date)) return date;
	return words.date(dayStart(date), date.slice(0, 4) !== today.slice(0, 4));
}
