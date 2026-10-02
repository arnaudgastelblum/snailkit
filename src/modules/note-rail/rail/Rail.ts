// One rail per Markdown view, mounted in the view's content element (below the view header, so it
// stays put while the note scrolls and survives switches between Live Preview, Source and Reading).
// The rail owns the panel card; panels only fill the body and the footer.
import { MarkdownView, Platform, setIcon, type TFile } from "obsidian";
import { PANELS } from "../panels/registry";
import { clamp, railOrder, SHOW_KEY } from "../settings";
import type { HideReason, PanelContext, PanelDefinition, PanelId, PanelInstance, RailEnv } from "../types";
import { asElement, asNode, dur, popIn } from "./motion";
import { PanelShell } from "./PanelShell";
import { RoomController } from "./room";

/** Hover intent before a rail button replaces the open panel. */
const HOVER_SWITCH_MS = 160;
/** Hover delay before a rail tooltip shows. */
const TOOLTIP_MS = 420;
/** Short beat between a committed click and the close, so the click registers visually. */
const COMMIT_CLOSE_MS = 140;

interface RailButton {
	id: PanelId;
	el: HTMLElement;
	badgeEl: HTMLElement;
}

export class Rail {
	private hostEl: HTMLElement;
	private railEl: HTMLElement;
	private puckEl: HTMLElement;
	private tooltipEl: HTMLElement;
	private buttons = new Map<PanelId, RailButton>();
	private openId: PanelId | null = null;
	private shell: PanelShell | null = null;
	private instance: PanelInstance | null = null;
	private pinned = new Set<PanelId>();
	private file: TFile | null;
	private room: RoomController;
	private cleanups: (() => void)[] = [];
	private hoverSwitchTimer = 0;
	private tooltipTimer = 0;
	private commitTimer = 0;
	private resizeObserver: ResizeObserver | null = null;
	private destroyed = false;
	private closing = new Set<PanelShell>();
	private returnFocus: HTMLElement | null = null;

	constructor(
		private env: RailEnv,
		readonly view: MarkdownView,
	) {
		this.file = view.file;
		this.hostEl = view.contentEl;
		this.hostEl.addClass("sk-note-rail-host");
		this.railEl = this.hostEl.createDiv({ cls: "sk-note-rail", attr: { role: "toolbar" } });
		this.puckEl = this.railEl.createSpan("sk-note-rail-puck");
		this.tooltipEl = this.hostEl.createDiv({ cls: "sk-note-rail-tooltip", attr: { role: "tooltip" } });
		this.room = new RoomController(view);

		const doc = this.hostEl.ownerDocument;
		this.listen(doc, "pointerdown", (e) => this.onDocPointerDown(e as PointerEvent), true);
		this.listen(doc, "keydown", (e) => this.onDocKeyDown(e as KeyboardEvent), true);
		this.listen(this.railEl, "pointerleave", () => this.clearHoverTimers());

		const RO = doc.defaultView?.ResizeObserver;
		if (RO) {
			this.resizeObserver = new RO(() => this.updateRoom());
			this.resizeObserver.observe(this.hostEl);
		}

		this.applySettings();
	}

	private get position(): "left" | "right" {
		return this.env.settings.position === "right" ? "right" : "left";
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

		if (!this.openId) return;
		const def = PANELS[this.openId];
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

	toggle(id: PanelId, fromKeyboard = false): boolean {
		if (this.openId === id) {
			this.hide("escape");
			return true;
		}
		return this.open(id, fromKeyboard);
	}

	/** `fromKeyboard` moves the focus into the panel (and back to where it was on close). */
	open(id: PanelId, fromKeyboard = false): boolean {
		if (this.destroyed) return false;
		const def = PANELS[id];
		if (!this.isOpenable(def)) return false;
		if (this.openId === id) return true;
		window.clearTimeout(this.commitTimer);
		const swap = !!this.openId;
		const doc = this.hostEl.ownerDocument;
		const active = doc.activeElement as HTMLElement | null;
		const focusInPanel = !!(this.shell && active && this.shell.el.contains(active));
		const returnFocus = swap ? this.returnFocus : active && active !== doc.body ? active : null;
		if (swap) this.hide("switch", true);
		this.returnFocus = returnFocus;

		this.openId = id;
		const shell = new PanelShell(this.hostEl, def, this.env, this.pinned.has(id), () => this.togglePin(id));
		this.shell = shell;
		shell.el.addEventListener("pointerleave", (e) => {
			if (e.pointerType === "touch" || this.shell !== shell) return;
			this.safe(() => this.instance?.onPointerLeave?.());
		});
		// Keep the editor focus (and its selection) when clicking inside the card.
		shell.el.addEventListener("mousedown", (e) => {
			const t = e.target as HTMLElement;
			if (!t.closest("input, textarea, select, [contenteditable]")) e.preventDefault();
		});
		this.instance = this.createInstance(def, shell);

		this.hideTooltip();
		this.railEl.addClass("is-engaged");
		for (const b of this.buttons.values()) b.el.toggleClass("is-active", b.id === id);
		this.movePuck();
		shell.show(swap);
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
		this.room.destroy();
		this.railEl.remove();
		this.tooltipEl.remove();
		this.hostEl.removeClass("sk-note-rail-host", "sk-note-rail-right");
	}

	// ---- buttons -------------------------------------------------------------

	private applySettings(): void {
		this.hostEl.toggleClass("sk-note-rail-right", this.position === "right");
		this.railEl.style.setProperty("--sk-note-rail-rest", String(clamp(this.env.settings.restOpacity, 0.2, 1, 0.5)));
		this.renderButtons();
	}

	private isShown(id: PanelId): boolean {
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
		const current = Array.from(this.railEl.querySelectorAll<HTMLElement>(":scope > .sk-note-rail-btn"));
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
			b.el.toggleClass("is-active", this.openId === def.id);
			b.el.toggleClass("is-pinned", this.pinned.has(def.id));
		}
		const visible = wanted.some((d) => !this.buttons.get(d.id)!.el.hidden);
		this.railEl.toggleClass("is-empty", !visible);
		if (changed || this.openId) this.movePuck();
	}

