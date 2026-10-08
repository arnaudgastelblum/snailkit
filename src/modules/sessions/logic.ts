// Pure logic of idea sessions: sentences, what looks like a task, how a caught sentence is
// written back, how tags are suggested and learned, and what the summary counts. No Obsidian here:
// everything is tested in test/sessions.test.ts.
import { ARTICLE_CLITICS, CLITICS, END_VERBS, FILLERS, FINITE, MARKERS, NL_PREFIXES, NOT_VERBS, OIR_VERBS, START_VERBS, STOP_WORDS } from "./verbs";

// ----- sentences -----

export interface Sentence {
	/** Offset of the first character (no leading space). */
	start: number;
	/** Offset after the last character, punctuation included, trailing spaces excluded. */
	end: number;
	text: string;
}

const ENDERS = ".!?…";
const CLOSERS = "\"'»”’)]*_";

/**
 * Sentences of a line. A sentence ends with . ! ? or … followed by a space or the end of the line
 * (so "3.5", "file.md" or "e.g.x" do not cut), never inside a [[link]], a `code span` or a URL.
 */
export function sentences(text: string): Sentence[] {
	const out: Sentence[] = [];
	let start = -1;
	let link = 0;
	let code = false;
	const push = (end: number) => {
		if (start < 0) return;
		let e = end;
		while (e > start && /\s/.test(text[e - 1])) e--;
		if (e > start) out.push({ start, end: e, text: text.slice(start, e) });
		start = -1;
	};
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (start < 0 && !/\s/.test(c)) start = i;
		if (c === "`") code = !code;
		if (code) continue;
		if (c === "[" && text[i + 1] === "[") { link++; i++; continue; }
		if (c === "]" && text[i + 1] === "]" && link) { link--; i++; continue; }
		if (link) continue;
		if (ENDERS.includes(c)) {
			if (c === "." && /^\w+:\/\//.test(text.slice(text.lastIndexOf(" ", i) + 1, i + 4))) continue;
			let j = i;
			while (j + 1 < text.length && ENDERS.includes(text[j + 1])) j++;
			while (j + 1 < text.length && CLOSERS.includes(text[j + 1])) j++;
			if (j + 1 >= text.length || /\s/.test(text[j + 1])) {
				push(j + 1);
				i = j;
			}
		}
	}
	push(text.length);
	return out;
}

/** The sentence at `offset` (or the closest one before it), or null on an empty line. */
export function sentenceAt(text: string, offset: number): Sentence | null {
	const all = sentences(text);
	if (!all.length) return null;
	let found = all[0];
	for (const s of all) if (s.start <= offset) found = s;
	return found;
}

// ----- what a sentence looks like -----

