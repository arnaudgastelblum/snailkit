// Tasks: every tagged task of the vault in one list (the Tasks tab of the Workbench, as a page or
// in the side panel), plus a public API.
import { Menu, TFile } from "obsidian";
import { defineModule } from "../../core/module";
import { buildDemo } from "./demo";
import { createTasksApi } from "./api";
import { TasksHub } from "./hub";
import { parseFolderList, parseTagList } from "./parse";
import type { TasksSettings } from "./types";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";
import { nl } from "./i18n/nl";
import { es } from "./i18n/es";

export const tasks = defineModule<TasksSettings>({
	id: "tasks",
	icon: "list-checks",
	category: "workbench",
	strings: { en, fr, nl, es },
	demo: (el, t) => buildDemo(el, t),
	defaults: {
		excludedFolders: "",
		flagTags: "",
		stampDone: true,
		newTaskNote: "",
		sortMode: "notes",
		priorityFilter: [],
		collapsed: [],
		tagOrder: [],
		taskOrder: [],
	},
	// The order of the tags is the user's arrangement: "Reset to defaults" keeps it.
	keepOnReset: ["tagOrder", "taskOrder"],
	activate(ctx) {
		const hub = new TasksHub(ctx);
		ctx.register(() => hub.dispose());

		// The Workbench is a view of the core: this module adds its tab there (removed when it stops).
		ctx.workbench.addTab(hub.tab());
		const ribbon = ctx.addRibbonIcon("list-checks", ctx.t("ribbon.open"), () => void hub.activate("page"));
		ctx.registerDomEvent(ribbon, "contextmenu", (event) => {
			event.preventDefault();
			const menu = new Menu();
			menu.addItem((item) => item.setTitle(ctx.t("action.page")).setIcon("layout-list").onClick(() => void hub.activate("page")));
			menu.addItem((item) => item.setTitle(ctx.t("action.side")).setIcon("panel-right").onClick(() => void hub.activate("side")));
			menu.addItem((item) => item.setTitle(ctx.t("action.new")).setIcon("plus").onClick(() => void hub.newTask()));
			menu.showAtMouseEvent(event);
		});
		ctx.addCommand({ id: "open-page", name: ctx.t("command.open-page"), callback: () => void hub.activate("page") });
		ctx.addCommand({ id: "open-side", name: ctx.t("command.open-side"), callback: () => void hub.activate("side") });
		ctx.addCommand({ id: "open-tasks", name: ctx.t("command.open-tasks"), callback: () => void hub.openWorkbench({ tab: "tasks" }) });
		ctx.addCommand({ id: "open-today", name: ctx.t("command.open-today"), callback: () => void hub.openWorkbench({ tab: "tasks", scope: "today" }) });
		ctx.addCommand({ id: "new-task", name: ctx.t("command.new-task"), callback: () => void hub.newTask() });

		// The index reads the vault once the layout is ready, then follows every change.
		ctx.app.workspace.onLayoutReady(() => {
			if (!hub.alive) return;
			void hub.index.build();
			ctx.registerEvent(ctx.app.metadataCache.on("changed", (file, data) => {
				if (file.extension === "md") hub.index.set(file.path, data);
			}));
			ctx.registerEvent(ctx.app.vault.on("delete", (file) => hub.index.remove(file.path)));
			ctx.registerEvent(ctx.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) void hub.index.renamed(file, oldPath);
				else hub.index.remove(oldPath);
			}));
		});

		// Read the vault again when what counts as a task changes; redraw on any other change.
		const signature = () => parseFolderList(ctx.settings.excludedFolders).join("|") + "#" + parseTagList(ctx.settings.flagTags).join("|");
		let last = signature();
		ctx.onSettingsChange(() => {
			const now = signature();
			if (now !== last) {
				last = now;
				if (hub.index.ready) void hub.index.build();
			}
			hub.refreshViews();
		});
		// Colors from the Tag colors module come and go with it.
		ctx.onServicesChange(() => hub.refreshViews());
		// Today moves at midnight: due labels and the Today view follow the Workbench's own clock
		// (it draws its shown tabs again every minute).

		ctx.provide("tasks", createTasksApi(hub.index, hub.writer, () => hub.alive, hub));
	},
	settings(page) {
		page.section(page.t("settings.which"), page.t("settings.which-desc"))
			.text("excludedFolders", page.t("settings.excluded"), {
				desc: page.t("settings.excluded-desc"),
				placeholder: page.t("settings.excluded-placeholder"),
				normalize: (value) => parseFolderList(value).join(", "),
			});
		page.section(page.t("settings.groups"))
			.text("flagTags", page.t("settings.flags"), {
				desc: page.t("settings.flags-desc"),
				placeholder: page.t("settings.flags-placeholder"),
				normalize: (value) => parseTagList(value).join(", "),
			});
		const writing = page.section(page.t("settings.writing"));
		writing.toggle("stampDone", page.t("settings.stamp"), { desc: page.t("settings.stamp-desc") });
		writing.text("newTaskNote", page.t("settings.target"), {
			desc: page.t("settings.target-desc"),
			placeholder: page.t("settings.target-placeholder"),
			normalize: (value) => value.trim().replace(/\\/g, "/").replace(/^\/+/, ""),
		});
	},
});