	private createButton(def: PanelDefinition): RailButton {
		// No aria-label: Obsidian would show its own tooltip on top of ours. The name is hidden text.
		const el = createEl("button", { cls: "sk-note-rail-btn", attr: { "data-btn": def.id } });
		setIcon(el.createSpan("sk-note-rail-btn-icon"), def.icon);
		el.createSpan({ cls: "sk-note-rail-sr-only", text: this.env.t(`panel.${def.id}`) });
		const badgeEl = el.createSpan("sk-note-rail-badge is-zero");
		el.createSpan("sk-note-rail-pin-dot");

		el.addEventListener("click", (e) => {
			e.stopPropagation();
			this.clearHoverTimers();
			// detail 0 = activated with Enter or Space.
			this.toggle(def.id, e.detail === 0);
		});
		el.addEventListener("pointerenter", (e) => {
			if (e.pointerType === "touch") return;
			this.showTooltipSoon(el, def);
			window.clearTimeout(this.hoverSwitchTimer);
			if (this.openId && this.openId !== def.id) {
				this.hoverSwitchTimer = window.setTimeout(() => this.open(def.id), HOVER_SWITCH_MS);
			}
		});
		el.addEventListener("pointerleave", () => {
			this.hideTooltip();
			window.clearTimeout(this.hoverSwitchTimer);
		});
		return { id: def.id, el, badgeEl };
	}

	private movePuck(): void {
		const b = this.openId ? this.buttons.get(this.openId) : null;
		if (!b || b.el.hidden) {
			this.puckEl.removeClass("is-on");
			return;
		}
		this.puckEl.style.setProperty("--y", `${b.el.offsetTop}px`);
		this.puckEl.addClass("is-on");
	}

	private togglePin(id: PanelId): void {
		if (this.pinned.has(id)) this.pinned.delete(id);
		else this.pinned.add(id);
		const on = this.pinned.has(id);
		this.buttons.get(id)?.el.toggleClass("is-pinned", on);
		if (this.openId === id) this.shell?.setPinned(on);
	}

	// ---- tooltips ------------------------------------------------------------

	private showTooltipSoon(btn: HTMLElement, def: PanelDefinition): void {
		window.clearTimeout(this.tooltipTimer);
		if (this.openId || Platform.isMobile) return;
		this.tooltipTimer = window.setTimeout(() => {
			if (this.openId || !btn.isConnected) return;
			this.tooltipEl.setText(this.env.t(`panel.${def.id}`));
			const host = this.hostEl.getBoundingClientRect();
			const r = btn.getBoundingClientRect();
			const rail = this.railEl.getBoundingClientRect();
			this.tooltipEl.style.top = `${r.top - host.top + r.height / 2}px`;
			if (this.position === "right") {
				this.tooltipEl.style.left = "auto";
				this.tooltipEl.style.right = `${host.right - rail.left + 8}px`;
			} else {
				this.tooltipEl.style.right = "auto";
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
		const live = () => this.shell === shell;
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
		this.instance = this.createInstance(PANELS[id], shell);
		shell.staggerBody();
		this.updateRoom();
	}

	private hide(reason: HideReason, swapping = false): void {
		const id = this.openId;
		const shell = this.shell;
		const instance = this.instance;
		if (!id || !shell) return;
		window.clearTimeout(this.commitTimer);
		this.openId = null;
		this.shell = null;
		this.instance = null;
		this.safe(() => instance?.onHide?.(reason));
		const instant = reason === "unload" || !this.hostEl.isConnected;
		// The panel had the focus: hand it back (a commit already moved it to the editor).
		const doc = this.hostEl.ownerDocument;
		if (!swapping && doc.activeElement && shell.el.contains(doc.activeElement)) {
			const back = this.returnFocus?.isConnected ? this.returnFocus : this.buttons.get(id)?.el;
			back?.focus({ preventScroll: true });
		}
		if (!swapping) this.returnFocus = null;
		this.closing.add(shell);
		shell.hide(swapping, instant, () => {
			this.closing.delete(shell);
			this.safe(() => instance?.destroy());
		});
		this.buttons.get(id)?.el.removeClass("is-active");
		if (!swapping) {
			this.railEl.removeClass("is-engaged");
			this.movePuck();
			this.updateRoom();
		}
	}

	private updateRoom(): void {
		if (this.destroyed) return;
		this.room.update(this.shell?.el ?? null, this.position, this.env.settings.makeRoom !== false);
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
		if (!inPanel && !active) return;
		e.preventDefault();
		e.stopPropagation();
		this.hide("escape");
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
