// Shared check for translation tables: same keys in every language, no empty string, same
// {placeholders}, no em dash. Used by core.test.ts and scripts/check-module.mjs.
import assert from "node:assert/strict";
import { LANGUAGES, type Strings, type Translations } from "../src/i18n";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

export function checkTable(name: string, table: Translations<Strings>): void {
	const keys = Object.keys(table.en).sort();
	for (const lang of LANGUAGES) {
		const own = table[lang] as Strings;
		assert.deepEqual(Object.keys(own).sort(), keys, `${name}/${lang}: same keys as English`);
		for (const key of keys) {
			assert.ok(own[key].trim(), `${name}/${lang}: "${key}" is empty`);
			assert.deepEqual(placeholders(own[key]), placeholders(table.en[key]), `${name}/${lang}: "${key}" placeholders`);
			assert.ok(!own[key].includes("\u2014"), `${name}/${lang}: "${key}" has an em dash`);
		}
	}
}
