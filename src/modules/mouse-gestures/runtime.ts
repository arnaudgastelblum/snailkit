// Mouse gestures: hold the right button, draw, release, and the action runs on the tab under the
// pointer. Listens in every window (popouts too), in the capture phase, so that no view hides the
// button from it. A right-click that draws nothing is left alone and opens its menu as usual.
import { Component, type WorkspaceLeaf } from "obsidian";
import type { ModuleContext } from "../../core/context";
import { isSideLeaf } from "../../core/workbench/state";
import { GestureTracker, actionFor, arrows, cleanCustom, customFor, type ActionId } from "./logic";
import { commandName, runCommand } from "./commands";
import { openLauncher, type LauncherOrigin } from "./launcher";
import type { MouseGesturesSettings } from "./types";

/** Commands run by each action, so that a gesture does exactly what its command does. */
const COMMANDS: Partial<Record<ActionId, string>> = {
	close: "workspace:close",
	reopen: "workspace:undo-close-pane",
	back: "app:go-back",
	forward: "app:go-forward",
	newTab: "workspace:new-tab",
	nextTab: "workspace:next-tab",
	prevTab: "workspace:previous-tab",
	// Home's New note window: it proposes a parent from the note the gesture was drawn on.
	newNote: "snailkit:home-new-note",
};

/** Workbench tabs: the open Workbench comes forward on that tab (a new one opens when there is none). */
const TABS: Partial<Record<ActionId, string>> = { home: "home", tasks: "tasks", brainstorm: "sessions" };

/** How long after a gesture the context menu that follows the release is swallowed (Windows). */
const SWALLOW_MS = 500;

interface Press {
	win: Window;
	/** The tab the gesture acts on, found when the button went down. */
	leaf: WorkspaceLeaf | null;
	tracker: GestureTracker;
	/** The context menu held back while the button is down (macOS and Linux open it on press). */
	menu: MouseEvent | null;
	trail: Trail | null;
	cancelled: boolean;
}

export class Gestures {
	private press: Press | null = null;
	/** After a gesture on Windows, the context menu still to come from that window is swallowed. */
	private swallow: { win: Window; until: number } | null = null;
	private replaying = false;

	constructor(private readonly ctx: ModuleContext<MouseGesturesSettings>) {
		// One set of listeners per window, dropped when its popout closes.
		const windows = new Map<Window, Component>();
		const listen = (win: Window | null) => {
			if (!win || windows.has(win)) return;
			const listeners = ctx.addChild(new Component());
			windows.set(win, listeners);
			const capture = { capture: true };
			// The main window also hears the events of popout windows: each window handles only its own.
			const own = (e: Event) => windowOf(e.target) === win;
			listeners.registerDomEvent(win, "mousedown", (e) => { if (own(e)) this.onDown(win, e); }, capture);
			listeners.registerDomEvent(win, "mousemove", (e) => { if (own(e)) this.onMove(e); }, capture);
			listeners.registerDomEvent(win, "mouseup", (e) => { if (own(e)) this.onUp(e); }, capture);
			listeners.registerDomEvent(win, "contextmenu", (e) => { if (own(e)) this.onMenu(win, e); }, capture);
			listeners.registerDomEvent(win, "keydown", (e) => { if (own(e)) this.onKey(e); }, capture);
			listeners.registerDomEvent(win, "blur", (e) => { if (own(e) && this.press?.win === win) this.drop(); });
		};
		const forget = (win: Window) => {
			if (this.press?.win === win) this.drop();
			if (this.swallow?.win === win) this.swallow = null;
			const listeners = windows.get(win);
			if (listeners) ctx.removeChild(listeners);
			windows.delete(win);
		};
		listen(window);
		ctx.app.workspace.iterateAllLeaves((leaf) => listen(leaf.view.containerEl.ownerDocument.defaultView));
		ctx.registerEvent(ctx.app.workspace.on("window-open", (w) => listen(w.win)));
		ctx.registerEvent(ctx.app.workspace.on("window-close", (w) => forget(w.win)));
		ctx.register(() => this.drop());
	}

	private onDown(win: Window, e: MouseEvent): void {
		if (this.press) {
			// Another button while drawing cancels the gesture.
			if (e.button !== 2) this.cancel();
			return;
		}
		this.swallow = null;
		const target = e.target as Element | null;
		if (e.button !== 2 || target?.nodeType !== 1) return;
		// Only over the workspace: menus, windows and the settings keep their own right-click.
		if (!target.closest(".workspace")) return;
		this.press = { win, leaf: this.leafFor(target), tracker: new GestureTracker(e.clientX, e.clientY), menu: null, trail: null, cancelled: false };
	}

