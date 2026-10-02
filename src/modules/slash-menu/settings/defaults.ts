import type { ActionConfig, BlockKind, CalloutFold, SlashCategory, SlashItem, SlashMenuSettings } from "../types/settings";
import { SETTINGS_VERSION } from "../types/settings";

export const DEFAULT_CATEGORIES: SlashCategory[] = [
	{ id: "basic", name: "Basic", hidden: false },
	{ id: "callouts", name: "Callouts", hidden: false },
	{ id: "insert", name: "Insert", hidden: false },
	{ id: "create", name: "Create", hidden: false },
	{ id: "snippets", name: "Snippets", hidden: false },
	{ id: "commands", name: "Commands", hidden: false },
];

/** Category that receives new commands added from "Add command". */
export const COMMANDS_CATEGORY_ID = "commands";

interface ItemSeed {
	id: string;
	name: string;
	description: string;
	icon: string;
	categoryId: string;
	keywords?: string[];
	aliases?: string[];
	pinned?: boolean;
	action: ActionConfig;
}

function item(seed: ItemSeed): SlashItem {
	return {
		id: seed.id,
		enabled: true,
		pinned: seed.pinned ?? false,
		name: seed.name,
		description: seed.description,
		icon: seed.icon,
		categoryId: seed.categoryId,
		keywords: seed.keywords ?? [],
		aliases: seed.aliases ?? [],
		action: seed.action,
	};
}

function block(id: string, name: string, description: string, icon: string, kind: BlockKind, keywords: string[], aliases: string[] = []): SlashItem {
	return item({ id: `builtin:${id}`, name, description, icon, categoryId: "basic", keywords, aliases, action: { type: "block", block: kind } });
}

function markdown(id: string, categoryId: string, name: string, description: string, icon: string, template: string, keywords: string[], aliases: string[] = []): SlashItem {
	return item({ id: `builtin:${id}`, name, description, icon, categoryId, keywords, aliases, action: { type: "markdown", template } });
}

interface CalloutSeed {
	type: string;
	name: string;
	icon: string;
	keywords?: string[];
	fold?: CalloutFold;
}

const CALLOUTS: CalloutSeed[] = [
	{ type: "note", name: "Note", icon: "pencil" },
	{ type: "abstract", name: "Abstract", icon: "clipboard-list", keywords: ["summary", "tldr"] },
	{ type: "info", name: "Info", icon: "info" },
	{ type: "todo", name: "Todo", icon: "circle-check", keywords: ["task"] },
	{ type: "tip", name: "Tip", icon: "flame", keywords: ["hint", "important"] },
	{ type: "success", name: "Success", icon: "check", keywords: ["done", "check"] },
	{ type: "question", name: "Question", icon: "circle-help", keywords: ["help", "faq"] },
	{ type: "warning", name: "Warning", icon: "triangle-alert", keywords: ["caution", "attention"] },
	{ type: "failure", name: "Failure", icon: "x", keywords: ["fail", "missing"] },
	{ type: "danger", name: "Danger", icon: "zap", keywords: ["error"] },
	{ type: "bug", name: "Bug", icon: "bug" },
	{ type: "example", name: "Example", icon: "list" },
	{ type: "quote", name: "Quote", icon: "quote", keywords: ["cite"] },
];

function callout(seed: CalloutSeed): SlashItem {
	return item({
		id: `builtin:callout-${seed.type}`,
		name: seed.name,
		description: `${seed.name} callout`,
		icon: seed.icon,
		categoryId: "callouts",
		keywords: ["callout", "admonition", seed.type, ...(seed.keywords ?? [])],
		aliases: [`callout ${seed.type}`],
		action: { type: "callout", calloutType: seed.type, title: "", fold: seed.fold ?? "none", content: "" },
	});
}

const TABLE_TEMPLATE = "| {{cursor}} |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |";


