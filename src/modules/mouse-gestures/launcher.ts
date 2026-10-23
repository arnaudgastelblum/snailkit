// The launcher: the window of the ↓ gesture (and of its command). A field that opens a note or
// names a new one, the tabs open now, the brainstorms in progress, then Snailkit's ways to create
// (brainstorm, task, note) and to go (Home, Tasks, Brainstorms). It springs from where the gesture
// ended, its rows come in one after the other, and the gliding cursor of Home takes the hue of
// each note's domain. Every service is optional: what its tool does not offer is not shown.
import { Modal, Platform, prepareFuzzySearch, setIcon, TFile, type EventRef, type SearchResult, type WorkspaceLeaf } from "obsidian";
import type { ModuleContext } from "../../core/context";
import { moment } from "../../core/moment";
import type { PlacesService } from "../../core/places/types";
import type { HomeService, SessionsReader, TasksReader } from "../../core/services";
import { isSideLeaf } from "../../core/workbench/state";
import { Surface } from "../../ui/surface";
import { crumb, recentTabs } from "./launcher-logic";
import type { MouseGesturesSettings } from "./types";

type Ctx = ModuleContext<MouseGesturesSettings>;

/** Where the window springs from: the end of the gesture, in the window's coordinates. */
export interface LauncherOrigin {
	x: number;
	y: number;
}

interface Row {
	el: HTMLElement;
	/** What Enter or a click does; `tab`: Ctrl/Cmd held, in a new tab. */
	run(tab: boolean): void;
}

const OPEN_TABS = 5;
const STORMS = 3;
const HITS = 8;

/** Opens the launcher (one at a time: a second call brings the field back). */
export function openLauncher(ctx: Ctx, origin: LauncherOrigin | null = null): void {
	if (Launcher.current) {
		Launcher.current.focusField();
		return;
	}
	new Launcher(ctx, origin).open();
}

/** Closes the launcher if it is open (the module stops). */
export function closeLauncher(): void {
	Launcher.current?.close();
}

class Launcher extends Modal {
	static current: Launcher | null = null;
	private input!: HTMLInputElement;
	private listEl!: HTMLElement;
	private createEl!: HTMLElement;
	private goEl!: HTMLElement;
	private readonly uid = `sk-launcher-${Date.now()}`;
	/** The tiles and the bar follow the tools turned on or off while the launcher is open. */
	private servicesRef: EventRef | null = null;
	private surface: Surface | null = null;
	private rows: Row[] = [];
	private hi = 0;
	/** The path of the tab the launcher was opened from: it is not offered again. */
	private readonly here: string | null;

	constructor(
		private readonly ctx: Ctx,
		private readonly origin: LauncherOrigin | null,
	) {
		super(ctx.app);
		this.here = ctx.app.workspace.getActiveFile()?.path ?? null;
	}

	private t(key: string, vars?: Record<string, string | number>): string {
		return this.ctx.t(key, vars);
	}

	private tn(key: string, count: number): string {
		return this.ctx.tn(key, count, { count });
	}

	private service<T>(name: string): T | null {
		const s = this.ctx.service<T & { version?: number }>(name);
		return s && s.version === 1 ? s : null;
	}

	focusField(): void {
		this.input?.focus();
	}

	open(): void {
		Launcher.current = this;
		super.open();
	}

	onOpen(): void {
		try {
			this.draw();
		} catch (error) {
			console.error("[Snailkit] mouse gestures: the launcher could not open", error);
			this.close();
		}
	}

	onClose(): void {
		if (Launcher.current === this) Launcher.current = null;
		if (this.servicesRef) this.app.workspace.offref(this.servicesRef);
		this.servicesRef = null;
		this.surface?.destroy();
		this.surface = null;
		this.contentEl.empty();
	}

