// The single settings tab of Snailkit. Home: every tool as a card, grouped by category, each
// with its switch. Clicking a card opens that tool's page: header, status banner, its settings.
import { Platform, PluginSettingTab, ToggleComponent, setIcon, setTooltip } from "obsidian";
import { LANGUAGES, LANGUAGE_NAMES, resolveLanguage, type LanguageSetting } from "../i18n";
import type { ModuleHandle } from "../core/host";
import { CATEGORY_ORDER } from "../core/module";
import type SnailkitPlugin from "../main";
import { SNAIL_ICON } from "./icons";
import { SettingsPage } from "./settings-page";

export const REPO_URL = "https://github.com/arnaudgastelblum/snailkit";

type View = { kind: "home" } | { kind: "module"; id: string; direction: "forward" | "back" | "none" };

export class SnailkitSettingTab extends PluginSettingTab {
	private view: View = { kind: "home" };
	private query = "";
	private resetArmed = 0;
	/** The module page on screen, disposed (pending edits saved) before anything replaces it. */
	private page: SettingsPage<object> | null = null;

	constructor(private readonly snail: SnailkitPlugin) {
		super(snail.app, snail);
	}

	/** Opens the tab on one tool's page (or the home when `id` is undefined). */
	show(id?: string): void {
		this.view = id ? { kind: "module", id, direction: "none" } : { kind: "home" };
		this.display();
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.snail.t(key, vars);
	}

	display(): void {
		const { containerEl } = this;
		this.disposePage();
		containerEl.empty();
		containerEl.addClass("sk-settings");
		const handle = this.view.kind === "module" ? this.snail.host.get(this.view.id) : undefined;
		if (this.view.kind === "module" && handle) this.renderModule(handle, this.view.direction);
		else this.renderHome();
	}

	private disposePage(): void {
		this.page?.dispose();
		this.page = null;
	}

	hide(): void {
		this.disposePage();
		this.view = { kind: "home" };
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
		foot.createSpan({ text: this.t("home.version", { version: this.snail.manifest.version }) });
		foot.createSpan({ cls: "sk-dot-sep", text: "·" });
		foot.createEl("a", { text: this.t("home.issue"), href: `${REPO_URL}/issues` });
	}

	private renderHero(root: HTMLElement): void {
		const hero = root.createDiv({ cls: "sk-hero" });
		setIcon(hero.createDiv({ cls: "sk-logo" }), SNAIL_ICON);
		const text = hero.createDiv({ cls: "sk-hero-text" });
		text.createDiv({ cls: "sk-hero-title", text: "Snailkit" });
		text.createDiv({ cls: "sk-hero-tagline", text: this.t("plugin.tagline") });
		const count = text.createDiv({ cls: "sk-hero-count" });
		count.createSpan({ cls: "sk-live-dot" });
		const on = this.snail.host.handles.filter((h) => h.state === "on").length;
		count.createSpan({ text: this.snail.translator.tn("home.count", on, { total: this.snail.host.handles.length }) });

		const side = hero.createDiv({ cls: "sk-hero-side" });
		const label = side.createEl("label", { cls: "sk-lang" });
		setIcon(label.createSpan({ cls: "sk-lang-icon" }), "languages");
		const select = label.createEl("select", { cls: "dropdown", attr: { "aria-label": this.t("language.label") } });
		const autoName = LANGUAGE_NAMES[resolveLanguage("auto", this.snail.obsidianLanguage())];
		const choices: [LanguageSetting, string][] = [["auto", this.t("language.auto", { name: autoName })], ...LANGUAGES.map((l) => [l, LANGUAGE_NAMES[l]] as [LanguageSetting, string])];
		for (const [value, name] of choices) select.createEl("option", { value, text: name });
		select.value = this.snail.data.language;
		select.addEventListener("change", async () => {
			await this.snail.setLanguage(select.value as LanguageSetting);
			this.display();
		});
	}

	private renderGroups(groups: HTMLElement): void {
		groups.empty();
		const query = normalize(this.query.trim());
		let shown = 0;
		for (const category of CATEGORY_ORDER) {
			const handles = this.snail.host.handles
				.filter((h) => h.def.category === category)
				.filter((h) => !query || normalize(`${h.name} ${h.description}`).includes(query))
				.sort((a, b) => a.name.localeCompare(b.name, this.snail.lang));
			if (!handles.length) continue;
			const group = groups.createDiv({ cls: "sk-group" });
			group.createDiv({ cls: "sk-group-title", text: this.t(`category.${category}`) });
			const grid = group.createDiv({ cls: "sk-grid" });
			handles.forEach((handle) => {
				this.renderCard(grid, handle, shown);
				shown++;
			});
		}
		if (!shown) groups.createDiv({ cls: "sk-empty", text: this.t("home.no-match", { query: this.query.trim() }) });
	}

	private renderCard(grid: HTMLElement, handle: ModuleHandle, index: number): void {
		const card = grid.createDiv({ cls: "sk-card", attr: { tabindex: "0", role: "button", "aria-label": this.t("card.open-settings", { name: handle.name }) } });
		card.style.setProperty("--i", String(index));
		const paint = () => {
			const state = handle.state;
			card.toggleClass("is-on", state === "on");
			card.toggleClass("is-error", state === "error");
			card.toggleClass("is-unavailable", state === "unavailable");
		};

		const top = card.createDiv({ cls: "sk-card-top" });
		setIcon(top.createDiv({ cls: "sk-tile" }), handle.def.icon);
		top.createDiv({ cls: "sk-card-name", text: handle.name });
		const switchEl = top.createDiv({ cls: "sk-card-switch" });
		this.addSwitch(switchEl, handle, () => {
			paint();
			this.refreshCount();
		});

		card.createDiv({ cls: "sk-card-desc", text: handle.description });

		const foot = card.createDiv({ cls: "sk-card-foot" });
		const badges = foot.createDiv({ cls: "sk-badges" });
		this.addBadges(badges, handle);
		const link = foot.createDiv({ cls: "sk-card-link" });
		link.createSpan({ text: this.t("card.settings") });
		setIcon(link.createSpan({ cls: "sk-chevron" }), "chevron-right");

		paint();
		const open = () => this.openModule(handle.def.id);
		card.addEventListener("click", open);
		card.addEventListener("keydown", (event) => {
			if (event.target !== card) return;
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				open();
			}
		});
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

	private refreshCount(): void {
		const count = this.containerEl.querySelector(".sk-hero-count span:last-child");
		if (!count) return;
		const on = this.snail.host.handles.filter((h) => h.state === "on").length;
		count.textContent = this.snail.translator.tn("home.count", on, { total: this.snail.host.handles.length });
	}

	private openModule(id: string): void {
		this.view = { kind: "module", id, direction: "forward" };
		this.display();
		this.containerEl.scrollTop = 0;
	}

	// ---------- Module page ----------

	private renderModule(handle: ModuleHandle, direction: "forward" | "back" | "none"): void {
		const root = this.containerEl.createDiv({ cls: `sk-page is-${direction}` });

		const back = root.createEl("button", { cls: "sk-back" });
		setIcon(back.createSpan({ cls: "sk-back-icon" }), "chevron-left");
		back.createSpan({ text: this.t("page.back") });
		back.addEventListener("click", () => {
			this.view = { kind: "home" };
			this.display();
		});

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
				this.page = page as SettingsPage<object>;
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
			reset.addEventListener("click", async () => {
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
			});
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
