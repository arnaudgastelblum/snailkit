// Translation core. English is the reference: every other language must have exactly the
// same keys (the compiler checks it through `Translations`), and a missing string at runtime
// falls back to English, then to the key itself, never to an empty label.

export const LANGUAGES = ["en", "fr", "nl", "es"] as const;
export type Lang = (typeof LANGUAGES)[number];
export type LanguageSetting = "auto" | Lang;

/** Each language written in itself, for the language picker. */
export const LANGUAGE_NAMES: Record<Lang, string> = {
	en: "English",
	fr: "Français",
	nl: "Nederlands",
	es: "Español",
};

export type Strings = Record<string, string>;
export type StringsOf<T extends Strings> = { [K in keyof T]: string };
export type Translations<T extends Strings> = { en: T } & { [L in Exclude<Lang, "en">]: StringsOf<T> };
export type Vars = Record<string, string | number>;

export function isLang(value: unknown): value is Lang {
	return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** Picks the language to show: the user's choice, else Obsidian's language when supported, else English. */
export function resolveLanguage(setting: LanguageSetting, obsidianLanguage: string | undefined): Lang {
	if (setting !== "auto") return setting;
	const base = (obsidianLanguage || "en").toLowerCase().split(/[-_]/)[0];
	return isLang(base) ? base : "en";
}

/** Replaces `{name}` placeholders. Unknown placeholders are left as written so a mistake stays visible. */
export function format(template: string, vars?: Vars): string {
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/**
 * Looks strings up in a list of tables, first match wins (a module's own table, then the core
 * table for shared words). Plurals use `key.one` / `key.other` picked by Intl.PluralRules.
 */
export class Translator {
	private readonly plural: Intl.PluralRules;

	constructor(
		readonly lang: Lang,
		private readonly tables: Translations<Strings>[],
	) {
		this.plural = new Intl.PluralRules(lang);
	}

	has(key: string): boolean {
		return this.tables.some((table) => key in table.en);
	}

	t(key: string, vars?: Vars): string {
		for (const table of this.tables) {
			const own = table[this.lang] as Strings;
			if (key in own && own[key]) return format(own[key], vars);
			if (key in table.en) return format(table.en[key], vars);
		}
		return key;
	}

	/** Plural form for `count`; `count` is also available as `{count}` in the string. */
	tn(key: string, count: number, vars?: Vars): string {
		const form = this.plural.select(count) === "one" ? "one" : "other";
		return this.t(`${key}.${form}`, { count, ...vars });
	}

	/** Same tables, another language (used to recognize text written in any language). */
	withLang(lang: Lang): Translator {
		return new Translator(lang, this.tables);
	}
}
