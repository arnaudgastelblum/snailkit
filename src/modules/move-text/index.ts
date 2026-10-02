// Move text: three editor actions and their live module settings.
import { moment, normalizePath } from "obsidian";
import { defineModule } from "../../core/module";
import { richText } from "../../ui/settings-page";
import { MoveTextActions } from "./actions";
import type { MoveTextSettings } from "./types";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";
import { nl } from "./i18n/nl";
import { es } from "./i18n/es";

export const moveText = defineModule<MoveTextSettings>({
	id: "move-text",
	icon: "scissors",
	category: "write",
	strings: { en, fr, nl, es },
	defaults: {
		archiveFolder: "Archives",
		prefixSubnoteName: true,
		provenanceLine: true,
		dateFormat: "YYYY-MM-DD",
	},
	activate(ctx) {
		const actions = new MoveTextActions(ctx);
		const commands = [
			{ id: "extract", icon: "scissors", run: actions.extract.bind(actions) },
			{ id: "archive", icon: "archive", run: actions.archive.bind(actions) },
			{ id: "append", icon: "file-input", run: actions.appendTo.bind(actions) },
		];
		for (const command of commands) {
			ctx.addCommand({ id: command.id, name: ctx.t("command." + command.id), editorCallback: command.run });
		}
		ctx.registerEvent(ctx.app.workspace.on("editor-menu", (menu, editor, view) => {
			if (!view.file) return;
			for (const command of commands) {
				menu.addItem((item) => item.setTitle(ctx.t("command." + command.id))
					.setIcon(command.icon).onClick(() => command.run(editor, view)));
			}
		}));
	},
	settings(page) {
		page.section(page.t("settings.subnotes"))
			.toggle("prefixSubnoteName", page.t("settings.prefix"), { desc: page.t("settings.prefix-desc") });
		page.section(page.t("settings.archives"))
			.text("archiveFolder", page.t("settings.folder"), {
				desc: page.t("settings.folder-desc"),
				placeholder: page.t("settings.folder-placeholder"),
				normalize: (value) => value.trim() && value.trim() !== "/" ? normalizePath(value.trim()) : "",
			});
		const provenance = page.section(page.t("settings.provenance"));
		provenance.toggle("provenanceLine", page.t("settings.provenance-line"), { desc: page.t("settings.provenance-desc") });
		const description = () => page.t("settings.date-desc", {
			date: moment().locale("en").format(page.settings.dateFormat || "YYYY-MM-DD"),
		});
		const dateRow = provenance.text("dateFormat", page.t("settings.date"), {
			desc: description(),
			placeholder: "YYYY-MM-DD",
			normalize: (value) => value.trim() || "YYYY-MM-DD",
			onChange: () => dateRow.setDesc(richText(description())),
		});
	},
});
