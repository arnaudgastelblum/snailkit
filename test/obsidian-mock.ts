// Minimal stand-in for the `obsidian` package in tests. Only what pure code touches at import
// time or in tests; extend it when a test needs more.
import moment from "moment";

export { moment };

export class Component {
	private callbacks: Array<() => void> = [];
	load(): void {}
	unload(): void {
		this.callbacks.splice(0).forEach((cb) => cb());
	}
	register(cb: () => void): void {
		this.callbacks.push(cb);
	}
	registerEvent(): void {}
	registerDomEvent(): void {}
	registerInterval(id: number): number {
		return id;
	}
}

export class Plugin extends Component {}
export class PluginSettingTab {}
export class Modal {}
export class SuggestModal<T> {
	declare _t: T;
}
export class FuzzySuggestModal<T> {
	declare _t: T;
}
export class Setting {}
export function requireApiVersion(_version: string): boolean {
	return true;
}
export class ToggleComponent {}
export class TFile {}
export class TFolder {}
export class MarkdownView {}
export class Notice {
	constructor(public message?: string) {}
}
export class MarkdownPreviewRenderer {
	static registerPostProcessor(): void {}
	static unregisterPostProcessor(): void {}
}
export const Platform = { isDesktopApp: true, isMobile: false, isPhone: false };

export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/|\/$/g, "");
}
export function getLanguage(): string {
	return "en";
}
export function setIcon(): void {}
export function setTooltip(): void {}
export function addIcon(): void {}

// Broader stubs so module tests can import UI files. Behavior is never simulated here: test pure
// functions, and give fakes to the code under test when it needs an app, a vault or an editor.
export class Events {
	on(): { e: unknown } {
		return { e: this };
	}
	off(): void {}
	offref(): void {}
	trigger(): void {}
}
export class View extends Component {}
export class ItemView extends View {}
export class MarkdownRenderChild extends Component {
	constructor(public containerEl?: unknown) {
		super();
	}
}
export class WorkspaceLeaf {}
export class Menu {
	addItem(): this {
		return this;
	}
	addSeparator(): this {
		return this;
	}
	showAtMouseEvent(): this {
		return this;
	}
	showAtPosition(): this {
		return this;
	}
}
export class MenuItem {}
export class Scope {
	register(): void {}
	unregister(): void {}
}
export class Keymap {
	static isModEvent(): boolean {
		return false;
	}
}
export class TAbstractFile {}
export class ButtonComponent {}
export class TextComponent {}
export class DropdownComponent {}
export class SliderComponent {}
export class ExtraButtonComponent {}
export class ColorComponent {}
export class AbstractInputSuggest<T> {
	declare _t: T;
}
export class MarkdownRenderer {
	static render(): Promise<void> {
		return Promise.resolve();
	}
}
export class Editor {}
export class FileView extends ItemView {}
export class EditableFileView extends FileView {}
export class TextFileView extends EditableFileView {}
export const editorInfoField = {};
export const editorLivePreviewField = {};
export const apiVersion = "1.13.1";
export function debounce<T extends (...args: never[]) => unknown>(fn: T): T & { cancel(): void } {
	const wrapped = ((...args: Parameters<T>) => fn(...args)) as T & { cancel(): void };
	wrapped.cancel = () => undefined;
	return wrapped;
}
export function prepareFuzzySearch(query: string) {
	return (text: string) => (text.toLowerCase().includes(query.toLowerCase()) ? { score: 0, matches: [] } : null);
}
export function prepareSimpleSearch(query: string) {
	return prepareFuzzySearch(query);
}
export function parseYaml(): unknown {
	return {};
}
export function stringifyYaml(value: unknown): string {
	return JSON.stringify(value);
}
export function getAllTags(): string[] {
	return [];
}
export function getIconIds(): string[] {
	return [];
}
export function requestUrl(): Promise<never> {
	return Promise.reject(new Error("network is not available in tests"));
}

/** Editor suggestions: enough to construct one (tests use its pure helpers). */
export class EditorSuggest<T> {
	declare _t: T;
	limit = 100;
	context: unknown = null;
	scope = new Scope();
	constructor(public app: unknown) {}
	setInstructions(): void {}
	close(): void {}
}
