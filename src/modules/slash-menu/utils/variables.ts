import { type TFile } from "obsidian";
import type { SlashMenuSettings } from "../types/settings";
import { moment } from "../../../core/moment";

/** What variables can read. Every field is optional so templates also render outside an editor. */
export interface VariableContext {
	settings: SlashMenuSettings;
	file: TFile | null;
	/** Extra values provided by the caller. */
	extra?: Record<string, string>;
}

type Resolver = (ctx: VariableContext, arg: string | undefined) => string | Promise<string>;

/**
 * Variable registry. Add an entry to support a new {{variable}}.
 * `{{name:arg}}` passes `arg` (e.g. a moment format: {{date:dddd D MMMM}}).
 */
const VARIABLES: Record<string, Resolver> = {
	date: (ctx, fmt) => moment().format(fmt || ctx.settings.dateFormat),
	time: (ctx, fmt) => moment().format(fmt || ctx.settings.timeFormat),
	datetime: (ctx, fmt) => moment().format(fmt || ctx.settings.datetimeFormat),
	title: (ctx) => ctx.file?.basename ?? "",

};

export const CURSOR_TOKEN = "{{cursor}}";
const VAR_RE = /\{\{\s*([a-zA-Z][\w-]*)(?::([^}]*))?\s*\}\}/g;

export function variableNames(): string[] {
	return [...Object.keys(VARIABLES), "cursor"];
}

/**
 * Replaces known {{variables}}. {{cursor}} and unknown names are kept as is.
 */
export async function renderVariables(template: string, ctx: VariableContext): Promise<string> {
	const matches = [...template.matchAll(VAR_RE)];
	if (matches.length === 0) return template;
	const values = await Promise.all(
		matches.map(async (m) => {
			const name = m[1].toLowerCase();
			if (name === "cursor") return m[0];
			if (ctx.extra && name in ctx.extra) return ctx.extra[name];
			const resolver = VARIABLES[name];
			if (!resolver) return m[0];
			try {
				return await resolver(ctx, m[2]?.trim() || undefined);
			} catch {
				return "";
			}
		}),
	);
	let out = "";
	let last = 0;
	matches.forEach((m, i) => {
		out += template.slice(last, m.index) + values[i];
		last = (m.index ?? 0) + m[0].length;
	});
	return out + template.slice(last);
}

/** Removes every {{cursor}} and returns the offset of the first one (or null). */
export function extractCursor(text: string): { text: string; cursor: number | null } {
	const at = text.indexOf(CURSOR_TOKEN);
	if (at < 0) return { text, cursor: null };
	return { text: text.split(CURSOR_TOKEN).join(""), cursor: at };
}

/** Makes a string safe as a file name on every OS (":" -> "-", no slashes...). */
export function sanitizeFileName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]/g, "-")
		.replace(/\s+/g, " ")
		.replace(/^[.\s]+|[.\s]+$/g, "")
		.slice(0, 200);
}
