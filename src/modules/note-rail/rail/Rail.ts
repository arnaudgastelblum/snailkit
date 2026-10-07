// One rail per Markdown view, mounted in the view's content element (below the view header, so it
// stays put while the note scrolls and survives switches between Live Preview, Source and Reading).
// The rail owns the panel card; panels only fill the body and the footer.
import { Keymap, MarkdownView, Menu, moment, Notice, Platform, setIcon, type TFile } from "obsidian";
import type { HomeService, SearchService } from "../../../core/services";
import { hueOf, placeFinder } from "../parents";
import { getDailyConfig, getOrCreateDailyNote } from "../panels/calendar/daily";
import { PANELS } from "../panels/registry";
import { sessionPanel, sessionsOf } from "../panels/session/SessionPanel";
import { clamp, railOrder, SHOW_KEY } from "../settings";
import type { HideReason, PanelContext, PanelDefinition, PanelInstance, RailEnv, RailPanelId } from "../types";
import { CLOSE_GRACE_MS, CORRIDOR_WAIT_MS, headingToPanel, OPEN_INTENT_MS, type Point } from "./hover";
import { commandHotkeys, hotkeyText, LONG_PRESS_MS, LONG_PRESS_SLOP, pillAction, type HotkeyLike } from "./entry";
import { asElement, asNode, dur, popIn } from "./motion";
import { PanelShell } from "./PanelShell";
import { RoomController } from "./room";

/** Without "Open on hover": hover intent before a rail button replaces the open panel. */
const HOVER_SWITCH_MS = 160;
/** Hover delay before a rail tooltip shows. */
const TOOLTIP_MS = 420;
/** Short beat between a committed click and the close, so the click registers visually. */
const COMMIT_CLOSE_MS = 140;
/** What counts as "still here" for a panel opened by hovering: Obsidian's page preview, menus, dialogs. */
const KEEP_OPEN = ".hover-popover, .popover, .menu, .modal-container, .suggestion-container, .sk-note-rail-tooltip";

/** The Search module's command (its hotkey shows in the magnifier's tooltip). */
const SEARCH_COMMAND = "snailkit:search-open";

/** "peek": opened by hovering, closes when the pointer leaves. "sticky": opened by a click, the keyboard or a command. */
type OpenMode = "peek" | "sticky";

interface RailButton {
	id: RailPanelId;
	el: HTMLElement;
	badgeEl: HTMLElement;
}

export class Rail {
	private hostEl: HTMLElement;
	private railEl: HTMLElement;
	private puckEl: HTMLElement;
	private tooltipEl: HTMLElement;
	private buttons = new Map<RailPanelId, RailButton>();
	/** Above the panel buttons: Search (with that module), the area of the note (a colored initial) and today's daily note. */
	private searchEl: HTMLElement;
	private placeEl: HTMLElement;
	private todayEl: HTMLElement;
	private sessionEl: HTMLElement;
	private placeTip = "";
	private openId: RailPanelId | null = null;
	private mode: OpenMode = "sticky";
	private shell: PanelShell | null = null;
	private instance: PanelInstance | null = null;
	/** Bumped each time a panel instance is created: an old instance's context goes quiet. */
	private panelGen = 0;
	private pinned = new Set<RailPanelId>();
	private file: TFile | null;
	private room: RoomController;
	private cleanups: (() => void)[] = [];
	private hoverSwitchTimer = 0;
	/** Open on hover: the intent before opening, the grace before closing, the wait while heading to the panel. */
	private intentTimer = 0;
	private closeTimer = 0;
	private corridorTimer = 0;
	/** A button the pointer crossed on its way to the open panel: it takes over if the pointer stops on it. */
	private corridorTarget: RailPanelId | null = null;
	private lastPoint: Point | null = null;
	/** The pointer is over the rail, the panel, or something that belongs to them (page preview, menu). */
	private pointerInside = false;
	private tooltipTimer = 0;
	private commitTimer = 0;
	private resizeObserver: ResizeObserver | null = null;
	private destroyed = false;
	private closing = new Set<PanelShell>();
	private returnFocus: HTMLElement | null = null;
	/** Height of what floats over the top of the note (phones), as a CSS length, or "". */
	private railTop = "";
	/** Long press on the area pill (touch, pen): the timer, where it started, and whether it showed the menu. */
	private pressTimer = 0;
	private pressStart: Point | null = null;
	private pressFired = false;

