import { defineModule } from "../../core/module";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";
import { nl } from "./i18n/nl";
import { es } from "./i18n/es";
import { defaultSettings, localizedSettings } from "./settings/defaults";
import { migrateSettings } from "./settings/migrations";
import { renderSettings, coreSlashEnabled } from "./settings/page";
import { MenuController, type MenuControllerHost } from "./menu/MenuController";
import { SearchIndex } from "./search/SearchIndex";
import { itemAvailability } from "./actions/executor";

export const slashMenu = defineModule({
	id: "slash-menu",
	icon: "square-slash",
	category: "write",
	strings: { en, fr, nl, es },
	defaults: defaultSettings(),
	migrate: (stored) => ({ ...migrateSettings(stored) }),
	settings: renderSettings,
	activate(ctx) {
		let active = true;
		const timers = new Set<number>();
		let settings = localizedSettings(migrateSettings(ctx.settings), ctx.t.bind(ctx));
		const index = new SearchIndex();
		const host: MenuControllerHost = {
			app: ctx.app,
			t: ctx.t.bind(ctx),
			active: () => active,
			store: { get settings() { return settings; } },
			getIndex: () => index,
			blocked: () => settings.triggerChar.startsWith("/") && coreSlashEnabled(ctx.app),
			later(callback, delay) {
				if (!active) return;
				const id = window.setTimeout(() => { timers.delete(id); if (active) callback(); }, delay);
				timers.add(id);
			},
			availabilityFor: (item, hasEditor) => itemAvailability(item, { app: ctx.app, host, hasEditor, hasFile: !!ctx.app.workspace.getActiveFile() }),
			recordRecent(id) {
				ctx.settings.recent = [id, ...ctx.settings.recent.filter((previous) => previous !== id)].slice(0, 20);
				void ctx.saveSettings();
			},
		};
		const controller = new MenuController(host);
		const rebuild = () => {
			settings = localizedSettings(migrateSettings(ctx.settings), ctx.t.bind(ctx));
			index.build(settings.items, settings.categories);
			controller.close(false);
		};
		rebuild();
		ctx.onSettingsChange(rebuild);
		ctx.registerEditorExtension(controller.extensions());
		ctx.register(() => {
			active = false;
			controller.destroy();
			for (const id of timers) window.clearTimeout(id);
			timers.clear();
		});
		ctx.addCommand({
			id: "open",
			name: ctx.t("command.open"),
			editorCallback: (editor) => {
				if (host.blocked()) ctx.toast(ctx.t("conflict.note"));
				else controller.openFromCommand(editor);
			},
		});
	},
});
