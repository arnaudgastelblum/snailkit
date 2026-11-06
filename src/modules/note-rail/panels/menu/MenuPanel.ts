// The Snailkit menu, at the top of the rail: everything that leads out of the note (Home, Tasks,
// Brainstorms, Search, today's note, the Calendar, the settings), each row shown only while its
// module runs. Brainstorms and Calendar are sub-panels: the card glides to them, a back arrow
// returns here.
import { Notice, Platform } from "obsidian";
import { moment } from "../../../../core/moment";
import { commandHotkeys, hotkeyText, type HotkeyLike } from "../../rail/entry";
import type { PanelContext, PanelDefinition, PanelInstance } from "../../types";
import { getDailyConfig, getOrCreateDailyNote } from "../calendar/daily";
import { RowList, wantsNewTab } from "../rows";
import { homeOf, searchOf } from "../services";
import { sessionsOf } from "../session/SessionPanel";
import { toSortCount } from "../session/list";

/** The Search module's command (its hotkey shows next to the Search row). */
const SEARCH_COMMAND = "snailkit:search-open";

export const menuPanel: PanelDefinition = {
	id: "menu",
	icon: "snailkit-snail",
	isAvailable: () => true,
	create: (ctx, body) => new MenuPanel(ctx, body),
};

class MenuPanel implements PanelInstance {
	private rows: RowList;
	private cleanups: (() => void)[] = [];
	private destroyed = false;
	private timer = 0;

	constructor(private ctx: PanelContext, private body: HTMLElement) {
		body.addClass("sk-note-rail-menu");
		this.rows = new RowList(body);
		const off = sessionsOf(ctx)?.onChange?.(() => this.refresh());
		if (off) this.cleanups.push(off);
		this.build();
	}

	refresh(): void {
		if (this.destroyed) return;
		this.body.win.clearTimeout(this.timer);
		this.timer = this.body.win.setTimeout(() => this.build(), 60);
	}

	onVaultTasks(): void {
		this.refresh();
	}

	destroy(): void {
		this.destroyed = true;
		this.body.win.clearTimeout(this.timer);
		for (const c of this.cleanups) c();
		this.cleanups = [];
		this.rows.destroy();
		this.body.empty();
	}

	private build(): void {
		if (this.destroyed) return;
		const { ctx } = this;
		const t = ctx.t.bind(ctx);
		const focusKey = this.rows.focusedKey();
		this.body.empty();
		this.rows.clear();

		const home = homeOf(ctx);
		if (home) this.rows.row(this.body, t("menu.home"), "home", () => this.leave(() => void home.open()), { icon: "house" });

		if (ctx.hasWorkbenchTab("tasks")) {
			const counts = ctx.vaultTasks();
			const meta = counts ? [counts.overdue ? ctx.tn("tasks.summary-overdue", counts.overdue) : "", counts.today ? ctx.tn("tasks.summary-today", counts.today) : ""].filter(Boolean).join(" · ") : "";
			this.rows.row(this.body, t("menu.tasks"), "tasks", () => this.leave(() => ctx.openWorkbench({ tab: "tasks" })), { icon: "list-checks", meta });
		}

		const sessions = sessionsOf(ctx);
		if (sessions) {
			const all = typeof sessions.list === "function" ? this.safe(() => sessions.list!(), null) : null;
			const waiting = all ? toSortCount(all) : 0;
			this.rows.row(this.body, t("menu.sessions"), "sessions", (e) => ctx.openPanel("session", !("button" in e)), {
				icon: "zap", chevron: true, meta: waiting ? ctx.tn("menu.to-sort", waiting) : "",
			});
		}

		const search = searchOf(ctx);
		if (search) {
			this.rows.row(this.body, t("menu.search"), "search", () => this.openSearch(), { icon: "search", meta: this.searchKeys() });
		}

		const todayKey = moment().format("YYYY-MM-DD");
		const onToday = ctx.view.file?.path === this.todayPath();
		this.rows.row(this.body, t("menu.today"), "today", (e) => void this.openToday(e), {
			icon: "sun", meta: moment(todayKey).format("ll"), cls: onToday ? "is-lit" : "",
		});
		if (ctx.settings.showCalendar !== false) {
			this.rows.row(this.body, t("menu.calendar"), "calendar", (e) => ctx.openPanel("calendar", !("button" in e)), { icon: "calendar-days", chevron: true });
		}

		this.body.createDiv("sk-note-rail-menu-sep");
		this.rows.row(this.body, t("menu.settings"), "settings", () => this.leave(() => ctx.openSettings()), { icon: "settings" });

		this.rows.focus(focusKey);
	}

	/** Run an action that leads somewhere else, then close the panel. */
	private leave(action: () => void): void {
		try {
			action();
		} finally {
			if (!this.destroyed) this.ctx.close("commit");
		}
	}

	/** The floating search, growing from the rail button. Shift+Enter there links into this note. */
	private openSearch(): void {
		const search = searchOf(this.ctx);
		if (!search) return;
		const file = this.ctx.view.file;
		const editor = this.ctx.view.getMode() === "source" ? this.ctx.view.editor : null;
		const anchor = this.ctx.railButton() ?? undefined;
		this.leave(() => search.open({ anchor, from: file ? { file, editor } : null }));
	}

	private searchKeys(): string {
		const manager = (this.ctx.app as unknown as {
			hotkeyManager?: { getHotkeys?(id: string): HotkeyLike[] | undefined; getDefaultHotkeys?(id: string): HotkeyLike[] | undefined };
		}).hotkeyManager;
		return this.safe(() => hotkeyText(commandHotkeys(manager?.getHotkeys?.(SEARCH_COMMAND), manager?.getDefaultHotkeys?.(SEARCH_COMMAND)), Platform.isMacOS), "");
	}

	private todayPath(): string {
		const cfg = getDailyConfig(this.ctx.app, this.ctx.settings);
		return (cfg.folder ? cfg.folder + "/" : "") + moment().format(cfg.format) + ".md";
	}

	private async openToday(e: MouseEvent | KeyboardEvent): Promise<void> {
		const { ctx } = this;
		try {
			const cfg = getDailyConfig(ctx.app, ctx.settings);
			const file = await getOrCreateDailyNote(ctx.app, moment().format("YYYY-MM-DD"), cfg);
			if (this.destroyed) return;
			const newTab = wantsNewTab(e);
			if (!newTab && ctx.view.file?.path === file.path) {
				ctx.close("escape");
				return;
			}
			const leaf = newTab ? ctx.app.workspace.getLeaf("tab") : ctx.view.leaf;
			ctx.close("commit");
			await leaf.openFile(file);
		} catch (err) {
			console.error("[Snailkit] note-rail: today's note", err);
			new Notice(ctx.t("rail.today-error"));
		}
	}

	private safe<T>(fn: () => T, fallback: T): T {
		try {
			return fn();
		} catch (err) {
			console.error("[Snailkit] note-rail: menu", err);
			return fallback;
		}
	}
}
