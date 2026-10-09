// The single settings tab of Snailkit, a showcase of a free suite. Home: the mascot and the
// count of tools "in your shell", then every tool grouped the
// way users meet them (the Workbench, around notes, writing, export). Each card opens with a
// small scene of the tool at work (the module's `demo`, played while on screen), its pitch and a
// Get / On button. Clicking a card opens that tool's page: the scene, header, status banner, its
// settings. The Workbench, a part of the core, has a page of its own: its setting and its tools.
import { Platform, PluginSettingTab, Setting, ToggleComponent, setIcon, setTooltip } from "obsidian";
import { LANGUAGES, LANGUAGE_NAMES, resolveLanguage, type LanguageSetting } from "../i18n";
import type { ModuleHandle } from "../core/host";
import { CATEGORY_ORDER, type ModuleCategory } from "../core/module";
import { AUTO_OPEN_MODES, START_TABS } from "../core/settings";
import type { AutoOpenMode, StartTab } from "../core/workbench/types";
import type SnailkitPlugin from "../main";
import { MASCOT_URL } from "./mascot";
import { richText, SettingsPage } from "./settings-page";

export const REPO_URL = "https://github.com/arnaudgastelblum/snailkit";
const AUTHOR = "Arnaud Gastelblum";
const AUTHOR_URL = "https://lazysnail.net";

type Direction = "forward" | "back" | "none";
type View = { kind: "home" } | { kind: "workbench"; direction: Direction } | { kind: "module"; id: string; direction: Direction };

/** The Workbench's page in the settings (show("workbench"), never a module id). */
export const WORKBENCH_PAGE = "workbench";
/** Lucide icon of the Workbench (its view's icon). */
const WORKBENCH_ICON = "layout-dashboard";
/** The tools of the Workbench in the order of their tabs; Search, which has none, last. */
const WORKBENCH_TOOLS = ["home", "tasks", "sessions", "search"];

export class SnailkitSettingTab extends PluginSettingTab {
	private view: View = { kind: "home" };
	private query = "";
	private resetArmed = 0;
	/** Where a tool's page goes back to: the Workbench's page when it was opened from there. */
	private from: "home" | "workbench" = "home";
	/** Plays the scenes on screen, pauses the others (one per drawing of the tab). */
	private scenes: IntersectionObserver | null = null;
	/** What shows a tool's state on screen (its card and its button), by tool id. */
	private readonly painters = new Map<string, Set<() => void>>();
	/** Unique ids for aria-labelledby. */
	private static seq = 0;
	/** The module page on screen, disposed (pending edits saved) before anything replaces it. */
	private page: SettingsPage<object> | null = null;

	constructor(private readonly snail: SnailkitPlugin) {
		super(snail.app, snail);
	}

	/** Opens the tab on one tool's page, the Workbench's ("workbench"), or the home when `id` is undefined. */
	show(id?: string): void {
		this.from = "home";
		if (id === WORKBENCH_PAGE) this.view = { kind: "workbench", direction: "none" };
		else this.view = id ? { kind: "module", id, direction: "none" } : { kind: "home" };
		this.display();
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.snail.t(key, vars);
	}

	display(): void {
		const { containerEl } = this;
		this.disposePage();
		this.stopScenes();
		this.painters.clear();
		containerEl.empty();
		containerEl.addClass("sk-settings");
		const handle = this.view.kind === "module" ? this.snail.host.get(this.view.id) : undefined;
		if (this.view.kind === "module" && handle) this.renderModule(handle, this.view.direction);
		else if (this.view.kind === "workbench") this.renderWorkbench(this.view.direction);
		else this.renderHome();
	}

	private disposePage(): void {
		this.page?.dispose();
		this.page = null;
	}

	private stopScenes(): void {
		this.scenes?.disconnect();
		this.scenes = null;
	}

