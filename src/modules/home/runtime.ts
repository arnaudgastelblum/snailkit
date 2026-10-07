// The Home module while it runs: its tab in the Workbench, the automatic opening, the places
// options, recent notes, the arrangement followed through renames, the services it reads (tasks,
// brainstorms, pins, search, tag colors) and the "home" service it publishes.
import { Platform, TFile, type TAbstractFile } from "obsidian";
import type { ModuleContext } from "../../core/context";
import { dailyConfig, getOrCreateDaily, todayKey, todayNote, parseDailyPath, type DailyConfig } from "../../core/daily";
import type { HomeService, NoteRailService, SearchService, SessionsReader, TagColorsReader, TaskInfoLite, TasksReader } from "../../core/services";
import { TAB_ORDER } from "../../core/workbench/types";
import { activity } from "./logic/blocks";
import { arrange, dropPath, liveBlocks, mentions, readingOrder, renamePath, sameArrangement, type Arrangement, type Layout } from "./logic/arrange";
import { isPage, nearestPage } from "./logic/blocks";
import { HomeMapSource, mapStateAt, VAULT_ROOT, type RootEntry } from "./logic/map";
import { cleanOrder, dropFromOrder, orderMentions, orderOf, renameInOrder, type NoteOrder } from "./logic/order";
import { cleanRecents, dropRecent, pushRecent, renameRecent, seedRecents, type Recent } from "./logic/recents";
import type { World } from "./logic/world";
import { arrangementOf, cleanSettings, splitFolders, writeArrangement } from "./settings-logic";
import { HomeView } from "./view";
import type { HomeLens, HomeSettings, HomeTabState } from "./types";

const RECENTS_KEY = "snailkit-home-recents";
/** Data changes are drawn once per burst. */
const CHANGE_MS = 150;
/** Typing in a note changes its time and maybe its tags: the Home follows, without hurry. */
const MODIFY_MS = 1200;

export type HomeContext = ModuleContext<HomeSettings>;

export class HomeRuntime {
	readonly views = new Set<HomeView>();
	readonly world: World;
	readonly mapSource: HomeMapSource;
	private recentList: Recent[] = [];
	private changeTimer = 0;
	private modifyTimer = 0;
	private subscriptions: Array<() => void> = [];
	private layoutCache: { key: string; layout: Layout } | null = null;
	/** Latest activity below each note, kept until the vault changes. */
	activityMemo = new Map<string, number>();
	stopped = false;

	constructor(readonly ctx: HomeContext) {
		this.world = obsidianWorld(this);
		this.mapSource = new HomeMapSource(this.world, () => this.mapRoots(), ctx.app.vault.getName(), (parent) => orderOf(this.noteOrder(), parent));
	}

	get app() {
		return this.ctx.app;
	}

	get settings(): HomeSettings {
		return this.ctx.settings;
	}

	t(key: string, vars?: Record<string, string | number>): string {
		return this.ctx.t(key, vars);
	}

	tn(key: string, count: number, vars?: Record<string, string | number>): string {
		return this.ctx.tn(key, count, vars);
	}

	start(): void {
		const { ctx } = this;
		ctx.register(() => this.stop());
		this.applySettings();
		ctx.onSettingsChange(() => {
			this.applySettings();
			this.changed();
		});

		ctx.workbench.addTab({
			id: "home",
			icon: "house",
			label: ctx.t("tab.label"),
			order: TAB_ORDER.home,
			mount: (el, host) => {
				const view = new HomeView(this, el, host);
				this.views.add(view);
				return view;
			},
		});
		ctx.addRibbonIcon("house", ctx.t("ribbon"), () => void this.open());
		ctx.addCommand({ id: "open", name: ctx.t("command.open"), icon: "house", callback: () => void this.open() });
		ctx.provide<HomeService>("home", this.service());

		this.loadRecents();
		const workspace = this.app.workspace;
		ctx.registerEvent(
			workspace.on("file-open", (file) => {
				if (file instanceof TFile && file.extension === "md") this.opened(file.path);
			}),
		);
		ctx.registerEvent(this.app.vault.on("rename", (file, old) => this.renamed(file, old)));
		ctx.registerEvent(this.app.vault.on("delete", (file) => this.deleted(file)));
		ctx.registerEvent(this.app.vault.on("modify", () => this.changedSlowly()));
		ctx.registerEvent(this.app.vault.on("create", () => this.changed()));
		ctx.registerEvent(this.app.metadataCache.on("changed", () => this.changedSlowly()));
		const offPlaces = ctx.places.onChange(() => this.changed());
		ctx.register(offPlaces);
		this.subscribe();
		ctx.onServicesChange(() => {
			this.subscribe();
			this.changed();
			for (const view of this.views) view.servicesChanged();
		});
	}