	private draw(): void {
		const { modalEl, contentEl, containerEl } = this;
		containerEl.addClass("sk-launcher-host");
		modalEl.addClass("sk-launcher");
		modalEl.toggleClass("is-phone", Platform.isPhone);
		// Named by hidden texts: an aria-label would show as a tooltip over the window, the field, the list.
		const uid = this.uid;
		contentEl.createSpan({ cls: "sk-launcher-sr", text: this.t("launcher.label"), attr: { id: `${uid}-name` } });
		contentEl.createSpan({ cls: "sk-launcher-sr", text: this.t("launcher.placeholder"), attr: { id: `${uid}-field` } });
		modalEl.setAttr("aria-labelledby", `${uid}-name`);

		const field = contentEl.createDiv({ cls: "sk-launcher-field sk-launcher-in" });
		setIcon(field.createSpan({ cls: "sk-launcher-field-icon" }), "search");
		this.input = field.createEl("input", { cls: "sk-launcher-input", attr: { type: "text", spellcheck: "false", autocomplete: "off", placeholder: this.t("launcher.placeholder"), "aria-labelledby": `${uid}-field`, role: "combobox", "aria-expanded": "true", "aria-autocomplete": "list", "aria-controls": `${uid}-list` } });
		this.input.addEventListener("input", () => this.renderList(false));
		this.input.addEventListener("keydown", (e) => this.onKey(e));

		this.createEl = contentEl.createDiv({ cls: "sk-launcher-create" });
		this.drawCreate();
		this.listEl = contentEl.createDiv({ cls: "sk-launcher-list", attr: { role: "listbox", id: `${uid}-list`, "aria-labelledby": `${uid}-name` } });
		this.surface = new Surface(this.listEl, {
			itemSelector: "[data-nav]",
			// The pointer leaving the list leaves the cursor where it was: Enter still runs that row.
			sticky: () => true,
			onSet: (el) => {
				const i = this.rows.findIndex((r) => r.el === el);
				if (i >= 0) this.mark(i);
			},
		});
		this.renderList(true);
		this.goEl = contentEl.createDiv({ cls: "sk-launcher-go sk-launcher-in" });
		this.drawGo();
		const ws = this.app.workspace as unknown as { on(name: string, callback: () => void): EventRef };
		this.servicesRef = ws.on("snailkit:services-changed", () => {
			this.drawCreate();
			this.drawGo();
		});

		// Each piece comes in after the other, the first ones while the window is still landing.
		let i = 0;
		for (const el of Array.from(contentEl.querySelectorAll<HTMLElement>(".sk-launcher-in"))) el.setCssProps({ "--sk-i": String(i++) });
		this.spring();
		this.input.focus();
	}

	/** The system asks for less motion: no spring, no rows coming in. */
	private still(): boolean {
		const win = this.modalEl.ownerDocument.defaultView;
		return !win || win.matchMedia("(prefers-reduced-motion: reduce)").matches;
	}

	/** The window springs out of the end of the gesture (centered when opened by its command). */
	private spring(): void {
		if (this.still()) return;
		this.modalEl.addClass("is-arriving");
		const r = this.modalEl.getBoundingClientRect();
		const dx = this.origin ? this.origin.x - (r.left + r.width / 2) : 0;
		const dy = this.origin ? this.origin.y - (r.top + r.height / 2) : 24;
		const from = this.origin ? 0.12 : 0.94;
		this.modalEl.animate(
			[
				{ transform: `translate(${dx}px, ${dy}px) scale(${from})`, opacity: 0 },
				{ transform: "translate(0, 0) scale(1)", opacity: 1 },
			],
			{ duration: this.origin ? 560 : 320, easing: "cubic-bezier(0.2, 1.3, 0.35, 1)" },
		);
	}

	// ----- create -----

	/** One tile per tool that offers it. A tile reads its tool again when pressed: it may have stopped since. */
	private drawCreate(): void {
		const first = !this.createEl.hasChildNodes();
		this.createEl.empty();
		const tiles: Array<[string, string, () => (() => void) | null]> = [
			["zap", this.t("launcher.new-brainstorm"), () => {
				const s = this.service<SessionsReader>("sessions");
				return s?.start ? () => void s.start?.() : null;
			}],
			["square-check", this.t("launcher.new-task"), () => {
				const s = this.service<TasksReader>("tasks");
				return s?.newTask ? () => void s.newTask?.() : null;
			}],
			["file-plus", this.t("launcher.new-note"), () => {
				const s = this.service<HomeService>("home");
				return s?.newNote ? () => s.newNote?.() : null;
			}],
		];
		for (const [icon, label, get] of tiles) {
			if (!get()) continue;
			const b = this.createEl.createEl("button", { cls: "sk-launcher-tile" + (first ? " sk-launcher-in" : ""), attr: { type: "button" } });
			setIcon(b.createSpan({ cls: "sk-launcher-tile-icon" }), icon);
			b.createSpan({ text: label });
			b.addEventListener("click", () => {
				const run = get();
				if (run) this.leave(run);
				else this.drawCreate();
			});
		}
	}

	// ----- go -----