	/**
	 * Draws a tool's scene in `container` (docs/showcase.md). It plays while at least half of it
	 * is on screen. Without a scene, the tool's icon stands in its place.
	 */
	private renderScene(container: HTMLElement, handle: ModuleHandle): HTMLElement {
		const el = container.createDiv({ cls: "sk-demo" });
		if (!handle.def.demo) {
			el.addClass("is-empty");
			setIcon(el.createDiv({ cls: "sk-demo-icon" }), handle.def.icon);
			return el;
		}
		try {
			handle.def.demo(el, (key) => handle.translator.t(key));
		} catch (error) {
			console.error(`[Snailkit] ${handle.def.id}: scene failed`, error);
			el.empty();
			el.addClass("is-empty");
			setIcon(el.createDiv({ cls: "sk-demo-icon" }), handle.def.icon);
			return el;
		}
		if (typeof IntersectionObserver === "undefined") {
			el.addClass("is-playing");
			return el;
		}
		this.scenes ??= new IntersectionObserver(
			(entries) => {
				for (const entry of entries) entry.target.toggleClass("is-playing", entry.isIntersecting);
			},
			{ threshold: 0.5 },
		);
		this.scenes.observe(el);
		return el;
	}

	hide(): void {
		this.disposePage();
		this.stopScenes();
		this.painters.clear();
		this.view = { kind: "home" };
		this.from = "home";
		this.query = "";
	}

	// ---------- Home ----------

	private renderHome(): void {
		const root = this.containerEl.createDiv({ cls: "sk-home" });
		this.renderHero(root);

		const handles = this.snail.host.handles;
		if (handles.length >= 6) {
			const search = root.createDiv({ cls: "sk-search" });
			setIcon(search.createSpan({ cls: "sk-search-icon" }), "search");
			const input = search.createEl("input", { type: "search", placeholder: this.t("home.search"), value: this.query });
			input.addEventListener("input", () => {
				this.query = input.value;
				this.renderGroups(groups);
			});
		}

		const groups = root.createDiv({ cls: "sk-groups" });
		this.renderGroups(groups);

		const foot = root.createDiv({ cls: "sk-footer" });
		const credit = foot.createDiv({ cls: "sk-credit" });
		credit.createSpan({ text: this.t("home.credit", { name: AUTHOR }) });
		credit.createSpan({ cls: "sk-dot-sep", text: "·" });
		credit.createEl("a", { text: AUTHOR_URL.replace(/^https:\/\//, ""), href: AUTHOR_URL });
		const meta = foot.createDiv({ cls: "sk-footer-meta" });
		meta.createSpan({ text: this.t("home.version", { version: this.snail.manifest.version }) });
		meta.createSpan({ cls: "sk-dot-sep", text: "·" });
		meta.createEl("a", { text: this.t("home.issue"), href: `${REPO_URL}/issues` });
	}

	/**
	 * Names a card by its visible name (aria-labelledby): an aria-label would show as Obsidian's
	 * tooltip over the whole card.
	 */
	private labelBy(card: HTMLElement, name: HTMLElement): void {
		name.id = `sk-card-name-${++SnailkitSettingTab.seq}`;
		card.setAttr("aria-labelledby", name.id);
	}

	/** The card's short line: the module's pitch, else its description. */
	private pitchOf(handle: ModuleHandle): string {
		const pitch = handle.translator.t("module.pitch");
		return pitch && pitch !== "module.pitch" ? pitch : handle.description;
	}

	/** Click or Enter / Space on `el` opens the tool's page. */
	private onOpen(el: HTMLElement, handle: ModuleHandle): void {
		const open = () => this.openModule(handle.def.id);
		el.addEventListener("click", open);
		el.addEventListener("keydown", (event) => {
			if (event.target !== el) return;
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				open();
			}
		});
	}

	/** Keeps `paint` in step with the tool's state, wherever it is drawn. */
	private painted(handle: ModuleHandle, paint: () => void): void {
		let set = this.painters.get(handle.def.id);
		if (!set) this.painters.set(handle.def.id, (set = new Set()));
		set.add(paint);
		paint();
	}

	/** The tool changed (on, off, error): every control of it is drawn again, and the count. */
	private repaint(handle: ModuleHandle): void {
		for (const paint of this.painters.get(handle.def.id) ?? []) paint();
		this.refreshCount();
	}

	/**
	 * The store button of a tool: "Get" while off, "On" with a check while on ("Turn off" when
	 * hovered or focused), "Could not start" while on but in error (a click turns it off), disabled
	 * when the tool cannot run here or while a change is under way. `after` runs once it changed.
	 */
	private addGetButton(container: HTMLElement, handle: ModuleHandle, after?: () => void): void {
		const button = container.createEl("button", { cls: "sk-get", attr: { type: "button", "aria-label": this.t("card.toggle", { name: handle.name }) } });
		let busy = false;
		const paint = () => {
			const error = handle.enabled && handle.state === "error";
			const on = handle.enabled && handle.state === "on";
			const unavailable = handle.state === "unavailable" && !handle.enabled;
			button.empty();
			button.toggleClass("is-on", on);
			button.toggleClass("is-error", error);
			button.disabled = unavailable || busy;
			button.setAttr("aria-pressed", String(handle.enabled));
			if (on || error) {
				setIcon(button.createSpan({ cls: "sk-get-icon" }), error ? "alert-triangle" : "check");
				button.createSpan({ cls: "sk-get-label is-rest", text: this.t(error ? "card.error" : "card.on") });
				button.createSpan({ cls: "sk-get-label is-hover", text: this.t("card.turn-off") });
			} else {
				button.createSpan({ cls: "sk-get-label", text: this.t(unavailable ? "card.unavailable" : "card.get") });
			}
		};
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			if (busy) return;
			const wanted = !handle.enabled;
			busy = true;
			paint();
			void this.snail.host
				.setEnabled(handle.def.id, wanted)
				.catch((error) => {
					console.error(`[Snailkit] ${handle.def.id}: could not turn on or off`, error);
					this.snail.toast(this.t("card.save-failed"));
				})
				.finally(() => {
					busy = false;
					if (wanted && handle.state === "on") button.addClass("is-fresh");
					this.repaint(handle);
					after?.();
				});
		});
		button.addEventListener("keydown", (event) => event.stopPropagation());
		this.painted(handle, paint);
	}

