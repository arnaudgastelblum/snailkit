// Snailkit: one plugin, many small tools ("modules"), each turned on or off in the settings.
// The plugin itself only loads settings, starts the enabled modules and draws the settings tab.
import type { Extension } from "@codemirror/state";
import { Notice, Plugin, getLanguage } from "obsidian";
import { ModuleHost } from "./core/host";
import { normalizeData, type SnailkitData } from "./core/settings";
import { Translator, resolveLanguage, type Lang, type LanguageSetting, type Vars } from "./i18n";
import { CORE_STRINGS } from "./i18n/core";
import { MODULES } from "./modules/registry";
import { registerIcons } from "./ui/icons";
import { SnailkitSettingTab } from "./ui/settings-tab";
import { clearToast, showToast, type ToastOptions } from "./ui/toast";

export default class SnailkitPlugin extends Plugin {
	data!: SnailkitData;
	host!: ModuleHost;
	translator!: Translator;
	/** Shared list given to CodeMirror once; modules add and remove their extensions in it. */
	readonly editorExtensions: Extension[] = [];
	/** Objects that running modules share with each other and with companion plugins (see ModuleContext.provide). */
	readonly services = new Map<string, unknown>();
	/** Public entry point for companion plugins: `app.plugins.plugins.snailkit.api`. */
	readonly api = {
		version: 1,
		/** A running module's shared object, or undefined while that module is off. */
		service: <T>(name: string): T | undefined => this.services.get(name) as T | undefined,
		/** Whether a module is currently on. */
		isEnabled: (moduleId: string): boolean => this.host?.get(moduleId)?.state === "on",
	};
	private settingTab!: SnailkitSettingTab;

	get lang(): Lang {
		return this.translator.lang;
	}

	async onload(): Promise<void> {
		this.data = normalizeData(await this.loadData());
		this.translator = new Translator(resolveLanguage(this.data.language, this.obsidianLanguage()), [CORE_STRINGS]);
		registerIcons();
		this.registerEditorExtension(this.editorExtensions);

		this.host = new ModuleHost(this, MODULES);
		this.settingTab = new SnailkitSettingTab(this);
		this.addSettingTab(this.settingTab);
		await this.host.startEnabled();

		if (!this.data.welcomed) this.app.workspace.onLayoutReady(() => this.welcome());
	}

	onunload(): void {
		this.host?.stopAll();
		clearToast();
	}

	obsidianLanguage(): string {
		try {
			return getLanguage();
		} catch {
			return "en";
		}
	}

	t(key: string, vars?: Vars): string {
		return this.translator.t(key, vars);
	}

	toast(message: string, options?: ToastOptions): void {
		showToast(message, options);
	}

	async setLanguage(language: LanguageSetting): Promise<void> {
		this.data.language = language;
		await this.saveData(this.data);
		this.translator = new Translator(resolveLanguage(language, this.obsidianLanguage()), [CORE_STRINGS]);
		await this.host.relocalize();
	}

	/** Opens Snailkit's settings, on a tool's page when `moduleId` is given. */
	openSettings(moduleId?: string): void {
		const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
		if (!setting) return;
		setting.open();
		setting.openTabById(this.manifest.id);
		this.settingTab.show(moduleId);
	}

	/** First run only: a notice pointing to the settings, since every tool starts off. */
	private async welcome(): Promise<void> {
		this.data.welcomed = true;
		await this.saveData(this.data);
		const notice = new Notice("", 12000);
		const el = notice.messageEl;
		el.addClass("sk-welcome");
		el.createDiv({ text: this.t("plugin.welcome") });
		const button = el.createEl("button", { cls: "mod-cta", text: this.t("plugin.welcome-action") });
		button.addEventListener("click", () => {
			notice.hide();
			this.openSettings();
		});
	}
}