	private drawGo(): void {
		this.goEl.empty();
		const wb = this.ctx.workbench;
		const tasks = this.service<TasksReader>("tasks");
		const sessions = this.service<SessionsReader>("sessions");
		const today = moment().format("YYYY-MM-DD");
		const due = tasks ? safe(() => tasks.getTasks().filter((t) => t.due === today).length, 0) : 0;
		const storms = sessions?.list ? safe(() => sessions.list!().filter((s) => s.state !== "closed").length, 0) : 0;
		const go: Array<[string, string, string, string]> = [];
		if (wb.hasTab("home")) go.push(["home", "house", this.t("launcher.home"), ""]);
		if (wb.hasTab("tasks")) go.push(["tasks", "list-checks", this.t("launcher.tasks"), due ? this.tn("launcher.today", due) : ""]);
		if (wb.hasTab("sessions")) go.push(["sessions", "zap", this.t("launcher.brainstorms"), storms ? String(storms) : ""]);
		const bar = this.goEl;
		for (const [tab, icon, label, count] of go) {
			const b = bar.createEl("button", { cls: "sk-btn is-ghost sk-launcher-go-btn", attr: { type: "button" } });
			setIcon(b.createSpan({ cls: "sk-launcher-go-icon" }), icon);
			b.appendText(label);
			if (count) b.createSpan({ cls: "sk-launcher-n", text: count });
			b.addEventListener("click", () => {
				if (wb.hasTab(tab)) this.leave(() => void wb.open({ tab }));
				else this.drawGo();
			});
		}
		if (!Platform.isMobile) {
			const keys = bar.createSpan({ cls: "sk-launcher-keys" });
			keys.createEl("kbd", { text: "↑↓" });
			keys.appendText(" " + this.t("launcher.key-move") + " ");
			keys.createEl("kbd", { text: "↵" });
			keys.appendText(" " + this.t("launcher.key-open"));
		}
	}

	// ----- the list -----

	private renderList(first: boolean): void {
		for (const el of Array.from(this.listEl.children)) if (el !== this.surface?.cursorEl) el.remove();
		this.rows = [];
		const query = this.input.value.trim();
		if (query) this.drawHits(query);
		else this.drawOpen();
		if (!this.rows.length) this.listEl.createDiv({ cls: "sk-launcher-empty", text: this.t(query ? "launcher.no-match" : "launcher.nothing-open") });
		this.hi = 0;
		if (!first) for (const el of Array.from(this.listEl.querySelectorAll<HTMLElement>(".sk-launcher-in"))) el.removeClass("sk-launcher-in");
		const row = this.rows[0];
		if (!row) {
			this.surface?.clear();
			this.input.removeAttribute("aria-activedescendant");
		} else if (!first || this.still() || !row.el.hasClass("sk-launcher-in")) this.surface?.set(row.el, "key", true);
		else {
			// The cursor is measured on the row: it lands once the row has come in, not while it rises.
			this.mark(0);
			const land = () => {
				if (row.el.isConnected && !this.surface?.current && this.rows[this.hi] === row) this.surface?.set(row.el, "key", true);
			};
			row.el.addEventListener("animationend", land, { once: true });
			row.el.win.setTimeout(land, 900);
		}
	}

	/** The tabs open now (the one the launcher came from left out), then the brainstorms in progress. */
	private drawOpen(): void {
		const ws = this.app.workspace;
		const sessions = this.service<SessionsReader>("sessions");
		const storms = sessions?.list ? safe(() => sessions.list!().filter((s) => s.state !== "closed").slice(0, STORMS), []) : [];
		const stormPaths = new Set(storms.map((s) => s.path));
		const leaves = new Map<string, WorkspaceLeaf>();
		const tabs: Array<{ path: string; activeTime: number }> = [];
		ws.iterateAllLeaves((leaf) => {
			const file = fileOf(this.app.vault.getAbstractFileByPath.bind(this.app.vault), leaf);
			if (!file || isSideLeaf(this.app, leaf)) return;
			const time = (leaf as unknown as { activeTime?: number }).activeTime ?? 0;
			const known = leaves.get(file.path);
			if (!known || ((known as unknown as { activeTime?: number }).activeTime ?? 0) < time) leaves.set(file.path, leaf);
			tabs.push({ path: file.path, activeTime: time });
		});
		const open = recentTabs(tabs.filter((t) => !stormPaths.has(t.path)), this.here, OPEN_TABS);
		if (open.length) this.heading(this.t("launcher.open"));
		for (const path of open) {
			const file = this.app.vault.getAbstractFileByPath(path);
			const leaf = leaves.get(path);
			if (!(file instanceof TFile) || !leaf) continue;
			this.noteRow(file, (tab) => {
				if (tab) void ws.getLeaf("tab").openFile(file);
				else {
					ws.setActiveLeaf(leaf, { focus: true });
					void ws.revealLeaf(leaf);
				}
			});
		}
		const shown = storms.filter((s) => s.path !== this.here);
		if (shown.length) this.heading(this.t("launcher.storms"));
		for (const s of shown) {
			const file = this.app.vault.getAbstractFileByPath(s.path);
			if (!(file instanceof TFile)) continue;
			const leaf = leaves.get(s.path);
			this.stormRow(file, s, (tab) => {
				if (leaf && !tab) {
					ws.setActiveLeaf(leaf, { focus: true });
					void ws.revealLeaf(leaf);
				} else void ws.getLeaf(tab ? "tab" : false).openFile(file);
			});
		}
	}