	private renderHero(root: HTMLElement): void {
		const hero = root.createDiv({ cls: "sk-hero" });
		hero.createEl("img", { cls: "sk-mascot", attr: { src: MASCOT_URL, alt: "", draggable: "false" } });
		const text = hero.createDiv({ cls: "sk-hero-text" });
		// No title with the plugin's name (Obsidian's guidelines: the tab already says it): the slogan leads.
		text.createDiv({ cls: "sk-hero-title", text: this.t("plugin.tagline") });
		const meta = text.createDiv({ cls: "sk-hero-meta" });
		const count = meta.createDiv({ cls: "sk-hero-count" });
		count.createSpan({ cls: "sk-live-dot" });
		const on = this.snail.host.handles.filter((h) => h.state === "on").length;
		count.createSpan({ text: this.snail.translator.tn("home.count", on, { total: this.snail.host.handles.length }) });
		const allOn = meta.createEl("button", { cls: "sk-btn is-s sk-all-on", attr: { type: "button" } });
		setIcon(allOn.createSpan({ cls: "sk-all-on-icon" }), "power");
		allOn.createSpan({ text: this.t("home.all-on") });
		allOn.addEventListener("click", () => void this.turnAllOn(allOn));
		this.refreshAllOn();

		const side = hero.createDiv({ cls: "sk-hero-side" });
		const label = side.createEl("label", { cls: "sk-lang" });
		setIcon(label.createSpan({ cls: "sk-lang-icon" }), "languages");
		const select = label.createEl("select", { cls: "dropdown", attr: { "aria-label": this.t("language.label") } });
		const autoName = LANGUAGE_NAMES[resolveLanguage("auto", this.snail.obsidianLanguage())];
		const choices: [LanguageSetting, string][] = [["auto", this.t("language.auto", { name: autoName })], ...LANGUAGES.map((l) => [l, LANGUAGE_NAMES[l]] as [LanguageSetting, string])];
		for (const [value, name] of choices) select.createEl("option", { value, text: name });
		select.value = this.snail.data.language;
		select.addEventListener("change", () => { void (async () => {
			await this.snail.setLanguage(select.value as LanguageSetting);
			this.display();
		})(); });
	}

