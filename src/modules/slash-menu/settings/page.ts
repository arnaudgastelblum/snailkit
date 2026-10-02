import { FuzzySuggestModal, Setting, type App } from "obsidian";
import type { SettingsPage } from "../../../ui/settings-page";
import type { ActionConfig, SlashItem, SlashMenuSettings } from "../types/settings";
import { defaultSettings, localizedSettings } from "./defaults";
import { listCommands, type CommandInfo } from "../integrations/obsidian-commands";
import { normalize } from "../search/SearchIndex";
import { sanitizeAction } from "./migrations";

export function coreSlashEnabled(app: App): boolean {
	const core = (app as unknown as { internalPlugins?: {
		getPluginById?: (id: string) => { enabled?: boolean } | undefined;
		plugins?: Record<string, { enabled?: boolean }>;
	} }).internalPlugins;
	return !!(core?.getPluginById?.("slash-command") ?? core?.plugins?.["slash-command"])?.enabled;
}

function id(): string {
	return `custom:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

class CommandPicker extends FuzzySuggestModal<CommandInfo> {
	constructor(app: App, private choose: (command: CommandInfo) => void) { super(app); }
	getItems(): CommandInfo[] { return listCommands(this.app); }
	getItemText(command: CommandInfo): string { return command.name; }
	onChooseItem(command: CommandInfo): void { this.choose(command); }
}

export function renderSettings(page: SettingsPage<SlashMenuSettings>): void {
	const t = page.t.bind(page);
	if (page.settings.triggerChar.startsWith("/") && coreSlashEnabled(page.app)) {
		page.section(t("conflict.title")).note(t("conflict.note"));
	}
	const general = page.section(t("general"));
	general.text("triggerChar", t("trigger"), {
		desc: t("trigger.desc"), normalize: (value) => value && value.length <= 3 && !/\s/.test(value) ? value : "/",
		onChange: () => page.refresh(),
	});
	for (const key of ["showDescriptions", "showPinned", "showRecent", "animations"] as const) {
		general.toggle(key, t(key), { desc: t(`${key}.desc`) });
	}

	const entries = page.section(t("entries"), t("entries.desc"));
	const tools = entries.add(t("entries"));
	const list = entries.el.createDiv({ cls: "sk-slash-menu-entries" });
	const editor = entries.el.createDiv({ cls: "sk-slash-menu-editor" });
	let filter = "";
	let drag: { kind: "category" | "item"; id: string } | null = null;
	let picker: CommandPicker | null = null;
	let disposed = false;
	page.onDispose(() => { disposed = true; picker?.close(); });
	const persist = () => { void page.save(); draw(); };
	const localized = () => localizedSettings(page.settings, t);
	const move = <T extends { id: string }>(array: T[], key: string, offset: number) => {
		const from = array.findIndex((item) => item.id === key);
		const to = Math.max(0, Math.min(array.length - 1, from + offset));
		if (from < 0 || from === to) return;
		array.splice(to, 0, array.splice(from, 1)[0]);
		persist();
	};
	const dragSource = (el: HTMLElement, kind: "category" | "item", key: string) => {
		el.draggable = true;
		el.addEventListener("dragstart", (event) => {
			event.stopPropagation(); drag = { kind, id: key };
			event.dataTransfer?.setData("text/plain", key);
		});
		el.addEventListener("dragend", () => { drag = null; });
	};
	const dropTarget = (el: HTMLElement, categoryId: string, itemId?: string) => {
		el.addEventListener("dragover", (event) => { if (drag) event.preventDefault(); });
		el.addEventListener("drop", (event) => {
			if (!drag) return;
			event.preventDefault(); event.stopPropagation();
			if (drag.kind === "category") {
				const array = page.settings.categories;
				const from = array.findIndex((c) => c.id === drag?.id);
				const to = array.findIndex((c) => c.id === categoryId);
				if (from >= 0 && to >= 0) array.splice(to, 0, array.splice(from, 1)[0]);
			} else {
				const array = page.settings.items;
				const from = array.findIndex((item) => item.id === drag?.id);
				if (from >= 0) {
					const [item] = array.splice(from, 1);
					item.categoryId = categoryId;
					const to = itemId ? array.findIndex((entry) => entry.id === itemId) : -1;
					array.splice(to < 0 ? array.length : to, 0, item);
				}
			}
			drag = null; persist();
		});
	};
	const edit = (item: SlashItem, fresh = false) => {
		editor.empty();
		const draft = structuredClone(item);
		draft.customized = true;
		editor.createEl("h4", { text: t("edit") });
		const error = editor.createDiv({ cls: "sk-slash-menu-help", attr: { role: "alert" } });
		const text = (key: string, value: string, change: (value: string) => void, multiline = false) => {
			const row = new Setting(editor).setName(t(key));
			if (multiline) row.addTextArea((input) => input.setValue(value).onChange(change));
			else row.addText((input) => input.setValue(value).onChange(change));
		};
		text("name", draft.name, (value) => { draft.name = value; });
		text("description", draft.description, (value) => { draft.description = value; });
		text("icon", draft.icon, (value) => { draft.icon = value; });
		text("aliases", draft.aliases.join(", "), (value) => { draft.aliases = value.split(",").map((s) => s.trim()).filter(Boolean); });
		text("keywords", draft.keywords.join(", "), (value) => { draft.keywords = value.split(",").map((s) => s.trim()).filter(Boolean); });
		new Setting(editor).setName(t("category")).addDropdown((dropdown) => {
			for (const category of localized().categories) dropdown.addOption(category.id, category.name);
			dropdown.setValue(draft.categoryId).onChange((value) => { draft.categoryId = value; });
		});
		const action = draft.action;
		if (action.type === "markdown") {
			text("template", action.template, (value) => { action.template = value; }, true);
			editor.createDiv({ cls: "sk-slash-menu-help", text: t("variables") });
		} else if (action.type === "callout") {
			text("calloutType", action.calloutType, (value) => { action.calloutType = value.replace(/[^\w-]/g, ""); });
			text("title", action.title, (value) => { action.title = value.replace(/[\r\n]/g, " "); });
			text("content", action.content, (value) => { action.content = value; }, true);
			new Setting(editor).setName(t("fold")).addDropdown((dropdown) => dropdown
				.addOptions({ none: t("fold.none"), open: t("fold.open"), closed: t("fold.closed") })
				.setValue(action.fold).onChange((value) => { action.fold = value as typeof action.fold; }));
			editor.createDiv({ cls: "sk-slash-menu-help", text: t("variables") });
		} else if (action.type === "command") {
			new Setting(editor).setName(t("commandId")).setDesc(action.commandId).addButton((button) => button.setButtonText(t("add.command")).onClick(() => {
				picker = new CommandPicker(page.app, (command) => { if (!disposed) { action.commandId = command.id; edit(draft, fresh); } });
				picker.open();
			}));
		}
		new Setting(editor)
			.addButton((button) => button.setButtonText(t("common.cancel")).onClick(() => editor.empty()))
			.addButton((button) => button.setButtonText(t("common.save")).setCta().onClick(() => {
				if (!draft.name.trim()) return;
				if (!sanitizeAction(draft.action)) { error.setText(t("unsupported")); return; }
				const index = page.settings.items.findIndex((entry) => entry.id === draft.id);
				if (fresh) page.settings.items.push(draft);
				else if (index >= 0) page.settings.items[index] = draft;
				editor.empty(); persist();
			}));
		editor.querySelector("input")?.focus();
	};
	const add = (type: "command" | "markdown" | "callout", command?: CommandInfo) => {
		const categoryId = type === "command" ? "commands" : type === "callout" ? "callouts" : "snippets";
		const action: ActionConfig = type === "command" ? { type, commandId: command!.id }
			: type === "markdown" ? { type, template: "{{cursor}}" }
				: { type, calloutType: "note", title: "", content: "", fold: "none" };
		edit({ id: id(), name: command?.name ?? t(`new.${type}`), description: "", icon: type === "command" ? "terminal" : "text",
			categoryId: page.settings.categories.some((c) => c.id === categoryId) ? categoryId : page.settings.categories[0].id,
			enabled: true, pinned: false, aliases: [], keywords: [], action }, true);
	};
	tools.addButton((button) => button.setButtonText(t("add.command")).onClick(() => {
		picker = new CommandPicker(page.app, (command) => { if (!disposed) add("command", command); });
		picker.setPlaceholder(t("add.command")); picker.open();
	}));
	for (const type of ["markdown", "callout"] as const) tools.addButton((button) => button.setButtonText(t(`add.${type}`)).onClick(() => add(type)));
	tools.addButton((button) => button.setButtonText(t("add.category")).onClick(() => {
		page.settings.categories.push({ id: id(), name: t("new.category"), hidden: false, customized: true }); persist();
	}));
	// Keep the filter above the list even though custom controls share the section body.
	const filterRow = entries.add(t("filter")).addSearch((search) => search.setPlaceholder(t("filter")).onChange((value) => { filter = normalize(value); draw(); }));
	list.before(filterRow.settingEl);
	function draw() {
		list.empty();
		const settings = localized();
		for (const category of settings.categories) {
			const group = list.createDiv({ cls: "sk-slash-menu-group" });
			const rawCategory = page.settings.categories.find((c) => c.id === category.id)!;
			const heading = new Setting(group).setName(category.name);
			dragSource(heading.settingEl, "category", category.id); dropTarget(group, category.id);
			heading.addText((input) => input.setValue(category.name).onChange((value) => {
				rawCategory.name = value; rawCategory.customized = true; void page.save();
			}));
			heading.addToggle((toggle) => { toggle.toggleEl.setAttr("aria-label", t("hidden")); toggle.setValue(category.hidden).onChange((value) => { rawCategory.hidden = value; persist(); }); });
			for (const [icon, label, offset] of [["arrow-up", "up", -1], ["arrow-down", "down", 1]] as const) heading.addExtraButton((button) => button.setIcon(icon).setTooltip(t(label)).onClick(() => move(page.settings.categories, category.id, offset)));
			const siblings = settings.items.filter((item) => item.categoryId === category.id);
			for (const item of siblings) {
				if (filter && !normalize([item.name, item.description, category.name, ...item.aliases, ...item.keywords].join(" ")).includes(filter)) continue;
				const raw = page.settings.items.find((entry) => entry.id === item.id)!;
				const row = new Setting(group).setName(item.name).setDesc(item.description);
				row.settingEl.addClass("sk-slash-menu-entry");
				dragSource(row.settingEl, "item", item.id); dropTarget(row.settingEl, category.id, item.id);
				row.addToggle((toggle) => { toggle.toggleEl.setAttr("aria-label", t("enabled")); toggle.setValue(item.enabled).onChange((value) => { raw.enabled = value; persist(); }); });
				row.addExtraButton((button) => button.setIcon(item.pinned ? "pin-off" : "pin").setTooltip(t("pinned")).onClick(() => { raw.pinned = !raw.pinned; persist(); }));
				row.addExtraButton((button) => button.setIcon("pencil").setTooltip(t("edit")).onClick(() => edit(item)));
				row.addExtraButton((button) => button.setIcon("copy").setTooltip(t("duplicate")).onClick(() => { page.settings.items.push({ ...structuredClone(item), id: id(), customized: true }); persist(); }));
				row.addExtraButton((button) => button.setIcon("trash").setTooltip(t("delete")).onClick(() => { page.settings.items = page.settings.items.filter((entry) => entry.id !== item.id); editor.empty(); persist(); }));
				for (const [icon, label, offset] of [["arrow-up", "up", -1], ["arrow-down", "down", 1]] as const) row.addExtraButton((button) => button.setIcon(icon).setTooltip(t(label)).onClick(() => {
					const from = siblings.findIndex((entry) => entry.id === item.id);
					const adjacent = siblings[from + offset];
					if (!adjacent) return;
					const items = page.settings.items;
					move(items, item.id, items.findIndex((entry) => entry.id === adjacent.id) - items.findIndex((entry) => entry.id === item.id));
				}));
			}
		}
	}
	draw();
	const advanced = page.section(t("advanced"));
	advanced.number("maxResults", t("maxResults"), { min: 10, max: 100, step: 10, desc: t("maxResults.desc") });
	advanced.dropdown("unavailableDisplay", t("unavailable"), { dim: t("dim"), hide: t("hide") }, { desc: t("unavailable.desc") });
	for (const key of ["dateFormat", "timeFormat", "datetimeFormat"] as const) advanced.text(key, t(key), { desc: t("format.desc"), normalize: (value) => value || defaultSettings()[key] });
}