	/** Notes whose name matches what is typed (as the quick switcher finds them), then "Create". */
	private drawHits(query: string): void {
		const match = prepareFuzzySearch(query);
		const scored: Array<{ file: TFile; result: SearchResult; onName: boolean }> = [];
		for (const file of this.app.vault.getFiles()) {
			if (file.extension !== "md" && file.extension !== "canvas") continue;
			const onName = match(file.basename);
			const onPath = onName ? null : match(file.path);
			const result = onName ?? onPath;
			// A match on the path only counts for less than one on the name.
			if (result) scored.push({ file, result: onName ? result : { ...result, score: result.score - 2 }, onName: !!onName });
		}
		scored.sort((a, b) => b.result.score - a.result.score || b.file.stat.mtime - a.file.stat.mtime);
		const hits = scored.slice(0, HITS);
		if (hits.length) this.heading(this.t("launcher.notes"));
		for (const hit of hits) this.noteRow(hit.file, (tab) => void this.app.workspace.getLeaf(tab ? "tab" : false).openFile(hit.file), hit.onName ? hit.result : null);
		const home = this.service<HomeService>("home");
		const same = this.app.vault.getMarkdownFiles().some((f) => f.basename.toLowerCase() === query.toLowerCase());
		if (home?.newNote && !same) {
			const el = this.row("is-new is-gray");
			setIcon(el.createDiv({ cls: "sk-launcher-pill is-new" }), "plus");
			const title = el.createSpan({ cls: "sk-launcher-title" });
			title.appendText(this.t("launcher.create") + " ");
			title.createEl("b", { text: query });
			this.rows.push({ el, run: () => this.leave(() => home.newNote?.({ name: query })) });
		}
	}

	private heading(text: string): void {
		this.listEl.createDiv({ cls: "sk-launcher-head sk-launcher-in", text, attr: { "aria-hidden": "true" } });
	}

	private row(cls = ""): HTMLElement {
		const i = this.rows.length;
		const el = this.listEl.createDiv({ cls: `sk-launcher-row sk-surface-item sk-launcher-in ${cls}`.trim(), attr: { "data-nav": "", role: "option", id: `${this.uid}-row-${i}` } });
		// A row chosen while it was still rising is measured again once it has landed.
		el.addEventListener("animationend", () => {
			if (this.surface?.current === el) this.surface.repaint(true);
		}, { once: true });
		el.addEventListener("mousedown", (e) => e.preventDefault());
		el.addEventListener("click", (e) => this.rows[i]?.run(e.ctrlKey || e.metaKey));
		return el;
	}

	/** A note: the pill of its domain (its initial, in the domain's hue), its name, where it sits. A brainstorm keeps its lightning. */
	private noteRow(file: TFile, run: (tab: boolean) => void, result: SearchResult | null = null): void {
		const places = this.service<PlacesService>("places");
		const sessions = this.service<SessionsReader>("sessions");
		const place = places && file.extension === "md" ? safe(() => places.placeOf(file), null) : null;
		const area = place?.area ?? null;
		const storm = !!sessions && safe(() => sessions.isSession(file), false);
		const el = this.row(area ? "" : "is-gray");
		const pill = el.createDiv({ cls: "sk-launcher-pill" + (storm ? " is-storm" : "") });
		if (area && places) el.setCssProps({ "--sk-hue": String(places.hueOf(area.path)) });
		if (storm) setIcon(pill, "zap");
		else if (area) pill.setText(Array.from(area.basename)[0]?.toUpperCase() ?? "");
		else setIcon(pill, file.extension === "canvas" ? "layout-dashboard" : "file");
		const title = el.createSpan({ cls: "sk-launcher-title" });
		marked(title, file.basename, result);
		const homePath = places ? safe(() => places.homePath(), null) : null;
		const home = homePath ? this.app.vault.getAbstractFileByPath(homePath) : null;
		const where = place ? crumb(place.chain.map((f) => f.basename), home instanceof TFile ? home.basename : null) : file.parent && file.parent.path !== "/" ? file.parent.path : "";
		if (where) el.createSpan({ cls: "sk-launcher-where", text: where });
		this.rows.push({ el, run: (tab) => this.leave(() => run(tab)) });
	}

