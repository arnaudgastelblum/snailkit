// One rail per Markdown view, mounted in the view's content element (below the view header, so it
// stays put while the note scrolls and survives switches between Live Preview, Source and Reading).
// Top to bottom: the Snailkit menu, a rule, the area pill, the panel buttons the user ordered
// (Contents, Open tasks, Bookmarks), Actions. The rail owns the panel card; panels only fill the
// body and the footer.
import { Keymap, MarkdownView, Platform, setIcon, type TFile } from "obsidian";
import { SNAIL_ICON } from "../../../ui/icons";
import { hueOf } from "../parents";
import { pillOf } from "../panels/place/PlacePanel";
import { ALL_PANELS, PANELS } from "../panels/registry";
import { clamp, railOrder, SHOW_KEY } from "../settings";
import type { HideReason, PanelContext, PanelDefinition, PanelInstance, RailEnv, RailPanelId } from "../types";
import { CLOSE_GRACE_MS, CORRIDOR_WAIT_MS, headingToPanel, OPEN_INTENT_MS, type Point } from "./hover";
import { asElement, asNode, dur, popIn } from "./motion";
import { PanelShell } from "./PanelShell";
import { textEdges } from "./column";

/** Without "Open on hover": hover intent before a rail button replaces the open panel. */
const HOVER_SWITCH_MS = 160;
/** Hover delay before a rail tooltip shows. */
const TOOLTIP_MS = 420;
/** Short beat between a committed click and the close, so the click registers visually. */
const COMMIT_CLOSE_MS = 140;
/** What counts as "still here" for a panel opened by hovering: Obsidian's page preview, menus, dialogs. */
const KEEP_OPEN = ".hover-popover, .popover, .menu, .modal-container, .suggestion-container, .sk-note-rail-tooltip";