	private renderGroups(groups: HTMLElement): void {
		groups.empty();
		this.scenes?.disconnect();
		this.painters.clear();
		const query = normalize(this.query.trim());
		let shown = 0;
		for (const category of CATEGORY_ORDER) {
			// The group's name finds all its tools ("workbench" shows Home, Tasks...).
			const groupMatches = !!query && normalize(this.t(`category.${category}`)).includes(query);
			const handles = this.toolsOf(category).filter((h) => !query || groupMatches || normalize(`${h.name} ${this.pitchOf(h)} ${h.description}`).includes(query));
			if (!handles.length) continue;
			const group = groups.createDiv({ cls: `sk-group is-${category}` });
			const head = group.createDiv({ cls: "sk-group-head" });
			const text = head.createDiv({ cls: "sk-group-text" });
			text.createDiv({ cls: "sk-group-title", text: this.t(`category.${category}`) });
			text.createDiv({ cls: "sk-group-desc", text: this.t(`category.${category}.desc`) });
			if (category === "workbench") {
				const link = head.createEl("button", { cls: "sk-group-link", attr: { type: "button" } });
				setIcon(link.createSpan({ cls: "sk-group-link-icon" }), "settings-2");
				link.createSpan({ text: this.t("group.workbench-settings") });
				setIcon(link.createSpan({ cls: "sk-chevron" }), "chevron-right");
				link.addEventListener("click", () => this.openWorkbench());
			}
			const grid = group.createDiv({ cls: "sk-grid" });
			handles.forEach((handle) => {
				this.renderCard(grid, handle, shown);
				shown++;
			});
		}
		if (!shown) groups.createDiv({ cls: "sk-empty", text: this.t("home.no-match", { query: this.query.trim() }) });
	}

	/** The tools of a group: the Workbench's in the order of its tabs, the others by name. */
	private toolsOf(category: ModuleCategory): ModuleHandle[] {
		const rank = (h: ModuleHandle) => {
			const i = WORKBENCH_TOOLS.indexOf(h.def.id);
			return i < 0 ? WORKBENCH_TOOLS.length : i;
		};
		return this.snail.host.handles
			.filter((h) => h.def.category === category)
			.sort((a, b) => (category === "workbench" ? rank(a) - rank(b) : 0) || a.name.localeCompare(b.name, this.snail.lang));
	}

	/** A tool's card: its scene, name, pitch and store button. `after` runs once it was turned on or off. */
	private renderCard(grid: HTMLElement, handle: ModuleHandle, index: number, after?: () => void): void {
		const card = grid.createDiv({ cls: "sk-card", attr: { tabindex: "0", role: "button" } });
		card.setCssProps({ "--i": String(index) });
		const paint = () => {
			const state = handle.state;
			card.toggleClass("is-on", state === "on");
			card.toggleClass("is-error", state === "error");
			card.toggleClass("is-unavailable", state === "unavailable");
		};

		this.renderScene(card.createDiv({ cls: "sk-card-media" }), handle);
		const top = card.createDiv({ cls: "sk-card-top" });
		setIcon(top.createDiv({ cls: "sk-tile" }), handle.def.icon);
		this.labelBy(card, top.createDiv({ cls: "sk-card-name", text: handle.name }));
		this.addGetButton(top, handle, after);

		card.createDiv({ cls: "sk-card-desc", text: this.pitchOf(handle) });

		const foot = card.createDiv({ cls: "sk-card-foot" });
		const badges = foot.createDiv({ cls: "sk-badges" });
		const link = foot.createDiv({ cls: "sk-card-link" });
		link.createSpan({ text: this.t("card.settings") });
		setIcon(link.createSpan({ cls: "sk-chevron" }), "chevron-right");

		this.painted(handle, () => {
			paint();
			badges.empty();
			this.addBadges(badges, handle);
		});
		this.onOpen(card, handle);
	}