	private onMove(e: MouseEvent): void {
		const press = this.press;
		if (!press) return;
		// The button was released where we could not hear it.
		if ((e.buttons & 2) === 0) return this.drop();
		const changed = press.tracker.move(e.clientX, e.clientY);
		const gesture = press.tracker.gesture;
		if (press.cancelled || !gesture || !this.ctx.settings.trail) return;
		press.trail ??= new Trail(press.win);
		if (changed) {
			const action = actionFor(this.ctx.settings, gesture);
			const custom = action ? null : customFor(cleanCustom(this.ctx.settings.custom), gesture);
			if (custom) {
				// A command of the user: its name, or "not available" while its plugin is off.
				const name = commandName(this.ctx.app, custom.command);
				press.trail.label(arrows(gesture), name ?? this.ctx.t("hint.missing"), name !== null);
			} else {
				const name = action ? this.ctx.t(`action.${action}`) : this.ctx.t("hint.none");
				const ready = action !== null && this.available(action);
				press.trail.label(arrows(gesture), action && !ready ? this.ctx.t("hint.off", { action: name }) : name, ready);
			}
		}
		press.trail.draw(press.tracker.points);
	}

	private onUp(e: MouseEvent): void {
		const press = this.press;
		if (!press || e.button !== 2) return;
		this.press = null;
		const gesture = press.cancelled ? "" : press.tracker.gesture;
		if (!gesture && !press.cancelled) {
			// A plain right-click: its menu opens now if it was held back.
			press.trail?.remove();
			if (press.menu) this.replay(press.menu);
			return;
		}
		// macOS and Linux already sent their menu during the press: nothing more to swallow.
		if (!press.menu) this.swallow = { win: press.win, until: Date.now() + SWALLOW_MS };
		const action = gesture ? actionFor(this.ctx.settings, gesture) : null;
		const custom = gesture && !action ? customFor(cleanCustom(this.ctx.settings.custom), gesture) : null;
		const command = custom && commandName(this.ctx.app, custom.command) !== null ? custom.command : null;
		press.trail?.leave(action !== null || command !== null);
		if (action) this.run(action, press.leaf, { x: e.clientX, y: e.clientY });
		else if (command && this.focus(press.leaf)) runCommand(this.ctx.app, command);
	}

	private onMenu(win: Window, e: MouseEvent): void {
		if (this.replaying) return;
		const press = this.press;
		const swallow = this.swallow;
		if ((swallow?.win === win && swallow.until > Date.now() && e.button === 2) || press?.menu) {
			this.swallow = null;
			e.preventDefault();
			e.stopImmediatePropagation();
			return;
		}
		if (press) {
			press.menu = e;
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	}

	private onKey(e: KeyboardEvent): void {
		if (e.key !== "Escape" || !this.press?.tracker.gesture || this.press.cancelled) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		this.cancel();
	}

	/** Stops drawing; the release that follows does nothing and opens no menu. */
	private cancel(): void {
		if (!this.press) return;
		this.press.cancelled = true;
		this.press.trail?.remove();
		this.press.trail = null;
	}

	/** Forgets the press entirely (module off, window left, button released out of reach). */
	private drop(): void {
		this.press?.trail?.remove();
		this.press = null;
	}

	/** Opens the context menu that was held back, where it was asked for. */
	private replay(menu: MouseEvent): void {
		const target = menu.target as Element | null;
		const view = target?.ownerDocument?.defaultView;
		if (!target || !view) return;
		const event = new view.MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			composed: true,
			view,
			button: 2,
			clientX: menu.clientX,
			clientY: menu.clientY,
			screenX: menu.screenX,
			screenY: menu.screenY,
			ctrlKey: menu.ctrlKey,
			shiftKey: menu.shiftKey,
			altKey: menu.altKey,
			metaKey: menu.metaKey,
		});
		this.replaying = true;
		try {
			target.dispatchEvent(event);
		} finally {
			this.replaying = false;
		}
	}

	/** Snailkit actions need their tool on (Home, Tasks, Brainstorm); Obsidian's are always there. */
	private available(action: ActionId): boolean {
		if (action === "launcher") return true;
		const tab = TABS[action];
		if (tab) return this.ctx.workbench.hasTab(tab);
		const id = COMMANDS[action];
		return !!id && !!this.commands()?.commands?.[id];
	}

	private commands(): { commands?: Record<string, unknown>; executeCommandById?(id: string): boolean } | undefined {
		return (this.ctx.app as unknown as { commands?: { commands?: Record<string, unknown>; executeCommandById?(id: string): boolean } }).commands;
	}

	/** `at`: where the gesture ended (the launcher springs from there). */
	private run(action: ActionId, leaf: WorkspaceLeaf | null, at: LauncherOrigin | null = null): void {
		if (!this.available(action) || !this.focus(leaf)) return;
		const tab = TABS[action];
		if (action === "launcher") openLauncher(this.ctx, at);
		else if (tab) void this.ctx.workbench.open({ tab });
		else this.commands()?.executeCommandById?.(COMMANDS[action] ?? "");
	}

	/**
	 * Makes the tab of the gesture the active one, so that the command acts on it. False when that
	 * tab was closed while drawing (Ctrl+W...): acting on another one would surprise.
	 */
	private focus(leaf: WorkspaceLeaf | null): boolean {
		if (!leaf) return true;
		let open = false;
		this.ctx.app.workspace.iterateAllLeaves((l) => { open ||= l === leaf; });
		if (!open) return false;
		this.ctx.app.workspace.setActiveLeaf(leaf, { focus: true });
		return true;
	}

	/**
	 * The tab the gesture was drawn on (its content or its header). Over a side panel or outside
	 * any tab: the visible tab of the same tab group, else the note's tab of the main area.
	 */
	private leafFor(target: Element): WorkspaceLeaf | null {
		const ws = this.ctx.app.workspace;
		let hit: WorkspaceLeaf | null = null;
		ws.iterateAllLeaves((leaf) => {
			if (hit) return;
			const header = (leaf as unknown as { tabHeaderEl?: HTMLElement }).tabHeaderEl;
			if (leaf.view.containerEl.contains(target) || header?.contains(target)) hit = leaf;
		});
		if (hit && !isSideLeaf(this.ctx.app, hit)) return hit;
		const group = target.closest(".workspace-tabs");
		if (group && !hit) {
			let shown: WorkspaceLeaf | null = null;
			ws.iterateAllLeaves((leaf) => {
				if (!shown && group.contains(leaf.view.containerEl) && leaf.view.containerEl.isShown() && !isSideLeaf(this.ctx.app, leaf)) shown = leaf;
			});
			if (shown) return shown;
		}
		return ws.getMostRecentLeaf();
	}
}