	private stop(): void {
		this.stopped = true;
		window.clearTimeout(this.changeTimer);
		window.clearTimeout(this.modifyTimer);
		for (const off of this.subscriptions.splice(0)) off();
		for (const view of [...this.views]) view.destroy();
		this.views.clear();
	}

	/** The places options and the automatic opening follow the settings. */
	private applySettings(): void {
		const settings = cleanSettings(this.settings);
		this.ctx.configurePlaces({ home: settings.homePage, ignoredFolders: splitFolders(settings.ignoredFolders) });
		this.ctx.workbench.setAutoOpen(settings.openWorkbench, "home");
	}

	/** Listens to the services that are on now (they come and go with their modules). */
	private subscribe(): void {
		for (const off of this.subscriptions.splice(0)) off();
		const tasks = this.tasks();
		if (tasks) this.subscriptions.push(safeOff(() => tasks.on("change", () => this.changed())));
		const sessions = this.sessions();
		if (sessions?.onChange) this.subscriptions.push(safeOff(() => sessions.onChange!(() => this.changed())));
		const rail = this.rail();
		if (rail) this.subscriptions.push(safeOff(() => rail.onPinsChange(() => this.changed())));
	}

	// ----- services read -----

	tasks(): TasksReader | undefined {
		const s = this.ctx.service<TasksReader>("tasks");
		return s && s.version === 1 && typeof s.getTasks === "function" ? s : undefined;
	}

	sessions(): SessionsReader | undefined {
		const s = this.ctx.service<SessionsReader>("sessions");
		return s && s.version === 1 && typeof s.isSession === "function" ? s : undefined;
	}

	rail(): NoteRailService | undefined {
		const s = this.ctx.service<NoteRailService>("note-rail");
		return s && s.version === 1 && typeof s.vaultPins === "function" ? s : undefined;
	}

	search(): SearchService | undefined {
		const s = this.ctx.service<SearchService>("search");
		return s && s.version === 1 && typeof s.attach === "function" ? s : undefined;
	}

	tagClasses(tag: string): string {
		const s = this.ctx.service<TagColorsReader>("tag-colors");
		if (!s || s.version !== 1 || typeof s.classes !== "function") return "";
		try {
			return s.classes(tag) || "";
		} catch {
			return "";
		}
	}

	/** Open tasks (and done ones when asked), or null without the Tasks module. */
	taskList(includeDone = false): TaskInfoLite[] | null {
		const tasks = this.tasks();
		if (!tasks) return null;
		try {
			return tasks.getTasks({ includeDone });
		} catch (error) {
			console.error("[Snailkit] home: could not read the tasks", error);
			return null;
		}
	}

	brainstorms(): ReturnType<NonNullable<SessionsReader["list"]>> | null {
		const sessions = this.sessions();
		if (!sessions?.list) return null;
		try {
			return sessions.list();
		} catch {
			return null;
		}
	}

	dailyConfig(): DailyConfig {
		return dailyConfig(this.app, this.rail());
	}

	todayNote(): TFile | null {
		return todayNote(this.app, this.dailyConfig());
	}

	/** "YYYY-MM-DD" of a daily note, or null. */
	dayOf(path: string): string | null {
		return parseDailyPath(path, this.dailyConfig());
	}

	async openDaily(event?: MouseEvent | KeyboardEvent, open?: (path: string) => void): Promise<void> {
		const existed = !!this.todayNote();
		const file = await getOrCreateDaily(this.app, todayKey(), this.dailyConfig());
		if (!existed) this.ctx.toast(this.t("toast.created"));
		if (open) open(file.path);
		else await this.app.workspace.getLeaf(event && (event.ctrlKey || event.metaKey) ? "tab" : false).openFile(file);
	}

	// ----- arrangement -----

	arrangement(): Arrangement {
		return arrangementOf(this.settings);
	}

	/** Saves a new arrangement (the views redraw through onSettingsChange). */
	async setArrangement(arr: Arrangement): Promise<void> {
		if (sameArrangement(arr, this.arrangement())) return;
		writeArrangement(this.settings, arr);
		this.layoutCache = null;
		await this.ctx.saveSettings();
	}