	private addBadges(container: HTMLElement, handle: ModuleHandle): void {
		const state = handle.state;
		if (state === "error") container.createSpan({ cls: "sk-badge is-error", text: this.t("card.error") });
		const desktopOnly = handle.def.desktopOnly === true;
		if (desktopOnly) container.createSpan({ cls: "sk-badge", text: this.t("card.desktop-only") });
		// The reason itself is the badge ("Excalidraw is not installed"), so nobody has to hover to understand.
		if (state === "unavailable" && !(desktopOnly && !Platform.isDesktopApp)) {
			const reason = (handle.unavailableReason() ?? this.t("card.unavailable")).replace(/\.$/, "");
			const badge = container.createSpan({ cls: "sk-badge is-muted", text: reason.charAt(0).toUpperCase() + reason.slice(1) });
			setTooltip(badge, reason);
		}
	}

	/** Obsidian's own switch, wired to the module. `after` runs once the module is on or off. */
	private addSwitch(container: HTMLElement, handle: ModuleHandle, after: () => void): void {
		container.addEventListener("click", (event) => event.stopPropagation());
		container.addEventListener("keydown", (event) => event.stopPropagation());
		const toggle = new ToggleComponent(container);
		toggle.setValue(handle.enabled && handle.state !== "unavailable");
		toggle.setDisabled(handle.state === "unavailable" && !handle.enabled);
		toggle.toggleEl.setAttr("aria-label", this.t("card.toggle", { name: handle.name }));
		toggle.toggleEl.setAttr("tabindex", "0");
		toggle.onChange(async (value) => {
			await this.snail.host.setEnabled(handle.def.id, value);
			after();
		});
	}

	/** The tools that "Turn all on" would turn on: off, and able to run here. */
	private offTools(): ModuleHandle[] {
		return this.snail.host.handles.filter((h) => !h.enabled && h.unavailableReason() === null);
	}

	/** "Turn all on" shows only while a tool that can run here is off. */
	private refreshAllOn(): void {
		const button = this.containerEl.querySelector(".sk-all-on");
		button?.toggleClass("is-hidden", this.offTools().length === 0);
	}

	/**
	 * Turns on every tool that can run here, one after the other. Tools never set up start with
	 * their default settings; settings already chosen are kept. Undo turns the same ones off.
	 */
	private async turnAllOn(button: HTMLButtonElement): Promise<void> {
		const tools = this.offTools();
		if (!tools.length) return;
		button.disabled = true;
		for (const handle of tools) await this.snail.host.setEnabled(handle.def.id, true);
		if (this.view.kind === "home") this.display();
		this.snail.toast(this.snail.translator.tn("home.all-on-done", tools.length), {
			action: {
				label: this.t("common.undo"),
				run: () => {
					void (async () => {
						for (const handle of [...tools].reverse()) await this.snail.host.setEnabled(handle.def.id, false);
						if (this.view.kind === "home" && this.containerEl.isConnected) this.display();
					})();
				},
			},
		});
	}

	private refreshCount(): void {
		this.refreshAllOn();
		const count = this.containerEl.querySelector(".sk-hero-count span:last-child");
		if (!count) return;
		const on = this.snail.host.handles.filter((h) => h.state === "on").length;
		count.textContent = this.snail.translator.tn("home.count", on, { total: this.snail.host.handles.length });
	}

	private openModule(id: string): void {
		this.from = this.view.kind === "workbench" ? "workbench" : "home";
		this.view = { kind: "module", id, direction: "forward" };
		this.display();
		this.containerEl.scrollTop = 0;
	}

	private openWorkbench(): void {
		this.view = { kind: "workbench", direction: "forward" };
		this.display();
		this.containerEl.scrollTop = 0;
	}