/** The window an event belongs to: a node's own window, a document's, or the window itself. */
function windowOf(target: EventTarget | null): Window | null {
	if (!target) return null;
	const node = target as { ownerDocument?: Document | null; defaultView?: Window | null };
	return node.ownerDocument?.defaultView ?? node.defaultView ?? (target as Window);
}

/** The line being drawn and the name of its action, over the whole window. */
class Trail {
	private readonly el: HTMLElement;
	private readonly line: SVGPolylineElement;
	private readonly hint: HTMLElement;
	private readonly arrowsEl: HTMLElement;
	private readonly nameEl: HTMLElement;
	private points: ReadonlyArray<readonly [number, number]> = [];
	private frame = 0;

	constructor(private readonly win: Window) {
		this.el = win.document.body.createDiv({ cls: "sk-mouse-gestures" });
		const svg = this.el.createSvg("svg", { attr: { "aria-hidden": "true" } });
		this.line = svg.createSvg("polyline", { cls: "sk-mouse-gestures-line" });
		this.hint = this.el.createDiv({ cls: "sk-mouse-gestures-hint" });
		this.arrowsEl = this.hint.createSpan({ cls: "sk-mouse-gestures-arrows" });
		this.nameEl = this.hint.createSpan({ cls: "sk-mouse-gestures-name" });
	}

	label(arrows: string, name: string, known: boolean): void {
		this.arrowsEl.setText(arrows);
		this.nameEl.setText(name);
		this.hint.toggleClass("is-unknown", !known);
	}

	/** Draws on the next frame: many moves, one paint. */
	draw(points: ReadonlyArray<readonly [number, number]>): void {
		this.points = points;
		if (this.frame) return;
		this.frame = this.win.requestAnimationFrame(() => {
			this.frame = 0;
			this.paint();
		});
	}

	private paint(): void {
		const points = this.points;
		const last = points[points.length - 1];
		if (!last) return;
		this.line.setAttribute("points", points.map(([x, y]) => `${x},${y}`).join(" "));
		// The name follows the pointer, below and to the right, kept inside the window.
		const width = this.hint.offsetWidth;
		const height = this.hint.offsetHeight;
		const x = Math.min(last[0] + 18, this.win.innerWidth - width - 8);
		const y = Math.min(last[1] + 20, this.win.innerHeight - height - 8);
		this.hint.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
		this.hint.addClass("is-shown");
	}

	/** Fades out after the release; `done` when an action runs. */
	leave(done: boolean): void {
		if (this.frame) this.win.cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.paint();
		this.el.addClass("is-leaving");
		this.el.toggleClass("is-done", done);
		this.win.setTimeout(() => this.el.remove(), 320);
	}

	remove(): void {
		if (this.frame) this.win.cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.el.remove();
	}
}
