// Home: the first tab of the Workbench. Search, today, pins, domains (or a map, or tags) and
// recent notes, filled in from the notes themselves; pages of a domain and of a tag. It also
// sets when the Workbench opens by itself, and the home page and ignored folders of the places
// rule (for all of Snailkit, while it runs). Nothing is ever written in the notes.
import { Notice } from "obsidian";
import { defineModule } from "../../core/module";
import type { PlacesService } from "../../core/places/types";
import { HomeRuntime } from "./runtime";
import { cleanNotePath, migrateSettings, OPEN_MODES, splitFolders } from "./settings-logic";
import { DEFAULTS, KEEP_ON_RESET, type HomeSettings } from "./types";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";
import { nl } from "./i18n/nl";
import { es } from "./i18n/es";

export const home = defineModule<HomeSettings>({
	id: "home",
	icon: "house",
	category: "organize",
	strings: { en, fr, nl, es },
	defaults: DEFAULTS,
	keepOnReset: KEEP_ON_RESET,
	migrate: migrateSettings,
	activate(ctx) {
		new HomeRuntime(ctx).start();
	},
	settings(page) {
		const opening = page.section(page.t("settings.opening"));
		const choices: Record<string, string> = {};
		for (const mode of OPEN_MODES) choices[mode] = page.t(`settings.mode.${mode}`);
		opening.dropdown("openWorkbench", page.t("settings.open-workbench"), choices, { desc: page.t("settings.open-desc") });
		opening.note(page.t("settings.open-warn"));

		const domains = page.section(page.t("settings.domains"));
		// The home page found now (with the options in force), through the shared "places" service.
		const places = (page.app as unknown as { plugins?: { plugins?: Record<string, { api?: { service?(name: string): unknown } }> } }).plugins?.plugins?.snailkit?.api?.service?.("places") as PlacesService | undefined;
		let found: string | null = null;
		try {
			found = places?.homePath() ?? null;
		} catch {
			found = null;
		}
		const foundName = found ? found.replace(/^.*\//, "").replace(/\.md$/, "") : "";
		domains.text("homePage", page.t("settings.home-page"), {
			desc: page.t("settings.home-page-desc", { found: found ? page.t("settings.home-found", { name: foundName }) : page.t("settings.home-none") }),
			placeholder: foundName || "Home.md",
			normalize: (value) => cleanNotePath(value),
		});
		domains.text("ignoredFolders", page.t("settings.ignored"), {
			desc: page.t("settings.ignored-desc"),
			placeholder: "Templates, Archive",
			normalize: (value) => splitFolders(value).join(", "),
		});
		const hidden = page.settings.hidden.length;
		domains
			.add(page.t("settings.hidden"), { desc: hidden ? page.tn("settings.hidden-desc", hidden) : page.t("settings.hidden-none") })
			.addButton((b) =>
				b
					.setButtonText(page.t("settings.show-hidden"))
					.setDisabled(!hidden)
					.onClick(async () => {
						page.settings.hidden = [];
						await page.save();
						page.refresh();
					}),
			);
		let armed = 0;
		domains.add(page.t("settings.arrangement"), { desc: page.t("settings.arrangement-desc") }).addButton((b) => {
			b.setButtonText(page.t("settings.reset-arrangement")).onClick(async () => {
				if (!armed) {
					b.setButtonText(page.t("settings.reset-confirm")).setWarning();
					armed = window.setTimeout(() => {
						armed = 0;
						b.setButtonText(page.t("settings.reset-arrangement"));
						b.buttonEl.removeClass("mod-warning");
					}, 3000);
					return;
				}
				window.clearTimeout(armed);
				armed = 0;
				const s = page.settings;
				s.domainOrder = [];
				s.featured = "";
				s.groups = [];
				s.domainGroups = [];
				s.hidden = [];
				s.pulledOut = [];
				s.noteOrder = [];
				await page.save();
				new Notice(page.t("settings.reset-done"));
				page.refresh();
			});
		});
	},
});