	/** The back button of a page: to the Workbench's page or to all the tools. */
	private addBack(root: HTMLElement, toWorkbench: boolean): void {
		const back = root.createEl("button", { cls: "sk-back" });
		setIcon(back.createSpan({ cls: "sk-back-icon" }), "chevron-left");
		back.createSpan({ text: this.t(toWorkbench ? "category.workbench" : "page.back") });
		back.addEventListener("click", () => {
			this.from = "home";
			this.view = toWorkbench ? { kind: "workbench", direction: "back" } : { kind: "home" };
			this.display();
		});
	}

	// ---------- The Workbench's page ----------

	private renderWorkbench(direction: Direction): void {
		const root = this.containerEl.createDiv({ cls: `sk-page is-${direction}` });
		this.addBack(root, false);

		const tools = this.toolsOf("workbench");
		const head = root.createDiv({ cls: "sk-page-head" });
		setIcon(head.createDiv({ cls: "sk-tile is-large" }), WORKBENCH_ICON);
		const text = head.createDiv({ cls: "sk-page-text" });
		text.createDiv({ cls: "sk-page-title", text: this.t("category.workbench") });
		text.createDiv({ cls: "sk-page-desc", text: this.t("workbench.page.desc") });
		const meta = text.createDiv({ cls: "sk-page-meta" });
		const docs = meta.createEl("a", { cls: "sk-doc-link", href: `${REPO_URL}/blob/main/docs/workbench.md` });
		setIcon(docs.createSpan({ cls: "sk-doc-icon" }), "book-open");
		docs.createSpan({ text: this.t("page.docs") });

		const banner = root.createDiv({ cls: "sk-banner" });
		// A tab, not a tool on: Search alone adds none, and the Workbench never opens empty.
		const paint = () => {
			const anyOn = this.snail.workbench.ids().length > 0;
			head.toggleClass("is-on", anyOn);
			banner.empty();
			banner.toggleClass("is-hidden", anyOn);
			if (anyOn) return;
			setIcon(banner.createSpan({ cls: "sk-banner-icon" }), "info");
			banner.createSpan({ text: this.t("workbench.page.none") });
		};
		paint();

		const body = root.createDiv({ cls: "sk-page-body" });
		const opening = this.section(body, this.t("workbench.opening"));
		const choices: Record<string, string> = {};
		for (const mode of AUTO_OPEN_MODES) choices[mode] = this.t(`workbench.mode.${mode}`);
		new Setting(opening)
			.setName(this.t("workbench.open"))
			.setDesc(richText(this.t("workbench.open-desc")))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(choices)
					.setValue(this.snail.data.workbench.autoOpen)
					.onChange((value) => void this.snail.setWorkbenchAutoOpen(value as AutoOpenMode)),
			);
		const tabs: Record<string, string> = {};
		for (const tab of START_TABS) tabs[tab] = this.t(`workbench.start-tab.${tab}`);
		for (const key of ["startTab", "startTabPhone"] as const) {
			new Setting(opening)
				.setName(this.t(`workbench.${key}`))
				.setDesc(this.t(`workbench.${key}-desc`))
				.addDropdown((dropdown) =>
					dropdown
						.addOptions(tabs)
						.setValue(this.snail.data.workbench[key])
						.onChange((value) => void this.snail.setWorkbenchStartTab(key, value as StartTab)),
				);
		}
		opening.createDiv({ cls: "sk-note" }).append(richText(this.t("workbench.open-warn")));

