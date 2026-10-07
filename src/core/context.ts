// What an active module gets: Obsidian's registration helpers, scoped to the module so that
// turning it off undoes everything it added (commands, views, editor extensions, events, DOM).
// Cleanups are owned by this context, never by the plugin, so nothing piles up across on/off cycles.
import type { Extension } from "@codemirror/state";
import {
	Component,
	MarkdownPostProcessor,
	MarkdownPreviewRenderer,
	type App,
	type Command,
	type ViewCreator,
} from "obsidian";
import type { Lang, Translator, Vars } from "../i18n";
import type SnailkitPlugin from "../main";
import { showToast, type ToastOptions } from "../ui/toast";
import type { ModuleHandle } from "./host";
import type { PlacesOptions, PlacesService } from "./places/types";
import { moduleWorkbench } from "./workbench";
import type { ModuleWorkbench } from "./workbench/types";

interface Ribbon {
	addRibbonItemButton(id: string, icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement;
	removeRibbonAction(id: string): void;
}
interface Commands {
	addCommand(command: Command): void;
	removeCommand(id: string): void;
}
interface ViewRegistry {
	registerView(type: string, creator: ViewCreator): void;
	unregisterView(type: string): void;
}

export class ModuleContext<S extends object = object> extends Component {
	readonly app: App;
	private readonly settingsListeners: Array<(settings: S) => void> = [];

	constructor(
		readonly plugin: SnailkitPlugin,
		private readonly handle: ModuleHandle<S>,
	) {
		super();
		this.app = plugin.app;
	}

	/**
	 * Every cleanup runs in its own try/catch: Obsidian stops at the first cleanup that throws,
	 * which would leave the rest of the module registered.
	 */
	register(cleanup: () => unknown): void {
		super.register(() => {
			try {
				cleanup();
			} catch (error) {
				console.error(`[Snailkit] ${this.id}: cleanup failed`, error);
			}
		});
	}

	get id(): string {
		return this.handle.def.id;
	}

	/** Current settings of the module. Read them when you need them: they change live. */
	get settings(): S {
		return this.handle.settings;
	}

	get lang(): Lang {
		return this.handle.translator.lang;
	}

	/** Module string, falling back to the shared `common.*` strings. */
	t(key: string, vars?: Vars): string {
		return this.handle.translator.t(key, vars);
	}

	tn(key: string, count: number, vars?: Vars): string {
		return this.handle.translator.tn(key, count, vars);
	}

	/** The module's strings in every language, to recognize text the module wrote in another language. */
	translators(): Translator[] {
		return this.handle.allTranslators();
	}

	async saveSettings(): Promise<void> {
		await this.handle.save();
	}

	/** Called after any settings change, from the settings page or from `saveSettings`. */
	onSettingsChange(listener: (settings: S) => void): void {
		this.settingsListeners.push(listener);
	}

	/** @internal */
	notifySettings(): void {
		for (const listener of this.settingsListeners) {
			try {
				listener(this.settings);
			} catch (error) {
				console.error(`[Snailkit] ${this.id}: settings listener failed`, error);
			}
		}
	}

	/**
	 * Adds a command, shown as "Snailkit: <name>". Its id is `snailkit:<module>-<id>`, so hotkeys
	 * the user assigns survive turning the module off and on.
	 */
	addCommand(command: Command): Command {
		const { id: pluginId, name: pluginName } = this.plugin.manifest;
		const full: Command = { ...command, id: `${pluginId}:${this.id}-${command.id}`, name: `${pluginName}: ${command.name}` };
		const commands = (this.app as unknown as { commands?: Commands }).commands;
		if (!commands) {
			// Fallback on the public API (its cleanup is then kept by the plugin until it unloads).
			const id = `${this.id}-${command.id}`;
			const added = this.plugin.addCommand({ ...command, id });
			this.register(() => this.plugin.removeCommand(id));
			return added;
		}
		commands.addCommand(full);
		this.register(() => commands.removeCommand(full.id));
		return full;
	}

	registerEditorExtension(extension: Extension): void {
		const list = this.plugin.editorExtensions;
		list.push(extension);
		this.app.workspace.updateOptions();
		this.register(() => {
			const index = list.indexOf(extension);
			if (index >= 0) list.splice(index, 1);
			this.app.workspace.updateOptions();
		});
	}

