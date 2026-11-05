// Pure parsing of what is typed in the quick add row: "Call the bank !1 @tomorrow".
import { addDays, isIsoDate } from "./group";
import { PRIORITIES, TAG_RE } from "./parse";
import type { Priority } from "./types";

export interface QuickAdd {
	text: string;
	priority: Priority | null;
	due: string | null;
	tag: string | null;
}

/** Words accepted after "@" for today and tomorrow, in every language of the interface. */
export interface DayWords {
	today: string[];
	tomorrow: string[];
}

const PRIORITY_RE = /(^|\s)!([0-3])(?=\s|$)/;
const AT_RE = /(^|\s)@(\S+)(?=\s|$)/gu;

/** Sunday first. No two-letter forms: "@me", "@do" or "@ma" are too likely to mean something else. */
export const WEEKDAY_WORDS: readonly (readonly string[])[] = [
	["sunday", "sun", "dimanche", "dim", "zondag", "zon", "domingo", "dom"],
	["monday", "mon", "lundi", "lun", "maandag", "maa", "lunes"],
	["tuesday", "tue", "tues", "mardi", "mar", "dinsdag", "din", "martes"],
	["wednesday", "wed", "mercredi", "mer", "woensdag", "woe", "miércoles", "mié"],
	["thursday", "thu", "thur", "thurs", "jeudi", "jeu", "donderdag", "don", "jueves", "jue"],
	["friday", "fri", "vendredi", "ven", "vrijdag", "vrij", "viernes", "vie"],
	["saturday", "sat", "samedi", "sam", "zaterdag", "zat", "sábado", "sáb"],
];

const weekdays = new Map(WEEKDAY_WORDS.flatMap((words, day) => words.map((word) => [normalizeWord(word), day] as const)));

/** Lowercase, no accents, letters and digits only: "Aujourd'hui" and "aujourdhui" match. */
export function normalizeWord(word: string): string {
	return word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}-]/gu, "");
}

/**
 * Reads `!1` `!2` `!3` (high, medium, low; `!0` none) and `@today`, `@tomorrow` or
 * `@YYYY-MM-DD` or a weekday; the first of each kind is taken out of the text.
 * With flags supplied, also names the first group tag (left in the text, where the writer reads it;
 * flags, priority tags and numbers like #123 are not group tags).
 */
export function parseQuickAdd(input: string, today: string, words: DayWords, flags?: ReadonlySet<string>): QuickAdd {
	let text = input;
	let priority: Priority | null = null;
	const p = text.match(PRIORITY_RE);
	if (p) {
		priority = ([null, "high", "medium", "low"] as const)[+p[2]];
		text = text.replace(PRIORITY_RE, "$1");
	}
	let due: string | null = null;
	const todayWords = new Set(words.today.map(normalizeWord));
	const tomorrowWords = new Set(words.tomorrow.map(normalizeWord));
	for (const m of text.matchAll(AT_RE)) {
		const value = m[2];
		const word = normalizeWord(value);
		if (isIsoDate(value)) due = value;
		else if (todayWords.has(word)) due = today;
		else if (tomorrowWords.has(word)) due = addDays(today, 1);
		else if (weekdays.has(word)) {
			const day = new Date(`${today}T00:00:00Z`).getUTCDay();
			due = addDays(today, (weekdays.get(word)! - day + 7) % 7 || 7);
		}
		else continue;
		const index = (m.index ?? 0) + m[1].length;
		text = text.slice(0, index) + text.slice(index + 1 + value.length);
		break;
	}
	let tag: string | null = null;
	if (flags) {
		for (const m of text.matchAll(TAG_RE)) {
			const name = m[2].toLowerCase();
			// The same rule as tagsOf: "#123" or "#2026" is a reference, not a tag.
			if (flags.has(name) || PRIORITIES.some((priority) => priority === name) || /^[\d/_-]+$/.test(name)) continue;
			// Left in the text: the writer reads the line's first tag as the task's group.
			tag = name;
			break;
		}
	}
	return { text: text.replace(/\s+/g, " ").trim(), priority, due, tag };
}