		// The cards stand on their own, as on the home, not inside a box of rows.
		const section = this.section(body, this.t("workbench.page.tools"), this.t("workbench.page.tools-desc"), false);
		const grid = section.createDiv({ cls: "sk-grid" });
		tools.forEach((handle, i) => this.renderCard(grid, handle, i, paint));
	}

	/** A titled section, as on a tool's page; returns its body (the section itself when `boxed` is false). */
	private section(container: HTMLElement, title: string, description?: string, boxed = true): HTMLElement {
		const el = container.createDiv({ cls: "sk-section" });
		const head = el.createDiv({ cls: "sk-section-head" });
		head.createDiv({ cls: "sk-section-title", text: title });
		if (description) head.createDiv({ cls: "sk-section-desc" }).append(richText(description));
		return boxed ? el.createDiv({ cls: "sk-section-body" }) : el;
	}

	// ---------- Module page ----------

	private renderModule(handle: ModuleHandle, direction: Direction): void {
		const root = this.containerEl.createDiv({ cls: `sk-page is-${direction}` });
		this.addBack(root, this.from === "workbench" && handle.def.category === "workbench");

		const head = root.createDiv({ cls: "sk-page-head" });
		setIcon(head.createDiv({ cls: "sk-tile is-large" }), handle.def.icon);
		const text = head.createDiv({ cls: "sk-page-text" });
		text.createDiv({ cls: "sk-page-title", text: handle.name });
		text.createDiv({ cls: "sk-page-desc", text: handle.description });
		const meta = text.createDiv({ cls: "sk-page-meta" });
		this.addBadges(meta, handle);
		const docs = meta.createEl("a", { cls: "sk-doc-link", href: `${REPO_URL}/blob/main/docs/${handle.def.id}.md` });
		setIcon(docs.createSpan({ cls: "sk-doc-icon" }), "book-open");
		docs.createSpan({ text: this.t("page.docs") });

		const switchEl = head.createDiv({ cls: "sk-page-switch" });
		const banner = root.createDiv({ cls: "sk-banner" });
		const paint = () => {
			head.toggleClass("is-on", handle.state === "on");
			this.renderBanner(banner, handle);
		};
		this.addSwitch(switchEl, handle, paint);
		paint();

		if (handle.def.demo) this.renderScene(root.createDiv({ cls: "sk-page-media" }), handle);

		const body = root.createDiv({ cls: "sk-page-body" });
		const renderBody = () => {
			this.disposePage();
			body.empty();
			if (!handle.def.settings) {
				body.createDiv({ cls: "sk-empty", text: this.t("page.no-settings") });
				return;
			}
			try {
				const page = new SettingsPage(this.app, body, handle, renderBody);
				this.page = page;
				handle.def.settings(page);
			} catch (error) {
				console.error(`[Snailkit] ${handle.def.id}: settings page failed`, error);
				body.createDiv({ cls: "sk-empty", text: String(error) });
			}
		};
		renderBody();

		if (handle.def.settings) {
			const foot = root.createDiv({ cls: "sk-page-foot" });
			const reset = foot.createEl("button", { cls: "sk-reset", text: this.t("page.reset") });
			reset.addEventListener("click", () => { void (async () => {
				if (Date.now() - this.resetArmed > 3000) {
					this.resetArmed = Date.now();
					reset.setText(this.t("page.reset-confirm"));
					reset.addClass("is-armed");
					window.setTimeout(() => {
						if (!reset.isConnected || Date.now() - this.resetArmed < 3000) return;
						reset.setText(this.t("page.reset"));
						reset.removeClass("is-armed");
					}, 3100);
					return;
				}
				this.resetArmed = 0;
				await handle.resetSettings();
				reset.setText(this.t("page.reset"));
				reset.removeClass("is-armed");
				renderBody();
				this.snail.toast(this.t("page.reset-done", { name: handle.name }));
			})(); });
		}
	}

	private renderBanner(banner: HTMLElement, handle: ModuleHandle): void {
		banner.empty();
		const state = handle.state;
		banner.className = "sk-banner";
		let message: string | null = null;
		let icon = "info";
		if (state === "error") {
			message = this.t("page.error", { message: handle.error ?? "" });
			icon = "alert-triangle";
			banner.addClass("is-error");
		} else if (state === "unavailable") {
			message = this.t("page.unavailable", { reason: handle.unavailableReason() ?? "" });
			icon = "ban";
		} else if (state === "off") {
			message = this.t("page.off");
			icon = "moon";
		}
		banner.toggleClass("is-hidden", !message);
		if (!message) return;
		setIcon(banner.createSpan({ cls: "sk-banner-icon" }), icon);
		banner.createSpan({ text: message });
	}
}

/** Lowercase without accents, for the search field. */
function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase();
}
