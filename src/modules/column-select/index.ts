import { buildDemo } from "./demo";
import { defineModule } from "../../core/module";
import { ColumnSelectEditor } from "./editor";
import type { ColumnSelectSettings } from "./types";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";
import { nl } from "./i18n/nl";
import { es } from "./i18n/es";

export const columnSelect = defineModule<ColumnSelectSettings>({
	id: "column-select",
	icon: "text-cursor-input",
	category: "write",
	strings: { en, fr, nl, es },
	demo: (el, t) => buildDemo(el, t),
	defaults: { keyboard: true, mouse: true, distributePaste: true },
	activate(ctx) {
		new ColumnSelectEditor(ctx);
	},
	settings(page) {
		const selecting = page.section(page.t("settings.selecting"));
		selecting.toggle("keyboard", page.t("settings.keyboard"), { desc: page.t("settings.keyboard-desc") });
		selecting.toggle("mouse", page.t("settings.mouse"), { desc: page.t("settings.mouse-desc") });
		page.section(page.t("settings.pasting"))
			.toggle("distributePaste", page.t("settings.paste"), { desc: page.t("settings.paste-desc") });
	},
});
