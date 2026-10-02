// Building blocks for a module's settings page. Every module page looks the same: titled
// sections of rows, each row bound to one setting, saved at once, with a small reset arrow
// that appears when the value differs from its default.
import { Setting, type App } from "obsidian";
import type { Vars } from "../i18n";
import type { ModuleHandle } from "../core/host";

type KeysOfType<S, V> = { [K in keyof S]-?: S[K] extends V ? K : never }[keyof S] & string;

/** Turns `code` spans of a translated string into <code> elements. */
export function richText(text: string): DocumentFragment {
	const fragment = createFragment();
	text.split(/(`[^`]+`)/).forEach((part) => {
		if (part.startsWith("`") && part.endsWith("`") && part.length > 1) fragment.createEl("code", { text: part.slice(1, -1) });
		else if (part) fragment.appendText(part);
	});
	return fragment;
}

interface RowOptions {
	/** Text under the name. Backticks become code. */
	desc?: string;
}

export class SettingsPage<S extends object> {
	private readonly disposers: Array<() => void> = [];

	constructor(
		readonly app: App,
		readonly containerEl: HTMLElement,
		private readonly handle: ModuleHandle<S>,
		private readonly rerender: () => void,
	) {}

	get settings(): S {
		return this.handle.settings;
	}

	t(key: string, vars?: Vars): string {
		return this.handle.translator.t(key, vars);
	}

	tn(key: string, count: number, vars?: Vars): string {
		return this.handle.translator.tn(key, count, vars);
	}

	async save(): Promise<void> {
		await this.handle.save();
	}

	/** Draws the page again, for settings that show or hide others. */
	refresh(): void {
		this.dispose();
		this.rerender();
	}

	/** @internal Runs when the page goes away: pending text edits are saved (normalized) once. */
	onDispose(callback: () => void): void {
		this.disposers.push(callback);
	}

	/** @internal */
	dispose(): void {
		for (const callback of this.disposers.splice(0)) {
			try {
				callback();
			} catch (error) {
				console.error("[Snailkit] settings page cleanup failed", error);
			}
		}
	}

	section(title: string, description?: string): SettingsSection<S> {
		const el = this.containerEl.createDiv({ cls: "sk-section" });
		const head = el.createDiv({ cls: "sk-section-head" });
		head.createDiv({ cls: "sk-section-title", text: title });
		if (description) head.createDiv({ cls: "sk-section-desc" }).append(richText(description));
		return new SettingsSection(this, el.createDiv({ cls: "sk-section-body" }), this.handle.def.defaults);
	}
}

export class SettingsSection<S extends object> {
	constructor(
		private readonly page: SettingsPage<S>,
		readonly el: HTMLElement,
		private readonly defaults: S,
	) {}

	private get values(): Record<string, unknown> {
		return this.page.settings as Record<string, unknown>;
	}

	private row(name: string, options: RowOptions): Setting {
		const setting = new Setting(this.el).setName(name);
		if (options.desc) setting.setDesc(richText(options.desc));
		return setting;
	}

	/**
	 * Wires one control to one setting. Every change, typed or from the reset arrow, goes through
	 * `commit`: value stored, saved once, arrow updated, `onChange` called once. Programmatic
	 * updates of the control (`show`) never count as a change, whatever the control does.
	 */
	private bind<V>(
		setting: Setting,
		key: string,
		defaultLabel: string,
		onChange: ((value: V) => void) | undefined,
		build: (commit: (value: V) => Promise<void>, isQuiet: () => boolean) => (value: V) => void,
	): void {
		const defaults = this.defaults as Record<string, unknown>;
		let quiet = false;
		let arrow: HTMLElement | null = null;
		const refreshArrow = () => arrow?.toggleClass("is-visible", this.values[key] !== defaults[key]);
		const commit = async (value: V) => {
			if (this.values[key] === value) return;
			this.values[key] = value;
			refreshArrow();
			await this.page.save();
			onChange?.(value);
		};
		const show = build(commit, () => quiet);
		setting.addExtraButton((extra) => {
			extra.setIcon("rotate-ccw").onClick(() => {
				const value = structuredClone(defaults[key]) as V;
				quiet = true;
				try {
					show(value);
				} finally {
					quiet = false;
				}
				void commit(value);
			});
			arrow = extra.extraSettingsEl;
			arrow.addClass("sk-reset-one");
			arrow.setAttr("aria-label", this.page.t("common.default", { value: defaultLabel }));
		});
		refreshArrow();
	}

	toggle(key: KeysOfType<S, boolean>, name: string, options: RowOptions & { onChange?: (value: boolean) => void } = {}): Setting {
		const setting = this.row(name, options);
		const def = (this.defaults as Record<string, unknown>)[key] as boolean;
		this.bind<boolean>(setting, key, this.page.t(def ? "common.on" : "common.off"), options.onChange, (commit, isQuiet) => {
			let show: (value: boolean) => void = () => undefined;
			setting.addToggle((toggle) => {
				toggle.setValue(this.values[key] as boolean).onChange((value) => {
					if (!isQuiet()) void commit(value);
				});
				show = (value) => toggle.setValue(value);
			});
			return show;
		});
		return setting;
	}

	text(
		key: KeysOfType<S, string>,
		name: string,
		options: RowOptions & { placeholder?: string; normalize?: (value: string) => string; onChange?: (value: string) => void } = {},
	): Setting {
		const setting = this.row(name, options);
		const def = (this.defaults as Record<string, unknown>)[key] as string;
		this.bind<string>(setting, key, def === "" ? "-" : def, options.onChange, (commit, isQuiet) => {
			let show: (value: string) => void = () => undefined;
			setting.addText((text) => {
				text.setValue(this.values[key] as string);
				if (options.placeholder) text.setPlaceholder(options.placeholder);
				let timer = 0;
				let pending = false;
				// While typing: saved after a short pause, as typed. On leaving the field (or the page): normalized.
				const finish = () => {
					window.clearTimeout(timer);
					if (!pending && !options.normalize) return;
					pending = false;
					const raw = text.getValue();
					const value = options.normalize ? options.normalize(raw) : raw;
					if (value !== raw) text.setValue(value);
					void commit(value);
				};
				text.onChange((raw) => {
					if (isQuiet()) return;
					pending = true;
					window.clearTimeout(timer);
					timer = window.setTimeout(() => {
						pending = false;
						void commit(raw);
					}, 400);
				});
				text.inputEl.addEventListener("blur", finish);
				this.page.onDispose(() => {
					if (pending) finish();
					window.clearTimeout(timer);
				});
				show = (value) => {
					window.clearTimeout(timer);
					pending = false;
					text.setValue(value);
				};
			});
			return show;
		});
		return setting;
	}

	dropdown(
		key: KeysOfType<S, string>,
		name: string,
		choices: Record<string, string>,
		options: RowOptions & { onChange?: (value: string) => void } = {},
	): Setting {
		const setting = this.row(name, options);
		const def = (this.defaults as Record<string, unknown>)[key] as string;
		this.bind<string>(setting, key, choices[def] ?? def, options.onChange, (commit, isQuiet) => {
			let show: (value: string) => void = () => undefined;
			setting.addDropdown((dropdown) => {
				dropdown.addOptions(choices).setValue(this.values[key] as string).onChange((value) => {
					if (!isQuiet()) void commit(value);
				});
				show = (value) => dropdown.setValue(value);
			});
			return show;
		});
		return setting;
	}

	number(
		key: KeysOfType<S, number>,
		name: string,
		options: RowOptions & { min: number; max: number; step?: number; unit?: string; onChange?: (value: number) => void },
	): Setting {
		const setting = this.row(name, options);
		const def = (this.defaults as Record<string, unknown>)[key] as number;
		this.bind<number>(setting, key, `${def}${options.unit ?? ""}`, options.onChange, (commit, isQuiet) => {
			let show: (value: number) => void = () => undefined;
			setting.addSlider((slider) => {
				slider
					.setLimits(options.min, options.max, options.step ?? 1)
					.setValue(this.values[key] as number)
					.setDynamicTooltip()
					.onChange((value) => {
						if (!isQuiet()) void commit(value);
					});
				show = (value) => slider.setValue(value);
			});
			return show;
		});
		return setting;
	}

	/** A row with no bound value, for buttons and custom controls. */
	add(name: string, options: RowOptions = {}): Setting {
		return this.row(name, options);
	}

	/** A short paragraph inside the section. */
	note(text: string): HTMLElement {
		const el = this.el.createDiv({ cls: "sk-note" });
		el.append(richText(text));
		return el;
	}
}
