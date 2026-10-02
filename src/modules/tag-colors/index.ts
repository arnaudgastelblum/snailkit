import { defineModule } from "../../core/module";
import { buildCss, capsule, slotHue } from "./colors";
import { classes, ColorModal, ReassignModal, setOverride } from "./dialogs";
import { TagRuntime } from "./runtime";
import { frequencies, migrate, registry, type ColorHost, type TagColorsSettings } from "./types";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";
import { nl } from "./i18n/nl";
import { es } from "./i18n/es";

export const tagColors = defineModule<TagColorsSettings>({
	id: "tag-colors",
	icon: "tags",
	category: "organize",
	strings: { en, fr, nl, es },
	defaults: { uppercase: true, colorPanes: true, slots: [], overrides: [] },
	migrate,
	activate(ctx) { new TagRuntime(ctx).start(); },
	settings(page) {
		const host: ColorHost = {
			app: page.app,
			get settings() { return page.settings; },
			t: (key, vars) => page.t(key, vars),
			save: () => page.save(),
		};
		const open = (modal: ColorModal | ReassignModal) => {
			page.onDispose(() => modal.close());
			modal.open();
		};
		const display = page.section(page.t("settings.display"));
		display.toggle("uppercase", page.t("settings.uppercase"), { desc: page.t("settings.uppercase-desc"), onChange: () => page.refresh() });
		display.toggle("colorPanes", page.t("settings.panes"), { desc: page.t("settings.panes-desc") });
		const most = page.section(page.t("settings.most"), page.t("settings.most-desc"));
		most.el.addClass("sk-tag-colors-settings");
		most.el.toggleClass("sk-tag-colors-upper", page.settings.uppercase);
		most.el.createEl("style").textContent = buildCss([...Array.from({ length: 14 }, (_, i) => slotHue(i)), ...Object.values(registry(page.settings, "overrides"))])
			.replace(/ \.sk-tag-colors-/g, " .sk-tag-colors-settings .sk-tag-colors-");
		const tags = Object.entries(frequencies(page.app)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20);
		if (!tags.length) most.note(page.t("settings.empty"));
		for (const [tag, count] of tags) {
			const row = most.add("", { desc: page.tn("occurrences", count) });
			const button = row.nameEl.createEl("button", { cls: "sk-tag-colors-tag-button", attr: { "aria-label": page.t("color.change", { tag }) } });
			button.append(capsule(button.ownerDocument, tag, classes(host, tag)));
			button.onclick = () => open(new ColorModal(host, tag, () => page.refresh()));
		}
		const custom = page.section(page.t("settings.custom"), page.t("settings.custom-desc"));
		const overrides = Object.keys(registry(page.settings, "overrides")).sort();
		if (!overrides.length) custom.note(page.t("settings.no-custom"));
		for (const tag of overrides) {
			custom.add("#" + tag)
				.addButton(button => button.setButtonText(page.t("color.tag")).onClick(() => open(new ColorModal(host, tag, () => page.refresh()))))
				.addButton(button => button.setButtonText(page.t("common.reset")).onClick(async () => {
					await setOverride(host, tag, null);
					page.refresh();
				}));
		}
		custom.add(page.t("reassign"), { desc: page.t("reassign.desc") })
			.addButton(button => button.setButtonText(page.t("reassign")).onClick(() => open(new ReassignModal(host, () => page.refresh()))));
	},
});
