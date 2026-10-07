// Turns modules on and off. Each module runs in its own ModuleContext, inside a try/catch:
// a module that fails to start is marked as such and never takes the others down.
import { Notice, Platform } from "obsidian";
import { LANGUAGES, Translator } from "../i18n";
import { CORE_STRINGS } from "../i18n/core";
import type SnailkitPlugin from "../main";
import { ModuleContext } from "./context";
import type { AnyModule, ModuleDefinition } from "./module";
import { mergeSettings, type SnailkitData } from "./settings";

/** How long a change made on this device wins over a file arriving from another one. */
const LOCAL_WINS_MS = 3000;

export type ModuleState = "off" | "on" | "error" | "unavailable";

export class ModuleHandle<S extends object = object> {
	settings: S;
	translator: Translator;
	context: ModuleContext<S> | null = null;
	error: string | null = null;
	/** When this device last changed the module (settings or on/off); see ModuleHost.applyExternal. */
	localAt = 0;

	constructor(
		private readonly plugin: SnailkitPlugin,
		readonly def: ModuleDefinition<S>,
	) {
		this.settings = this.readSettings();
		this.translator = this.makeTranslator();
	}

	get enabled(): boolean {
		return this.plugin.data.modules[this.def.id]?.enabled === true;
	}

	get name(): string {
		return this.translator.t("module.name");
	}

	get description(): string {
		return this.translator.t("module.description");
	}

	/** Why the module cannot run on this device or vault, or null. */
	unavailableReason(): string | null {
		if (this.def.desktopOnly && !Platform.isDesktopApp) return this.translator.t("reason.desktop");
		try {
			return this.def.unavailableReason?.(this.plugin.app, (key) => this.translator.t(key)) ?? null;
		} catch {
			return null;
		}
	}

	get state(): ModuleState {
		if (this.context) return "on";
		if (this.enabled && this.error) return "error";
		if (this.unavailableReason()) return "unavailable";
		return "off";
	}

	makeTranslator(): Translator {
		return new Translator(this.plugin.lang, [this.def.strings, CORE_STRINGS]);
	}

	allTranslators(): Translator[] {
		return LANGUAGES.map((lang) => this.translator.withLang(lang));
	}

	readSettings(): S {
		let stored = this.plugin.data.modules[this.def.id]?.settings ?? {};
		if (this.def.migrate) {
			try {
				stored = this.def.migrate({ ...stored });
			} catch (error) {
				console.error(`[Snailkit] ${this.def.id}: settings migration failed, using defaults`, error);
				stored = {};
			}
		}
		return mergeSettings(this.def.defaults, stored);
	}

	/** Writes the current settings and tells the running module. */
	async save(): Promise<void> {
		this.localAt = Date.now();
		const record = (this.plugin.data.modules[this.def.id] ??= { enabled: false, settings: {} });
		// Keys this version does not know stay as they are: a newer copy of Snailkit on another
		// device (through Obsidian Sync) may have written them.
		record.settings = { ...record.settings, ...(structuredClone(this.settings) as Record<string, unknown>) };
		await this.plugin.saveData(this.plugin.data);
		this.localAt = Date.now();
		this.context?.notifySettings();
	}

	/** Back to the defaults, except the keys the module marks as user data (`keepOnReset`). */
	async resetSettings(): Promise<void> {
		const fresh = structuredClone(this.def.defaults) as Record<string, unknown>;
		for (const key of this.def.keepOnReset ?? []) fresh[key] = (this.settings as Record<string, unknown>)[key];
		this.settings = fresh as S;
		await this.save();
	}

	/**
	 * Bumped by every start and stop. A start that finishes after a newer start or stop (the user
	 * toggled fast, changed language, or the plugin unloaded) throws its context away.
	 */
	private generation = 0;
	/** The plugin unloaded (see close): the module never starts again. */
	private closed = false;

	async start(): Promise<boolean> {
		if (this.context) return true;
		if (this.closed) return false;
		this.error = null;
		if (this.unavailableReason()) return false;
		const generation = ++this.generation;
		const context = new ModuleContext<S>(this.plugin, this);
		context.load();
		try {
			await this.def.activate(context);
		} catch (error) {
			safeUnload(context, this.def.id);
			if (generation === this.generation) {
				this.error = error instanceof Error ? error.message : String(error);
				console.error(`[Snailkit] ${this.def.id} could not start`, error);
				new Notice(this.translator.t("plugin.start-error", { name: this.name }));
			}
			return false;
		}
		if (generation !== this.generation || !this.enabled) {
			safeUnload(context, this.def.id);
			return false;
		}
		this.context = context;
		return true;
	}

	stop(): void {
		this.generation++;
		const context = this.context;
		this.context = null;
		if (context) safeUnload(context, this.def.id);
	}