	/** The blocks of the Domains view in their order (cached until the data or the arrangement change). */
	layout(): Layout {
		const arr = this.arrangement();
		const key = JSON.stringify(arr);
		if (this.layoutCache?.key === key) return this.layoutCache.layout;
		const layout = arrange(liveBlocks(this.world, arr), arr, (id) => this.activity(id), (id) => this.world.name(id));
		this.layoutCache = { key, layout };
		return layout;
	}

	/** The order of the notes the user dragged on the Map, per parent. */
	noteOrder(): NoteOrder {
		return cleanOrder(this.settings.noteOrder);
	}

	async setNoteOrder(order: NoteOrder): Promise<void> {
		this.settings.noteOrder = order.map(([parent, kids]) => [parent, [...kids]]);
		this.mapSource.invalidate();
		await this.ctx.saveSettings();
	}

	activity(path: string): number {
		return activity(this.world, path, this.activityMemo);
	}

	/** The Map's first column: the Domains view's order, without hidden or pulled-out blocks. */
	private mapRoots(): RootEntry[] {
		const layout = this.layout();
		const out: RootEntry[] = [];
		const other = layout.sections.some((s) => s.group) ? this.t("domains.other") : null;
		if (layout.featured?.kind === "domain") out.push({ path: layout.featured.id, group: null });
		for (const section of layout.sections) {
			for (const block of section.blocks) if (block.kind === "domain") out.push({ path: block.id, group: section.group?.name ?? other });
		}
		return out;
	}

	domainSet(): Set<string> {
		return new Set(this.world.domains());
	}

	pulledSet(): Set<string> {
		return new Set(this.layout().order.filter((b) => b.kind === "pulled").map((b) => b.id));
	}

	/** Visible blocks in reading order (featured first). */
	readingOrder() {
		return readingOrder(this.layout());
	}

	// ----- recent notes -----

	recents(): Recent[] {
		return this.recentList;
	}

	private loadRecents(): void {
		let stored: unknown = null;
		try {
			stored = this.app.loadLocalStorage(RECENTS_KEY);
		} catch {
			/* nothing kept */
		}
		const list = cleanRecents(stored);
		this.recentList = list.length ? list : seedRecents(this.app.workspace.getLastOpenFiles?.() ?? []);
	}

	private saveRecents(): void {
		try {
			this.app.saveLocalStorage(RECENTS_KEY, this.recentList);
		} catch {
			/* not kept: shown until Obsidian closes */
		}
	}

	private opened(path: string): void {
		this.recentList = pushRecent(this.recentList, path, Date.now());
		this.saveRecents();
		this.changed();
	}

	// ----- the vault changes -----

	/** Data changed: the views redraw soon (once per burst). */
	changed(): void {
		if (this.stopped) return;
		window.clearTimeout(this.changeTimer);
		this.changeTimer = window.setTimeout(() => {
			if (this.stopped) return;
			this.layoutCache = null;
			this.activityMemo = new Map();
			this.mapSource.invalidate();
			for (const view of this.views) view.dataChanged();
		}, CHANGE_MS);
	}

	private changedSlowly(): void {
		if (this.stopped) return;
		window.clearTimeout(this.modifyTimer);
		this.modifyTimer = window.setTimeout(() => this.changed(), MODIFY_MS);
	}

	private renamed(file: TAbstractFile, old: string): void {
		if (!(file instanceof TFile)) return;
		if (this.recentList.some((r) => r.path === old)) {
			this.recentList = renameRecent(this.recentList, old, file.path);
			this.saveRecents();
		}
		const arr = this.arrangement();
		if (mentions(arr, old)) void this.setArrangement(renamePath(arr, old, file.path));
		const order = this.noteOrder();
		if (orderMentions(order, old)) void this.setNoteOrder(renameInOrder(order, old, file.path));
		if (this.settings.homePage && [old, old.replace(/\.md$/, "")].includes(this.settings.homePage)) {
			this.settings.homePage = file.path;
			void this.ctx.saveSettings();
		}
		for (const view of this.views) view.renamed(old, file.path);
		this.changed();
	}

	private deleted(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		if (this.recentList.some((r) => r.path === file.path)) {
			this.recentList = dropRecent(this.recentList, file.path);
			this.saveRecents();
		}
		const arr = this.arrangement();
		if (mentions(arr, file.path)) void this.setArrangement(dropPath(arr, file.path));
		const order = this.noteOrder();
		if (orderMentions(order, file.path)) void this.setNoteOrder(dropFromOrder(order, file.path));
		this.changed();
	}

	// ----- opening -----