const fold = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'");
const deburr = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** The sentence without a leading "don't forget to", "penser à", "niet vergeten"... */
export function stripFillers(text: string): string {
	let t = text.trim().replace(/^[-*+]\s+/, "");
	for (let changed = true; changed;) {
		changed = false;
		const low = fold(t);
		for (const f of FILLERS) {
			if (!low.startsWith(f)) continue;
			const next = t.charAt(f.length);
			// Whole words only ("must" is not "mustard"); a filler ending with ":" or "'" stands alone.
			if (next && /[\p{L}\p{N}]/u.test(next) && !/[:']$/.test(f)) continue;
			t = t.slice(f.length).replace(/^[\s:,]+/, "");
			changed = true;
			break;
		}
	}
	return t;
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;

/**
 * [word, weight]: what the user taught about the first words of sentences, most recent first. A
 * sentence made a task raises its word, a dotted sentence kept as an idea or deleted lowers it.
 * Words are folded and without accents. Kept in the settings, never in a note.
 */
export type LearnedVerbs = Array<[string, number]>;

/** How much the word itself says: a verb of the lists, a word shaped like an infinitive, or nothing. */
const KNOWN = 4;
const SHAPED = 2;
/** Learned weights stay within [-WEIGHT_MAX, WEIGHT_MAX]: four refusals silence even a known verb. */
const WEIGHT_MAX = 4;

type Lang = "fr" | "es" | "en" | "nl";
const LANGS: readonly Lang[] = ["fr", "es", "en", "nl"];

const PLAIN_START: ReadonlySet<string> = new Set([...START_VERBS].map(deburr));
const PLAIN_END: ReadonlySet<string> = new Set([...END_VERBS].map(deburr));
const FUNCTION_WORDS: ReadonlySet<string> = new Set([...STOP_WORDS, ...CLITICS, ...ARTICLE_CLITICS, ...FINITE, ...LANGS.flatMap((l) => [...MARKERS[l]].map(deburr))]);
/** French -aire and -oire words are nouns, but for these verbs. */
const AIRE_VERBS: ReadonlySet<string> = new Set("faire refaire defaire satisfaire parfaire plaire deplaire complaire taire extraire distraire soustraire traire boire croire".split(" "));

/**
 * The languages in which a word (folded, without accents) has the shape of an infinitive: French
 * -er -ir and a few -re endings (-dre, -ttre, -aitre, -ire, -ivre...), Spanish -ar -er -ir with
 * or without attached pronouns ("llamarle", "inscribirse"), Dutch -eren. Known false friends
 * (NOT_VERBS) have none.
 */
export function infinitiveShape(word: string): Lang[] {
	if (word.length < 4 || !/^[a-z]+$/.test(word) || NOT_VERBS.has(word)) return [];
	if (/oir$/.test(word)) return OIR_VERBS.has(word) ? ["fr"] : [];
	if (/[ae]ir$/.test(word)) return [];
	if (/[ei]r$/.test(word)) return ["fr", "es"];
	if (/ar$/.test(word)) return ["es"];
	if (/eren$/.test(word)) return word.length >= 6 ? ["nl"] : [];
	if (/[ao]ire$/.test(word)) return AIRE_VERBS.has(word) ? ["fr"] : [];
	if (/(?:dre|ttre|aitre|oitre|ire|ivre|ompre|aincre|clure|clore)$/.test(word)) return ["fr"];
	const pronoun = /^(.+)(ar|er|ir)(?:se|me|te|nos|le|les|lo|la|los|las)(?:lo|la|los|las)?$/.exec(word);
	// "cuadernos", "inviernos": -ernos is a plural far more often than "hacernos".
	if (pronoun && pronoun[1].length >= 2 && !(pronoun[2] === "er" && /nos$/.test(word))) return ["es"];
	return [];
}

/** How many words only one language uses, per language (an elided "l'", "d'" counts for French). */
function languages(tokens: readonly string[]): Record<Lang, number> {
	const n: Record<Lang, number> = { fr: 0, es: 0, en: 0, nl: 0 };
	for (const t of tokens) {
		if (/^(?:[cdjlmnst]|qu)'./.test(t)) n.fr++;
		else for (const l of LANGS) if (MARKERS[l].has(t)) n[l]++;
	}
	return n;
}

/** The rest of the sentence does not speak another language more than one of `langs`. */
function fits(langs: readonly Lang[], n: Record<Lang, number>): boolean {
	const own = Math.max(...langs.map((l) => n[l]));
	const other = Math.max(0, ...LANGS.filter((l) => !langs.includes(l)).map((l) => n[l]));
	return own >= other;
}

/**
 * The word that should be a verb at the start: past "s'", "m'", "l'" and pronouns ("lui
 * envoyer", "s'en occuper"). `weak`: after "le", "la", "les" or "l'", which are articles as often,
 * only a known or learned verb counts ("le rappeler", not "le dîner"). `next`: index of the word after it.
 */
function headOf(found: readonly string[]): { word: string; weak: boolean; next: number } {
	let i = 0;
	let weak = false;
	let w = deburr(found[0]);
	for (let step = 0; step < 3; step++) {
		const elided = /^([lmst])'(.+)$/.exec(w);
		if (elided) {
			weak = weak || elided[1] === "l";
			w = elided[2];
			continue;
		}
		if ((CLITICS.has(w) || ARTICLE_CLITICS.has(w)) && i + 1 < found.length) {
			weak = weak || ARTICLE_CLITICS.has(w);
			w = deburr(found[++i]);
			continue;
		}
		break;
	}
	// "don't" is "don", "follow-up" is "follow".
	return { word: w.replace(/'.*$/, "").split("-")[0], weak, next: i + 1 };
}

const weightCache = new WeakMap<LearnedVerbs, Map<string, number>>();

function weightsOf(learned: LearnedVerbs): Map<string, number> {
	let map = weightCache.get(learned);
	if (!map) {
		map = new Map();
		for (const e of learned) if (Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number") map.set(e[0], e[1]);
		weightCache.set(learned, map);
	}
	return map;
}

/** The words of a sentence once its fillers are gone, or null for a question or nothing. */
function analyzable(sentence: string): string[] | null {
	const t = stripFillers(sentence);
	if (!t || /\?\s*$/.test(t) || t.startsWith("¿")) return null;
	const found: string[] = fold(t).match(WORD) ?? [];
	return found.length && found.length <= 40 ? found : null;
}

/**
 * The word that makes a sentence look like a task, or null: an action verb first (a verb of the
 * lists, or a word shaped like an infinitive in a language the sentence may be written in), or a
 * Dutch infinitive last. What the user taught (`learned`) adds to or takes from each word. A
 * question never is a task; "don't forget to", "penser à"... are skipped first.
 */
export function actionVerb(sentence: string, learned: LearnedVerbs = []): string | null {
	const found = analyzable(sentence);
	if (!found) return null;
	const weights = weightsOf(Array.isArray(learned) ? learned : []);
	const head = headOf(found);
	const after = found[head.next];
	if (head.word && !(after && FINITE.has(deburr(after)))) {
		const w = head.word;
		const known = PLAIN_START.has(w);
		const shapes = known || head.weak ? [] : infinitiveShape(w);
		const base = known ? KNOWN : shapes.length && fits(shapes, languages(found.slice(head.next))) ? SHAPED : 0;
		if (base + (weights.get(w) ?? 0) >= 1) return w;
	}
	if (found.length >= 2) {
		const last = deburr(found[found.length - 1]);
		if (/en$/.test(last)) {
			const known = PLAIN_END.has(last) || NL_PREFIXES.some((p) => last.startsWith(p) && PLAIN_END.has(last.slice(p.length)));
			const base = known ? KNOWN : infinitiveShape(last).includes("nl") && fits(["nl"], languages(found.slice(0, -1))) ? SHAPED : 0;
			if (base + (weights.get(last) ?? 0) >= 1) return last;
		}
	}
	return null;
}

/** A sentence that starts with an action verb (or, in Dutch, ends with an infinitive): see `actionVerb`. */
export function looksLikeTask(sentence: string, learned: LearnedVerbs = []): boolean {
	return actionVerb(sentence, learned) !== null;
}

/** A word worth learning as a verb: not an article, a pronoun, a preposition, a number... */
function learnable(word: string): boolean {
	return word.length >= 3 && /^[a-z]+$/.test(word) && !FUNCTION_WORDS.has(word);
}

/**
 * The word a sentence made a task teaches: the one that already makes it look like a task, or
 * else its first word, or else (Dutch) its last word in -en. Null for a question.
 */
export function verbKey(sentence: string, learned: LearnedVerbs = []): string | null {
	const found = analyzable(sentence);
	if (!found) return null;
	const known = actionVerb(sentence, learned);
	if (known) return known;
	const head = headOf(found);
	if (!head.weak && learnable(head.word)) return head.word;
	const last = deburr(found[found.length - 1]);
	return found.length >= 2 && /en$/.test(last) && learnable(last) ? last : null;
}

/**
 * Learns from a gesture: `task` true when the sentence was made a task (its verb gains weight),
 * false when a dotted sentence was kept as an idea or deleted (the word behind the dot loses
 * weight; a sentence without a dot teaches nothing). Keeps at most `cap` words, the surest
 * (largest weight either way) and most recent. A word back to weight 0 is forgotten.
 */
export function learnVerb(learned: LearnedVerbs, sentence: string, task: boolean, cap = 300): LearnedVerbs {
	const list = Array.isArray(learned) ? learned : [];
	const key = task ? verbKey(sentence, list) : actionVerb(sentence, list);
	if (!key || !learnable(key)) return list;
	const old = weightsOf(list).get(key) ?? 0;
	const weight = Math.max(-WEIGHT_MAX, Math.min(WEIGHT_MAX, old + (task ? 1 : -1)));
	const rest = list.filter(([w]) => w !== key);
	const all: LearnedVerbs = weight ? [[key, weight], ...rest] : rest;
	if (all.length <= cap) return all;
	return all.map((e, i) => ({ e, i })).sort((a, b) => Math.abs(b.e[1]) - Math.abs(a.e[1]) || a.i - b.i).slice(0, cap).sort((a, b) => a.i - b.i).map((x) => x.e);
}

export function isQuestion(sentence: string): boolean {
	return /[?¿]/.test(sentence);
}

/**
 * A short print of a sentence (spaces folded, case kept): how a sentence kept as an idea is
 * remembered in the settings without copying the text there. A changed sentence is a new one.
 */
export function fingerprint(sentence: string): string {
	const text = sentence.replace(/\s+/g, " ").trim();
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(36) + text.length.toString(36);
}

export interface Mark {
	kind: "task" | "question";
	sentence: Sentence;
}

/**
 * The sentence of a free line that gets a pale dot: the first one that looks like a task, else
 * the first question; sentences kept as ideas (their print in `kept`) are passed over.
 */
export function markOf(body: string, learned: LearnedVerbs = [], kept: ReadonlySet<string> = new Set()): Mark | null {
	const all = sentences(body).filter((s) => !kept.has(fingerprint(s.text)));
	const task = all.find((s) => looksLikeTask(s.text, learned));
	if (task) return { kind: "task", sentence: task };
	const q = all.find((s) => isQuestion(s.text));
	return q ? { kind: "question", sentence: q } : null;
}

/**
 * The title of a task from its sentence: without fillers, without the final period, with a
 * capital first letter. A question keeps its question mark.
 */
export function cleanTitle(sentence: string): string {
	let t = stripFillers(sentence).replace(/\s+/g, " ").trim();
	t = t.replace(/[\s.;:,!…]+$/u, "");
	if (!t) return sentence.trim();
	return t.charAt(0).toLocaleUpperCase() + t.slice(1);
}

// ----- lines of a note -----

export type LineKind = "blank" | "free" | "task" | "decide" | "heading" | "other";

export interface LineInfo {
	kind: LineKind;
	/** Leading spaces and tabs. */
	indent: string;
	/** List marker with its space ("- ", "1. "), or "" for a plain line. */
	marker: string;
	/** The checkbox character of a task ("x", " ", "?"), or null. */
	box: string | null;
	/** Offset where the text starts (after indent, marker and checkbox). */
	bodyStart: number;
	body: string;
}

const TASK_LINE = /^(\s*)([-*+]|\d+[.)])\s\[(.)\](?:\s|$)/;
const LIST_LINE = /^(\s*)([-*+]|\d+[.)])\s+/;

export function lineInfo(text: string): LineInfo {
	const indent = /^[ \t]*/.exec(text)![0];
	const task = TASK_LINE.exec(text);
	if (task) {
		const bodyStart = task[0].length;
		const marker = text.slice(indent.length, text.indexOf("[", indent.length));
		return { kind: task[3] === "?" ? "decide" : "task", indent, marker, box: task[3], bodyStart, body: text.slice(bodyStart) };
	}
	const rest = text.slice(indent.length);
	if (!rest.trim()) return { kind: "blank", indent, marker: "", box: null, bodyStart: text.length, body: "" };
	if (/^#{1,6}(\s|$)/.test(rest)) return { kind: "heading", indent, marker: "", box: null, bodyStart: indent.length, body: rest };
	if (/^(>|\||```|~~~|\$\$|<!--|%%|---\s*$|\*\*\*\s*$|___\s*$)/.test(rest) || /^!?\[\[[^\]]*\]\]$/.test(rest.trim())) {
		return { kind: "other", indent, marker: "", box: null, bodyStart: indent.length, body: rest };
	}
	const list = LIST_LINE.exec(text);
	if (list) return { kind: "free", indent, marker: text.slice(indent.length, list[0].length), box: null, bodyStart: list[0].length, body: text.slice(list[0].length) };
	return { kind: "free", indent, marker: "", box: null, bodyStart: indent.length, body: rest };
}

/** Lines inside fenced code or the properties block: they are never ideas. */
export function hiddenLines(lines: readonly string[]): boolean[] {
	const hidden = lines.map(() => false);
	let i = 0;
	if (lines[0]?.trim() === "---") {
		const close = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l));
		if (close > 0) for (; i <= close; i++) hidden[i] = true;
	}
	let fence: string | null = null;
	for (; i < lines.length; i++) {
		const m = /^\s*(```+|~~~+)/.exec(lines[i]);
		if (fence) {
			hidden[i] = true;
			if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
		} else if (m) {
			fence = m[1];
			hidden[i] = true;
		}
	}
	return hidden;
}

/** Width of an indentation, a tab counting for `tabSize` columns. */
export function indentWidth(indent: string, tabSize = 4): number {
	let w = 0;
	for (const c of indent) w += c === "\t" ? tabSize - (w % tabSize) : 1;
	return w;
}

// ----- catching a sentence -----

export interface Fished {
	/** The lines that replace the original line. */
	lines: string[];
	/** Index, in `lines`, of the task line. */
	task: number;
	/** Offset, in the task line, where the title starts. */
	titleStart: number;
}

/**
 * Turns the sentence [start, end) of the body of a line into a task line. What comes before stays
 * on its own line above, what comes after goes on its own line below (it will usually be the first
 * line of the description). A list item keeps its marker; a plain line becomes "- [ ] ".
 */
export function fish(text: string, start: number, end: number, box = " "): Fished {
	const info = lineInfo(text);
	const body = info.body;
	const before = body.slice(0, start).trim();
	const sentence = body.slice(start, end).trim() || body.trim();
	const after = body.slice(end).trim();
	const marker = info.marker || "- ";
	const lines: string[] = [];
	if (before) lines.push(info.indent + info.marker + before);
	const head = info.indent + marker + "[" + box + "] ";
	lines.push(head + cleanTitle(sentence));
	const task = lines.length - 1;
	if (after) lines.push(info.indent + after);
	return { lines, task, titleStart: head.length };
}

/** The tags written in a text, without "#", in order. */
export function tagsIn(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu)) out.push(m[1].replace(/\/+$/, ""));
	return out;
}

/** Priority tags mark a task, they never group it. */
export const PRIORITY_TAGS: ReadonlySet<string> = new Set(["high", "medium", "low"]);

export function isPriority(tag: string): boolean {
	return PRIORITY_TAGS.has(tag.toLowerCase());
}

/** The tag that groups a task: its first tag that is not a priority, or null. */
export function groupTag(text: string): string | null {
	return tagsIn(text).find((t) => !isPriority(t)) ?? null;
}

/** The text of a task line without one of its tags (its first one when `tag` is not given). */
export function withoutTag(text: string, tag?: string): string {
	const target = tag ?? tagsIn(text)[0];
	if (!target) return text;
	const re = new RegExp(`(^|\\s)#${target.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?=\\s|$)`, "iu");
	return text.replace(re, "").replace(/\s{2,}/g, " ").trim();
}

export interface PoseInput {
	/** The task line as it is now (its title may have been edited). */
	taskLine: string;
	/** The chosen tag without "#", or null. */
	tag: string | null;
	/** The lines that follow the task line and could be its description, as they are now. */
	candidates: string[];
	/** How many of them become the description. */
	count: number;
	/** How many of them were already the description (editing a task): they leave it if not kept. */
	wasDescription: number;
	/** The editor's indentation unit ("\t" or spaces). */
	unit: string;
}

/**
 * The new text of the task line and of the candidates it touches: "- [ ] Title #tag", then the
 * description lines one indentation unit under the task. Lines that leave the description move
 * back to the task's level. Trailing blank lines are never taken.
 */
export function poseLines(input: PoseInput): string[] {
	const info = lineInfo(input.taskLine);
	const tag = input.tag ? input.tag.replace(/^#/, "") : null;
	let title = info.body.replace(/\s+$/, "");
	if (tag) title = withoutTag(title, tag);
	const head = input.taskLine.slice(0, info.bodyStart);
	const out = [head + (title.trim() || "") + (tag ? (title.trim() ? " " : "") + "#" + tag : "")];
	let count = Math.max(0, Math.min(input.count, input.candidates.length));
	while (count > 0 && !input.candidates[count - 1].trim()) count--;
	const touched = Math.max(count, Math.min(input.wasDescription, input.candidates.length));
	const taken = input.candidates.slice(0, touched);
	// The description the task already had and the lines newly taken are leveled apart: an
	// indented description followed by plain prose keeps one indentation unit, not two.
	const owned = Math.min(input.wasDescription, taken.length);
	const level = (lines: string[]) => Math.min(...lines.filter((l) => l.trim()).map((l) => indentWidth(/^[ \t]*/.exec(l)![0])), Infinity);
	const commonOwned = level(taken.slice(0, owned));
	const commonNew = level(taken.slice(owned));
	const strip = (line: string, common: number) => {
		if (!line.trim()) return "";
		let w = 0;
		let at = 0;
		while (at < line.length && (line[at] === " " || line[at] === "\t") && w < common) {
			w = line[at] === "\t" ? w + 4 - (w % 4) : w + 1;
			at++;
		}
		return " ".repeat(Math.max(0, w - common)) + line.slice(at);
	};
	taken.forEach((line, i) => {
		const own = strip(line, i < owned ? commonOwned : commonNew);
		if (i < count) out.push(own ? info.indent + input.unit + own : "");
		else out.push(own ? info.indent + own : "");
	});
	return out;
}

/** How many candidate lines are taken at first: the paragraph that follows (up to a blank line). */
export function defaultCount(candidates: readonly string[]): number {
	let n = 0;
	while (n < candidates.length && candidates[n].trim()) n++;
	return n;
}

/**
 * The lines after a task that can become its description: its current description (indented
 * lines, blank ones included) then free lines and blank lines, up to anything else (a task, a
 * heading, a closing line). Returns how many there are and how many were the description.
 */
export function candidateRange(lines: readonly string[], task: number, isClosing: (line: string) => boolean): { count: number; description: number } {
	const info = lineInfo(lines[task] ?? "");
	const base = indentWidth(info.indent);
	let i = task + 1;
	while (i < lines.length) {
		const l = lines[i];
		if (!l.trim()) {
			let j = i;
			while (j < lines.length && !lines[j].trim()) j++;
			if (j < lines.length && indentWidth(/^[ \t]*/.exec(lines[j])![0]) > base && !TASK_LINE.test(lines[j])) { i = j; continue; }
			break;
		}
		if (indentWidth(/^[ \t]*/.exec(l)![0]) <= base || TASK_LINE.test(l)) break;
		i++;
	}
	const description = i - task - 1;
	let end = task + 1 + description;
	while (end < lines.length) {
		const kind = lineInfo(lines[end]).kind;
		if ((kind !== "free" && kind !== "blank") || isClosing(lines[end])) break;
		end++;
	}
	while (end > task + 1 + description && !lines[end - 1].trim()) end--;
	// One blank line in the middle is fine (the grip can go past it), trailing ones are not offered.
	return { count: end - task - 1, description };
}

// ----- tags: suggestion and learning -----

/** [word, tag, uses]: words of posed titles and the tag chosen for them. */
export type Learned = Array<[string, string, number]>;

/** The words of a text that may say what it is about. */
export function keywords(text: string): string[] {
	const out = new Set<string>();
	const clean = plainTask(text).replace(/\[\[[^\]]*\]\]/g, " ").replace(/#[\p{L}\p{N}_/-]+/gu, " ");
	for (const m of (fold(clean).match(WORD) ?? []) as string[]) {
		const w = deburr(m.replace(/^[a-z]'/, "")).replace(/'s$/, "");
		if (w.length < 3 || /^\d+$/.test(w) || STOP_WORDS.has(w) || START_VERBS.has(w) || END_VERBS.has(w)) continue;
		out.add(w);
	}
	return [...out];
}

/** Remembers that the words of `title` went with `tag`. Keeps at most `cap` pairs, the most used and most recent. */
export function learn(learned: Learned, title: string, tag: string, cap = 400): Learned {
	const key = tag.replace(/^#/, "").toLowerCase();
	if (!key) return learned;
	const touched: Learned = [];
	const rest = learned.filter(([w, t, n]) => {
		if (t === key && keywords(title).includes(w)) {
			touched.push([w, t, n + 1]);
			return false;
		}
		return true;
	});
	for (const w of keywords(title)) if (!touched.some(([x]) => x === w)) touched.push([w, key, 1]);
	const all = [...touched, ...rest];
	if (all.length <= cap) return all;
	return all.map((e, i) => ({ e, i })).sort((a, b) => b.e[2] - a.e[2] || a.i - b.i).slice(0, cap).sort((a, b) => a.i - b.i).map((x) => x.e);
}

export interface Suggestion {
	tag: string;
	/** The word of the text that spoke for the tag the most (shown as "learned · word"). */
	word: string;
}

/**
 * The tag to suggest for a text, and the word that earned it: what was chosen before for its
 * words (weighted by how sure it is: one word seen once is not enough), or a tag of the vault
 * whose last part is one of its words. Null when nothing is sure enough.
 */
export function suggestion(text: string, learned: Learned, known: readonly string[]): Suggestion | null {
	const words = keywords(text);
	if (!words.length) return null;
	const score = new Map<string, number>();
	const voice = new Map<string, { word: string; weight: number }>();
	const add = (tag: string, n: number, word: string) => {
		score.set(tag, (score.get(tag) ?? 0) + n);
		const v = voice.get(tag);
		if (!v || n > v.weight) voice.set(tag, { word, weight: n });
	};
	for (const w of words) {
		const hits = learned.filter(([x]) => x === w);
		const total = hits.reduce((s, h) => s + h[2], 0);
		for (const [, tag, n] of hits) add(tag, (n / total) * Math.min(1, total / 3), w);
	}
	const knownByKey = new Map(known.map((t) => [t.toLowerCase(), t]));
	for (const tag of known) {
		const parts = tag.toLowerCase().split("/");
		const leaf = deburr(parts[parts.length - 1]);
		if (leaf.length < 3) continue;
		const word = words.find((w) => w === leaf || (leaf.length >= 5 && w.startsWith(leaf)));
		if (word) add(tag.toLowerCase(), 0.6 + 0.05 * parts.length, word);
	}
	let best: string | null = null;
	let top = 0;
	for (const [tag, s] of score) if (s > top || (s === top && best && tag.length > best.length)) { best = tag; top = s; }
	if (!best || top < 0.6) return null;
	return { tag: knownByKey.get(best) ?? best, word: voice.get(best)!.word };
}

/** The tag to suggest for a text (see `suggestion`), or null. */
export function suggestTag(text: string, learned: Learned, known: readonly string[]): string | null {
	return suggestion(text, learned, known)?.tag ?? null;
}

/** The recently chosen tags, most recent first. */
export function remember(recent: readonly string[], tag: string, cap = 8): string[] {
	const key = tag.toLowerCase();
	return [tag, ...recent.filter((t) => t.toLowerCase() !== key)].slice(0, cap);
}

// The tag column lives in the shared tag picker (src/ui/tag-picker).
export { isTagName } from "../../ui/tag-picker/logic";

/** After the tag: the description, when the task has lines to take; otherwise the task is placed at once. */
export function stepAfterTag(candidates: number): "desc" | "place" {
	return candidates > 0 ? "desc" : "place";
}

/** A task text without its hidden comments (%%...%%), dates and markers added by other tools. */
export function plainTask(text: string): string {
	return text.replace(/%%[\s\S]*?%%/g, " ").replace(/\s*[📅✅⏳🛫➕❌]️?\s*\d{4}-\d{2}-\d{2}/gu, " ").replace(/\s+/g, " ").trim();
}

// ----- the session as a whole -----

export interface SummaryTask {
	line: number;
	/** The whole line as read (to find it again before changing it). */
	raw: string;
	title: string;
	tag: string;
	done: boolean;
	/** Description lines (indented under the task), trimmed, blank ones left out. */
	description: string[];
}

export interface SummaryQuestion {
	line: number;
	/** The whole line as read. */
	raw: string;
	text: string;
	/** "- [?]": kept to decide on purpose (a plain question is counted too). */
	explicit: boolean;
	/** Offsets of the question sentence in the line body (to catch it as a task). */
	start: number;
	end: number;
}

export interface SummaryItem {
	kind: "task" | "question" | "free";
	line: number;
	text: string;
	tag: string;
	/** Characters, for the width of its bar. */
	size: number;
}

export interface Summary {
	items: SummaryItem[];
	tasks: SummaryTask[];
	questions: SummaryQuestion[];
	/** Paragraphs of free text. */
	free: number;
	ideas: number;
	/** Tasks without a tag plus lines kept to decide: what still waits for a choice. */
	pending: number;
}

const TAG_WORD = /^#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*$/u;

/** A line made only of tags ("#work", "#home #car"): a label of the note, never an idea. */
export function isTagLine(text: string): boolean {
	const words = text.trim().split(/\s+/).filter(Boolean);
	return words.length > 0 && words.every((w) => TAG_WORD.test(w));
}

/** A header line without the tags that follow its link ("[[Inbox]] #work" gives "[[Inbox]]"). */
function withoutHeaderTags(text: string): string {
	return text.replace(/(\s+#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)+\s*$/u, "");
}

/**
 * Where the text of the session starts: after the properties and the header our new sessions get
 * (a line with only a [[link]], a short date line), and after the blank line that follows them.
 */
export function bodyStart(lines: readonly string[]): number {
	const hidden = hiddenLines(lines);
	let i = 0;
	while (i < lines.length && hidden[i]) i++;
	const top = i;
	while (i < lines.length && !lines[i].trim()) i++;
	let header = 0;
	while (i < lines.length && header < 2) {
		const l = lines[i].trim();
		const linkOnly = /^(\[\[[^\]]+\]\]\s*[,·]?\s*)+$/.test(withoutHeaderTags(l)) || isTagLine(l);
		const dateLine = l.length <= 60 && /\d/.test(l) && !/[.!?]\s*$|[.!?]\s/.test(l) && !lineInfo(lines[i]).marker && i - top < 4;
		if (!linkOnly && !dateLine) break;
		i++;
		header++;
	}
	if (!header) return top;
	while (i < lines.length && !lines[i].trim()) i++;
	return i;
}

/** Counts a session: tasks (with their description), questions and lines kept to decide, free paragraphs. */
export function summarize(lines: readonly string[], isClosing: (line: string) => boolean): Summary {
	const hidden = hiddenLines(lines);
	const items: SummaryItem[] = [];
	const tasks: SummaryTask[] = [];
	const questions: SummaryQuestion[] = [];
	let free: SummaryItem | null = null;
	for (let i = bodyStart(lines); i < lines.length; i++) {
		if (hidden[i] || isClosing(lines[i])) { free = null; continue; }
		const info = lineInfo(lines[i]);
		// A line made only of tags (the context of the note) is a label, never an idea.
		if (info.kind === "blank" || info.kind === "heading" || info.kind === "other" || isTagLine(lines[i])) { free = null; continue; }
		if (info.kind === "task") {
			const range = candidateRange(lines, i, isClosing);
			const description = lines.slice(i + 1, i + 1 + range.description).map((l) => l.trim()).filter(Boolean);
			const tag = groupTag(info.body) ?? "";
			const title = plainTask(tag ? withoutTag(info.body, tag) : info.body);
			tasks.push({ line: i, raw: lines[i], title, tag, done: info.box !== " ", description });
			items.push({ kind: "task", line: i, text: title, tag, size: title.length + description.join(" ").length });
			free = null;
			i += range.description;
			continue;
		}
		const text = info.body.trim();
		if (info.kind === "decide" || isQuestion(text)) {
			const s = info.kind === "decide" ? { start: 0, end: info.body.length } : sentences(info.body).find((x) => isQuestion(x.text)) ?? { start: 0, end: info.body.length };
			questions.push({ line: i, raw: lines[i], text, explicit: info.kind === "decide", start: s.start, end: s.end });
			items.push({ kind: "question", line: i, text, tag: "", size: text.length });
			free = null;
			continue;
		}
		if (free) { free.size += text.length; continue; }
		free = { kind: "free", line: i, text, tag: "", size: text.length };
		items.push(free);
	}
	const pending = tasks.filter((t) => !t.tag && !t.done).length + questions.filter((q) => q.explicit).length;
	return { items, tasks, questions, free: items.filter((x) => x.kind === "free").length, ideas: items.length, pending };
}

// ----- the closing line -----

/** The closing line as written in the note: in italics, so it reads as a remark. */
export function closingLine(text: string): string {
	return "*" + text.replace(/\*/g, "") + "*";
}

/** Closing lines written before the feature was called Brainstorm, still recognized in all 4 languages. */
export const LEGACY_CLOSING = ["Session closed at", "Session close à", "Sessie afgesloten om", "Sesión cerrada a las"];

/**
 * Recognizes a closing line written in any language: italics whose text starts like one of
 * `prefixes` ("Brainstorm closed at", "Brainstorm clos à"...).
 */
export function closingMatcher(prefixes: readonly string[]): (line: string) => boolean {
	const starts = prefixes.map((p) => p.trim().toLowerCase()).filter(Boolean);
	return (line: string) => {
		const m = /^\s*([*_])(.+)\1\s*$/.exec(line);
		if (!m) return false;
		const inner = m[2].trim().toLowerCase();
		return starts.some((p) => inner.startsWith(p));
	};
}

// ----- a new session -----

export type DayPart = "morning" | "afternoon" | "evening";

export function dayPart(date: Date): DayPart {
	const h = date.getHours();
	return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

/** A file name from a title: without the characters Obsidian refuses in names. */
export function safeName(title: string): string {
	return title.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "").trim() || "Session";
}

/** "Session du 5 oct, matin": the template with the short date ("5 oct.") and the part of the day. */
export function proposedTitle(template: string, shortDate: string, part: string): string {
	return template.replace("{date}", shortDate.replace(/\.(?=\s|$)/g, "").trim()).replace("{part}", part);
}

/** The first lines of a new session: an empty line, the parent link if any, the date, then room to write. */
export function newSessionText(parent: string, dateLine: string): string {
	const name = parent.trim().replace(/^\[\[|\]\]$/g, "").replace(/\.md$/, "");
	return ["", ...(name ? [`[[${name}]]`] : []), dateLine, "", ""].join("\n");
}

export function hhmm(date: Date): string {
	return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}