	constructor(
		private env: RailEnv,
		readonly view: MarkdownView,
	) {
		this.file = view.file;
		this.hostEl = view.contentEl;
		this.hostEl.addClass("sk-note-rail-host");
		this.railEl = this.hostEl.createDiv({ cls: "sk-note-rail", attr: { role: "toolbar" } });
		this.puckEl = this.railEl.createSpan("sk-note-rail-puck");
		// No aria-label (Obsidian would add its own tooltip): the name is hidden text.
		this.searchEl = this.railEl.createEl("button", { cls: "sk-note-rail-btn sk-note-rail-search", attr: { "data-btn": "search" } });
		setIcon(this.searchEl.createSpan("sk-note-rail-btn-icon"), "search");
		this.searchEl.createSpan({ cls: "sk-note-rail-sr-only", text: env.t("rail.search") });
		// A mouse press leaves the focus in the note: closing the search gives it back there.
		this.searchEl.addEventListener("mousedown", (e) => e.preventDefault());
		this.placeEl = this.railEl.createEl("button", { cls: "sk-note-rail-btn sk-note-rail-place", attr: { "data-btn": "place" } });
		this.placeEl.createSpan("sk-note-rail-place-initial");
		this.placeEl.createSpan("sk-note-rail-sr-only");
		this.todayEl = this.railEl.createEl("button", { cls: "sk-note-rail-btn sk-note-rail-today", attr: { "data-btn": "today" } });
		setIcon(this.todayEl.createSpan("sk-note-rail-btn-icon"), "sun");
		this.todayEl.createSpan({ cls: "sk-note-rail-sr-only", text: env.t("rail.today") });
		this.wireAction(this.searchEl, () => this.searchTip(), () => this.openSearch());
		this.wireAction(this.placeEl, () => this.placeTip, (e) => this.onPlace(e));
		this.wireAction(this.todayEl, () => env.t("rail.today"), (e) => void this.openToday(e));
		this.sessionEl = this.railEl.createEl("button", { cls: "sk-note-rail-btn sk-note-rail-session", attr: { "data-btn": "session" } });
		setIcon(this.sessionEl.createSpan("sk-note-rail-btn-icon"), "zap");
		this.sessionEl.createSpan({ cls: "sk-note-rail-sr-only", text: env.t("panel.session") });
		this.sessionEl.createSpan("sk-note-rail-session-dot");
		this.sessionEl.createSpan("sk-note-rail-pin-dot");
		this.wirePanelButton(this.sessionEl, "session");
		this.placeEl.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			// A long press on a phone may also fire contextmenu: one menu only, and no click after it.
			const touch = this.pressStart !== null;
			this.cancelPress();
			if (this.pressFired) return;
			this.pressFired = touch;
			this.placeMenu(e);
		});
		this.wireLongPress();
		this.tooltipEl = this.hostEl.createDiv({ cls: "sk-note-rail-tooltip", attr: { role: "tooltip" } });
		this.room = new RoomController(view);

		const doc = this.hostEl.ownerDocument;
		this.listen(doc, "pointerdown", (e) => this.onDocPointerDown(e as PointerEvent), true);
		this.listen(doc, "keydown", (e) => this.onDocKeyDown(e as KeyboardEvent), true);
		this.listen(doc, "pointermove", (e) => this.onDocPointerMove(e as PointerEvent), true);
		this.listen(doc, "pointerover", (e) => this.onDocPointerOver(e as PointerEvent), true);
		this.listen(doc, "pointerout", (e) => {
			// Left the window.
			if (!(e as PointerEvent).relatedTarget) this.onDocPointerOver(e as PointerEvent, true);
		}, true);
		this.listen(this.railEl, "pointerleave", () => this.clearHoverTimers());

		const RO = doc.defaultView?.ResizeObserver;
		if (RO) {
			this.resizeObserver = new RO(() => {
				this.placeBelowHeader();
				this.updateRoom();
			});
			this.resizeObserver.observe(this.hostEl);
		}

		this.applySettings();
		this.placeBelowHeader();
	}

	/**
	 * On phones and tablets the note header (and the status bar) float over the top of the note:
	 * the rail and its panels start below them. Set on the rail and its panel only, never on the
	 * note (a custom property there would restyle the whole editor at each resize).
	 */
	private placeBelowHeader(): void {
		if (!Platform.isMobile) return;
		const host = this.hostEl.getBoundingClientRect();
		let covered = 0;
		const header = this.view.containerEl.querySelector<HTMLElement>(":scope > .view-header");
		if (header && header.offsetHeight) covered = header.getBoundingClientRect().bottom - host.top;
		const win = this.hostEl.ownerDocument.defaultView;
		const safeTop = win ? parseFloat(win.getComputedStyle(this.hostEl.ownerDocument.body).getPropertyValue("--safe-area-inset-top")) || 0 : 0;
		covered = Math.max(covered, safeTop - host.top);
		this.railTop = covered > 0 ? `${Math.round(covered)}px` : "";
		for (const el of [this.railEl, this.shell?.el]) {
			if (el && el.style.getPropertyValue("--sk-note-rail-top") !== this.railTop) el.setCssProps({ "--sk-note-rail-top": this.railTop });
		}
	}

	private get position(): "left" | "right" {
		const value = Platform.isMobile ? this.env.settings.mobilePosition ?? "right" : this.env.settings.position;
		return value === "right" ? "right" : "left";
	}

	/** Re-check everything: mount point, file, settings-driven look, button availability. */
	sync(contentChanged = false): void {
		if (this.destroyed) return;
		if (!this.railEl.isConnected || this.railEl.parentElement !== this.hostEl) {
			this.hostEl.addClass("sk-note-rail-host");
			this.hostEl.append(this.railEl, this.tooltipEl);
			if (this.shell) this.hostEl.append(this.shell.el);
		}
		const fileChanged = this.view.file !== this.file;
		this.file = this.view.file;
		this.applySettings();
		this.placeBelowHeader();

		if (!this.openId) return;
		const def = this.defOf(this.openId);
		if (!this.isShown(this.openId) || !this.isOpenable(def)) {
			this.hide("file-change");
			return;
		}
		if (fileChanged) {
			if (this.pinned.has(this.openId)) this.rebuildInstance();
			else this.hide("file-change");
			return;
		}
		if (contentChanged) this.safe(() => this.instance?.refresh());
		this.updateRoom();
	}

	/** A click or a command: closes the panel when it is open and kept open, keeps it open when it was only hovered. */
	toggle(id: RailPanelId, fromKeyboard = false): boolean {
		if (this.openId === id) {
			if (this.mode === "peek" && !fromKeyboard) {
				this.setMode("sticky");
				return true;
			}
			this.hide("escape");
			return true;
		}
		return this.open(id, fromKeyboard, "sticky");
	}

	/** `fromKeyboard` moves the focus into the panel (and back to where it was on close). */
	open(id: RailPanelId, fromKeyboard = false, mode: OpenMode = "sticky"): boolean {
		if (this.destroyed) return false;
		const def = this.defOf(id);
		if (!this.isOpenable(def)) return false;
		// A pinned panel stays pinned, however it is reached.
		if (this.pinned.has(id)) mode = "sticky";
		this.clearOpenTimers();
		if (this.openId === id) {
			if (mode === "sticky") this.setMode("sticky");
			return true;
		}
		window.clearTimeout(this.commitTimer);
		const doc = this.hostEl.ownerDocument;
		const active = doc.activeElement as HTMLElement | null;
		const focusInPanel = !!(this.shell && active && this.shell.el.contains(active));
		const oldShell = this.openId ? this.shell : null;

		let shell: PanelShell;
		if (oldShell && this.openId) {
			// From one panel to another: the card stays, its content and size change.
			const oldId = this.openId;
			const old = this.instance;
			this.instance = null;
			this.safe(() => old?.onHide?.("switch"));
			this.buttonEl(oldId)?.removeClass("is-active");
			this.openId = id;
			shell = oldShell;
			shell.morph(def, this.pinned.has(id));
			this.safe(() => old?.destroy());
		} else {
			this.returnFocus = active && active !== doc.body ? active : null;
			this.openId = id;
			shell = new PanelShell(this.hostEl, def, this.env, this.pinned.has(id), () => {
				if (this.openId) this.togglePin(this.openId);
			});
			this.shell = shell;
			shell.el.addEventListener("pointerleave", (e) => {
				if (e.pointerType === "touch" || this.shell !== shell) return;
				this.safe(() => this.instance?.onPointerLeave?.());
			});
			// Keep the editor focus (and its selection) when clicking inside the card. A press inside a
			// panel opened by hovering keeps it open.
			shell.el.addEventListener("mousedown", (e) => {
				const t = e.target as HTMLElement;
				if (this.shell === shell && this.mode === "peek") this.setMode("sticky");
				if (!t.closest("input, textarea, select, [contenteditable]")) e.preventDefault();
			});
		}
		this.mode = mode;
		this.railEl.toggleClass("is-peek", mode === "peek");
		this.instance = this.createInstance(def, shell);

		this.hideTooltip();
		this.railEl.addClass("is-engaged");
		for (const b of this.buttons.values()) b.el.toggleClass("is-active", b.id === id);
		this.sessionEl.toggleClass("is-active", id === "session");
		this.movePuck();
		this.placeShell(shell);
		if (oldShell) shell.staggerBody();
		else shell.show(false);
		this.updateRoom();
		if (fromKeyboard || focusInPanel) {
			const target = shell.bodyEl.querySelector<HTMLElement>(".is-current[tabindex], [tabindex='0'], button")
				?? shell.el.querySelector<HTMLElement>(".sk-note-rail-pin");
			target?.focus({ preventScroll: true });
		}
		return true;
	}

	/** Close the open panel. `commit` keeps a pinned panel open. */
	close(reason: HideReason = "escape"): void {
		if (!this.openId) return;
		if (reason === "commit") {
			if (this.pinned.has(this.openId)) return;
			const shell = this.shell;
			window.clearTimeout(this.commitTimer);
			this.commitTimer = window.setTimeout(() => {
				if (this.shell === shell) this.hide("commit");
			}, dur(COMMIT_CLOSE_MS, this.hostEl.win));
			return;
		}
		this.hide(reason);
	}

	destroy(): void {
		if (this.destroyed) return;
		this.clearOpenTimers();
		this.hide("unload");
		// Cards still playing their exit: finish them now (DOM, listeners, timers).
		for (const shell of Array.from(this.closing)) shell.flush();
		this.closing.clear();
		this.destroyed = true;
		this.clearHoverTimers();
		this.cancelPress();
		window.clearTimeout(this.commitTimer);
		this.resizeObserver?.disconnect();
		for (const c of this.cleanups) c();
		this.cleanups = [];
		this.room.destroy();
		this.railEl.remove();
		this.tooltipEl.remove();
		this.hostEl.removeClass("sk-note-rail-host", "sk-note-rail-right");
	}

	// ---- buttons -------------------------------------------------------------

	/** The definition behind a panel id (the four panels, or the idea sessions panel). */
	private defOf(id: RailPanelId): PanelDefinition {
		return id === "session" ? sessionPanel : PANELS[id];
	}

	private buttonEl(id: RailPanelId): HTMLElement | null {
		return id === "session" ? this.sessionEl : this.buttons.get(id)?.el ?? null;
	}

	private hoverEnabled(): boolean {
		return !Platform.isMobile && this.env.settings.openOnHover !== false;
	}

	private applySettings(): void {
		this.hostEl.toggleClass("sk-note-rail-right", this.position === "right");
		this.railEl.setCssProps({ "--sk-note-rail-rest": String(clamp(this.env.settings.restOpacity, 0.2, 1, 0.5)) });
		this.renderActions();
		this.renderButtons();
	}

	// ---- area and today ------------------------------------------------------

	/** The Search magnifier (with that module), the area pill (hidden when the note has none) and the Today button (lit on today's note). */
	private renderActions(): void {
		const file = this.view.file;
		this.searchEl.hidden = !this.searchService();
		const place = file && this.env.settings.showPlace !== false ? placeFinder(this.env.app).placeOf(file) : null;
		const area = place?.area ?? null;
		this.placeEl.hidden = !area;
		if (area && file && place) {
			const initial = (/[\p{L}\p{N}]/u.exec(area.basename)?.[0] ?? "?").toUpperCase();
			this.placeEl.querySelector(".sk-note-rail-place-initial")?.setText(initial);
			this.placeEl.setCssProps({ "--sk-place-hue": String(hueOf(area.path)) });
			this.placeTip = this.placeSteps(file).map((f) => f.basename).join(" › ");
			this.placeEl.querySelector(".sk-note-rail-sr-only")?.setText(this.placeTip);
		}
		this.todayEl.hidden = this.env.settings.showToday === false;
		this.renderSession(file);
		this.todayEl.toggleClass("is-active", !!file && file.path === this.todayPath());
	}

	/**
	 * The idea sessions button, when the Idea sessions module is on: it opens the sessions panel. Lit
	 * on an open session; a dot when sessions wait to be sorted.
	 */
	private renderSession(file: TFile | null): void {
		const sessions = sessionsOf(this.env);
		this.sessionEl.hidden = !sessions || this.env.settings.showSession === false;
		if (!sessions) return;
		const session = !!file && sessions.isSession(file);
		const closed = session && !!file && sessions.isClosed(file);
		this.sessionEl.toggleClass("is-lit", session && !closed);
		this.sessionEl.toggleClass("has-pending", (this.safe(() => sessions.pending(), 0) ?? 0) > 0);
		this.sessionEl.toggleClass("is-pinned", this.pinned.has("session"));
	}

	/** From the area down to the direct parent of the note (the area alone when the note is the area). */
	private placeSteps(file: TFile): TFile[] {
		const place = placeFinder(this.env.app).placeOf(file);
		if (!place.area) return [];
		if (place.area === file) return [file];
		const from = place.chain.indexOf(place.area);
		const steps: TFile[] = [];
		for (let i = from; i >= 0; i--) steps.push(place.chain[i]);
		return steps;
	}

	/** Tooltip on hover, the action on click (closing an open panel first). */
	private wireAction(el: HTMLElement, label: () => string, run: (e: MouseEvent) => void): void {
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			this.clearHoverTimers();
			if (this.openId) this.hide("commit");
			run(e);
		});
		el.addEventListener("pointerenter", (e) => {
			if (e.pointerType !== "touch") this.showTooltipSoon(el, label());
		});
		el.addEventListener("pointerleave", () => this.hideTooltip());
	}

	/**
	 * Click: with the Home module, the page of the area in the Workbench (the nearest sub-MOC, the
	 * note marked "you are here"). Without it, or with Ctrl or Cmd: the area note, and on a phone
	 * (no hover to read the path) or on the area itself, the path as a menu.
	 */
	private onPlace(e: MouseEvent): void {
		// The end of a long press that already showed the menu.
		if (this.pressFired) {
			this.pressFired = false;
			return;
		}
		const file = this.view.file;
		if (!file) return;
		const steps = this.placeSteps(file);
		const area = steps[0];
		if (!area) return;
		const home = this.homeService();
		const mod = !!Keymap.isModEvent(e);
		const legacy = () => this.placeAction(pillAction({ home: false, mobile: Platform.isMobile, isArea: area === file, mod }), area, e);
		if (!home || pillAction({ home: true, mobile: Platform.isMobile, isArea: area === file, mod }) !== "place") {
			legacy();
			return;
		}
		home.openPlace(file).then((shown) => {
			if (!shown && !this.destroyed) legacy();
		}, (err) => {
			console.error("[Snailkit] note-rail: could not open the page of the area", err);
			if (!this.destroyed) legacy();
		});
	}

	private placeAction(action: "place" | "note" | "menu", area: TFile, e: MouseEvent): void {
		if (action === "menu") this.placeMenu(e);
		else if (action === "note") void this.openFile(area, e);
	}

	/** Touch or pen held on the pill: the path menu (the click that follows is ignored). */
	private wireLongPress(): void {
		const el = this.placeEl;
		el.addEventListener("pointerdown", (e) => {
			this.pressFired = false;
			if (e.pointerType === "mouse" || e.button !== 0) return;
			this.cancelPress();
			this.pressStart = { x: e.clientX, y: e.clientY };
			this.pressTimer = window.setTimeout(() => {
				this.pressTimer = 0;
				this.pressStart = null;
				if (this.destroyed || !el.isConnected || el.hidden) return;
				this.pressFired = true;
				this.placeMenu(e);
			}, LONG_PRESS_MS);
		});
		el.addEventListener("pointermove", (e) => {
			const start = this.pressStart;
			if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP) this.cancelPress();
		});
		for (const type of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(type, () => this.cancelPress());
	}

	private cancelPress(): void {
		window.clearTimeout(this.pressTimer);
		this.pressTimer = 0;
		this.pressStart = null;
	}

	// ---- search and home -----------------------------------------------------

	private searchService(): SearchService | null {
		const search = this.safe(() => this.env.service<SearchService>("search"), undefined);
		return search && search.version === 1 && typeof search.open === "function" ? search : null;
	}

	private homeService(): HomeService | null {
		const home = this.safe(() => this.env.service<HomeService>("home"), undefined);
		return home && home.version === 1 && typeof home.openPlace === "function" ? home : null;
	}

	/** "Search", plus the hotkey of the Search command when it has one. */
	private searchTip(): string {
		const label = this.env.t("rail.search");
		const manager = (this.env.app as unknown as {
			hotkeyManager?: { getHotkeys?(id: string): HotkeyLike[] | undefined; getDefaultHotkeys?(id: string): HotkeyLike[] | undefined };
		}).hotkeyManager;
		const keys = this.safe(() => hotkeyText(commandHotkeys(manager?.getHotkeys?.(SEARCH_COMMAND), manager?.getDefaultHotkeys?.(SEARCH_COMMAND)), Platform.isMacOS), "");
		return keys ? `${label} · ${keys}` : label;
	}

	/** The floating search, growing from the magnifier; Shift+Enter links into this note. */
	private openSearch(): void {
		const search = this.searchService();
		if (!search) return;
		const file = this.view.file;
		const editor = this.view.getMode() === "source" ? this.view.editor : null;
		this.safe(() => search.open({ anchor: this.searchEl, from: file ? { file, editor } : null }));
	}

	private placeMenu(e: MouseEvent): void {
		const file = this.view.file;
		if (!file) return;
		const menu = new Menu();
		for (const step of this.placeSteps(file)) {
			menu.addItem((item) => item.setTitle(step.basename).setIcon(step === file ? "dot" : "corner-left-up").setDisabled(step === file).onClick(() => void this.openFile(step, e)));
		}
		menu.showAtMouseEvent(e);
	}

	private todayPath(): string {
		const cfg = getDailyConfig(this.env.app, this.env.settings);
		const name = moment().format(cfg.format);
		return (cfg.folder ? cfg.folder + "/" : "") + name + ".md";
	}

	private async openToday(e: MouseEvent): Promise<void> {
		try {
			const cfg = getDailyConfig(this.env.app, this.env.settings);
			const file = await getOrCreateDailyNote(this.env.app, moment().format("YYYY-MM-DD"), cfg);
			await this.openFile(file, e);
		} catch (err) {
			console.error("[Snailkit] note-rail: today's note", err);
			new Notice(this.env.t("rail.today-error"));
		}
	}

	/** In this pane (a new tab with Ctrl or Cmd). */
	private async openFile(file: TFile, e: MouseEvent): Promise<void> {
		if (!Keymap.isModEvent(e) && this.view.file?.path === file.path) return;
		const leaf = Keymap.isModEvent(e) ? this.env.app.workspace.getLeaf("tab") : this.view.leaf;
		await leaf.openFile(file);
	}

	private isShown(id: RailPanelId): boolean {
		if (id === "session") return this.env.settings.showSession !== false;
		return this.env.settings[SHOW_KEY[id]] !== false;
	}

	private isOpenable(def: PanelDefinition): boolean {
		return this.isShown(def.id) && this.safe(() => def.isAvailable(this.env, this.view), false) === true;
	}

	/** Buttons in settings order, shown ones only, hidden when their panel has nothing for this note. */
	private renderButtons(): void {
		const wanted = railOrder(this.env.settings.buttonOrder).filter((id) => this.isShown(id)).map((id) => PANELS[id]);
		const keep = new Set(wanted.map((d) => d.id));
		for (const [id, b] of this.buttons) {
			if (!keep.has(id)) {
				b.el.remove();
				this.buttons.delete(id);
			}
		}
		let changed = false;
		for (const def of wanted) {
			if (!this.buttons.has(def.id)) this.buttons.set(def.id, this.createButton(def));
		}
		// Keep DOM order equal to settings order (moving a hovered node would drop its hover state).
		const order = wanted.map((d) => this.buttons.get(d.id)!.el);
		const current = Array.from(this.railEl.querySelectorAll<HTMLElement>(":scope > .sk-note-rail-btn[data-panel-btn]"));
		if (order.length !== current.length || order.some((el, i) => current[i] !== el)) {
			for (const el of order) this.railEl.appendChild(el);
			changed = true;
		}
		for (const def of wanted) {
			const b = this.buttons.get(def.id)!;
			const available = this.isOpenable(def);
			if (b.el.hidden === available) {
				b.el.hidden = !available;
				changed = true;
				if (available && this.railEl.isConnected) popIn(b.el, this.hostEl.win);
			}
			const badge = def.badge ? this.safe(() => def.badge!(this.env, this.view), null) : null;
			b.badgeEl.setText(badge ? String(badge > 99 ? "99+" : badge) : "");
			b.badgeEl.toggleClass("is-zero", !badge);
			b.badgeEl.toggleClass("is-warn", !!badge && !!def.badgeTone && this.safe(() => def.badgeTone!(this.env, this.view), null) === "warn");
			b.el.toggleClass("is-active", this.openId === def.id);
			b.el.toggleClass("is-pinned", this.pinned.has(def.id));
		}
		const visible = wanted.some((d) => !this.buttons.get(d.id)!.el.hidden);
		this.railEl.toggleClass("is-empty", !visible);
		if (changed || this.openId) this.movePuck();
	}

	private createButton(def: PanelDefinition): RailButton {
		// No aria-label: Obsidian would show its own tooltip on top of ours. The name is hidden text.
		const el = createEl("button", { cls: "sk-note-rail-btn", attr: { "data-btn": def.id, "data-panel-btn": "" } });
		setIcon(el.createSpan("sk-note-rail-btn-icon"), def.icon);
		el.createSpan({ cls: "sk-note-rail-sr-only", text: this.env.t(`panel.${def.id}`) });
		const badgeEl = el.createSpan("sk-note-rail-badge is-zero");
		el.createSpan("sk-note-rail-pin-dot");
		this.wirePanelButton(el, def.id);
		return { id: def.id, el, badgeEl };
	}

	/** Click toggles (or keeps open a hovered panel); hovering opens after a short intent, or swaps an open panel. */
	private wirePanelButton(el: HTMLElement, id: RailPanelId): void {
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			this.clearHoverTimers();
			// With open on hover (computer, mouse): hovering shows the Tasks and Brainstorm panels, a
			// click goes straight to the Workbench on the matching tab. The keyboard still opens the panel.
			const workbench = id === "tasks" ? "tasks" : id === "session" ? "sessions" : null;
			if (workbench && e.detail !== 0 && this.hoverEnabled() && this.env.openWorkbench({ tab: workbench })) {
				if (this.openId) this.hide("commit");
				return;
			}
			// detail 0 = activated with Enter or Space.
			this.toggle(id, e.detail === 0);
		});
		el.addEventListener("pointerenter", (e) => {
			if (e.pointerType === "touch") return;
			this.showTooltipSoon(el, this.env.t(`panel.${id}`));
			window.clearTimeout(this.hoverSwitchTimer);
			// Only a mouse hovers: a pen or a finger opens panels by tapping.
			if (e.pointerType !== "mouse") return;
			if (this.hoverEnabled()) {
				this.hoverButton(id, e);
				return;
			}
			if (this.openId && this.openId !== id) {
				this.hoverSwitchTimer = window.setTimeout(() => this.open(id), HOVER_SWITCH_MS);
			}
		});
		el.addEventListener("pointerleave", () => {
			this.hideTooltip();
			window.clearTimeout(this.hoverSwitchTimer);
			window.clearTimeout(this.intentTimer);
			if (this.corridorTarget === id) this.clearCorridor();
		});
	}

	// ---- open on hover ---------------------------------------------------------

	/**
	 * The pointer came onto a panel button. Nothing open: open after the intent delay. A hovered
	 * panel open: swap right away, unless the pointer is on its way to that panel (then wait for it
	 * to stop here). A panel kept open by a click stays as it is.
	 */
	private hoverButton(id: RailPanelId, e: PointerEvent): void {
		window.clearTimeout(this.intentTimer);
		if (this.openId === id) {
			this.cancelClose();
			return;
		}
		// Ctrl or Cmd held: the pointer is after Obsidian's page preview, not a panel.
		if (Keymap.isModEvent(e)) return;
		if (this.openId && this.mode === "sticky") return;
		if (!this.isOpenable(this.defOf(id))) return;
		if (this.openId && this.shell) {
			const from = this.lastPoint;
			const to = { x: e.clientX, y: e.clientY };
			if (from && headingToPanel(from, to, this.shell.el.getBoundingClientRect(), this.position)) {
				this.corridorTarget = id;
				this.armCorridor();
				return;
			}
			this.open(id, false, "peek");
			return;
		}
		this.intentTimer = window.setTimeout(() => {
			if (!this.destroyed && !this.openId && hovered(this.buttonEl(id))) this.open(id, false, "peek");
		}, OPEN_INTENT_MS);
	}

	/** The pointer stopped on a crossed button: it was not heading for the panel after all. */
	private armCorridor(): void {
		window.clearTimeout(this.corridorTimer);
		this.corridorTimer = window.setTimeout(() => {
			const id = this.corridorTarget;
			this.corridorTarget = null;
			if (id && this.openId && this.mode === "peek" && hovered(this.buttonEl(id))) this.open(id, false, "peek");
		}, CORRIDOR_WAIT_MS);
	}

	private clearCorridor(): void {
		window.clearTimeout(this.corridorTimer);
		this.corridorTarget = null;
	}

	private onDocPointerMove(e: PointerEvent): void {
		if (e.pointerType !== "mouse" || !this.openId || this.mode !== "peek") {
			this.lastPoint = null;
			return;
		}
		const to = { x: e.clientX, y: e.clientY };
		const from = this.lastPoint;
		this.lastPoint = to;
		// Still crossing a button toward the panel: keep waiting; turned away from it: swap now.
		if (this.corridorTarget && from && this.shell && (from.x !== to.x || from.y !== to.y)) {
			if (headingToPanel(from, to, this.shell.el.getBoundingClientRect(), this.position)) this.armCorridor();
			else {
				const id = this.corridorTarget;
				this.clearCorridor();
				if (hovered(this.buttonEl(id))) this.open(id, false, "peek");
			}
		}
	}

	/** Pointer over something: inside the rail, the panel or what belongs to them keeps a hovered panel open. */
	private onDocPointerOver(e: PointerEvent, leftWindow = false): void {
		if (e.pointerType !== "mouse") return;
		const t = leftWindow ? null : asElement(e.target);
		this.pointerInside = !!t && (this.railEl.contains(t) || !!this.shell?.el.contains(t) || !!t.closest(KEEP_OPEN));
		if (!this.openId || this.mode !== "peek") return;
		if (this.pointerInside) this.cancelClose();
		else this.armClose();
	}

	private armClose(): void {
		if (this.closeTimer) return;
		this.closeTimer = window.setTimeout(() => {
			this.closeTimer = 0;
			if (this.destroyed || !this.openId || this.mode !== "peek" || this.pointerInside) return;
			const doc = this.hostEl.ownerDocument;
			// A menu or a dialog is open, or the keyboard is in the panel: stay.
			if (doc.querySelector(".menu, .modal-container")) return;
			if (this.shell && doc.activeElement && this.shell.el.contains(doc.activeElement)) return;
			this.hide("leave");
		}, CLOSE_GRACE_MS);
	}

	private cancelClose(): void {
		window.clearTimeout(this.closeTimer);
		this.closeTimer = 0;
	}

	private clearOpenTimers(): void {
		window.clearTimeout(this.intentTimer);
		this.cancelClose();
		this.clearCorridor();
	}

	/** A hovered panel becomes a panel kept open (a click on its button, a press inside it). */
	private setMode(mode: OpenMode): void {
		this.mode = mode;
		this.railEl.toggleClass("is-peek", mode === "peek");
		if (mode === "sticky") this.clearOpenTimers();
	}

	private movePuck(): void {
		const b = this.openId ? this.buttonEl(this.openId) : null;
		if (!b || b.hidden) {
			this.puckEl.removeClass("is-on");
			return;
		}
		this.puckEl.setCssProps({ "--y": `${b.offsetTop}px` });
		this.puckEl.addClass("is-on");
	}

	/** The card's size limits (from the pane, in pixels) and where it grows from (the active button). */
	private placeShell(shell: PanelShell): void {
		const host = this.hostEl;
		const inset = 10;
		const top = parseFloat(this.railTop) || 0;
		shell.setBounds(host.clientWidth - this.railEl.offsetWidth - 2 * inset - 16, host.clientHeight - top - 2 * inset);
		const b = this.openId ? this.buttonEl(this.openId) : null;
		if (b) shell.setOrigin(this.railEl.offsetTop + b.offsetTop + b.offsetHeight / 2 - (top + inset));
	}

	private togglePin(id: RailPanelId): void {
		if (this.pinned.has(id)) this.pinned.delete(id);
		else this.pinned.add(id);
		const on = this.pinned.has(id);
		this.buttonEl(id)?.toggleClass("is-pinned", on);
		if (this.openId === id) this.shell?.setPinned(on);
		if (on && this.openId === id) this.setMode("sticky");
	}

	// ---- tooltips ------------------------------------------------------------

	private showTooltipSoon(btn: HTMLElement, text: string): void {
		window.clearTimeout(this.tooltipTimer);
		if (this.openId || Platform.isMobile) return;
		this.tooltipTimer = window.setTimeout(() => {
			if (this.openId || !btn.isConnected) return;
			this.tooltipEl.setText(text);
			const host = this.hostEl.getBoundingClientRect();
			const r = btn.getBoundingClientRect();
			const rail = this.railEl.getBoundingClientRect();
			this.tooltipEl.style.top = `${r.top - host.top + r.height / 2}px`;
			if (this.position === "right") {
				this.tooltipEl.style.removeProperty("left");
				this.tooltipEl.style.right = `${host.right - rail.left + 8}px`;
			} else {
				this.tooltipEl.style.removeProperty("right");
				this.tooltipEl.style.left = `${rail.right - host.left + 8}px`;
			}
			this.tooltipEl.addClass("is-on");
		}, TOOLTIP_MS);
	}

	private hideTooltip(): void {
		window.clearTimeout(this.tooltipTimer);
		this.tooltipEl.removeClass("is-on");
	}

	private clearHoverTimers(): void {
		window.clearTimeout(this.hoverSwitchTimer);
		this.hideTooltip();
	}

	// ---- panel lifecycle -----------------------------------------------------

	private createInstance(def: PanelDefinition, shell: PanelShell): PanelInstance | null {
		const env = this.env;
		const gen = ++this.panelGen;
		const live = () => this.shell === shell && this.panelGen === gen;
		const ctx: PanelContext = {
			app: env.app,
			view: this.view,
			get settings() {
				return env.settings;
			},
			lang: env.lang,
			hoverSource: env.hoverSource,
			t: (key, vars) => env.t(key, vars),
			tn: (key, count, vars) => env.tn(key, count, vars),
			updateSettings: (mutate) => env.updateSettings(mutate),
			service: (name) => env.service(name),
			vaultTasks: () => env.vaultTasks(),
			openWorkbench: (options) => env.openWorkbench(options),
			close: (reason?: HideReason) => {
				if (live()) this.close(reason ?? "escape");
			},
			setFooter: (content) => {
				if (live()) shell.setFooter(content);
			},
			setSubtitle: (text) => {
				if (live()) shell.setSubtitle(text);
			},
			setCount: (count) => {
				if (live()) shell.setCount(count);
			},
			setProgress: (p) => {
				if (live()) shell.setProgress(p);
			},
			isPinned: () => this.pinned.has(def.id),
		};
		try {
			return def.create(ctx, shell.bodyEl);
		} catch (err) {
			console.error(`[Snailkit] note-rail: the ${def.id} panel failed to open`, err);
			shell.bodyEl.empty();
			shell.bodyEl.createDiv({ cls: "sk-note-rail-empty", text: env.t("panel.error") });
			return null;
		}
	}

	/** Pinned panel, new note in the same view: rebuild the content in place. */
	private rebuildInstance(): void {
		const shell = this.shell;
		const id = this.openId;
		if (!shell || !id) return;
		const old = this.instance;
		this.safe(() => old?.onHide?.("file-change"));
		this.safe(() => old?.destroy());
		shell.bodyEl.empty();
		shell.setFooter("");
		shell.setCount(null);
		shell.setProgress(null);
		shell.setSubtitle("");
		this.instance = this.createInstance(this.defOf(id), shell);
		shell.staggerBody();
		this.updateRoom();
	}

	private hide(reason: HideReason, swapping = false): void {
		const id = this.openId;
		const shell = this.shell;
		const instance = this.instance;
		if (!id || !shell) return;
		window.clearTimeout(this.commitTimer);
		this.clearOpenTimers();
		this.mode = "sticky";
		this.railEl.removeClass("is-peek");
		this.openId = null;
		this.shell = null;
		this.instance = null;
		this.safe(() => instance?.onHide?.(reason));
		const instant = reason === "unload" || !this.hostEl.isConnected;
		// The panel had the focus: hand it back (a commit already moved it to the editor).
		const doc = this.hostEl.ownerDocument;
		if (!swapping && doc.activeElement && shell.el.contains(doc.activeElement)) {
			const back = this.returnFocus?.isConnected ? this.returnFocus : this.buttonEl(id);
			back?.focus({ preventScroll: true });
		}
		if (!swapping) this.returnFocus = null;
		this.closing.add(shell);
		shell.hide(swapping, instant, () => {
			this.closing.delete(shell);
			this.safe(() => instance?.destroy());
		});
		this.buttonEl(id)?.removeClass("is-active");
		if (!swapping) {
			this.railEl.removeClass("is-engaged");
			this.movePuck();
			this.updateRoom();
		}
	}

	private updateRoom(): void {
		if (this.destroyed) return;
		// On a phone there is no room to make: the text would slide off the screen.
		if (this.shell && this.railTop) this.shell.el.setCssProps({ "--sk-note-rail-top": this.railTop });
		if (this.shell) this.placeShell(this.shell);
		this.room.update(this.shell?.el ?? null, this.position, this.env.settings.makeRoom !== false && !Platform.isPhone);
	}

	// ---- document-level interactions -----------------------------------------

	private onDocPointerDown(e: PointerEvent): void {
		if (!this.openId || !this.shell) return;
		const t = e.target as Node | null;
		if (!t) return;
		if (this.shell.el.contains(t) || this.railEl.contains(t)) return;
		if (this.pinned.has(this.openId)) return;
		// Menus and modals opened from a panel are not "outside".
		if (asElement(t)?.closest(".menu, .modal-container, .suggestion-container")) return;
		this.hide("outside");
	}

	private onDocKeyDown(e: KeyboardEvent): void {
		if (e.key !== "Escape" || !this.openId || !this.shell || e.defaultPrevented) return;
		const doc = this.hostEl.ownerDocument;
		// Let modals, menus and suggestion popups handle their own Escape first.
		if (doc.querySelector(".modal-container, .menu, .suggestion-container")) return;
		const target = asNode(e.target);
		// The command palette removes itself on this same Escape before we see it: a detached
		// target, or one inside a modal, menu or prompt, means the key was meant for that UI.
		if (target && !target.isConnected) return;
		if (asElement(e.target)?.closest(".modal-container, .menu, .prompt, .suggestion-container")) return;
		const inPanel = !!target && this.shell.el.contains(target);
		const active = this.env.app.workspace.getActiveViewOfType(MarkdownView) === this.view;
		// A panel opened by hovering in another pane: Esc closes it while the pointer is on it.
		if (!inPanel && !active && !(this.mode === "peek" && this.pointerInside)) return;
		e.preventDefault();
		e.stopPropagation();
		this.hide("escape");
	}

	/** The overdue and today's tasks of the vault changed: badges follow, the open panel too. */
	vaultTasksChanged(): void {
		if (this.destroyed) return;
		this.renderButtons();
		this.safe(() => this.instance?.onVaultTasks?.());
	}

	// ---- helpers ---------------------------------------------------------------

	private listen(target: EventTarget, type: string, fn: (e: Event) => void, capture = false): void {
		target.addEventListener(type, fn, capture);
		this.cleanups.push(() => target.removeEventListener(type, fn, capture));
	}

	/** Panels are separate code: never let one break the rail. */
	private safe<T>(fn: () => T, fallback?: T): T | undefined {
		try {
			return fn();
		} catch (err) {
			console.error("[Snailkit] note-rail:", err);
			return fallback;
		}
	}
}

/** The pointer is on this element now. */
function hovered(node: HTMLElement | null): boolean {
	return !!node && node.isConnected && node.matches(":hover");
}