export function defaultItems(): SlashItem[] {
	return [
		// Basic
		block("text", "Text", "Plain paragraph", "pilcrow", "text", ["paragraph", "plain", "normal"], ["p"]),
		block("h1", "Heading 1", "Big section heading", "heading-1", "h1", ["title", "header", "h1"], ["h1", "#"]),
		block("h2", "Heading 2", "Medium section heading", "heading-2", "h2", ["subtitle", "header", "h2"], ["h2", "##"]),
		block("h3", "Heading 3", "Small section heading", "heading-3", "h3", ["header", "h3"], ["h3", "###"]),
		block("bullet", "Bullet list", "Simple bulleted list", "list", "bullet", ["unordered", "ul", "dash"], ["ul", "-"]),
		block("numbered", "Numbered list", "List with numbering", "list-ordered", "numbered", ["ordered", "ol"], ["ol", "1."]),
		block("todo", "Todo", "Checkbox to track a task", "square-check", "todo", ["task", "checkbox", "check"], ["[]", "checkbox"]),
		block("quote", "Quote", "Capture a quote", "text-quote", "quote", ["blockquote", "citation"], [">"]),
		markdown("code", "basic", "Code block", "Capture a code snippet", "code", "```{{cursor}}\n\n```", ["snippet", "pre", "fence"], ["```"]),
		markdown("hr", "basic", "Horizontal rule", "Visual divider", "minus", "---\n{{cursor}}", ["divider", "separator", "line"], ["---", "divider"]),

		// Callouts
		...CALLOUTS.map(callout),

		// Insert
		markdown("link", "insert", "Link", "External link", "link", "[]({{cursor}})", ["url", "href", "web"]),
		markdown("wikilink", "insert", "Internal link", "Link to another note", "file-symlink", "[[{{cursor}}]]", ["wikilink", "note", "reference"], ["[["]),
		markdown("table", "insert", "Table", "Simple 3 columns table", "table", TABLE_TEMPLATE, ["grid", "columns", "rows"]),
		markdown("math", "insert", "Math block", "LaTeX equation", "sigma", "$$\n{{cursor}}\n$$", ["latex", "equation", "formula", "katex"]),
		markdown("date", "insert", "Current date", "Insert today's date", "calendar", "{{date}}", ["today", "day"], ["today"]),
		markdown("time", "insert", "Current time", "Insert the current time", "clock", "{{time}}", ["now", "hour"], ["now"]),
		markdown("datetime", "insert", "Date and time", "Insert the current date and time", "calendar-clock", "{{datetime}}", ["timestamp", "now"]),

		// Create
		item({
			id: "builtin:new-note",
			name: "New note",
			description: "Create a note and link it here",
			icon: "file-plus",
			categoryId: "create",
			keywords: ["page", "file", "create", "subpage"],
			aliases: ["page"],
			action: { type: "new-note", nameTemplate: "", folder: "", insertLink: true, openInNewTab: true },
		}),


	];
}

export function defaultSettings(): SlashMenuSettings {
	return {
		version: SETTINGS_VERSION,
		triggerChar: "/",
		triggerAfterSpaceOnly: true,
		showDescriptions: true,
		showIcons: true,
		showCategories: true,
		showPinned: true,
		showRecent: true,
		maxRecent: 5,
		animations: true,
		flashInserted: true,
		unavailableDisplay: "dim",
		maxResults: 50,
		dateFormat: "YYYY-MM-DD",
		timeFormat: "HH:mm",
		datetimeFormat: "YYYY-MM-DD HH:mm",
		categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
		items: defaultItems(),
		recent: [],
	};
}

/** Translate untouched built-ins at display time; user edits remain exactly as saved. */
export function localizedSettings(settings: SlashMenuSettings, t: (key: string) => string): SlashMenuSettings {
	const seeds = new Map(defaultItems().map((item) => [item.id, item]));
	return {
		...settings,
		items: settings.items.map((item) => {
			const seed = seeds.get(item.id);
			if (!seed || item.customized) return item;
			const key = "entry." + item.id.slice(8);
			return { ...item, name: item.name === seed.name ? t(key + ".name") : item.name,
				description: item.description === seed.description ? t(key + ".description") : item.description };
		}),
		categories: settings.categories.map((category) => {
			const seed = DEFAULT_CATEGORIES.find((c) => c.id === category.id);
			return seed && !category.customized && category.name === seed.name ? { ...category, name: t("category." + category.id) } : category;
		}),
	};
}
