// Idea sessions (with the Idea sessions module): start a session, close or reopen the one open
// here, the sessions still waiting to be sorted, and a way to all of them in the Workbench.
import { Keymap, Notice, setIcon, TFile } from "obsidian";
import { asElement } from "../../rail/motion";
import type { PanelContext, PanelDefinition, PanelInstance, RailEnv, SessionsService } from "../../types";
import { workbenchFooter } from "../workbench-link";
import { sessionsToSort, toSortCount } from "./list";

/** The "sessions" service when it is there and speaks version 1. */
export function sessionsOf(env: Pick<RailEnv, "service">): SessionsService | null {
	const s = env.service<SessionsService>("sessions");
	return s && s.version === 1 ? s : null;
}

export const sessionPanel: PanelDefinition = {
	id: "session",
	icon: "zap",
	isAvailable: (env) => !!sessionsOf(env),
	create: (ctx, body) => new SessionPanel(ctx, body),
};

type Action = () => void;

class SessionPanel implements PanelInstance {
	private actions = new Map<HTMLElement, (e: MouseEvent | KeyboardEvent) => void>();
	private cleanups: (() => void)[] = [];
	private destroyed = false;
	private timer = 0;

	constructor(private ctx: PanelContext, private body: HTMLElement) {
		body.addClass("sk-note-rail-session-panel");
		this.listen("click", (e) => this.activate(e as MouseEvent));
		this.listen("auxclick", (e) => {
			if ((e as MouseEvent).button === 1) this.activate(e as MouseEvent);
		});
		this.listen("keydown", (e) => this.onKey(e as KeyboardEvent));
		const off = sessionsOf(ctx)?.onChange?.(() => this.refresh());
		if (off) this.cleanups.push(off);
		this.build();
	}

	refresh(): void {
		if (this.destroyed) return;
		this.body.win.clearTimeout(this.timer);
		this.timer = this.body.win.setTimeout(() => this.build(), 60);
	}

	destroy(): void {
		this.destroyed = true;
		this.body.win.clearTimeout(this.timer);
		for (const c of this.cleanups) c();
		this.cleanups = [];
		this.actions.clear();
		this.body.empty();
	}

	private listen(type: string, fn: (e: Event) => void): void {
		this.body.addEventListener(type, fn);
		this.cleanups.push(() => this.body.removeEventListener(type, fn));
	}

	private build(): void {
		const sessions = sessionsOf(this.ctx);
		if (this.destroyed || !sessions) return;
		const t = this.ctx.t.bind(this.ctx);
		const focusKey = asElement(this.body.doc.activeElement)?.closest<HTMLElement>("[data-key]")?.dataset.key;
		this.body.empty();
		this.actions.clear();

		const file = this.ctx.view.file;
		const here = !!file && sessions.isSession(file);
		const closed = here && !!file && sessions.isClosed(file);
		this.row(this.body, "plus", t("session.new"), "new", () => this.run(() => void sessions.start()), "is-primary");
		if (here && file) {
			this.row(this.body, closed ? "rotate-ccw" : "check-circle-2", t(closed ? "session.reopen" : "session.close"), "state", () => this.run(() => (closed ? sessions.reopen(file) : sessions.close(file))));
		}

		const all = typeof sessions.list === "function" ? this.safeList(sessions) : null;
		const waiting = sessionsToSort(all);
		if (all) {
			const head = this.body.createDiv("sk-note-rail-section");
			head.createSpan({ text: t("session.to-sort") });
			const total = toSortCount(all);
			if (total) head.createSpan({ cls: "sk-note-rail-count", text: String(total) });
			if (!waiting.length) this.body.createDiv({ cls: "sk-note-rail-empty", text: t("session.none") });
			for (const s of waiting) {
				const counts = [this.ctx.tn("session.tasks", s.tasks)];
				if (s.undecided) counts.push(this.ctx.tn("session.undecided", s.undecided));
				const el = this.row(this.body, null, s.title, `s:${s.path}`, (e) => this.openSession(s.path, e));
				el.addClass("sk-note-rail-session-row");
				el.setAttr("title", s.path);
				el.createSpan({ cls: "sk-note-rail-row-meta", text: counts.join(" · ") });
			}
		}

		this.ctx.setCount(null);
		this.ctx.setSubtitle(here && file ? file.basename : "");
		this.ctx.setFooter(workbenchFooter(this.ctx, { tab: "sessions" }, t("rail.workbench-tip-sessions")));

		if (focusKey) this.body.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
	}

	private safeList(sessions: SessionsService) {
		try {
			return sessions.list!();
		} catch (err) {
			console.error("[Snailkit] note-rail: sessions list", err);
			return null;
		}
	}

	/** A focusable row: icon, label, then whatever the caller adds. */
	private row(parent: HTMLElement, icon: string | null, label: string, key: string, run: (e: MouseEvent | KeyboardEvent) => void, extra = ""): HTMLElement {
		const el = key.startsWith("s:")
			? parent.createDiv({ cls: "sk-note-rail-row sk-note-rail-session-row", attr: { tabindex: "0", role: "button", "data-key": key, "data-nav": "" } })
			: parent.createEl("button", { cls: `sk-btn sk-note-rail-session-action ${extra}`.trim(), attr: { type: "button", tabindex: "0", role: "button", "data-key": key, "data-nav": "" } });
		if (icon) setIcon(el.createSpan("sk-note-rail-session-icon"), icon);
		el.createSpan({ cls: "sk-note-rail-row-title", text: label });
		this.actions.set(el, run);
		return el;
	}

	/** Run an action, then close the panel (it led somewhere else). */
	private run(action: Action): void {
		try {
			action();
		} finally {
			if (!this.destroyed) this.ctx.close("commit");
		}
	}

	private openSession(path: string, e: MouseEvent | KeyboardEvent): void {
		const file = this.ctx.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const newTab = Keymap.isModEvent(e) || ("button" in e && e.button === 1);
		const leaf = newTab ? this.ctx.app.workspace.getLeaf("tab") : this.ctx.view.leaf;
		void leaf.openFile(file).catch(() => new Notice(this.ctx.t("panel.open-error", { name: file.basename })));
		if (!this.destroyed) this.ctx.close("commit");
	}

	private activate(e: MouseEvent): void {
		const el = asElement(e.target)?.closest<HTMLElement>("[data-key]");
		const run = el ? this.actions.get(el) : undefined;
		if (!run) return;
		e.preventDefault();
		run(e);
	}

	/** Up and Down move, Home and End jump, Enter or Space runs (Ctrl or Cmd Enter: a new tab). */
	private onKey(e: KeyboardEvent): void {
		const items = Array.from(this.body.querySelectorAll<HTMLElement>("[data-nav]"));
		const current = asElement(e.target)?.closest<HTMLElement>("[data-nav]");
		const i = current ? items.indexOf(current) : -1;
		let next: HTMLElement | undefined;
		if (e.key === "ArrowDown") next = items[Math.min(items.length - 1, i + 1)];
		else if (e.key === "ArrowUp") next = items[Math.max(0, i - 1)];
		else if (e.key === "Home") next = items[0];
		else if (e.key === "End") next = items[items.length - 1];
		else if ((e.key === "Enter" || e.key === " ") && current) {
			const run = this.actions.get(current);
			if (!run) return;
			e.preventDefault();
			if (!e.repeat) run(e);
			return;
		} else return;
		e.preventDefault();
		next?.focus({ preventScroll: false });
	}
}