	/** The plugin unloads: stops the module, and a start still on its way, or asked later, does nothing. */
	close(): void {
		this.closed = true;
		this.stop();
	}
}

function safeUnload(context: { unload(): void }, id: string): void {
	try {
		context.unload();
	} catch (error) {
		console.error(`[Snailkit] ${id}: error while stopping`, error);
	}
}

export class ModuleHost {
	readonly handles: ModuleHandle[];
	/** Turning modules on and off, and language changes, run one after the other, never interleaved. */
	private queue: Promise<unknown> = Promise.resolve();
	/** The plugin unloaded (stopAll): a queued or running task changes nothing any more. */
	private closed = false;

	constructor(
		private readonly plugin: SnailkitPlugin,
		modules: AnyModule[],
	) {
		const seen = new Set<string>();
		for (const def of modules) {
			if (seen.has(def.id)) throw new Error(`Snailkit: two modules use the id "${def.id}"`);
			seen.add(def.id);
		}
		this.handles = modules.map((def) => new ModuleHandle(plugin, def));
	}

	get(id: string): ModuleHandle | undefined {
		return this.handles.find((handle) => handle.def.id === id);
	}

	private run<T>(task: () => Promise<T>): Promise<T> {
		const next = this.queue.then(task, task);
		this.queue = next.catch(() => undefined);
		return next;
	}

	startEnabled(): Promise<void> {
		return this.run(async () => {
			for (const handle of this.handles) {
				if (this.closed) return;
				if (handle.enabled) await handle.start();
			}
		});
	}

	/**
	 * The plugin unloads: every module stops for good. This does not wait for the queue: a task
	 * caught in the middle of an await (a slow start, reading data.json) finds the host closed
	 * when it resumes, and no module starts again.
	 */
	stopAll(): void {
		this.closed = true;
		for (const handle of [...this.handles].reverse()) handle.close();
	}

	/** Turns a module on or off and remembers the choice. Returns the resulting state. */
	setEnabled(id: string, enabled: boolean): Promise<ModuleState> {
		const handle = this.get(id);
		if (!handle) return Promise.resolve("off");
		// The choice is recorded at once; starting or stopping waits for its turn in the queue.
		const record = (this.plugin.data.modules[id] ??= { enabled: false, settings: {} });
		record.enabled = enabled;
		handle.localAt = Date.now();
		return this.run(async () => {
			// Saved even when the plugin unloaded meanwhile: the choice is kept for the next start.
			await this.plugin.saveData(this.plugin.data);
			handle.localAt = Date.now();
			if (this.closed) return handle.state;
			if (handle.enabled) await handle.start();
			else {
				handle.stop();
				handle.error = null;
			}
			return handle.state;
		});
	}

	/**
	 * data.json was changed on disk, usually by Obsidian Sync from another device: take the new
	 * values, so that this device never writes its older copy back over them. Settings reach the
	 * running modules, modules turned on or off elsewhere follow, and so does the language.
	 * `read` runs at its turn in the queue (never before a pending local change is saved) and
	 * returns null when the file cannot be read whole: then nothing changes. A module this device
	 * changed in the last seconds keeps its local values, which are being written and will win.
	 */
	applyExternal(read: () => Promise<SnailkitData | null>): Promise<void> {
		return this.run(async () => {
			if (this.closed) return;
			const fresh = await read();
			if (!fresh || this.closed) return;
			const now = Date.now();
			for (const handle of this.handles) {
				const local = this.plugin.data.modules[handle.def.id];
				if (local && now - handle.localAt < LOCAL_WINS_MS) fresh.modules[handle.def.id] = local;
			}
			const language = fresh.language !== this.plugin.data.language;
			this.plugin.data = fresh;
			for (const handle of this.handles) {
				if (this.closed) return;
				const settings = handle.readSettings();
				if (JSON.stringify(settings) !== JSON.stringify(handle.settings)) {
					handle.settings = settings;
					handle.context?.notifySettings();
				}
				if (handle.enabled && !handle.context && !handle.error && !handle.unavailableReason()) await handle.start();
				else if (!handle.enabled && handle.context) handle.stop();
			}
			if (language && !this.closed) {
				this.plugin.resetTranslator();
				await this.restartAll();
			}
		});
	}

	/** After a language change: new strings everywhere, and running modules restart so command names follow. */
	relocalize(): Promise<void> {
		return this.run(() => this.restartAll());
	}

	private async restartAll(): Promise<void> {
		if (this.closed) return;
		const running = this.handles.filter((handle) => handle.context);
		for (const handle of [...running].reverse()) handle.stop();
		for (const handle of this.handles) handle.translator = handle.makeTranslator();
		for (const handle of running) {
			if (this.closed) return;
			await handle.start();
		}
	}
}
