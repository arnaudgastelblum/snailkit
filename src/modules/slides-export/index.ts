import { buildDemo } from "./demo";
import { ItemView } from "obsidian";
import { defineModule } from "../../core/module";
import { unavailableReason } from "./availability";
import { SlidesExporter } from "./exporter";
import { folderPath, SLIDE_SIZES } from "./logic";
import type { DrawingView, SlidesSettings } from "./types";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";
import { nl } from "./i18n/nl";
import { es } from "./i18n/es";

export const slidesExport = defineModule<SlidesSettings>({
	id: "slides-export",
	icon: "presentation",
	category: "export",
	strings: { en, fr, nl, es },
	demo: (el, t) => buildDemo(el, t),
	defaults: { slideSize: "16:9", imageWidth: "1920", theme: "view", withBackground: true, saveMode: "ask", outputFolder: "", lastSaveDir: "" },
	keepOnReset: ["lastSaveDir"],
	unavailableReason,
	activate(ctx) {
		const exporter = new SlidesExporter(ctx);
		ctx.register(() => exporter.cancel());
		ctx.addCommand({
			id: "export",
			name: ctx.t("command.export"),
			icon: "presentation",
			checkCallback(checking) {
				const view = ctx.app.workspace.getActiveViewOfType(ItemView);
				if (!view || view.getViewType() !== "excalidraw" || !(view as DrawingView).file) return false;
				if (!checking) void exporter.exportView(view as DrawingView);
				return true;
			},
		});
	},
	settings(page) {
		const t = (key: string) => page.t(key);
		const slides = page.section(t("settings.slides"), t("settings.clip"));
		slides.dropdown("slideSize", t("settings.size"), Object.fromEntries(Object.keys(SLIDE_SIZES).map((value) => [value, value])), { desc: t("settings.size-desc") });
		slides.dropdown("imageWidth", t("settings.width"), Object.fromEntries([1280, 1920, 2560, 3840].map((value) => [String(value), `${value} px`])), { desc: t("settings.width-desc") });
		slides.dropdown("theme", t("settings.theme"), { view: t("theme.view"), light: t("theme.light"), dark: t("theme.dark") }, { desc: t("settings.theme-desc") });
		slides.toggle("withBackground", t("settings.background"), { desc: t("settings.background-desc") });
		const output = page.section(t("settings.output"));
		output.dropdown("saveMode", t("common.save"), { ask: t("save.ask"), vault: t("save.vault") }, { desc: t("settings.save-desc") });
		output.text("outputFolder", t("settings.folder"), { desc: t("settings.folder-desc"), normalize: folderPath });
	},
});