	/** The Workbench on Home with a state (the Home root by default). */
	async show(state: HomeTabState, focus = true): Promise<boolean> {
		const instance = await this.ctx.workbench.open({ tab: "home", state: state as unknown as Record<string, unknown>, focus });
		return !!instance;
	}

	async open(): Promise<void> {
		await this.show({ page: null });
	}

	/** The page of a domain or sub-MOC; `here`: the note to put under the cursor. */
	async openDomain(path: string, here?: string): Promise<boolean> {
		if (!isPage(this.world, path, this.domainSet(), this.pulledSet())) return false;
		return this.show({ page: here ? { kind: "domain", path, here } : { kind: "domain", path } });
	}

	async openPlace(file: TFile): Promise<boolean> {
		const home = this.world.home();
		if (file.path === home) {
			await this.openMap(file.path);
			return true;
		}
		const page = nearestPage(this.world, file.path, this.domainSet(), this.pulledSet());
		if (!page) return false;
		return this.show({ page: { kind: "domain", path: page, here: file.path } });
	}

	async openTag(tag: string): Promise<boolean> {
		const clean = String(tag ?? "").replace(/^#/, "").trim();
		if (!clean) return false;
		return this.show({ page: { kind: "tag", tag: clean } });
	}

	async openMap(path?: string, here?: string): Promise<void> {
		const source = this.mapSource;
		source.invalidate();
		let root = path && source.node(path) ? path : source.home();
		// A note without children shows its parent's branch, itself marked.
		if (root !== source.home() && !source.node(root)?.hasChildren) root = source.parent(root) ?? source.home();
		const map = mapStateAt(source, root, here ?? path ?? null);
		await this.setLens("map");
		await this.show({ page: null, lens: "map", map });
	}

	/** Keeps the last view (map, domains, tags); `chosen`: picked by the user, so the Home opens on it. */
	async setLens(lens: HomeLens, chosen = false): Promise<void> {
		if (this.settings.lens === lens && (!chosen || this.settings.lensChosen)) return;
		this.settings.lens = lens;
		if (chosen) this.settings.lensChosen = true;
		await this.ctx.saveSettings();
	}

	private service(): HomeService {
		return {
			version: 1,
			open: () => this.open(),
			openPlace: (file) => (file instanceof TFile ? this.openPlace(file) : Promise.resolve(false)),
			openDomain: (path) => (typeof path === "string" ? this.openDomain(path) : Promise.resolve(false)),
			openTag: (tag) => this.openTag(tag),
			openMap: (path) => this.openMap(typeof path === "string" ? path : undefined),
		};
	}

	/** True on phones and small tablets: touch first, no hover, no drag. */
	get touch(): boolean {
		return Platform.isMobile;
	}
}

function safeOff(subscribe: () => unknown): () => void {
	try {
		const off = subscribe();
		return typeof off === "function" ? (off as () => void) : () => undefined;
	} catch (error) {
		console.error("[Snailkit] home: could not listen to a service", error);
		return () => undefined;
	}
}

/** World (logic/world.ts) over Obsidian: the places service, the vault and Brainstorm. */
function obsidianWorld(rt: HomeRuntime): World {
	const { app } = rt.ctx;
	const places = rt.ctx.places;
	const file = (path: string): TFile | null => {
		const f = app.vault.getFileByPath?.(path) ?? app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	};
	return {
		home: () => places.homePath(),
		domains: () => places.domains().map((f) => f.path),
		children: (path) => (path === VAULT_ROOT ? [] : places.childrenOf(path).map((f) => f.path)),
		hasChildren: (path) => path !== VAULT_ROOT && places.hasChildren(path),
		parent: (path) => {
			const f = file(path);
			return f ? places.parentOf(f)?.path ?? null : null;
		},
		exists: (path) => !!file(path),
		name: (path) => file(path)?.basename ?? path.replace(/^.*\//, "").replace(/\.md$/, ""),
		mtime: (path) => file(path)?.stat.mtime ?? 0,
		isBrainstorm: (path) => {
			const sessions = rt.sessions();
			const f = sessions ? file(path) : null;
			try {
				return !!(f && sessions!.isSession(f));
			} catch {
				return false;
			}
		},
		isDrawing: (path) => {
			const f = file(path);
			if (!f) return false;
			if (/\.excalidraw$/i.test(f.basename)) return true;
			const fm = app.metadataCache.getFileCache(f)?.frontmatter;
			return !!fm && "excalidraw-plugin" in fm;
		},
		hue: (path) => places.hueOf(path),
	};
}
