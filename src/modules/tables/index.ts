import { buildDemo } from "./demo";
// Tables: insert with a size grid, a floating toolbar, smart sorting, column widths and styles
// saved in a comment below each table, keyboard navigation in Source mode.
import { Platform, type Menu } from "obsidian";
import { defineModule } from "../../core/module";
import { TablesController } from "./controller";
import { tablesExtensions } from "./extensions";
import { BANDINGS, lookMeta, STYLES, TEXT_SIZES } from "./logic";
import type { TablesSettings } from "./types";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";
import { nl } from "./i18n/nl";
import { es } from "./i18n/es";

export const tables = defineModule<TablesSettings>({
	id: "tables",
	icon: "table",
	category: "write",
	strings: { en, fr, nl, es },
	demo: (el, t) => buildDemo(el, t),
	defaults: {
		newStyle: "plain",
		newBanding: "rows",
		newSize: "theme",
		newExtras: "",
		otherTables: "none",
		toolbar: true,
		chip: true,
		keyboard: true,
		dateOrder: "dmy",
	},
	activate(ctx) {
		const controller = new TablesController(ctx);
		ctx.register(() => controller.stop());
		ctx.registerEditorExtension(tablesExtensions(controller));
		ctx.registerMarkdownPostProcessor((el, mdCtx) => controller.styleReading(el, mdCtx));
		controller.registerCommands();
		ctx.registerEvent(ctx.app.workspace.on("editor-menu", (menu: Menu, _editor, view) => controller.onEditorMenu(menu, view)));

		// Column resizing and the header button follow the mouse, in every window.
		if (!Platform.isMobile) {
			const listened = new Set<Document>();
			const listen = (doc: Document) => {
				if (listened.has(doc)) return;
				listened.add(doc);
				ctx.registerDomEvent(doc, "mousemove", (evt) => controller.resizer.onMove(evt));
				ctx.registerDomEvent(doc, "mouseup", () => controller.resizer.onUp());
			};
			listen(document);
			ctx.app.workspace.iterateAllLeaves((leaf) => listen(leaf.view.containerEl.ownerDocument));
			ctx.registerEvent(ctx.app.workspace.on("window-open", (win) => listen(win.doc)));
		}

		// The toolbar follows the cursor.
		const refresh = () => controller.toolbar.refreshSoon();
		ctx.registerDomEvent(document, "selectionchange", refresh);
		ctx.registerDomEvent(document, "focusin", refresh);
		ctx.registerDomEvent(document, "focusout", refresh);
		ctx.registerDomEvent(document, "scroll", refresh, true);
		ctx.registerDomEvent(window, "resize", refresh);
		const viewport = window.visualViewport;
		if (viewport) {
			viewport.addEventListener("resize", refresh);
			ctx.register(() => viewport.removeEventListener("resize", refresh));
		}
		ctx.registerEvent(ctx.app.workspace.on("active-leaf-change", refresh));
		ctx.registerEvent(ctx.app.workspace.on("layout-change", refresh));
		ctx.registerEvent(ctx.app.workspace.on("editor-change", refresh));
		// Another note in the same pane: the panel opened for the previous one closes.
		ctx.registerEvent(
			ctx.app.workspace.on("file-open", () => {
				controller.stylePanel?.close(false);
				controller.toolbar.hide();
			}),
		);
		ctx.onSettingsChange(() => {
			controller.restyleAll();
			refresh();
		});
	},
	settings(page) {
		const t = (key: string) => page.t(key);
		const choices = (ids: readonly string[], prefix: string) => Object.fromEntries(ids.map((id) => [id, t(prefix + id)]));

		const fresh = page.section(t("settings.new"), t("settings.new-desc"));
		fresh.dropdown("newStyle", t("settings.new-style"), choices(STYLES, "style."), { desc: t("settings.new-style-desc") });
		fresh.dropdown("newBanding", t("settings.new-banding"), choices(BANDINGS, "banding."), { desc: t("settings.new-banding-desc") });
		fresh.dropdown("newSize", t("settings.new-size"), choices(TEXT_SIZES, "size."), { desc: t("settings.new-size-desc") });
		// What "Use as default for new tables" saved beyond the three rows above, in words.
		const look = lookMeta(page.settings.newStyle, page.settings.newBanding, page.settings.newSize, page.settings.newExtras);
		const extras: string[] = [];
		if (look.accent !== "theme") {
			// A custom color has no name: its hex code is shown.
			const name = look.accent.startsWith("#") ? look.accent : t("accent." + look.accent);
			extras.push(page.t("settings.extras-accent", { accent: name }));
		}
		if (look.header === "off") extras.push(t("settings.extras-header-off"));
		if (look.header === "hide") extras.push(t("settings.extras-header-hide"));
		if (look.firstCol) extras.push(t("settings.extras-first-col"));
		if (look.total) extras.push(t("settings.extras-total"));
		if (extras.length) {
			fresh.add(t("settings.new-extras"), { desc: page.t("settings.new-extras-desc", { list: extras.join(", ") }) }).addButton((button) =>
				button.setButtonText(t("settings.extras-clear")).onClick(async () => {
					page.settings.newExtras = "";
					await page.save();
					page.refresh();
				}),
			);
		}

		page.section(t("settings.other")).dropdown("otherTables", t("settings.other-style"), { none: t("style.none"), ...choices(STYLES, "style.") }, {
			desc: t("settings.other-style-desc"),
		});

		const ui = page.section(t("settings.interface"));
		ui.toggle("toolbar", t("settings.toolbar"), { desc: t("settings.toolbar-desc") });
		ui.toggle("chip", t("settings.chip"), { desc: t("settings.chip-desc") });
		ui.toggle("keyboard", t("settings.keyboard"), { desc: t("settings.keyboard-desc") });

		page.section(t("settings.sorting")).dropdown("dateOrder", t("settings.date-order"), { dmy: t("settings.dmy"), mdy: t("settings.mdy") }, {
			desc: t("settings.date-order-desc"),
		});
	},
});