/** Gap between the rail and the text column it stands next to. */
const TEXT_GAP = 28;
/** Distance kept from the pane's edge (matches --sk-note-rail-inset in styles.css). */
const INSET = 10;

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
	/** The fixed buttons: the Snailkit menu (top), the area of the note (a colored initial), Actions (bottom). */
	private menuEl: HTMLElement;
	private placeEl: HTMLElement;
	private actionBtnEl: HTMLElement;
	/** The area shown by the pill (its path), to redraw only when it changes. */
	private pillPath = "";
	private openId: RailPanelId | null = null;
	private mode: OpenMode = "sticky";
	private shell: PanelShell | null = null;
	private instance: PanelInstance | null = null;
	/** Bumped each time a panel instance is created: an old instance's context goes quiet. */
	private panelGen = 0;
	private pinned = new Set<RailPanelId>();
	private file: TFile | null;
	/** Distance of the rail from its side of the pane, as a CSS length (beside the text column). */
	private railX = "";
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
		this.menuEl = this.fixedButton("menu", "sk-note-rail-menu-btn");
		setIcon(this.menuEl.createSpan("sk-note-rail-btn-icon"), SNAIL_ICON);
		this.menuEl.createSpan({ cls: "sk-note-rail-sr-only", text: env.t("panel.menu") });
		this.menuEl.createSpan("sk-note-rail-pin-dot");
		this.railEl.createSpan("sk-note-rail-sep");
		this.placeEl = this.fixedButton("place", "sk-note-rail-place");
		this.placeEl.createSpan("sk-note-rail-place-initial");
		this.placeEl.createSpan("sk-note-rail-sr-only");
		this.placeEl.createSpan("sk-note-rail-pin-dot");
		this.actionBtnEl = this.fixedButton("actions", "sk-note-rail-actions-btn");
		setIcon(this.actionBtnEl.createSpan("sk-note-rail-btn-icon"), ALL_PANELS.actions.icon);
		this.actionBtnEl.createSpan({ cls: "sk-note-rail-sr-only", text: env.t("panel.actions") });
		this.actionBtnEl.createSpan("sk-note-rail-pin-dot");
		this.wirePanelButton(this.menuEl, "menu");
		this.wirePanelButton(this.placeEl, "place", () => this.pillTip);
		this.wirePanelButton(this.actionBtnEl, "actions");
		this.tooltipEl = this.hostEl.createDiv({ cls: "sk-note-rail-tooltip", attr: { role: "tooltip" } });

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
				this.placeNearText();
				this.updatePanelPlace();
			});
			this.resizeObserver.observe(this.hostEl);
		}

		// Readable line length, fonts or the theme changed: the text column may have moved.
		const ref = env.app.workspace.on("css-change", () => {
			this.placeNearText();
			this.updatePanelPlace();
		});
		this.cleanups.push(() => env.app.workspace.offref(ref));

		this.applySettings();
		this.placeBelowHeader();
		this.placeNearText();
	}

	/**
	 * On a computer the rail stands next to the text column rather than at the far edge of a wide
	 * pane; it never goes closer to the edge than the inset, and the panel opens over the text.
	 * Set on the rail and its panel only (like --sk-note-rail-top).
	 */
	private placeNearText(): void {
		let x = INSET;
		if (!Platform.isPhone) {
			const edges = textEdges(this.view);
			const host = this.hostEl.getBoundingClientRect();
			const width = this.railEl.offsetWidth;
			if (edges && width > 0 && host.width > 0) {
				x = this.position === "right"
					? host.right - edges.right - TEXT_GAP - width
					: edges.left - host.left - TEXT_GAP - width;
				x = Math.max(INSET, Math.round(x));
			}
		}
		this.railX = x === INSET ? "" : `${x}px`;
		for (const el of [this.railEl, this.shell?.el]) {
			if (el && el.style.getPropertyValue("--sk-note-rail-x") !== this.railX) el.setCssProps({ "--sk-note-rail-x": this.railX });
		}
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
		this.placeNearText();

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
		this.updatePanelPlace();
	}

	/** A click or a command: closes the panel when it is open and kept open, keeps it open when it was only hovered. */
	toggle(id: RailPanelId, fromKeyboard = false): boolean {
		if (this.openId === id || (this.openId && this.defOf(this.openId).parent === id)) {
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
			}, () => {
				const parent = this.openId ? this.defOf(this.openId).parent : undefined;
				if (parent) this.open(parent, !!this.shell && this.shell.el.contains(this.hostEl.ownerDocument.activeElement));
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
		this.markActive(id);
		this.movePuck();
		this.placeShell(shell);
		if (oldShell) shell.staggerBody();
		else shell.show(false);
		this.updatePanelPlace();
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
		window.clearTimeout(this.commitTimer);
		this.resizeObserver?.disconnect();
		for (const c of this.cleanups) c();
		this.cleanups = [];
		this.railEl.remove();
		this.tooltipEl.remove();
		this.hostEl.removeClass("sk-note-rail-host", "sk-note-rail-right");
	}

	// ---- buttons -------------------------------------------------------------

	private defOf(id: RailPanelId): PanelDefinition {
		return ALL_PANELS[id];
	}

	/** The rail button of a panel: a sub-panel's is its parent's (lit while the sub-panel is open). */
	private buttonEl(id: RailPanelId): HTMLElement | null {
		const parent = this.defOf(id).parent;
		if (parent) return this.buttonEl(parent);
		if (id === "menu") return this.menuEl;
		if (id === "place") return this.placeEl;
		if (id === "actions") return this.actionBtnEl;
		return this.buttons.get(id)?.el ?? null;
	}

	/** Only the button of the open panel (or of its parent) is lit. */
	private markActive(id: RailPanelId | null): void {
		const active = id ? this.buttonEl(id) : null;
		for (const el of [this.menuEl, this.placeEl, this.actionBtnEl, ...Array.from(this.buttons.values(), (b) => b.el)]) {
			el.toggleClass("is-active", el === active);
		}
	}

	private fixedButton(id: RailPanelId, cls: string): HTMLElement {
		return this.railEl.createEl("button", { cls: `sk-note-rail-btn ${cls}`, attr: { "data-btn": id } });
	}

	private hoverEnabled(): boolean {
		return !Platform.isMobile && this.env.settings.openOnHover !== false;
	}

	private applySettings(): void {
		this.hostEl.toggleClass("sk-note-rail-right", this.position === "right");
		this.railEl.setCssProps({ "--sk-note-rail-rest": String(clamp(this.env.settings.restOpacity, 0.2, 1, 0.5)) });
		this.renderFixed();
		this.renderButtons();
	}

	// ---- the fixed buttons ----------------------------------------------------

	/** The tooltip of the pill: the way from the top of the tree down to the note's parent. */
	private pillTip = "";

	/**
	 * The area pill (hidden when the note has no parent and no children: its initial and color come
	 * from the area, or from the note itself when it tops a tree) and the Actions button.
	 */
	private renderFixed(): void {
		const file = this.view.file;
		const area = pillOf(this.env, this.view);
		this.placeEl.hidden = !area;
		if (area && file) {
			const chain = this.safe(() => this.env.places.placeOf(file).chain, [] as TFile[]) ?? [];
			this.pillTip = [...chain.slice().reverse(), file].map((f) => f.basename).join(" › ");
			if (area.path !== this.pillPath) {
				this.pillPath = area.path;
				const initial = (/[\p{L}\p{N}]/u.exec(area.basename)?.[0] ?? "?").toUpperCase();
				this.placeEl.querySelector(".sk-note-rail-place-initial")?.setText(initial);
				this.placeEl.setCssProps({ "--sk-place-hue": String(hueOf(area.path)) });
			}
			this.placeEl.querySelector(".sk-note-rail-sr-only")?.setText(this.pillTip);
		}
		this.actionBtnEl.hidden = !this.isOpenable(this.defOf("actions"));
		for (const id of ["menu", "place", "actions"] as const) this.buttonEl(id)?.toggleClass("is-pinned", this.pinned.has(id));
		this.markActive(this.openId);
	}

	private isShown(id: RailPanelId): boolean {
		if (id === "menu" || id === "session" || id === "actions" || id === "callout") return true;
		if (id === "place") return this.env.settings.showPlace !== false;
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
			for (const el of order) this.railEl.insertBefore(el, this.actionBtnEl);
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
	private wirePanelButton(el: HTMLElement, id: RailPanelId, label?: () => string): void {
		el.addEventListener("click", (e) => {
			e.stopPropagation();
			this.clearHoverTimers();
			// detail 0 = activated with Enter or Space.
			this.toggle(id, e.detail === 0);
		});
		el.addEventListener("pointerenter", (e) => {
			if (e.pointerType === "touch") return;
			this.showTooltipSoon(el, label?.() || this.env.t(`panel.${id}`));
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
		// The button of the open panel, or of its parent (the menu while the Calendar is open): stay.
		if (this.openId === id || (this.openId && this.defOf(this.openId).parent === id)) {
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
		const inset = INSET;
		const top = parseFloat(this.railTop) || 0;
		const x = parseFloat(this.railX) || inset;
		shell.setBounds(host.clientWidth - x - this.railEl.offsetWidth - inset - 16, host.clientHeight - top - 2 * inset);
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
			hasWorkbenchTab: (tab) => env.hasWorkbenchTab(tab),
			places: env.places,
			noteActions: () => env.noteActions(),
			openSettings: () => env.openSettings(),
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
			openPanel: (id, fromKeyboard) => {
				if (live()) this.open(id, !!fromKeyboard, "sticky");
			},
			railButton: () => this.buttonEl(def.id),
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
		this.updatePanelPlace();
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
			this.updatePanelPlace();
		}
	}

	/** The open panel follows the rail (it opens over the text, which never moves). */
	private updatePanelPlace(): void {
		if (this.destroyed || !this.shell) return;
		if (this.railTop) this.shell.el.setCssProps({ "--sk-note-rail-top": this.railTop });
		if (this.railX) this.shell.el.setCssProps({ "--sk-note-rail-x": this.railX });
		else this.shell.el.style.removeProperty("--sk-note-rail-x");
		this.placeShell(this.shell);
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