	registerView(type: string, creator: ViewCreator): void {
		const registry = (this.app as unknown as { viewRegistry?: ViewRegistry }).viewRegistry;
		if (!registry) {
			this.plugin.registerView(type, creator);
			this.register(() => this.app.workspace.detachLeavesOfType(type));
			return;
		}
		registry.registerView(type, creator);
		this.register(() => {
			this.app.workspace.detachLeavesOfType(type);
			registry.unregisterView(type);
		});
	}

	registerMarkdownPostProcessor(processor: MarkdownPostProcessor, sortOrder?: number): void {
		MarkdownPreviewRenderer.registerPostProcessor(processor, sortOrder);
		// Same notification as Obsidian's own helper, so open notes render again with (or without) it.
		this.app.workspace.trigger("post-processor-change");
		this.register(() => {
			MarkdownPreviewRenderer.unregisterPostProcessor(processor);
			this.app.workspace.trigger("post-processor-change");
		});
	}

	addRibbonIcon(icon: string, title: string, callback: (event: MouseEvent) => unknown): HTMLElement {
		const ribbon = (this.app.workspace as unknown as { leftRibbon?: Ribbon }).leftRibbon;
		if (!ribbon) {
			const el = this.plugin.addRibbonIcon(icon, title, callback);
			this.register(() => el.detach());
			return el;
		}
		const id = `${this.plugin.manifest.id}:${this.id}-${title}`;
		const el = ribbon.addRibbonItemButton(id, icon, title, callback);
		this.register(() => {
			ribbon.removeRibbonAction(id);
			el.detach();
		});
		return el;
	}

	addStatusBarItem(): HTMLElement {
		const el = this.plugin.addStatusBarItem();
		this.register(() => el.detach());
		return el;
	}

	/**
	 * Shares an object with other modules (and with companion plugins, through
	 * `app.plugins.plugins.snailkit.api.service(name)`) while this module is on. Name it after
	 * the module id. Keep it small, documented and stable: it is a public API.
	 */
	provide<T>(name: string, service: T): void {
		this.plugin.services.set(name, service);
		this.plugin.app.workspace.trigger("snailkit:services-changed");
		this.register(() => {
			if (this.plugin.services.get(name) === service) this.plugin.services.delete(name);
			this.plugin.app.workspace.trigger("snailkit:services-changed");
		});
	}

	/**
	 * Another module's shared object, or undefined while that module is off. Ask for it each time
	 * you need it (it comes and goes); listen to "snailkit:services-changed" on the workspace to
	 * redraw when it does.
	 */
	service<T>(name: string): T | undefined {
		return this.plugin.services.get(name) as T | undefined;
	}

	/** Runs `callback` whenever a module starts or stops sharing a service. */
	onServicesChange(callback: () => void): void {
		const workspace = this.app.workspace as unknown as { on(name: string, cb: () => void): import("obsidian").EventRef };
		this.registerEvent(workspace.on("snailkit:services-changed", callback));
	}

	private moduleBench: ModuleWorkbench | null = null;

	/** The Workbench of the core: tabs this module adds go away when it stops (see core/workbench/types.ts). */
	get workbench(): ModuleWorkbench {
		return (this.moduleBench ??= moduleWorkbench(this.plugin.workbench, (cleanup) => this.register(cleanup)));
	}

	/** Where notes belong (parents, areas, domains): the rule shared by the rail, Home, the Map and Search. */
	get places(): PlacesService {
		return this.plugin.places;
	}

	/** Options of the places rule (the Home module's settings). Back to the defaults when this module stops. */
	configurePlaces(options: Partial<PlacesOptions>): void {
		this.plugin.places.configure(options);
		if (this.placesConfigured) return;
		this.placesConfigured = true;
		this.register(() => this.plugin.places.configure({ home: "", ignoredFolders: [] }));
	}

	private placesConfigured = false;

	/** A short message at the bottom of the window, with an optional action such as Undo. */
	toast(message: string, options?: ToastOptions): void {
		showToast(message, options);
	}
}
