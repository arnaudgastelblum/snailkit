// Pure parsing of what is typed in the quick add row: "Call the bank !1 @tomorrow".
import { addDays, isIsoDate } from "./group";
import type { Priority } from "./types";

export interface QuickAdd {
	text: string;
	priority: Priority | null;
	due: string | null;
}

/** Words accepted after "@" for today and tomorrow, in every language of the interface. */
export interface DayWords {
	today: string[];
	tomorrow: string[];
}

const PRIORITY_RE = /(^|\s)!([0-3])(?=\s|$)/;
const AT_RE = /(^|\s)@(\S+)(?=\s|$)/gu;

/** Lowercase, no accents, letters and digits only: "Aujourd'hui" and "aujourdhui" match. */
export function normalizeWord(word: string): string {
	return word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}-]/gu, "");
}

/**
 * Reads `!1` `!2` `!3` (high, medium, low; `!0` none) and `@today`, `@tomorrow` or
 * `@YYYY-MM-DD`; the first of each kind is taken out of the text, the rest stays as typed.
 */
export function parseQuickAdd(input: string, today: string, words: DayWords): QuickAdd {
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
		else continue;
		const index = (m.index ?? 0) + m[1].length;
		text = text.slice(0, index) + text.slice(index + 1 + value.length);
		break;
	}
	return { text: text.replace(/\s+/g, " ").trim(), priority, due };
}
