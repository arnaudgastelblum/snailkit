// Idea sessions: write freely in one note, catch the tasks in it, close with a short summary.
import { normalizePath, Platform } from "obsidian";
import { defineModule } from "../../core/module";
import { keys } from "./capsule";
import { SessionsRuntime } from "./runtime";
import { DEFAULTS, type SessionsSettings } from "./types";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";
import { nl } from "./i18n/nl";
import { es } from "./i18n/es";

export const sessions = defineModule<SessionsSettings>({
	id: "sessions",
	icon: "zap",
	category: "write",
	strings: { en, fr, nl, es },
	defaults: DEFAULTS,
	keepOnReset: ["sessions", "created", "learned", "recentTags", "pinned", "archived"],
	activate(ctx) {
		new SessionsRuntime(ctx).start();
	},
	settings(page) {
		const fresh = page.section(page.t("settings.new"));
		fresh.text("folder", page.t("settings.folder"), {
			desc: page.t("settings.folder-desc"),
			placeholder: "Sessions",
			normalize: (v) => (v.trim() ? normalizePath(v.trim()) : ""),
		});
		fresh.text("parent", page.t("settings.parent"), {
			desc: page.t("settings.parent-desc"),
			placeholder: "Inbox",
			normalize: (v) => v.trim().replace(/^\[\[|\]\]$/g, "").replace(/\.md$/i, ""),
		});

		const note = page.section(page.t("settings.note"));
		note.dropdown("scope", page.t("settings.scope"), { sessions: page.t("scope.sessions"), all: page.t("scope.all") }, { desc: page.t("settings.scope-desc") });
		note.toggle("dots", page.t("settings.dots"), { desc: page.t("settings.dots-desc") });
		note.add(page.t("settings.learned"), { desc: page.tn("settings.learned-desc", new Set(page.settings.learned.map(([w]) => w)).size) })
			.addButton((b) => b.setButtonText(page.t("settings.forget")).setDisabled(!page.settings.learned.length).onClick(async () => {
				page.settings.learned = [];
				page.settings.recentTags = [];
				await page.save();
				page.refresh();
			}));

		const mod = Platform.isMacOS ? "Cmd" : "Ctrl";
		const alt = Platform.isMacOS ? "Option" : "Alt";
		const enter = page.t("key.enter");
		const shift = page.t("key.shift");
		const tab = page.t("key.tab");
		const esc = page.t("key.esc");
		const list = page.section(page.t("settings.shortcuts"), page.t("settings.shortcuts-desc"));
		list.el.addClass("sk-sessions-shortcuts");
		const rows: Array<[string, string[][]]> = [
			["sc.fish", [[mod, enter]]],
			["sc.decide", [[mod, shift, enter]]],
			["sc.next", [[alt, "↓"]]],
			["sc.prev", [[alt, "↑"]]],
			["sc.undo", [[mod, "Z"]]],
			["sc.title-enter", [[enter]]],
			["sc.title-tab", [[tab]]],
			["sc.tag-pick", [["←"], ["→"], ["↑"], ["↓"]]],
			["sc.tag-sub", [[tab], [shift, tab]]],
			["sc.tag-type", []],
			["sc.desc-lines", [["↓"], ["↑"]]],
			["sc.desc-place", [[enter]]],
			["sc.bracket", [[alt, "↓"], [alt, "↑"]]],
			["sc.place", [[mod, enter]]],
			["sc.cancel", [[esc]]],
			["sc.back", [[shift, tab]]],
			["sc.help", [[mod, "/"]]],
		];
		for (const [key, combos] of rows) {
			const row = list.add(page.t(key));
			const keysEl = row.controlEl.createSpan({ cls: "sk-sessions-keys" });
			if (!combos.length) keysEl.createSpan({ text: page.t("sc.tag-type-key") });
			combos.forEach((combo, i) => {
				if (i) keysEl.appendText(" ");
				keys(keysEl, ...combo);
			});
		}
	},
});