	/** A brainstorm in progress: its steps (the frieze of the Brainstorms tab) and what waits in it. */
	private stormRow(file: TFile, s: { state: string; pending?: number; undecided: number }, run: (tab: boolean) => void): void {
		const places = this.service<PlacesService>("places");
		const area = places ? safe(() => places.placeOf(file).area, null) : null;
		const el = this.row(area ? "" : "is-gray");
		if (area && places) el.setCssProps({ "--sk-hue": String(places.hueOf(area.path)) });
		setIcon(el.createDiv({ cls: "sk-launcher-pill is-storm" }), "zap");
		el.createSpan({ cls: "sk-launcher-title", text: file.basename });
		const step = s.state === "to-sort" ? 1 : 0;
		const steps = el.createSpan({ cls: "sk-sessions-mini sk-launcher-steps", attr: { "aria-hidden": "true" } });
		for (let k = 0; k < 4; k++) {
			if (k) steps.createEl("b", { cls: k <= step ? "is-done" : "" });
			steps.createEl("i", { cls: k < step ? "is-done" : k === step ? "is-current" : "" });
		}
		const waiting = s.state === "to-sort" && s.pending ? this.tn("launcher.to-sort", s.pending) : s.undecided ? this.tn("launcher.to-decide", s.undecided) : "";
		el.createSpan({ cls: "sk-launcher-state", text: waiting });
		this.rows.push({ el, run: (tab) => this.leave(() => run(tab)) });
	}

	// ----- keys -----

	private onKey(e: KeyboardEvent): void {
		if (e.isComposing) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			if (!this.rows.length) return;
			const n = this.rows.length;
			this.go((this.hi + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
		} else if (e.key === "Enter") {
			e.preventDefault();
			this.rows[this.hi]?.run(e.ctrlKey || e.metaKey);
		}
	}

	private go(i: number): void {
		const row = this.rows[i];
		if (!row || !this.surface) return;
		this.surface.set(row.el, "key");
		this.surface.reveal(row.el);
	}

	private mark(i: number): void {
		this.hi = i;
		this.rows.forEach((r, k) => r.el.setAttr("aria-selected", String(k === i)));
		const row = this.rows[i];
		if (row) this.input.setAttr("aria-activedescendant", row.el.id);
	}

	/** Closes, then does `run` (a note opens where the launcher was asked for, a window opens on top). */
	private leave(run: () => void): void {
		this.close();
		try {
			run();
		} catch (error) {
			console.error("[Snailkit] mouse gestures: a launcher action failed", error);
		}
	}
}

/**
 * The file shown in a tab. A tab in the background is not loaded yet (Obsidian defers it): its
 * view has no file, its state still names it.
 */
function fileOf(find: (path: string) => unknown, leaf: WorkspaceLeaf): TFile | null {
	const shown = (leaf.view as { file?: unknown }).file;
	if (shown instanceof TFile) return shown;
	const path = leaf.getViewState().state?.file;
	const file = typeof path === "string" ? find(path) : null;
	return file instanceof TFile ? file : null;
}

/** The name, the letters that match what is typed in bold. */
function marked(el: HTMLElement, text: string, result: SearchResult | null): void {
	if (!result?.matches.length) {
		el.setText(text);
		return;
	}
	let at = 0;
	for (const [from, to] of result.matches) {
		if (from > at) el.appendText(text.slice(at, from));
		el.createEl("mark", { text: text.slice(from, to) });
		at = to;
	}
	if (at < text.length) el.appendText(text.slice(at));
}

function safe<T>(read: () => T, fallback: T): T {
	try {
		return read();
	} catch {
		return fallback;
	}
}
