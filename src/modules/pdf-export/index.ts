// PDF export: one command and two menu entries that print a note to PDF with the look it has
// in Obsidian. Desktop only (Electron prints the page).
import { TFile, type Menu } from "obsidian";
import { defineModule } from "../../core/module";
import { PdfExporter } from "./exporter";
import { PAGE_SIZES_MM, folderPath } from "./logic";
import type { PdfExportSettings } from "./types";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";
import { nl } from "./i18n/nl";
import { es } from "./i18n/es";

export const pdfExport = defineModule<PdfExportSettings>({
	id: "pdf-export",
	icon: "file-down",
	category: "export",
	strings: { en, fr, nl, es },
	desktopOnly: true,
	defaults: {
		pageSize: "A4",
		landscape: false,
		marginMm: 15,
		scalePercent: 100,
		pageNumbers: true,
		headerTitle: false,
		colorScheme: "obsidian",
		pageBackground: "white",
		addTitle: true,
		pageBreakMarker: "%% pagebreak %%",
		pageBreakBefore: "none",
		internalLinks: "obsidian",
		clickableImages: true,
		outline: true,
		saveMode: "ask",
		outputFolder: "PDF",
		openAfterExport: true,
		lastSaveDir: "",
	},
	activate(ctx) {
		const exporter = new PdfExporter(ctx);
		// Turning the module off cancels an export in flight: host, print window and temp file go.
		ctx.register(() => exporter.cancel());
		const run = (file: TFile) => void exporter.exportFile(file);

		ctx.addCommand({
			id: "export",
			name: ctx.t("command.export"),
			icon: "file-down",
			checkCallback: (checking) => {
				const file = ctx.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) run(file);
				return true;
			},
		});
		const addItem = (menu: Menu, file: TFile) =>
			menu.addItem((item) => item.setTitle(ctx.t("menu.export")).setIcon("file-down").onClick(() => run(file)));
		ctx.registerEvent(ctx.app.workspace.on("editor-menu", (menu, _editor, view) => {
			if (view.file?.extension === "md") addItem(menu, view.file);
		}));
		ctx.registerEvent(ctx.app.workspace.on("file-menu", (menu, file) => {
			if (file instanceof TFile && file.extension === "md") addItem(menu, file);
		}));
	},
	settings(page) {
		const t = (key: string) => page.t(key);
		const choices = (prefix: string, values: string[]) => Object.fromEntries(values.map((value) => [value, t(`${prefix}.${value}`)]));

		const paper = page.section(t("settings.page"));
		const sizes = Object.fromEntries(Object.keys(PAGE_SIZES_MM).map((size) => [size, size]));
		paper.dropdown("pageSize", t("settings.page-size"), sizes, { desc: t("settings.page-size-desc") });
		paper.toggle("landscape", t("settings.landscape"), { desc: t("settings.landscape-desc") });
		paper.number("marginMm", t("settings.margin"), { desc: t("settings.margin-desc"), min: 0, max: 40, unit: " mm" });
		paper.number("scalePercent", t("settings.scale"), { desc: t("settings.scale-desc"), min: 50, max: 150, step: 5, unit: " %" });
		paper.toggle("pageNumbers", t("settings.page-numbers"), { desc: t("settings.page-numbers-desc") });
		paper.toggle("headerTitle", t("settings.header"), { desc: t("settings.header-desc") });

		const content = page.section(t("settings.content"));
		content.dropdown("colorScheme", t("settings.color-scheme"), choices("scheme", ["obsidian", "light", "dark"]), { desc: t("settings.color-scheme-desc") });
		content.dropdown("pageBackground", t("settings.background"), choices("background", ["white", "theme"]), { desc: t("settings.background-desc") });
		content.toggle("addTitle", t("settings.add-title"), { desc: t("settings.add-title-desc") });
		content.text("pageBreakMarker", t("settings.marker"), {
			desc: t("settings.marker-desc"),
			placeholder: "%% pagebreak %%",
			normalize: (value) => value.trim(),
		});
		content.dropdown("pageBreakBefore", t("settings.break-before"), choices("break", ["none", "h1", "h2"]), { desc: t("settings.break-before-desc") });

		const links = page.section(t("settings.links"));
		links.dropdown("internalLinks", t("settings.internal-links"), choices("links", ["obsidian", "none"]), { desc: t("settings.internal-links-desc") });
		links.toggle("clickableImages", t("settings.clickable-images"), { desc: t("settings.clickable-images-desc") });

		const output = page.section(t("settings.output"));
		output.toggle("outline", t("settings.outline"), { desc: t("settings.outline-desc") });
		// The output folder only matters in "In a vault folder": the page is drawn again to show or hide it.
		output.dropdown("saveMode", t("settings.save"), choices("save", ["ask", "nextToNote", "folder"]), {
			desc: t("settings.save-desc"),
			onChange: () => page.refresh(),
		});
		if (page.settings.saveMode === "folder") {
			output.text("outputFolder", t("settings.folder"), {
				desc: t("settings.folder-desc"),
				placeholder: "PDF",
				normalize: folderPath,
			});
		}
		output.toggle("openAfterExport", t("settings.open"), { desc: t("settings.open-desc") });
	},
});
